"""The analysers the accuracy loop can score, behind one interface.

An analyser is a function `(audio_path, params) -> dict` that returns any of:

    onsets    list of (time_s, weight)
    kinds     list of "percussive" or "soft", one per onset (optional)
    beats     list of time_s
    bpm       float
    sections  list of boundary time_s
    stems     dict of name -> mono float array at STEM_RATE ("drums", "bass", "other")

A part it does not produce is simply left out. Register new analysers in ANALYSERS:
a wrapper around a local model or a hosted API is scored exactly like the ones
here, and the accuracy loop picks the best analyser for each part from the scores.

`standin` is the loop's own signal-processing analyser (analyse.py). The others are
deliberately simple baselines: they give every part at least one real contender, and
any serious analyser should beat them.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

import analyse

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


ANALYSERS = {
    "standin": standin,
    "energy": energy,
    "novelty": novelty,
    "bandsplit": bandsplit,
}

# Which analysers accept the tunable parameter set of analyse.py.
TUNABLE = {"standin"}
