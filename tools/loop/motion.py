"""How a picture moves: optical flow and detail, measured from frames.

The render loop's first metrics ask whether anything moves and whether it follows
the music. These ask what the movement is like, which is where the reference the
project is aiming at (Milkdrop, rendered through projectM) differs most from flat
shapes on a black ground: there the whole frame flows, in a way that is not one
rigid slide or zoom, and the picture is full of fine detail.

Flow is found by phase correlation on a grid of overlapping tiles: for each tile,
the shift that best lines it up with the same tile one frame on. It is coarse (one
vector per tile) and that is enough for statistics over a clip. Only numpy is
needed.

Everything is in units that do not depend on frame size or rate: distances in frame
widths, times in seconds.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

WORK_WIDTH = 240  # frames are shrunk to about this width before measuring
TILE = 32  # tile size in shrunk pixels; the largest shift it can see is half of this per frame
STEP = 16
TEXTURE_FLOOR = 0.012  # a tile whose brightness varies less than this (standard deviation, 0 to 1) has nothing to track
MOVING = 0.02  # frame widths per second above which a tile counts as moving


def load_frames(video: Path, seconds: float = 0.0) -> np.ndarray:
    """Decode a video to (frames, height, WORK_WIDTH, 3) uint8: larger than the other metrics use, to keep its detail."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
        check=True, capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )  # fmt: skip
    width, height = (int(v) for v in probe.stdout.strip().split(",")[:2])
    out_h = max(2, round(height * WORK_WIDTH / width / 2) * 2)
    cmd = ["ffmpeg", "-v", "error", "-i", str(video)] + (["-t", f"{seconds:.3f}"] if seconds > 0 else [])
    cmd += ["-vf", f"scale={WORK_WIDTH}:{out_h}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True, stdin=subprocess.DEVNULL).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, out_h, WORK_WIDTH, 3)


def _shrink(luma: np.ndarray) -> np.ndarray:
    """Average blocks of pixels so the frame is about WORK_WIDTH wide."""
    k = max(1, luma.shape[2] // WORK_WIDTH)
    if k == 1:
        return luma
    n, h, w = luma.shape
    h2, w2 = h // k, w // k
    return luma[:, : h2 * k, : w2 * k].reshape(n, h2, k, w2, k).mean(axis=(2, 4))


def _tiles(frames: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cut every frame into overlapping tiles. Returns (tiles, centre x, centre y) with centres in -0.5..0.5 of the width."""
    n, h, w = frames.shape
    ys = np.arange(0, h - TILE + 1, STEP)
    xs = np.arange(0, w - TILE + 1, STEP)
    tiles = np.stack([np.stack([frames[:, y : y + TILE, x : x + TILE] for x in xs], axis=1) for y in ys], axis=1)
    cx = (xs + TILE / 2 - w / 2) / w
    cy = (ys + TILE / 2 - h / 2) / w  # also in widths, so that speeds compare across directions
    return tiles, cx, cy


def tile_flow(luma: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Per-tile shift from each frame to the next.

    `luma` is (frames, height, width), 0 to 1. Returns (flow, textured, cx, cy):
    flow is (frames - 1, rows, cols, 2) in shrunk pixels per frame, x then y;
    textured says which tiles had anything to track in both frames.
    """
    frames = _shrink(luma.astype(np.float32))
    tiles, cx, cy = _tiles(frames)
    window = np.outer(np.hanning(TILE), np.hanning(TILE)).astype(np.float32)
    textured = tiles.std(axis=(-1, -2)) > TEXTURE_FLOOR
    spectra = np.fft.rfft2((tiles - tiles.mean(axis=(-1, -2), keepdims=True)) * window)
    cross = spectra[1:] * np.conj(spectra[:-1])
    cross /= np.abs(cross) + 1e-6
    surface = np.fft.irfft2(cross, s=(TILE, TILE))
    flat = surface.reshape(*surface.shape[:-2], -1)
    peak = flat.argmax(axis=-1)
    py, px = np.unravel_index(peak, (TILE, TILE))

    def refine(p: np.ndarray, axis: int) -> np.ndarray:
        """Sub-pixel position of the peak along one axis, from its two neighbours."""
        take = lambda shift: np.take_along_axis(  # noqa: E731
            flat, np.ravel_multi_index(((py + (shift if axis == 0 else 0)) % TILE, (px + (shift if axis == 1 else 0)) % TILE), (TILE, TILE))[..., None], axis=-1
        )[..., 0]
        left, mid, right = take(-1), take(0), take(1)
        denom = left - 2 * mid + right
        offset = np.where(np.abs(denom) > 1e-9, 0.5 * (left - right) / np.where(np.abs(denom) > 1e-9, denom, 1.0), 0.0)
        whole = np.where(p > TILE // 2, p - TILE, p)
        return whole + np.clip(offset, -0.5, 0.5)

    flow = np.stack([refine(px, 1), refine(py, 0)], axis=-1).astype(np.float32)
    return flow, textured[1:] & textured[:-1], cx, cy


def _fit_affine(flow: np.ndarray, ok: np.ndarray, cx: np.ndarray, cy: np.ndarray):
    """Least-squares v = t + A p over the tiles marked ok. Returns (zoom, spin, residual share) or None."""
    if ok.sum() < 6:
        return None
    gx, gy = np.meshgrid(cx, cy)
    p = np.stack([np.ones(ok.sum()), gx[ok], gy[ok]], axis=1)
    v = flow[ok]
    coef, *_ = np.linalg.lstsq(p, v, rcond=None)
    fitted = p @ coef
    a = coef[1:].T  # [[dvx/dx, dvx/dy], [dvy/dx, dvy/dy]]
    zoom = 0.5 * (a[0, 0] + a[1, 1])
    spin = 0.5 * (a[1, 0] - a[0, 1])
    total = float((v**2).sum())
    return zoom, spin, float(((v - fitted) ** 2).sum()) / total if total > 1e-12 else 0.0


def compute(frames: np.ndarray, fps: float) -> dict:
    """Motion and detail figures for a clip. `frames` is (n, height, width, 3) uint8, from `load_frames`."""
    luma = (frames[..., 0] * 0.2126 + frames[..., 1] * 0.7152 + frames[..., 2] * 0.0722) / 255.0
    flow, ok, cx, cy = tile_flow(luma)
    width = _shrink(luma[:1]).shape[2]
    speed = np.linalg.norm(flow, axis=-1) * fps / width  # frame widths per second
    moving = ok & (speed > MOVING)
    out: dict[str, float] = {}
    # How much of the frame is flowing, and how fast where it is.
    out["flow_area"] = float(moving.mean())
    out["flow_speed"] = float(np.median(speed[moving])) if moving.any() else 0.0
    out["textured_area"] = float(ok.mean())

    zooms, spins, swirls = [], [], []
    for f in range(len(flow)):
        fit = _fit_affine(flow[f] * fps / width, moving[f], cx, cy)
        if fit:
            zooms.append(abs(fit[0]))
            spins.append(abs(fit[1]))
            swirls.append(fit[2])
    # A zoom of 1 means the picture doubles in size in about 0.7 s; a spin of 1 is a radian a second.
    out["flow_zoom"] = float(np.mean(zooms)) if zooms else 0.0
    out["flow_spin"] = float(np.mean(spins)) if spins else 0.0
    # The share of the motion that is NOT one slide, zoom or turn of the whole frame.
    out["flow_swirl"] = float(np.mean(swirls)) if swirls else 0.0

    # How much the pattern of motion itself changes from one second to the next.
    lag = max(1, int(round(fps)))
    if len(flow) > lag + 1:
        a, b = flow[:-lag], flow[lag:]
        both = moving[:-lag] | moving[lag:]
        num = (np.linalg.norm(a - b, axis=-1) * both).sum(axis=(1, 2))
        den = ((np.linalg.norm(a, axis=-1) + np.linalg.norm(b, axis=-1)) * both).sum(axis=(1, 2))
        valid = den > 1e-6
        out["flow_change"] = float(np.mean(num[valid] / den[valid])) if valid.any() else 0.0
    else:
        out["flow_change"] = 0.0

    # Detail: how much fine structure the picture has, as brightness steps between neighbouring pixels.
    sample = _shrink(luma[:: max(1, len(luma) // 60)])
    gx = np.abs(np.diff(sample, axis=2)).mean()
    gy = np.abs(np.diff(sample, axis=1)).mean()
    out["detail"] = float(gx + gy)  # always at WORK_WIDTH, so clips of different sizes compare
    # The share of the picture where neighbouring pixels are all but equal: flat colour, or black.
    step = np.abs(np.diff(sample, axis=2))[:, :-1] + np.abs(np.diff(sample, axis=1))[:, :, :-1]
    out["flat_area"] = float((step < 2.0 / 255.0).mean())

    # Pace: how different the picture is after a short and a long wait, against its own contrast.
    spread = float(luma.std()) + 1e-6
    for name, seconds in (("change_quarter_s", 0.25), ("change_2s", 2.0)):
        k = max(1, int(round(seconds * fps)))
        out[name] = float(np.abs(luma[k:] - luma[:-k]).mean() / spread) if len(luma) > k else 0.0
    return out


REFERENCE = Path(__file__).parent / "milkdrop_reference.json"
# The figures set beside the reference: the motion ones above and the render loop's own.
REFERENCE_FIGURES = [
    "flow_area", "flow_speed", "flow_swirl", "flow_change", "flow_zoom", "flow_spin", "detail", "flat_area",
    "change_quarter_s", "change_2s", "look_change", "punch", "audio_sync", "jerkiness", "active_area",
    "colourfulness", "one_hue_share", "contrast", "wash", "variety",
]  # fmt: skip


def reference_table(ours: list[dict], reference: dict) -> list[str]:
    """Markdown rows: each figure's range over the Milkdrop reference clips beside the median of ours.

    `ours` is a list of metric dicts, one per clip. "Inside" means our median lies
    between the reference's 10th and 90th percentile.
    """
    lines = ["| Figure | Milkdrop, 10th to 90th percentile | Milkdrop median | Ours, median | Ours, range | |", "|---|---|---|---|---|---|"]
    for name in REFERENCE_FIGURES:
        ref = reference["figures"].get(name)
        values = [c[name] for c in ours if name in c]
        if not ref or not values:
            continue
        mid = float(np.median(values))
        verdict = "inside" if ref["p10"] <= mid <= ref["p90"] else ("below" if mid < ref["p10"] else "above")
        lines.append(f"| {name} | {ref['p10']:.3f} to {ref['p90']:.3f} | {ref['p50']:.3f} | {mid:.3f} | {min(values):.3f} to {max(values):.3f} | {verdict} |")
    return lines


def selftest() -> list[tuple[str, bool, str]]:
    """Known motions, measured. Returns (name, passed, detail) for the loop's self-test."""
    rng = np.random.default_rng(3)
    h, w, n, fps = 135, 240, 24, 30.0
    big = rng.random((h * 3, w * 3)).astype(np.float32)
    for _ in range(3):  # blur a little so sub-pixel shifts mean something
        big = (big + np.roll(big, 1, 0) + np.roll(big, 1, 1) + np.roll(big, (1, 1), (0, 1))) / 4
    big = (big - big.min()) / (big.max() - big.min())

    def clip(make) -> np.ndarray:
        frames = np.stack([make(i) for i in range(n)])
        return np.repeat((frames[..., None] * 255).astype(np.uint8), 3, axis=-1)

    results = []
    still = compute(clip(lambda i: big[h : 2 * h, w : 2 * w]), fps)
    results.append(("motion: a still picture has no flow", still["flow_area"] < 0.02, f"-> flow over {still['flow_area'] * 100:.0f}% of the frame"))

    slide = compute(clip(lambda i: big[h : 2 * h, w + 2 * i : 2 * w + 2 * i]), fps)  # 2 px a frame = 0.25 widths a second
    results.append(("motion: a slide is measured at its speed", abs(slide["flow_speed"] - 0.25) < 0.02 and slide["flow_area"] > 0.9, f"-> {slide['flow_speed']:.3f} widths/s (0.25 expected) over {slide['flow_area'] * 100:.0f}%"))
    results.append(("motion: and is seen as one rigid movement", slide["flow_swirl"] < 0.05 and slide["flow_zoom"] < 0.02, f"-> swirl {slide['flow_swirl']:.2f}, zoom {slide['flow_zoom']:.3f}"))

    def zoomed(i: int) -> np.ndarray:
        scale = 1.0 + 0.01 * i  # grows by 1% of its first size each frame: a zoom rate of about 0.27 a second
        ys = (np.arange(h) - h / 2) / scale + h * 1.5
        xs = (np.arange(w) - w / 2) / scale + w * 1.5
        y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
        fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
        at = lambda dy, dx: big[y0 + dy][:, x0 + dx]  # noqa: E731
        return (at(0, 0) * (1 - fy) * (1 - fx) + at(0, 1) * (1 - fy) * fx + at(1, 0) * fy * (1 - fx) + at(1, 1) * fy * fx).astype(np.float32)

    zoom = compute(clip(zoomed), fps)
    results.append(("motion: a zoom is measured as a zoom", 0.2 < zoom["flow_zoom"] < 0.34 and zoom["flow_spin"] < 0.05 and zoom["flow_swirl"] < 0.2, f"-> zoom {zoom['flow_zoom']:.2f} (about 0.27 expected), spin {zoom['flow_spin']:.2f}, swirl {zoom['flow_swirl']:.2f}"))

    def halves(i: int) -> np.ndarray:  # top half slides right, bottom half left: not one rigid movement
        frame = big[h : 2 * h, w : 2 * w].copy()
        frame[: h // 2] = big[h : h + h // 2, w + 2 * i : 2 * w + 2 * i]
        frame[h // 2 :] = big[h + h // 2 : 2 * h, w - 2 * i : 2 * w - 2 * i]
        return frame

    shear = compute(clip(halves), fps)
    results.append(("motion: two halves moving apart are not rigid", shear["flow_swirl"] > 0.1 or shear["flow_spin"] > 0.2, f"-> swirl {shear['flow_swirl']:.2f}, spin {shear['flow_spin']:.2f}"))

    flat = compute(clip(lambda i: np.full((h, w), 0.5, dtype=np.float32)), fps)
    results.append(("motion: flat colour has no detail and nothing to track", flat["detail"] < 1e-4 and flat["textured_area"] < 0.01 and still["detail"] > 0.01 and flat["flat_area"] > 0.99 and still["flat_area"] < 0.3, f"-> detail {flat['detail']:.4f} flat, {still['detail']:.3f} textured"))
    return results


if __name__ == "__main__":
    import sys

    failed = False
    for name, ok, detail in selftest():
        print(f"{'ok  ' if ok else 'FAIL'} {name} {detail}")
        failed |= not ok
    sys.exit(1 if failed else 0)
