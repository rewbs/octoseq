"""Degraded copies of a rendered track, to stop analysis being tuned to clean audio.

A tracker render is unusually clean: dry, uncompressed, lossless. Real releases are
none of those, so every reference track is also scored through reverb, heavy
compression and an MP3 round trip. The reference event times stay valid because
none of these moves the audio in time, which `alignment_ms` verifies. (The limiter
looks ahead and would delay the audio by 5 ms; `latency=1` compensates for that.)
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

VARIANTS = {
    "clean": None,
    "reverb": ["-af", "aecho=0.8:0.6:23|47|83|131:0.35|0.3|0.22|0.15", "-c:a", "pcm_s16le"],
    "compress": ["-af", "acompressor=threshold=-26dB:ratio=8:attack=3:release=60:makeup=8,alimiter=limit=0.9:latency=1", "-c:a", "pcm_s16le"],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "96k"],
}
SUFFIX = {"reverb": ".wav", "compress": ".wav", "mp3": ".mp3"}


def make(source: Path, out_dir: Path, names: tuple[str, ...] = tuple(VARIANTS)) -> dict[str, Path]:
    """Create (or reuse) the requested variants of `source`. Returns name -> path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = {}
    for name in names:
        if VARIANTS[name] is None:
            out[name] = source
            continue
        path = out_dir / f"{name}{SUFFIX[name]}"
        if not path.exists():
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", "44100", *VARIANTS[name], str(path)]
            subprocess.run(cmd, check=True)
        out[name] = path
    return out


def _decode(path: Path, seconds: float = 30.0, rate: int = 22050) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-t", str(seconds), "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout, dtype=np.float32)


def alignment_ms(clean: Path, variant: Path, rate: int = 22050) -> float:
    """How far the variant's audio is shifted against the clean render, in ms (positive = later)."""
    a, b = _decode(clean, rate=rate), _decode(variant, rate=rate)
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    size = 1 << int(np.ceil(np.log2(2 * n)))
    corr = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    max_lag = int(0.1 * rate)
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    window = np.concatenate([corr[: max_lag + 1], corr[-max_lag:]])
    return float(lags[int(np.argmax(window))] / rate * 1000.0)
