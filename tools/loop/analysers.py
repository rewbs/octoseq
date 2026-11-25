"""The analysers the accuracy loop can score, behind one interface.

An analyser is a function `(audio_path, params) -> dict` that returns any of:

    onsets    list of (time_s, weight)
    kinds     list of "percussive" or "soft", one per onset (optional)
    beats     list of time_s
    downbeats list of time_s (optional)
    bpm       float
    sections  list of boundary time_s
    drums     dict of "kick", "snare" and "hat" -> list of time_s
    stems     dict of name -> mono float array at STEM_RATE ("vocals", "drums", "bass",
              "other", plus any extras a source provides)

A part it does not produce is simply left out. Register new analysers in ANALYSERS:
a wrapper around a local model or a hosted API is scored exactly like the ones
here, and the accuracy loop picks the best analyser for each part from the scores.

`standin` is the loop's own signal-processing analyser (analyse.py). The others are
deliberately simple baselines: they give every part at least one real contender, and
any serious analyser should beat them.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import numpy as np

import analyse
import stems as stem_sources

STEM_RATE = 22050


def decode(audio: Path, rate: int = STEM_RATE) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout, dtype=np.float32).copy()


def standin(audio: Path, params: dict | None = None) -> dict:
    result = analyse.detect(audio, params)
    return dict(onsets=result["onsets"], kinds=result["kinds"], beats=result["beats"], bpm=result["bpm"])


def energy(audio: Path, params: dict | None = None) -> dict:
    """Onsets from rises in overall loudness: the simplest detector there is."""
    x = decode(audio)
    hop = 220  # 10 ms
    frames = len(x) // hop
    rms = np.sqrt((x[: frames * hop].reshape(frames, hop) ** 2).mean(axis=1))
    level = np.log1p(200.0 * rms)
    rise = np.maximum(np.diff(level, prepend=level[:1]), 0.0)
    threshold = analyse.moving_median(rise, 101) + 0.5 * float(rise.std())
    onsets, last = [], -100
    for i in range(1, frames - 1):
        if rise[i] > threshold[i] and rise[i] >= rise[i - 1] and rise[i] > rise[i + 1] and i - last >= 8:
            onsets.append((i * hop / STEM_RATE, float(rise[i])))
            last = i
    return dict(onsets=onsets)


def novelty(audio: Path, params: dict | None = None) -> dict:
    """Section boundaries from where the long-term spectrum changes most."""
    x = decode(audio)
    mag = analyse.spectrogram(x, 2048, 2048)  # ~93 ms frames
    edges = np.unique(np.geomspace(2, mag.shape[1] - 1, 25).astype(int))
    bands = np.stack([mag[:, a:b].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)
    feat = np.log1p(50.0 * bands)
    per_s = analyse.SAMPLE_RATE / 2048
    block = max(1, int(round(per_s)))  # one-second summaries
    n = len(feat) // block
    if n < 16:
        return dict(sections=[])
    summary = feat[: n * block].reshape(n, block, -1).mean(axis=1)
    summary = (summary - summary.mean(axis=0)) / (summary.std(axis=0) + 1e-9)
    width = 8  # compare the 8 seconds before with the 8 seconds after
    score = np.zeros(n)
    for i in range(width, n - width):
        score[i] = np.linalg.norm(summary[i : i + width].mean(axis=0) - summary[i - width : i].mean(axis=0))
    threshold = score.mean() + 0.5 * score.std()
    sections = []
    for i in range(1, n - 1):
        if score[i] > threshold and score[i] >= score[i - 1] and score[i] > score[i + 1]:
            if not sections or i - sections[-1] >= width // 2:
                sections.append(i)
    return dict(sections=[float(i * block / per_s) for i in sections])


# Set on the training split (a sweep of each; the scores are flat around these values).
CHANGE_WIDTH_S = 6.0  # compare this much sound before a moment with this much after
CHANGE_THRESHOLD_DB = 3.5  # a boundary needs the spectrum to move this much, averaged over bands
CHANGE_MIN_GAP_S = 3.0


def change(audio: Path, params: dict | None = None) -> dict:
    """Section boundaries from where the spectrum moves by more than a fixed number of decibels.

    `novelty` judges change against each track's own variation, so it finds a dozen
    boundaries in a track that never changes and too few in one that never settles.
    Here the amount of change is absolute: the mean difference, in decibels over 24
    bands, between the six seconds before a moment and the six after.
    """
    x = decode(audio)
    hop = 2048
    mag = analyse.spectrogram(x, 2048, hop)
    edges = np.unique(np.geomspace(2, mag.shape[1] - 1, 25).astype(int))
    bands = np.stack([mag[:, a:b].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)
    level = 20 * np.log10(bands + 0.01)
    per_s = STEM_RATE / hop
    w = max(2, int(round(CHANGE_WIDTH_S * per_s)))
    n = len(level)
    if n < 2 * w + 2:
        return dict(sections=[])
    total = np.cumsum(np.concatenate([np.zeros((1, level.shape[1])), level]), axis=0)
    at = np.arange(w, n - w)
    moved = np.zeros(n)
    moved[at] = np.abs((total[at + w] - total[at]) / w - (total[at] - total[at - w]) / w).mean(axis=1)
    gap = max(1, int(round(CHANGE_MIN_GAP_S * per_s)))
    taken = np.zeros(n, dtype=bool)
    sections = []
    for i in np.argsort(-moved, kind="stable"):  # strongest first; anything close to one already taken is the same change
        if moved[i] < CHANGE_THRESHOLD_DB:
            break
        lo, hi = max(0, i - gap), min(n, i + gap + 1)
        if taken[lo:hi].any() or moved[i] < moved[lo:hi].max():
            continue
        taken[i] = True
        sections.append(float(i / per_s))
    return dict(sections=sorted(sections))


# Chosen on the training split, where the scores are flat around them.
GRID_BEATS = 16  # four bars of 4/4: the length of a tracker pattern at the usual four rows to the beat
GRID_REACH_S = 2.0  # a found boundary this close to a grid mark is moved onto it
GRID_CELL_DB = 2.0  # a grid mark with this much change across it is a boundary even if nothing found it
GRID_CLEAR_S = 3.0  # but not within this of a boundary already there
GRID_HOP = 1024


def _grid_marks(beats: np.ndarray, found: list[float]) -> np.ndarray | None:
    """Every sixteenth beat, starting from whichever beat puts the marks nearest the found boundaries."""
    if len(beats) < 2 * GRID_BEATS or not found:
        return None
    times = np.asarray(found, dtype=float)
    best_fit, best_marks = -1.0, None
    for phase in range(GRID_BEATS):
        marks = beats[phase::GRID_BEATS]
        if len(marks) < 2:
            continue
        miss = np.abs(times[:, None] - marks[None, :]).min(axis=1)
        fit = float(np.exp(-(miss**2)).sum())  # a boundary a second off counts about a third
        if fit > best_fit:
            best_fit, best_marks = fit, marks
    return best_marks


def _change_across(level: np.ndarray, marks: np.ndarray, per_s: float) -> np.ndarray:
    """At each mark, how far the average spectrum moves from the stretch before it to the stretch after, in dB."""
    idx = [int(round(m * per_s)) for m in marks]
    total = np.cumsum(np.concatenate([np.zeros((1, level.shape[1])), level]), axis=0)
    out = np.zeros(len(marks))
    for k in range(1, len(marks) - 1):
        a, b, c = idx[k - 1], idx[k], idx[k + 1]
        if b - a >= 2 and c - b >= 2 and c <= len(level):
            out[k] = np.abs((total[c] - total[b]) / (c - b) - (total[b] - total[a]) / (b - a)).mean()
    return out


def novelty_grid(audio: Path, params: dict | None = None) -> dict:
    """`novelty`'s boundaries, put on a grid of whole patterns.

    Sections start on bar lines, and in most of this music on every fourth one. So
    the boundaries `novelty` finds are moved to the nearest mark of a sixteen-beat
    grid (the grid's starting beat is whichever fits them best), and a mark where the
    average spectrum of the sixteen beats after it differs clearly from the sixteen
    before becomes a boundary too. The first makes boundaries land on the beat; the
    second finds changes too gradual for `novelty`'s sliding window.
    """
    found = novelty(audio)["sections"]
    beats = np.asarray(analyse.detect(audio, analyse.load_params())["beats"], dtype=float)
    marks = _grid_marks(beats, found)
    if marks is None:
        return dict(sections=found)
    moved = set()
    for t in found:
        nearest = float(marks[np.abs(marks - t).argmin()])
        moved.add(nearest if abs(nearest - t) <= GRID_REACH_S else t)
    x = decode(audio)
    mag = analyse.spectrogram(x, 2048, GRID_HOP)
    edges = np.unique(np.geomspace(2, mag.shape[1] - 1, 25).astype(int))
    level = 20 * np.log10(np.stack([mag[:, a:b].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1) + 0.01)
    duration = len(x) / STEM_RATE
    across = _change_across(level, marks, STEM_RATE / GRID_HOP)
    for mark, change_db in zip(marks, across):
        if change_db >= GRID_CELL_DB and 1.0 < mark < duration - 1.0 and all(abs(mark - t) > GRID_CLEAR_S for t in moved):
            moved.add(float(mark))
    return dict(sections=sorted(moved))


DRUM_FFT, DRUM_HOP = 1024, 220  # 10 ms frames
DRUM_BANDS_HZ = {"kick": (0.0, 150.0), "snare": (200.0, 3000.0), "hat": (5000.0, 11025.0)}
# Found by tune_drums.py on the training split and kept in drum_params.json: one set
# for listening to the full mix, one for listening to a separated drum stem.
DRUM_PARAMS_FILE = Path(__file__).parent / "drum_params.json"
DRUM_PARAMS_START = dict(ratio=[2.0, 2.0, 2.0], delta=[0.05, 0.05, 0.05], gap_s=0.06, hat_over_snare=1.5, snare_over_kick=3.0, offset_s=0.0)


def drum_params(source: str) -> dict:
    """The tuned detector settings for "mix" or "stem", or the untuned starting point."""
    if DRUM_PARAMS_FILE.exists():
        return json.loads(DRUM_PARAMS_FILE.read_text()).get(source, DRUM_PARAMS_START)
    return DRUM_PARAMS_START


def drum_envelopes(x: np.ndarray) -> np.ndarray:
    """How fast the sound is rising in the kick, snare and hat bands, one row per 10 ms."""
    mag = analyse.spectrogram(x, DRUM_FFT, DRUM_HOP)
    freqs = np.fft.rfftfreq(DRUM_FFT, 1.0 / STEM_RATE)
    level = np.log1p(100.0 * mag)
    rise = np.maximum(np.diff(level, axis=0, prepend=level[:1]), 0.0)
    return np.stack([rise[:, (freqs >= lo) & (freqs < hi)].mean(axis=1) for lo, hi in DRUM_BANDS_HZ.values()], axis=1)


def drum_hits(env: np.ndarray, p: dict) -> dict[str, list[float]]:
    """Kick, snare and hat times from the three band envelopes.

    A hit is a peak in its band that stands clear of the band's recent level. A
    snare is broadband and lights up the hat band too, and a kick's click reaches
    the snare band, so a hat is dropped where the snare band rose much more, and a
    snare where the kick band did.
    """
    fps = STEM_RATE / DRUM_HOP
    floor = np.stack([analyse.moving_median(env[:, i], 101) for i in range(3)], axis=1)
    clear = env - floor
    gap = int(round(p["gap_s"] * fps))
    out: dict[str, list[float]] = {}
    for i, kind in enumerate(DRUM_BANDS_HZ):
        e = env[:, i]
        threshold = floor[:, i] * p["ratio"][i] + p["delta"][i]
        hits, last = [], -100
        if len(e) < 5:
            out[kind] = hits
            continue
        m = e[2:-2]
        peaks = np.flatnonzero((m > threshold[2:-2]) & (m >= e[1:-3]) & (m > e[3:-1]) & (m >= e[:-4]) & (m >= e[4:])) + 2
        for n in peaks:
            if n - last < gap:
                continue
            if kind == "hat" and clear[max(0, n - 2) : n + 3, 1].max() > p["hat_over_snare"] * clear[n, 2]:
                continue
            if kind == "snare" and clear[max(0, n - 2) : n + 3, 0].max() > p["snare_over_kick"] * clear[n, 1]:
                continue
            hits.append(float(n / fps + p["offset_s"]))
            last = n
        out[kind] = hits
    return out


def drumbands(audio: Path, params: dict | None = None) -> dict:
    """Kick, snare and hat hits from three frequency bands of the full mix. No model, no stems."""
    return dict(drums=drum_hits(drum_envelopes(decode(audio)), drum_params("mix")))


def drumbands_stem(audio: Path, params: dict | None = None) -> dict:
    """The same detector, listening to the drum stem that local Demucs separates.

    The mix has bass notes in the kick band and tunes in the snare band; the drum
    stem mostly does not. Needs the optional model environment.
    """
    stems = stem_sources.separate("demucs", audio)
    return dict(drums=drum_hits(drum_envelopes(decode(stems.files["drums"])), drum_params("stem")))


ADTOF_LABELS = {"kick": 35, "snare": 38, "hat": 42}  # of its five classes; toms and cymbals are not used
# Its hits come 5 to 7 ms before the modules' own (twelve training modules), so this is added.
ADTOF_OFFSET_S = 0.006


def adtof_stem(audio: Path, params: dict | None = None) -> dict:
    """Kick, snare and hat hits from ADTOF, listening to the drum stem that local Demucs separates.

    ADTOF is a network trained to transcribe drums (Zehren, Alunno and Bientinesi,
    2021 and 2023), here in Xavier Riley's PyTorch port with the published
    weights and its own thresholds. Where the band detector asks whether a band
    got louder, this has learned what a kick and a snare sound like, so it keeps
    finding them when they come fast: on twelve training modules it found 0.73 of
    the blows inside rolls where the bands found 0.42, with more of what it
    reported real (0.82 against 0.74).

    Two cautions. Its weights are licensed CC BY-NC-SA 4.0, non-commercial (see
    NONCOMMERCIAL). And it is slow without a graphics card: about the length of
    the track.
    """
    import tempfile

    from adtof_pytorch import FRAME_RNN_THRESHOLDS, LABELS_5, PeakPicker, transcribe_to_midi

    stems = stem_sources.separate("demucs", audio)
    unused = Path(tempfile.gettempdir()) / "octoseq-adtof-unused.mid"  # asked for activations, it writes no file
    act = transcribe_to_midi(str(stems.files["drums"]), str(unused), device=model_device(), return_activations=True)
    peaks = PeakPicker(thresholds=FRAME_RNN_THRESHOLDS, fps=100).pick(act, labels=LABELS_5, label_offset=0)[0]
    return dict(drums={kind: sorted(float(t) + ADTOF_OFFSET_S for t in peaks.get(label, [])) for kind, label in ADTOF_LABELS.items()})


def _istft(spec: np.ndarray, n_fft: int, hop: int, length: int) -> np.ndarray:
    window = np.hanning(n_fft).astype(np.float32)
    out = np.zeros(hop * (len(spec) - 1) + n_fft, dtype=np.float32)
    norm = np.zeros_like(out)
    frames = np.fft.irfft(spec, n=n_fft, axis=1).astype(np.float32) * window
    for i, frame in enumerate(frames):
        out[i * hop : i * hop + n_fft] += frame
        norm[i * hop : i * hop + n_fft] += window**2
    out /= np.maximum(norm, 1e-6)
    return out[n_fft // 2 : n_fft // 2 + length]


def bandsplit(audio: Path, params: dict | None = None) -> dict:
    """A crude three-way separation: no model, just spectral masks.

    Bass is everything below 180 Hz. Of the rest, components that are short in
    time and broad in frequency go to drums and the remainder to other
    (median-filter harmonic/percussive separation).
    """
    x = decode(audio)
    n_fft, hop = 1024, 256
    pad = n_fft // 2
    padded = np.pad(x, (pad, pad))
    n_frames = 1 + (len(padded) - n_fft) // hop
    window = np.hanning(n_fft).astype(np.float32)
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    spec = np.fft.rfft(padded[idx] * window, axis=1)
    mag = np.abs(spec)
    k = 17
    half = k // 2
    harmonic = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(mag, ((half, half), (0, 0)), mode="edge"), k, axis=0), axis=-1)
    percussive = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(mag, ((0, 0), (half, half)), mode="edge"), k, axis=1), axis=-1)
    total = harmonic**2 + percussive**2 + 1e-12
    low = (np.fft.rfftfreq(n_fft, 1.0 / STEM_RATE) < 180.0)[None, :]
    masks = {
        "bass": np.where(low, 1.0, 0.0),
        "drums": np.where(low, 0.0, percussive**2 / total),
        "other": np.where(low, 0.0, harmonic**2 / total),
    }
    return dict(stems={name: _istft(spec * m, n_fft, hop, len(x)) for name, m in masks.items()})


def model_device() -> str:
    """Where model analysers run: the GPU when PyTorch can use one, otherwise the CPU.

    Set OCTOSEQ_DEVICE=cpu (or cuda, cuda:1, mps) to override. Call this only from
    the process that will run the model: asking PyTorch about CUDA starts the CUDA
    runtime, and a process that has done so cannot hand it on to forked workers.
    """
    import torch

    forced = os.environ.get("OCTOSEQ_DEVICE")
    if forced:
        return forced
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


_beat_this_model = None


def beat_this(audio: Path, params: dict | None = None) -> dict:
    """Beats and downbeats from the Beat This model (Foscarin, Schlueter and Widmer, 2024).

    A trained transformer, run locally on the GPU if there is one and the CPU if
    not. Needs the optional model environment: see tools/loop/models/setup.sh.
    """
    global _beat_this_model
    if _beat_this_model is None:
        import torch
        from beat_this.inference import Audio2Beats

        torch.set_num_threads(1)  # the accuracy loop already runs one analysis per core
        _beat_this_model = Audio2Beats(checkpoint_path="final0", device=model_device(), dbn=False)
    beats, downbeats = _beat_this_model(decode(audio), STEM_RATE)
    bpm = float(60.0 / np.median(np.diff(beats))) if len(beats) > 1 else 0.0
    return dict(beats=[float(b) for b in beats], downbeats=[float(b) for b in downbeats], bpm=bpm)


def stem_source(source: str, **options):
    """An analyser that gets its stems from one of the sources in stems.py."""

    def run(audio: Path, params: dict | None = None) -> dict:
        result = stem_sources.separate(source, audio, **options)
        return dict(
            stems={label: decode(path) for label, path in result.files.items()},
            stem_source=result.source,
            stem_detail=result.detail,
        )

    run.__name__ = source
    return run


ANALYSERS = {
    "standin": standin,
    "energy": energy,
    "novelty": novelty,
    "change": change,
    "novelty_grid": novelty_grid,
    "drumbands": drumbands,
    "bandsplit": bandsplit,
}

# Every stem source, whether or not it can run on this machine: one that cannot (no
# key, package not installed) is reported as not run rather than left out silently.
# Modules have no vocals to score, so LALAL.AI, which bills per stem, is asked only
# for drums and bass here; everything else is `other`.
STEM_SOURCES = {
    "user_stems": stem_source("user"),
    "lalal": stem_source("lalal", want=("drums", "bass", "other")),
    "musicai": stem_source("musicai"),
    "fal_demucs": stem_source("fal_demucs"),
    "demucs": stem_source("demucs"),
    "demucs_ft": stem_source("demucs_ft"),
}
ANALYSERS.update(STEM_SOURCES)
STEMS_ONLY = {"bandsplit", *STEM_SOURCES}  # produce nothing but stems
HOSTED = set(stem_sources.HOSTED)  # cost money per run; results are cached and recorded
UNVERIFIED = set(stem_sources.UNVERIFIED)  # written from documentation, never run against the service
# Fed the answer: user-supplied stems are scored by handing the true stems back
# through the interface. That checks the interface, and is not a candidate for "best".
REFERENCE_FED = {"user_stems"}

# Model-based analysers are registered only where their packages are installed, so
# the loop runs without them. Use the model environment's Python to include them.
MODELS = set()
if importlib.util.find_spec("beat_this") and importlib.util.find_spec("torch"):
    ANALYSERS["beat_this"] = beat_this
    MODELS.add("beat_this")
if stem_sources.demucs_installed():
    ANALYSERS["drumbands_stem"] = drumbands_stem
    MODELS.add("drumbands_stem")
if stem_sources.demucs_installed() and importlib.util.find_spec("adtof_pytorch"):
    ANALYSERS["adtof_stem"] = adtof_stem
    MODELS.add("adtof_stem")
# Analysers whose licence does not allow commercial use. They are scored like any
# other, but the worker does not pick one for a bundle unless the environment says
# that is acceptable (OCTOSEQ_NONCOMMERCIAL=1): whether it is, is the owner's call.
NONCOMMERCIAL = {"adtof_stem": "its weights are licensed CC BY-NC-SA 4.0, for non-commercial use only"}
# The owner was told of that licence with round 4 of review 3 and answered "Yes, keep
# the model" (24 November 2026). Set this to False to go back to asking the
# environment (OCTOSEQ_NONCOMMERCIAL=1) each time.
NONCOMMERCIAL_ACCEPTED = True
# How many worker processes each model gets when it runs on a GPU. Every worker keeps
# its own copy of the model there, so the number is what fits, not what is fastest:
# Beat This is small and spends most of its time on the CPU preparing audio, so it
# takes many; Demucs fills a couple of gigabytes each.
GPU_WORKERS = {"beat_this": 8, "drumbands_stem": 2, "adtof_stem": 2}


def result_version(name: str) -> str:
    """What a model analyser's stored results depend on, besides the audio.

    A model gives the same answer for the same audio every time it is asked, and
    asking is slow, so the accuracy loop keeps the answers. Anything that would
    change them belongs in this string.
    """
    if name == "beat_this":
        return "beat_this-1.1.0-final0-nodbn"
    if name == "drumbands_stem":
        return "htdemucs-shifts1-" + analyse.params_key(drum_params("stem")) + f"-{DRUM_FFT}-{DRUM_HOP}"
    if name == "adtof_stem":
        return f"htdemucs-shifts1-adtof-frame-rnn-own-thresholds-offset{ADTOF_OFFSET_S * 1000:g}ms"
    return "1"


# Too slow to run on everything (Demucs separates a module at about seven times real
# time on a laptop GPU): scored on the clean audio of every third held-out module.
SAMPLED = {"drumbands_stem", "adtof_stem"}
SAMPLE_EVERY = 3

# Which analysers accept the tunable parameter set of analyse.py.
TUNABLE = {"standin"}
