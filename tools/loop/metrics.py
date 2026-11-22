"""Frame metrics for the build loop.

These numbers catch output that is broken or boring in measurable ways: black,
frozen, strobing, empty, jerky, unrelated to the music, or the same all the way
through. They do not measure whether a clip is fun to watch. That judgement stays
with a person, and each time a person makes it the thresholds in gates.json should
be adjusted to agree with them.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

METRIC_W, METRIC_H = 128, 72


def load_frames(video: Path) -> np.ndarray:
    """Decode a video to a small uint8 array of shape (frames, H, W, 3)."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(video),
        "-vf", f"scale={METRIC_W}:{METRIC_H}:flags=area",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]  # fmt: skip
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, METRIC_H, METRIC_W, 3)


def _luma(frames: np.ndarray) -> np.ndarray:
    rgb = frames.astype(np.float32) / 255.0
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def _max_flashes_per_second(series: np.ndarray, fps: float) -> float:
    """Worst one-second count of flashes in a brightness series.

    A flash is a pair of opposing brightness swings of at least 0.1, following the
    general-flash definition in WCAG 2.3.1. More than three per second is the
    accessibility limit, and it is also simply unpleasant.
    """
    # Zigzag: record the frame at which brightness has reversed by at least 0.1
    # from its last extreme.
    swing_times = []
    trend, extreme = 0, float(series[0])
    for i, v in enumerate(series):
        v = float(v)
        if trend == 0:
            if abs(v - extreme) >= 0.1:
                trend = 1 if v > extreme else -1
                extreme = v
                swing_times.append(i)
        elif (v - extreme) * trend > 0:
            extreme = v
        elif (extreme - v) * trend >= 0.1:
            trend = -trend
            extreme = v
            swing_times.append(i)
    if len(swing_times) < 2:
        return 0.0
    swing_times = np.array(swing_times)
    window = int(round(fps))
    worst = 0
    for t in swing_times:
        worst = max(worst, int(np.sum((swing_times >= t) & (swing_times < t + window))))
    return worst / 2.0


