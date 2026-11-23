"""Stand-in audio analyser for the build loop.

Turns an audio file into an Interpretation Package v1 using signal processing only
(no trained models, no external services), so the loop can render real tracks
before the real analysis worker exists. It is deterministic.

This is NOT the analysis worker described in docs/design/redesign-deliverable.md.
It covers only the "signal processing" rows of that design: loudness, spectral
shape, onsets, three fixed frequency bands, and a single-tempo beat grid. When the
real worker lands, the loop should call that instead and this file can go.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 22050
ANALYSER_VERSION = "standin-6"

# Every tunable setting of the analysis. tools/loop/tune.py searches these against
# tracker-module ground truth; if it finds a better set it writes params.json next
# to this file, and that set becomes the default.
DEFAULT_PARAMS = {
    "n_fft": 1024,  # analysis window, samples at 22.05 kHz
    "hop": 441,  # 441 = 50 frames per second
    "log_gain": 100.0,  # compression applied to magnitudes before differencing
    "floor_window_s": 0.5,  # median window that removes the slow-moving flux floor
    "threshold_window_s": 1.0,  # median window of the adaptive peak threshold
    "threshold_k": 0.1,  # how far above that median a peak must be, in standard deviations
    "min_gap_s": 0.08,  # closest two onsets may be
    "onset_shift_s": 0.0,  # added to every onset time, to cancel systematic lateness
    "attack_window_s": 0.3,  # how long after a detection its attack is followed
    "soft_attack_s": 0.04,  # a measured rise slower than this makes the event "soft"
    "soft_shift_s": 0.0,  # added to the time of soft events, to cancel systematic lateness
    "retime_soft": False,  # move soft events to the middle of their rise (see profile_attacks)
}
PARAMS_FILE = Path(__file__).parent / "params.json"


def load_params() -> dict:
    """The tuned parameter set if one has been accepted, otherwise the defaults."""
    params = dict(DEFAULT_PARAMS)
    if PARAMS_FILE.exists():
        params.update(json.loads(PARAMS_FILE.read_text())["params"])
    return params


def params_key(params: dict) -> str:
    return hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:10]

# (id, label, low Hz, high Hz). Labels match what the example scripts expect.
BANDS = [
    ("band-bass", "Bass", 20.0, 200.0),
    ("band-mids", "Mids", 200.0, 2000.0),
    ("band-highs", "Highs", 2000.0, 11000.0),
]

EPOCH = "2026-01-01T00:00:00.000Z"  # fixed, so output never depends on the clock


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def decode_mono(path: Path) -> np.ndarray:
    """Decode any audio file to mono float32 at SAMPLE_RATE using ffmpeg."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-",
    ]  # fmt: skip
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def spectrogram(samples: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """Magnitude spectrogram, shape (frames, n_fft // 2 + 1). Frame i is centred on sample i * hop."""
    pad = n_fft // 2
    padded = np.pad(samples, (pad, pad))
    n_frames = 1 + (len(padded) - n_fft) // hop
    window = np.hanning(n_fft).astype(np.float32)
    out = np.empty((n_frames, n_fft // 2 + 1), dtype=np.float32)
    for start in range(0, n_frames, 2048):  # in blocks, to bound memory on long tracks
        idx = np.arange(n_fft)[None, :] + hop * np.arange(start, min(start + 2048, n_frames))[:, None]
        out[start : start + len(idx)] = np.abs(np.fft.rfft(padded[idx] * window, axis=1))
    return out


def normalise(x: np.ndarray) -> np.ndarray:
    """Min-max to [0, 1], the same normalisation the web exporter applies."""
    lo, hi = float(np.min(x)), float(np.max(x))
    if hi - lo < 1e-12:
        return np.zeros_like(x, dtype=np.float32)
    return ((x - lo) / (hi - lo)).astype(np.float32)


def moving_median(x: np.ndarray, width: int) -> np.ndarray:
    pad = width // 2
    padded = np.pad(x, (pad, pad), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, width)
    return np.median(windows, axis=1)[: len(x)]


def flux_of(mag: np.ndarray, log_gain: float) -> np.ndarray:
    """Half-wave rectified difference of log magnitude, summed over frequency."""
    logmag = np.log1p(log_gain * mag)
    diff = np.diff(logmag, axis=0, prepend=logmag[:1])
    return np.maximum(diff, 0.0).sum(axis=1)


def onset_of(flux: np.ndarray, frame_rate: float, floor_window_s: float) -> np.ndarray:
    """Flux with its slow-moving floor removed, so only attacks remain."""
    floor = moving_median(flux, int(frame_rate * floor_window_s) | 1)
    return np.maximum(flux - floor, 0.0)


def centroid_of(mag: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    total = mag.sum(axis=1)
    return (mag * freqs[None, :]).sum(axis=1) / np.maximum(total, 1e-9)


def pick_peaks(env: np.ndarray, frame_rate: float, params: dict) -> list[tuple[float, float]]:
    """Local maxima above an adaptive threshold, as (time, weight) pairs.

    Peak positions are refined between frames by fitting a parabola through the
    peak and its neighbours, so timing is not limited to the frame spacing.
    """
    threshold = moving_median(env, int(frame_rate * params["threshold_window_s"]) | 1)
    threshold = threshold + params["threshold_k"] * float(np.std(env))
    gap = max(1, int(round(params["min_gap_s"] * frame_rate)))
    picked: list[int] = []
    for i in range(1, len(env) - 1):
        if env[i] > threshold[i] and env[i] >= env[i - 1] and env[i] > env[i + 1]:
            if not picked or i - picked[-1] >= gap:
                picked.append(i)
            elif env[i] > env[picked[-1]]:
                picked[-1] = i
    peaks = []
    for i in picked:
        a, b, c = float(env[i - 1]), float(env[i]), float(env[i + 1])
        denom = a - 2 * b + c
        offset = 0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0.0
        time = (i + float(np.clip(offset, -0.5, 0.5))) / frame_rate + params["onset_shift_s"]
        peaks.append((max(0.0, time), b, i))
    return peaks


def _crossing(env: np.ndarray, level: float) -> float:
    """Fractional index at which a rising envelope first reaches `level`."""
    above = np.flatnonzero(env >= level)
    if not len(above) or above[0] == 0:
        return 0.0
    i = int(above[0])
    span = env[i] - env[i - 1]
    return i - 1 + (float((level - env[i - 1]) / span) if span > 0 else 1.0)


PROFILE_N_FFT, PROFILE_HOP = 512, 110  # a second, finer analysis used only to time attacks (5 ms steps)


def profile_attacks(fine: np.ndarray, peaks: list[tuple[float, float, int]], params: dict) -> list[dict]:
    """Time the attack that follows each detected onset.

    The onset detector fires where new sound first appears, which for a slow attack
    is well before it is heard to arrive. For each detection this follows the level
    of the frequencies that get louder after it, on a 5 ms grid, and reports where
    that rise starts, where it is halfway and where it peaks. An event whose rise is
    slow is labelled soft.

    With `retime_soft`, soft events are also moved to the halfway point. That is
    off by default: on held-out modules it improved soft-event timing by about 2 ms
    and recall by under a point, and cost slightly more than that on percussive
    events. The attack-type labels themselves are barely better than calling
    everything percussive, so treat them as a placeholder for a better analyser.
    """
    rate = SAMPLE_RATE / PROFILE_HOP
    n = len(fine)
    lead = 8  # frames examined before the detection (40 ms)
    reach = max(6, int(round(params["attack_window_s"] * rate)))
    hold = 8  # a peak stands if nothing exceeds it within this many frames (40 ms)
    frames = [int(round(time * rate)) for time, _, _ in peaks]
    events = []
    for k, (time, weight, _) in enumerate(peaks):
        event = dict(time=time, onset=time, peak=time, attack_s=0.0, kind="percussive", weight=weight)
        events.append(event)
        f0 = frames[k]
        start = f0 - lead
        end = min(n - 1, f0 + reach, frames[k + 1] - 2 if k + 1 < len(peaks) else n - 1)
        if start < 0 or end - f0 < 4:
            continue
        seg = fine[start : end + 1]
        before = seg[: lead - 3].mean(axis=0)
        gain = np.maximum(seg[lead:].max(axis=0) - before, 0.0)  # the bins that get louder
        if float(gain.sum()) <= 0.0:
            continue
        env = seg @ (gain / gain.sum())
        env = np.convolve(np.pad(env, 1, mode="edge"), np.ones(3) / 3, mode="valid")
        low = int(np.argmin(env[: lead + 3]))
        top = low
        for j in range(low + 1, len(env)):
            if env[j] > env[top]:
                top = j
            elif j - top >= hold:
                break
        rise = float(env[top] - env[low])
        if top - low < 2 or rise <= 0.0:
            continue
        run = env[low : top + 1]
        at = lambda fraction: (start + low + _crossing(run, env[low] + fraction * rise)) / rate  # noqa: E731
        attack = at(0.9) - at(0.1)
        half = at(0.5)
        event.update(onset=max(0.0, at(0.05)), peak=at(0.95), attack_s=attack)
        if attack > params["soft_attack_s"] and half - time > 0.5 * params["soft_attack_s"]:
            event["kind"] = "soft"
            if params["retime_soft"]:
                event["time"] = max(0.0, half + params["soft_shift_s"])
    return events


def estimate_tempo(onset: np.ndarray, frame_rate: float) -> tuple[float, float]:
    """Single global tempo and the time of the first beat.

    Autocorrelation of the onset envelope with a gentle preference for tempi near
    120 BPM, then a search for the phase that puts most onset energy on the grid.
    Good enough to make beat-synced motion plausible; not a beat tracker.
    """
    x = onset - onset.mean()
    if not np.any(x):
        return 120.0, 0.0
    n = len(x)
    spec = np.fft.rfft(x, 2 * n)
    acf = np.fft.irfft(spec * np.conj(spec))[:n]
    best_bpm, best_score = 120.0, -np.inf
    for bpm in np.arange(60.0, 180.25, 0.25):
        lag = 60.0 / bpm * frame_rate
        # Sample the autocorrelation at this lag and its first two multiples.
        score = 0.0
        for mult, weight in ((1, 1.0), (2, 0.5), (4, 0.25)):
            pos = lag * mult
            i = int(pos)
            if i + 1 >= n:
                continue
            frac = pos - i
            score += weight * ((1 - frac) * acf[i] + frac * acf[i + 1])
        score *= np.exp(-0.5 * (np.log2(bpm / 120.0) / 0.7) ** 2)
        if score > best_score:
            best_bpm, best_score = float(bpm), float(score)

    # Refine tempo and phase together: the grid that collects the most onset
    # energy per beat wins. The autocorrelation alone is only good to ~0.5 BPM,
    # which drifts audibly off the beat over a few minutes.
    frames = np.arange(n)
    steps = 64
    best_phase, best_energy = 0.0, -np.inf
    for bpm in np.arange(best_bpm - 1.5, best_bpm + 1.5001, 0.05):
        period = 60.0 / bpm * frame_rate
        for s in range(steps):
            offset = period * s / steps
            grid = np.arange(offset, n - 1, period)
            energy = float(np.interp(grid, frames, onset).mean())
            if energy > best_energy:
                best_bpm, best_phase, best_energy = float(bpm), offset / frame_rate, energy
    best_bpm = round(best_bpm, 2)
    return best_bpm, best_phase


def _signal(name: str, values: np.ndarray, frame_rate: float) -> dict:
    return {"name": name, "rate": frame_rate, "values": np.round(values, 5).tolist()}


def _events(peaks: list[tuple[float, float]]) -> list[dict]:
    top = max((w for _, w in peaks), default=1.0) or 1.0
    return [{"time": round(t, 4), "weight": round(w / top, 4)} for t, w in peaks]


def _core(audio: Path, params: dict) -> dict:
    """The shared front end: spectrogram, flux, onset envelope, onsets and tempo."""
    samples = decode_mono(audio)
    frame_rate = SAMPLE_RATE / params["hop"]
    mag = spectrogram(samples, params["n_fft"], params["hop"])
    flux = flux_of(mag, params["log_gain"])
    onset = onset_of(flux, frame_rate, params["floor_window_s"])
    bpm, first_beat = estimate_tempo(onset, frame_rate)
    fine = spectrogram(samples, PROFILE_N_FFT, PROFILE_HOP)
    events = profile_attacks(fine, pick_peaks(onset, frame_rate, params), params)
    events.sort(key=lambda e: e["time"])
    return dict(
        samples=samples, duration=len(samples) / SAMPLE_RATE, frame_rate=frame_rate, mag=mag,
        flux=flux, onset=onset, bpm=bpm, first_beat=first_beat, events=events,
        peaks=[(e["time"], e["weight"]) for e in events],
    )  # fmt: skip


def detect(audio: Path, params: dict | None = None) -> dict:
    """Onsets and beat grid only, for the accuracy loop. Times in seconds."""
    core = _core(audio, params or load_params())
    period = 60.0 / core["bpm"]
    beats = np.arange(core["first_beat"], core["duration"], period)
    return dict(
        duration=core["duration"], bpm=core["bpm"], beats=[float(b) for b in beats],
        onsets=[(float(t), float(w)) for t, w in core["peaks"]],
        kinds=[e["kind"] for e in core["events"]],
        events=[{k: (round(float(v), 5) if k != "kind" else v) for k, v in e.items()} for e in core["events"]],
    )  # fmt: skip


def analyse(audio: Path, params: dict | None = None) -> dict:
    params = params or load_params()
    core = _core(audio, params)
    samples, duration, frame_rate, mag = core["samples"], core["duration"], core["frame_rate"], core["mag"]
    n_fft = params["n_fft"]
    freqs = np.fft.rfftfreq(n_fft, 1.0 / SAMPLE_RATE)

    rms = np.sqrt((mag**2).mean(axis=1))
    flux, onset, bpm, first_beat = core["flux"], core["onset"], core["bpm"], core["first_beat"]

    signals = [
        _signal("amplitude", normalise(rms), frame_rate),
        _signal("energy", normalise(rms**2), frame_rate),
        _signal("spectralFlux", normalise(flux), frame_rate),
        _signal("onsetEnvelope", normalise(onset), frame_rate),
        _signal("spectralCentroid", normalise(centroid_of(mag, freqs)), frame_rate),
    ]

    band_signals, band_events, band_defs = [], [], []
    for order, (band_id, label, lo, hi) in enumerate(BANDS):
        sel = (freqs >= lo) & (freqs < hi)
        sub = mag[:, sel]
        b_flux = flux_of(sub, params["log_gain"])
        b_onset = onset_of(b_flux, frame_rate, params["floor_window_s"])
        features = {
            "energy": normalise((sub**2).mean(axis=1)),
            "flux": normalise(b_flux),
            "onset": normalise(b_onset),
            "centroid": normalise(centroid_of(sub, freqs[sel])),
        }
        for feature, values in features.items():
            band_signals.append({
                "bandId": band_id, "label": label, "feature": feature,
                "rate": frame_rate, "values": np.round(values, 5).tolist(),
            })  # fmt: skip
        band_events.append({"bandId": band_id, "events": _events([(t, w) for t, w, _ in pick_peaks(b_onset, frame_rate, params)])})
        band_defs.append({
            "id": band_id, "label": label, "sourceId": "mixdown", "enabled": True,
            "timeScope": {"kind": "global"},
            "frequencyShape": [{
                "startTime": 0, "endTime": duration,
                "lowHzStart": lo, "highHzStart": hi, "lowHzEnd": lo, "highHzEnd": hi,
            }],
            "sortOrder": order + 1,
            "provenance": {"source": "manual", "createdAt": EPOCH},
        })  # fmt: skip

    return {
        "formatVersion": 1,
        "createdAt": EPOCH,
        "projectName": audio.stem,
        "durationSec": duration,
        "script": None,
        "signals": signals,
        "bandSignals": band_signals,
        "stemSignals": [],
        "customSignals": [],
        "composedSignals": [],
        "eventStreams": [
            {"name": "onsetPeaks", "events": _events(core["peaks"])},
            {"name": "percussive", "events": _events([(e["time"], e["weight"]) for e in core["events"] if e["kind"] == "percussive"])},
            {"name": "soft", "events": _events([(e["time"], e["weight"]) for e in core["events"] if e["kind"] == "soft"])},
        ],
        "authoredEventStreams": [],
        "bandEvents": band_events,
        "musicalTime": {
            "version": 1,
            "segments": [{
                "id": "seg-1", "bpm": bpm, "phaseOffset": round(first_beat, 4),
                "startTime": 0, "endTime": duration + 1.0,
                "provenance": {"source": "manual_entry", "promotedAt": EPOCH},
            }],
            "createdAt": EPOCH, "modifiedAt": EPOCH,
        },
        "frequencyBands": {
            "version": 2, "bands": band_defs, "createdAt": EPOCH, "modifiedAt": EPOCH,
        },
        "availableStems": [],
        # Not part of the v1 contract; unknown fields are ignored by the engine.
        "loop": {"analyser": ANALYSER_VERSION, "params": params, "audioSha256": file_sha256(audio)},
    }  # fmt: skip


def analyse_cached(audio: Path, cache_dir: Path) -> Path:
    """Analyse once per (audio content, analyser version, parameters) and reuse the result."""
    params = load_params()
    key = f"{file_sha256(audio)[:16]}-{ANALYSER_VERSION}-{params_key(params)}"
    out = cache_dir / key / "package.json"
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(analyse(audio, params)))
    return out
