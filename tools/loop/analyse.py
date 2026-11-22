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
N_FFT = 1024
HOP = 441  # 50 frames per second
FRAME_RATE = SAMPLE_RATE / HOP
ANALYSER_VERSION = "standin-2"

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


def spectrogram(samples: np.ndarray) -> np.ndarray:
    """Magnitude spectrogram, shape (frames, N_FFT // 2 + 1)."""
    pad = N_FFT // 2
    padded = np.pad(samples, (pad, pad))
    n_frames = 1 + (len(padded) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    window = np.hanning(N_FFT).astype(np.float32)
    return np.abs(np.fft.rfft(padded[idx] * window, axis=1)).astype(np.float32)


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


def flux_of(mag: np.ndarray) -> np.ndarray:
    """Half-wave rectified difference of log magnitude, summed over frequency."""
    logmag = np.log1p(100.0 * mag)
    diff = np.diff(logmag, axis=0, prepend=logmag[:1])
    return np.maximum(diff, 0.0).sum(axis=1)


def onset_of(flux: np.ndarray) -> np.ndarray:
    """Flux with its slow-moving floor removed, so only attacks remain."""
    floor = moving_median(flux, int(FRAME_RATE * 0.5) | 1)
    return np.maximum(flux - floor, 0.0)


def centroid_of(mag: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    total = mag.sum(axis=1)
    return (mag * freqs[None, :]).sum(axis=1) / np.maximum(total, 1e-9)


def pick_peaks(env: np.ndarray, min_gap_s: float = 0.08) -> list[tuple[float, float]]:
    """Local maxima above an adaptive threshold, as (time, weight) pairs."""
    threshold = moving_median(env, int(FRAME_RATE * 1.0) | 1) + 0.1 * float(np.std(env))
    gap = max(1, int(min_gap_s * FRAME_RATE))
    peaks: list[tuple[float, float]] = []
    last = -gap
    for i in range(1, len(env) - 1):
        if env[i] > threshold[i] and env[i] >= env[i - 1] and env[i] > env[i + 1]:
            if i - last >= gap:
                peaks.append((i / FRAME_RATE, float(env[i])))
                last = i
            elif peaks and env[i] > peaks[-1][1]:
                peaks[-1] = (i / FRAME_RATE, float(env[i]))
                last = i
    return peaks


def estimate_tempo(onset: np.ndarray) -> tuple[float, float]:
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
        lag = 60.0 / bpm * FRAME_RATE
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
        period = 60.0 / bpm * FRAME_RATE
        for s in range(steps):
            offset = period * s / steps
            grid = np.arange(offset, n - 1, period)
            energy = float(np.interp(grid, frames, onset).mean())
            if energy > best_energy:
                best_bpm, best_phase, best_energy = float(bpm), offset / FRAME_RATE, energy
    best_bpm = round(best_bpm, 2)
    return best_bpm, best_phase


def _signal(name: str, values: np.ndarray) -> dict:
    return {"name": name, "rate": FRAME_RATE, "values": np.round(values, 5).tolist()}


def _events(peaks: list[tuple[float, float]]) -> list[dict]:
    top = max((w for _, w in peaks), default=1.0) or 1.0
    return [{"time": round(t, 4), "weight": round(w / top, 4)} for t, w in peaks]


def analyse(audio: Path) -> dict:
    samples = decode_mono(audio)
    duration = len(samples) / SAMPLE_RATE
    mag = spectrogram(samples)
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / SAMPLE_RATE)

    rms = np.sqrt((mag**2).mean(axis=1))
    flux = flux_of(mag)
    onset = onset_of(flux)
    bpm, first_beat = estimate_tempo(onset)

    signals = [
        _signal("amplitude", normalise(rms)),
        _signal("energy", normalise(rms**2)),
        _signal("spectralFlux", normalise(flux)),
        _signal("onsetEnvelope", normalise(onset)),
        _signal("spectralCentroid", normalise(centroid_of(mag, freqs))),
    ]

    band_signals, band_events, band_defs = [], [], []
    for order, (band_id, label, lo, hi) in enumerate(BANDS):
        sel = (freqs >= lo) & (freqs < hi)
        sub = mag[:, sel]
        b_flux = flux_of(sub)
        b_onset = onset_of(b_flux)
        features = {
            "energy": normalise((sub**2).mean(axis=1)),
            "flux": normalise(b_flux),
            "onset": normalise(b_onset),
            "centroid": normalise(centroid_of(sub, freqs[sel])),
        }
        for feature, values in features.items():
            band_signals.append({
                "bandId": band_id, "label": label, "feature": feature,
                "rate": FRAME_RATE, "values": np.round(values, 5).tolist(),
            })  # fmt: skip
        band_events.append({"bandId": band_id, "events": _events(pick_peaks(b_onset))})
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
        "eventStreams": [{"name": "onsetPeaks", "events": _events(pick_peaks(onset))}],
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
        "loop": {"analyser": ANALYSER_VERSION, "audioSha256": file_sha256(audio)},
    }  # fmt: skip


def analyse_cached(audio: Path, cache_dir: Path) -> Path:
    """Analyse once per (audio content, analyser version) and reuse the result."""
    key = f"{file_sha256(audio)[:16]}-{ANALYSER_VERSION}"
    out = cache_dir / key / "package.json"
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(analyse(audio)))
    return out