def _active_area(luma: np.ndarray) -> float:
    """Share of the frame that has something going on in it.

    The frame is cut into a 12x16 grid; a cell counts as active if it contains
    visible structure. A small object on a flat background scores a few percent,
    whatever the background colour. A full-frame flow field scores near 1.
    """
    sample = luma[:: max(1, len(luma) // 60)]
    cells = sample.reshape(len(sample), 12, METRIC_H // 12, 16, METRIC_W // 16)
    return float((cells.std(axis=(2, 4)) > 0.015).mean())


def _colourfulness(frames: np.ndarray) -> float:
    """Hasler and Suesstrunk's colourfulness measure, averaged over sampled frames."""
    sample = frames[:: max(1, len(frames) // 60)].astype(np.float32)
    rg = sample[..., 0] - sample[..., 1]
    yb = 0.5 * (sample[..., 0] + sample[..., 1]) - sample[..., 2]
    axes = (1, 2)
    std = np.sqrt(rg.std(axis=axes) ** 2 + yb.std(axis=axes) ** 2)
    mean = np.sqrt(rg.mean(axis=axes) ** 2 + yb.mean(axis=axes) ** 2)
    return float((std + 0.3 * mean).mean() / 255.0)


def _variety(frames: np.ndarray, fps: float, window_s: float = 5.0) -> float:
    """How much the overall look changes between different parts of the clip.

    Each window is summarised by a coarse colour histogram plus a coarse brightness
    layout; the result is the mean distance between windows (0 = identical).
    """
    step = max(1, int(window_s * fps))
    summaries = []
    for start in range(0, len(frames) - step + 1, step):
        chunk = frames[start : start + step : max(1, step // 20)]
        bins = (chunk // 64).astype(np.int32)
        codes = bins[..., 0] * 16 + bins[..., 1] * 4 + bins[..., 2]
        hist = np.bincount(codes.ravel(), minlength=64).astype(np.float32)
        hist /= hist.sum()
        layout = _luma(chunk).mean(axis=0)
        layout = layout.reshape(6, METRIC_H // 6, 8, METRIC_W // 8).mean(axis=(1, 3))
        summaries.append((hist, layout.ravel()))
    if len(summaries) < 2:
        return 0.0
    dists = []
    for i in range(len(summaries)):
        for j in range(i + 1, len(summaries)):
            colour = 0.5 * np.abs(summaries[i][0] - summaries[j][0]).sum()
            layout = np.abs(summaries[i][1] - summaries[j][1]).mean()
            dists.append(colour + layout)
    return float(np.mean(dists))


def _best_correlation(a: np.ndarray, b: np.ndarray, fps: float, max_lag_s: float = 0.25):
    """Peak normalised correlation of two series within a small lag window.

    Positive lag means the picture trails the sound.
    """
    n = min(len(a), len(b))
    a = a[:n] - a[:n].mean()
    b = b[:n] - b[:n].mean()
    denom = float(np.sqrt((a**2).sum() * (b**2).sum()))
    if denom < 1e-9:
        return 0.0, 0.0
    best, best_lag = -1.0, 0
    max_lag = int(max_lag_s * fps)
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            c = float((a[lag:] * b[: n - lag]).sum())
        else:
            c = float((a[: n + lag] * b[-lag:]).sum())
        if c / denom > best:
            best, best_lag = c / denom, lag
    return best, best_lag / fps


def _package_signal(package: dict, name: str, fps: float, n: int) -> np.ndarray | None:
    for sig in package.get("signals", []):
        if sig["name"] == name:
            values = np.asarray(sig["values"], dtype=np.float32)
            times = np.arange(n) / fps
            return np.interp(times, np.arange(len(values)) / sig["rate"], values)
    return None


def compute(frames: np.ndarray, fps: float, package: dict) -> dict:
    """All metrics for one rendered clip. Values are plain floats."""
    n = len(frames)
    luma = _luma(frames)
    frame_luma = luma.mean(axis=(1, 2))

    diff = np.abs(np.diff(luma, axis=0))
    motion = diff.mean(axis=(1, 2))
    motion = np.concatenate([[motion[0] if len(motion) else 0.0], motion])

    # Smoothness: how large the frame-to-frame change in motion is, compared with
    # the motion itself. Steady flow scores near 0; flicker and jumps score near 2.
    first = np.abs(luma[2:] - luma[:-2]).mean() if n > 2 else 0.0
    second = np.abs(luma[2:] - 2 * luma[1:-1] + luma[:-2]).mean() if n > 2 else 0.0
    jerkiness = float(second / first) if first > 1e-6 else 0.0

    # Flashing, measured on the whole frame and on each cell of a 3x3 grid.
    grid = luma.reshape(n, 3, METRIC_H // 3, 4, METRIC_W // 4).mean(axis=(2, 4))
    flashes = _max_flashes_per_second(frame_luma, fps)
    for r in range(3):
        for c in range(4):
            flashes = max(flashes, _max_flashes_per_second(grid[:, r, c], fps))

    gy = np.abs(np.diff(luma[:: max(1, n // 60)], axis=1)).mean()
    gx = np.abs(np.diff(luma[:: max(1, n // 60)], axis=2)).mean()

    sync, sync_lag = 0.0, 0.0
    for visual, audio_name in ((motion, "onsetEnvelope"), (motion, "energy"), (frame_luma, "energy")):
        audio = _package_signal(package, audio_name, fps, n)
        if audio is None:
            continue
        corr, lag = _best_correlation(visual, audio, fps)
        if corr > sync:
            sync, sync_lag = corr, lag

    return {
        "frames": n,
        "mean_luma": float(frame_luma.mean()),
        "black_fraction": float((frame_luma < 0.02).mean()),
        "blown_fraction": float(((luma > 0.95).mean(axis=(1, 2)) > 0.4).mean()),
        "active_area": _active_area(luma),
        "detail": float(gx + gy),
        "colourfulness": _colourfulness(frames),
        "motion": float(motion.mean()),
        "static_fraction": float((motion < 0.0005).mean()),
        "jerkiness": jerkiness,
        "max_flashes_per_sec": float(flashes),
        "variety": _variety(frames, fps),
        "audio_sync": float(sync),
        "audio_sync_lag_s": float(sync_lag),
    }
