"""Stem sources behind one interface.

    stems.separate("demucs", Path("track.flac"))     -> StemSet
    python3 tools/loop/stems.py status               # which sources can run here
    python3 tools/loop/stems.py demucs track.mp3     # separate one file, print where the stems went

A source turns one audio file into a set of stem files, normalised to the common
labels `vocals`, `drums`, `bass` and `other`, plus any extras the source provides
(`guitar`, `piano` and so on). The sources:

    user        stems the user already has: label them, nothing is separated
    lalal       LALAL.AI (hosted)                      LALALAI_API_KEY
    musicai     Music.ai (hosted)                      MUSICAI_API_KEY, MUSICAI_STEMS_WORKFLOW
    fal_demucs  Demucs hosted on fal.ai                FAL_KEY
    demucs      Demucs run locally (htdemucs)          needs the model environment
    demucs_ft   Demucs run locally (htdemucs_ft: four fine-tuned models, about 4x slower)

Keys are read from the environment, then from a `.env` file at the repository root.
They are never printed, logged or written anywhere, and are scrubbed from error text.

Everything a source produces is cached under .loop/cache/stems, keyed by the audio's
checksum and the source's settings, so a paid separation is never bought twice and a
bundle built from stored stems never changes. The StemSet records which source made
the stems; the analysis bundle carries that through.

Each source is registered as an analyser in analysers.py and scored against the
true stems of tracker modules by the accuracy loop.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".loop" / "cache" / "stems"
COMMON = ("vocals", "drums", "bass", "other")
RATE = 44100  # sample rate of residual stems computed here; provider files keep their own

# Whatever a source or a user calls a stem, mapped to the common labels. Anything
# not listed keeps its own (lower-case) name and is carried as an extra.
LABELS = {
    "vocals": "vocals", "vocal": "vocals", "voice": "vocals", "vox": "vocals", "lead_vocals": "vocals",
    "drums": "drums", "drum": "drums", "percussion": "drums", "perc": "drums", "kit": "drums",
    "bass": "bass", "bassline": "bass", "sub": "bass",
    "other": "other", "others": "other", "rest": "other", "music": "other", "instruments": "other",
    "guitars": "guitar", "guitar": "guitar", "electric_guitar": "guitar", "acoustic_guitar": "acoustic_guitar",
    "keys": "keys", "piano": "piano", "strings": "strings", "wind": "wind", "synthesizer": "synth", "synth": "synth",
}  # fmt: skip
AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aac", ".aif", ".aiff", ".opus"}
POLL_SECONDS = 5.0
JOB_TIMEOUT_SECONDS = 1800.0


class StemError(RuntimeError):
    """A source could not produce stems. The message is safe to print: keys are scrubbed."""


class Unavailable(StemError):
    """A source cannot run on this machine (no key, package not installed)."""


@dataclass
class StemSet:
    source: str  # which source produced these (recorded in the analysis bundle)
    files: dict[str, Path]  # label -> audio file
    detail: dict = field(default_factory=dict)  # model, provider settings, anything worth recording

    def labels(self) -> list[str]:
        return sorted(self.files)


def normalise_label(name: str) -> str:
    key = name.strip().lower().replace(" ", "_").replace("-", "_")
    return LABELS.get(key, key)


# ------------------------------------------------------------------ keys


def _dotenv() -> dict[str, str]:
    path = ROOT / ".env"
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[name] = value
    return values


def setting(name: str) -> str | None:
    """A key or setting from the environment, else from .env. Never log the result."""
    return os.environ.get(name) or _dotenv().get(name) or None


def _scrub(text: str) -> str:
    for name in ("LALALAI_API_KEY", "MUSICAI_API_KEY", "FAL_KEY"):
        secret = setting(name)
        if secret:
            text = text.replace(secret, "***")
            for part in secret.split(":"):  # fal keys are id:secret
                if len(part) >= 8:
                    text = text.replace(part, "***")
    return text


# ------------------------------------------------------------------ plumbing


def _http(method: str, url: str, headers: dict | None = None, data: bytes | None = None, timeout: float = 120.0) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": "octoseq-loop/0.1", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise StemError(_scrub(f"{method} {url.split('?')[0]} failed: {error}")) from None


def _json(method: str, url: str, headers: dict | None = None, body: dict | None = None, ok: tuple[int, ...] = (200, 201, 202), timeout: float = 120.0) -> dict:
    headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    status, raw = _http(method, url, headers, data, timeout)
    if status not in ok:
        raise StemError(_scrub(f"{method} {url.split('?')[0]} returned {status}: {raw[:400].decode(errors='replace')}"))
    try:
        return json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        raise StemError(_scrub(f"{method} {url.split('?')[0]} did not return JSON: {raw[:200].decode(errors='replace')}")) from None


def _download(url: str, path: Path) -> None:
    if not url.lower().startswith(("https://", "http://")):
        raise StemError("a provider returned a download address that is not a web address")
    status, raw = _http("GET", url, timeout=600.0)
    if status != 200 or not raw:
        raise StemError(_scrub(f"downloading a stem returned {status}"))
    path.write_bytes(raw)


def _ffmpeg(args: list[str]) -> None:
    result = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise StemError(f"ffmpeg failed: {result.stderr.strip()[-300:]}")


def decode(path: Path, rate: int = RATE, channels: int = 2) -> np.ndarray:
    """Audio as float32, shape (frames, channels)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", str(channels), "-ar", str(rate), "-f", "f32le", "-"]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise StemError(f"could not decode {path.name}: {result.stderr.decode(errors='replace').strip()[-200:]}")
    return np.frombuffer(result.stdout, dtype=np.float32).reshape(-1, channels).copy()


def write_flac(path: Path, audio: np.ndarray, rate: int = RATE) -> None:
    """Write float audio (frames, channels) as 24-bit FLAC."""
    audio = np.atleast_2d(audio.T).T.astype("<f4")
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", str(audio.shape[1]), "-i", "-",
           "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", str(path)]  # fmt: skip
    result = subprocess.run(cmd, input=audio.tobytes(), capture_output=True)
    if result.returncode != 0:
        raise StemError(f"could not write {path.name}: {result.stderr.decode(errors='replace').strip()[-200:]}")


def _lag(reference: np.ndarray, other: np.ndarray, rate: int, max_s: float = 0.25) -> int:
    """How many samples `other` is delayed against `reference` (mono arrays)."""
    n = min(len(reference), len(other), rate * 60)
    a, b = reference[:n] - reference[:n].mean(), other[:n] - other[:n].mean()
    size = 1 << int(np.ceil(np.log2(2 * n)))
    corr = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    max_lag = int(max_s * rate)
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    return int(lags[int(np.argmax(np.concatenate([corr[: max_lag + 1], corr[-max_lag:]])))])


def residual(audio: Path, stem_files: list[Path], out: Path) -> dict:
    """Write what is left of `audio` once the given stems are taken out of it.

    For providers that return one stem at a time: `other` is the mix minus the
    stems that were asked for. That is only right if each stem lines up with the
    mix and is at the same level, so both are measured: a constant delay is
    removed, and the level is fitted by least squares.
    """
    mix = decode(audio)
    rest = mix.copy()
    notes = {}
    for path in stem_files:
        stem = decode(path)
        lag = _lag(mix.mean(axis=1), stem.mean(axis=1), RATE)
        if lag > 0:
            stem = stem[lag:]
        elif lag < 0:
            stem = np.concatenate([np.zeros((-lag, stem.shape[1]), dtype=np.float32), stem])
        n = min(len(rest), len(stem))
        stem = stem[:n]
        energy = float(np.vdot(stem, stem))
        gain = float(np.vdot(stem, mix[:n]) / energy) if energy > 1e-9 else 1.0
        # A separated stem is correlated with the mix it came from, so the fitted gain
        # of a faithful stem is a little over 1. Only correct a level that is clearly off.
        applied = 1.0 if 0.7 < gain < 1.5 else gain
        rest[:n] -= applied * stem
        notes[path.stem] = dict(lag_samples=lag, fitted_gain=round(gain, 3), applied_gain=round(applied, 3))
    write_flac(out, rest)
    return notes


def _cache_dir(source: str, audio: Path, settings: dict, cache: Path) -> Path:
    h = hashlib.sha256(audio.read_bytes())
    h.update(json.dumps(settings, sort_keys=True).encode())
    return cache / source / h.hexdigest()[:24]


def _cached(directory: Path, source: str) -> StemSet | None:
    manifest = directory / "stems.json"
    if not manifest.exists():
        return None
    data = json.loads(manifest.read_text())
    files = {label: directory / name for label, name in data["files"].items()}
    if not all(p.exists() for p in files.values()):
        return None
    return StemSet(source=source, files=files, detail=data.get("detail", {}))


def _store(directory: Path, source: str, files: dict[str, Path], detail: dict) -> StemSet:
    detail = dict(detail, created=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    manifest = dict(source=source, files={label: path.name for label, path in files.items()}, detail=detail)
    (directory / "stems.json").write_text(json.dumps(manifest, indent=1))
    return StemSet(source=source, files=files, detail=detail)


def _wait(describe: str, poll, timeout: float = JOB_TIMEOUT_SECONDS):
    """Call `poll()` until it returns something other than None."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = poll()
        if result is not None:
            return result
        time.sleep(POLL_SECONDS)
    raise StemError(f"{describe} did not finish within {timeout / 60:.0f} minutes")


# ------------------------------------------------------------------ user-supplied stems


def user(audio: Path, cache: Path = CACHE, files: dict[str, Path] | None = None, directory: Path | None = None, **_) -> StemSet:
    """Stems the user already has. Nothing is separated and nothing is copied.

    Give `files` (label -> file), or a `directory` of audio files named by label
    (`drums.wav`, `Vocals.flac`), optionally with a `stems.json` mapping label to
    file name for files named some other way. With neither, the directory is
    looked for beside the track: `song.mp3` -> `song.stems/`.
    """
    if files is None:
        directory = directory or audio.with_suffix(".stems")
        if not directory.is_dir():
            raise Unavailable(f"no user-supplied stems: {directory} does not exist")
        mapping = directory / "stems.json"
        if mapping.exists():
            files = {label: directory / name for label, name in json.loads(mapping.read_text()).items()}
        else:
            files = {p.stem: p for p in sorted(directory.iterdir()) if p.suffix.lower() in AUDIO_SUFFIXES}
    out: dict[str, Path] = {}
    for label, path in files.items():
        path = Path(path)
        if not path.exists():
            raise StemError(f"user-supplied stem {label!r} points at {path}, which does not exist")
        label = normalise_label(label)
        if label in out:
            raise StemError(f"two user-supplied stems are both labelled {label!r}")
        out[label] = path
    if not out:
        raise StemError("no user-supplied stem files found")
    return StemSet(source="user", files=out, detail=dict(supplied=sorted(out)))


# ------------------------------------------------------------------ LALAL.AI

LALAL = "https://www.lalal.ai/api/v1"
LALAL_STEM = {"vocals": "vocals", "drums": "drum", "bass": "bass"}  # their names for the stems we ask for


def lalal_minutes_left() -> float | None:
    key = setting("LALALAI_API_KEY")
    if not key:
        return None
    return _json("POST", f"{LALAL}/limits/minutes_left/", {"X-License-Key": key}).get("minutes_left")


def lalal(audio: Path, cache: Path = CACHE, want: tuple[str, ...] = COMMON, splitter: str = "auto", **_) -> StemSet:
    """LALAL.AI, API v1. One stem per task, so each wanted stem is a separate (billed) task.

    `other` is not something LALAL.AI separates when drums and bass are also taken
    out, so it is computed here as the mix minus the stems that were asked for.
    """
    asked = [s for s in want if s in LALAL_STEM]
    settings = dict(api="v1", splitter=splitter, stems=asked, other="residual" if "other" in want else None)
    directory = _cache_dir("lalal", audio, settings, cache)
    if hit := _cached(directory, "lalal"):
        return hit
    key = setting("LALALAI_API_KEY")
    if not key:
        raise Unavailable("LALALAI_API_KEY is not set")
    directory.mkdir(parents=True, exist_ok=True)
    auth = {"X-License-Key": key}

    status, raw = _http("POST", f"{LALAL}/upload/", {**auth, "Content-Disposition": f"attachment; filename=track{audio.suffix}", "Content-Type": "application/octet-stream"}, audio.read_bytes(), timeout=900.0)  # fmt: skip
    if status != 200:
        raise StemError(_scrub(f"LALAL.AI upload returned {status}: {raw[:300].decode(errors='replace')}"))
    source_id = json.loads(raw)["id"]
    try:
        tasks = {}
        for stem in asked:
            body = dict(source_id=source_id, presets=dict(stem=LALAL_STEM[stem], splitter=splitter, encoder_format="flac"))
            tasks[_json("POST", f"{LALAL}/split/stem_separator/", auth, body)["task_id"]] = stem

        def poll():
            result = _json("POST", f"{LALAL}/check/", auth, dict(task_ids=list(tasks)))["result"]
            for task_id, entry in result.items():
                if entry.get("status") in ("error", "cancelled", "server_error"):
                    raise StemError(_scrub(f"LALAL.AI task for {tasks.get(task_id)} ended as {entry.get('status')}: {str(entry.get('error'))[:300]}"))
            return result if all(e.get("status") == "success" for e in result.values()) and len(result) == len(tasks) else None

        result = _wait("LALAL.AI separation", poll)
        files: dict[str, Path] = {}
        models = {}
        for task_id, entry in result.items():
            stem = tasks[task_id]
            track = next(t for t in entry["result"]["tracks"] if t.get("type") == "stem")
            files[stem] = directory / f"{stem}.flac"
            _download(track["url"], files[stem])
            models[stem] = (entry.get("presets") or {}).get("splitter")
    finally:
        try:  # the upload is theirs to keep for a while otherwise; ask for it to be removed now
            _json("POST", f"{LALAL}/delete/", auth, dict(source_id=source_id))
        except StemError:
            pass
    detail = dict(provider="LALAL.AI", api="v1", splitter=splitter, models=models)
    if "other" in want:
        files["other"] = directory / "other.flac"
        detail["residual"] = residual(audio, [files[s] for s in asked], files["other"])
    return _store(directory, "lalal", files, detail)


# ------------------------------------------------------------------ Music.ai

MUSICAI = "https://api.music.ai/v1"


def musicai(audio: Path, cache: Path = CACHE, workflow: str | None = None, **_) -> StemSet:
    """Music.ai. UNVERIFIED: written from the published API reference, never run against the service.

    Music.ai runs a named workflow. The reference documents no ready-made workflow
    that returns vocals, drums, bass and other, so one has to be created in the
    Music.ai dashboard (the "Musical Stems" module) and its slug given in
    MUSICAI_STEMS_WORKFLOW. Result keys are taken as stem names.
    """
    workflow = workflow or setting("MUSICAI_STEMS_WORKFLOW")
    settings = dict(api="v1", workflow=workflow)
    directory = _cache_dir("musicai", audio, settings, cache)
    if hit := _cached(directory, "musicai"):
        return hit
    key = setting("MUSICAI_API_KEY")
    if not key:
        raise Unavailable("MUSICAI_API_KEY is not set")
    if not workflow:
        raise Unavailable("MUSICAI_STEMS_WORKFLOW is not set (the slug of a stem-separation workflow in your Music.ai account)")
    directory.mkdir(parents=True, exist_ok=True)
    auth = {"Authorization": key}

    upload = _json("GET", f"{MUSICAI}/upload", auth)
    status, raw = _http("PUT", upload["uploadUrl"], {"Content-Type": "application/octet-stream"}, audio.read_bytes(), timeout=900.0)
    if status not in (200, 201):
        raise StemError(_scrub(f"Music.ai upload returned {status}: {raw[:300].decode(errors='replace')}"))
    job_id = _json("POST", f"{MUSICAI}/job", auth, dict(name=f"octoseq-{uuid.uuid4().hex[:8]}", workflow=workflow, params=dict(inputUrl=upload["downloadUrl"])))["id"]

    def poll():
        job = _json("GET", f"{MUSICAI}/job/{job_id}", auth)
        if job.get("status") == "FAILED":
            raise StemError(_scrub(f"Music.ai job failed: {json.dumps(job.get('error'))[:300]}"))
        return job if job.get("status") == "SUCCEEDED" else None

    job = _wait("Music.ai separation", poll)
    files: dict[str, Path] = {}
    for name, url in (job.get("result") or {}).items():
        if not isinstance(url, str) or not url.lower().startswith("http"):
            continue
        label = normalise_label(name)
        suffix = Path(urllib.parse.urlparse(url).path).suffix or ".wav"
        files[label] = directory / f"{label}{suffix}"
        _download(url, files[label])
    if not files:
        raise StemError("Music.ai returned no stem files")
    return _store(directory, "musicai", files, dict(provider="Music.ai", workflow=workflow, unverified=True))


# ------------------------------------------------------------------ Demucs on fal.ai

FAL_QUEUE = "https://queue.fal.run/fal-ai/demucs"
FAL_REST = "https://rest.alpha.fal.ai"
FAL_INLINE_LIMIT = 40_000_000  # the queue accepts request bodies up to 64 MiB; base64 adds a third


def _fal_upload(audio: Path, key: str) -> tuple[str, str]:
    """Put a local file where fal.ai can read it. Returns its address and how it got there.

    Uses fal's storage endpoint, the one its own client libraries use. If that is
    refused and the file is small enough, the audio is sent inline instead.
    """
    content_type = {".flac": "audio/flac", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4"}.get(audio.suffix.lower(), "application/octet-stream")
    data = audio.read_bytes()
    try:
        started = _json("POST", f"{FAL_REST}/storage/upload/initiate?storage_type=fal-cdn-v3", {"Authorization": f"Key {key}"}, dict(file_name=f"track{audio.suffix}", content_type=content_type))
        status, raw = _http("PUT", started["upload_url"], {"Content-Type": content_type}, data, timeout=900.0)
        if status not in (200, 201):
            raise StemError(f"fal.ai storage upload returned {status}")
        return started["file_url"], "storage"
    except (StemError, KeyError) as error:
        if len(data) > FAL_INLINE_LIMIT:
            raise StemError(_scrub(f"could not upload to fal.ai storage ({error}) and the file is too large to send inline")) from None
        return f"data:{content_type};base64,{base64.b64encode(data).decode()}", "inline"


def fal_demucs(audio: Path, cache: Path = CACHE, model: str = "htdemucs_ft", shifts: int = 1, **_) -> StemSet:
    """Demucs hosted on fal.ai (the `fal-ai/demucs` endpoint), through fal's queue."""
    settings = dict(endpoint="fal-ai/demucs", model=model, shifts=shifts, output_format="wav")
    directory = _cache_dir("fal_demucs", audio, settings, cache)
    if hit := _cached(directory, "fal_demucs"):
        return hit
    key = setting("FAL_KEY")
    if not key:
        raise Unavailable("FAL_KEY is not set")
    directory.mkdir(parents=True, exist_ok=True)
    auth = {"Authorization": f"Key {key}"}

    # fal.ai lists mp3, ogg, wav, m4a and aac as accepted; FLAC is sent as WAV to be safe.
    upload = audio
    if audio.suffix.lower() not in (".wav", ".mp3", ".ogg", ".m4a", ".aac"):
        upload = directory / "upload.wav"
        _ffmpeg(["-i", str(audio), "-c:a", "pcm_s16le", str(upload)])
    try:
        address, route = _fal_upload(upload, key)
        body = dict(audio_url=address, model=model, stems=list(COMMON), shifts=shifts, output_format="wav")
    finally:
        if upload != audio:
            upload.unlink(missing_ok=True)
    submitted = _json("POST", FAL_QUEUE, auth, body, timeout=900.0)

    def poll():
        status = _json("GET", submitted["status_url"], auth)
        if status.get("status") != "COMPLETED":
            return None
        if status.get("error"):
            raise StemError(_scrub(f"fal.ai request failed: {str(status.get('error'))[:300]}"))
        return status

    status = _wait("fal.ai separation", poll)
    result = _json("GET", submitted["response_url"], auth)
    files: dict[str, Path] = {}
    for name in COMMON + ("guitar", "piano"):
        entry = result.get(name)
        if isinstance(entry, dict) and entry.get("url"):
            files[name] = directory / f"{name}.wav"
            _download(entry["url"], files[name])
    if not files:
        raise StemError("fal.ai returned no stem files")
    detail = dict(provider="fal.ai", endpoint="fal-ai/demucs", model=model, shifts=shifts, upload=route, inference_seconds=(status.get("metrics") or {}).get("inference_time"))
    return _store(directory, "fal_demucs", files, detail)


# ------------------------------------------------------------------ Demucs, run locally

_demucs_models: dict = {}


def demucs_installed() -> bool:
    import importlib.util

    return bool(importlib.util.find_spec("demucs") and importlib.util.find_spec("torch"))


def demucs(audio: Path, cache: Path = CACHE, model: str = "htdemucs", shifts: int = 1, **_) -> StemSet:
    """Demucs (Rouard, Massa and Défossez, 2023) run on this machine: the GPU if there is one.

    Needs the optional model environment (tools/loop/models/setup.sh). `shifts=1`
    with a fixed seed keeps the result repeatable on one machine.
    """
    settings = dict(model=model, shifts=shifts, version=1)
    source = "demucs" if model == "htdemucs" else f"demucs_{model.removeprefix('htdemucs_')}"
    directory = _cache_dir(source, audio, settings, cache)
    if hit := _cached(directory, source):
        return hit
    if not demucs_installed():
        raise Unavailable("the demucs package is not installed: run tools/loop/models/setup.sh")
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    import analysers  # for the device choice; imported here to avoid a cycle

    device = analysers.model_device()
    if model not in _demucs_models:
        _demucs_models[model] = get_model(model).eval()
    net = _demucs_models[model]
    wav = torch.from_numpy(decode(audio, rate=net.samplerate, channels=net.audio_channels).T.copy())
    # Demucs is trained on audio scaled to unit variance.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    torch.manual_seed(0)
    with torch.no_grad():
        out = apply_model(net, ((wav - mean) / std)[None], device=device, shifts=shifts, split=True, overlap=0.25, progress=False)[0]
    out = (out * std + mean).cpu().numpy()
    directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, stem in zip(net.sources, out):
        files[normalise_label(name)] = directory / f"{normalise_label(name)}.flac"
        write_flac(files[normalise_label(name)], stem.T, rate=net.samplerate)
    return _store(directory, source, files, dict(model=model, shifts=shifts, device=device.split(":")[0]))


def demucs_ft(audio: Path, cache: Path = CACHE, **options) -> StemSet:
    return demucs(audio, cache, model="htdemucs_ft", **options)


# ------------------------------------------------------------------ registry

SOURCES = dict(user=user, lalal=lalal, musicai=musicai, fal_demucs=fal_demucs, demucs=demucs, demucs_ft=demucs_ft)
HOSTED = {"lalal": "LALALAI_API_KEY", "musicai": "MUSICAI_API_KEY", "fal_demucs": "FAL_KEY"}
# Adaptors written from a provider's documentation that have never been run against it.
UNVERIFIED = {"musicai"}


def available(source: str) -> tuple[bool, str]:
    """Whether a source can run here, and if not, why."""
    if source in HOSTED:
        if not setting(HOSTED[source]):
            return False, f"{HOSTED[source]} is not set"
        if source == "musicai" and not setting("MUSICAI_STEMS_WORKFLOW"):
            return False, "MUSICAI_STEMS_WORKFLOW is not set"
        return True, "key is set"
    if source in ("demucs", "demucs_ft"):
        return (True, "installed") if demucs_installed() else (False, "demucs is not installed (tools/loop/models/setup.sh)")
    return True, "needs stem files beside the track"


def separate(source: str, audio: Path, cache: Path = CACHE, **options) -> StemSet:
    """Stems for `audio` from the named source. Raises StemError if it cannot."""
    if source not in SOURCES:
        raise StemError(f"unknown stem source {source!r}; known: {', '.join(SOURCES)}")
    return SOURCES[source](Path(audio), cache, **options)


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "status":
        for name in SOURCES:
            ok, why = available(name)
            flag = "  (unverified)" if name in UNVERIFIED else ""
            print(f"{'ready  ' if ok else 'not run'} {name:11} {why}{flag}")
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in SOURCES:
        print(__doc__.split("\n\n")[1])
        return 2
    try:
        result = separate(sys.argv[1], Path(sys.argv[2]))
    except StemError as error:
        print(f"{sys.argv[1]}: {error}", file=sys.stderr)
        return 1
    for label, path in sorted(result.files.items()):
        print(f"{label:8} {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
