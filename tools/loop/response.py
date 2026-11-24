#!/usr/bin/env python3
"""Does the picture answer the music? The measures review 3 showed were missing.

Nine whole-track shows passed every gate and target the loop had and were rated
"not fun", above all for not being responsive: when the picture answered the music
the answer was too small; it tracked parts that were not what the music was doing;
it missed the hits in a drum roll and moved where there were none. `punch`, the one
figure meant to catch this, looks only at the bundle's `hit` stream, which is never
closer together than half a second and so says nothing about any of it.

These figures ask the question directly, of every drum blow the bundle knows of:

- answered        the share of blows (kicks and snares) at which the picture jumps
- answered_rolls  the same, for blows within a fifth of a second of another: a roll
- jump_size       how much more of the frame changes at a blow than was changing
                  around it, as a share of the frame
- stray_jumps     the share of the picture's jumps that land on no sound at all
- dead_time       the share of two-second stretches with music in them in which
                  the picture answers under a third of what it is called to

A jump is a frame in which far more of the picture changes than has been changing
around it: the picture's own onset. It is counted on how much of the frame moved,
not on how bright it is, so a scene can answer a roll by turning or stepping, which
the limit on flashing allows, as well as by flaring, which it does not.

    python3 tools/loop/response.py clip.mp4 package.json    # the figures for one clip
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

CHANGED = 0.05  # a pixel has visibly changed if its brightness moved this much between frames
JUMP_FLOOR = 0.015  # a jump moves at least this share of the frame...
JUMP_RATIO = 1.6  # ...and this many times what has been moving around it
AROUND_S = 0.75  # "around it": this long either side
ANSWER_FRAMES = 3  # a blow is answered by a jump within this many frames after it (0.1 s at 30 fps)
ROLL_GAP_S = 0.2  # blows closer than this are a roll
WINDOW_S = 2.0
ANSWERED_ENOUGH = 1 / 3


def changed_area(luma: np.ndarray) -> np.ndarray:
    """For each frame, the share of the picture that visibly changed since the one before."""
    if len(luma) < 2:
        return np.zeros(len(luma))
    area = (np.abs(np.diff(luma, axis=0)) > CHANGED).mean(axis=(1, 2))
    return np.concatenate([[0.0], area])


def jumps(area: np.ndarray, fps: float) -> np.ndarray:
    """The frames at which the picture jumps: a local peak, well above what surrounds it."""
    n = len(area)
    half = max(2, int(round(AROUND_S * fps)))
    found = []
    for i in range(1, n - 1):
        if area[i] < JUMP_FLOOR or area[i] < area[i - 1] or area[i] < area[i + 1]:
            continue
        around = np.concatenate([area[max(0, i - half) : max(0, i - 1)], area[i + 2 : i + half + 1]])
        if len(around) and area[i] >= JUMP_RATIO * float(np.median(around)):
            found.append(i)
    return np.array(found, dtype=int)


def _stream(package: dict, role: str) -> list[dict]:
    """A role's events, or the stream of that name if the bundle binds no such role."""
    name = package.get("roles", {}).get(role, {}).get("events", role)
    return next((s["events"] for s in package.get("eventStreams", []) if s["name"] == name), [])


def blows(package: dict) -> list[float]:
    """Every kick and snare, in order; two within a thirtieth of a second are one."""
    times = sorted(float(e["time"]) for role in ("kick", "snare") for e in _stream(package, role))
    merged: list[float] = []
    for t in times:
        if not merged or t - merged[-1] > 1 / 30:
            merged.append(t)
    return merged


def sounds(package: dict) -> list[float]:
    """Every event the bundle knows of, of any kind: what a jump may fairly land on."""
    names = [package.get("roles", {}).get(role, {}).get("events", role) for role in ("kick", "snare", "hat", "onset", "hit")] + ["onsetPeaks", "events", "percussive"]
    return sorted({round(float(e["time"]), 4) for s in package.get("eventStreams", []) if s["name"] in names for e in s["events"]})


def _calls(package: dict, start: float, end: float, hits: list[float]) -> list[float]:
    """What the picture is called to answer in a stretch: its blows, or failing two of those its stronger onsets."""
    inside = [t for t in hits if start <= t < end]
    if len(inside) >= 2:
        return inside
    onsets = _stream(package, "onset")
    if not onsets:
        return []
    floor = float(np.median([e["weight"] for e in onsets]))
    strong = [float(e["time"]) for e in onsets if e["weight"] >= floor and start <= e["time"] < end]
    return strong if len(strong) >= 2 else []


def compute(luma: np.ndarray, fps: float, package: dict) -> dict:
    """The response figures for a clip, given its frames as brightness (n, height, width; 0 to 1)."""
    n = len(luma)
    length = n / fps
    area = changed_area(luma)
    jump_frames = jumps(area, fps)
    is_jump = np.zeros(n + ANSWER_FRAMES + 2, dtype=bool)
    is_jump[jump_frames] = True

    def answered(t: float) -> bool:
        i = int(round(t * fps))
        return bool(is_jump[max(0, i - 1) : i + ANSWER_FRAMES + 1].any())

    hits = [t for t in blows(package) if 0.5 <= t < length - 0.5]
    out: dict[str, float] = {}
    if len(hits) >= 8:
        out["answered"] = float(np.mean([answered(t) for t in hits]))
        # How much more of the frame moves at a blow than was moving around it: a
        # picture that is always in motion does not get credit for that here.
        half = max(2, int(round(AROUND_S * fps)))
        sizes = []
        for t in hits:
            i = int(round(t * fps))
            around = np.concatenate([area[max(0, i - half) : max(0, i - 1)], area[i + ANSWER_FRAMES + 1 : i + half + 1]])
            sizes.append(max(0.0, float(area[i : i + ANSWER_FRAMES + 1].max()) - (float(np.median(around)) if len(around) else 0.0)))
        out["jump_size"] = float(np.median(sizes))
        rolled = [t for k, t in enumerate(hits) if (k > 0 and t - hits[k - 1] < ROLL_GAP_S) or (k + 1 < len(hits) and hits[k + 1] - t < ROLL_GAP_S)]
        if len(rolled) >= 6:
            out["answered_rolls"] = float(np.mean([answered(t) for t in rolled]))
    if len(jump_frames) >= 4:
        heard = np.array(sounds(package)) * fps
        if len(heard):
            # A jump may come up to four frames after its sound, or a frame before it is rounded to.
            nearest = np.array([np.min(np.where((j - heard >= -1.5) & (j - heard <= 4.5), 0.0, 1.0)) for j in jump_frames])
            out["stray_jumps"] = float(nearest.mean())
    live, dead = 0, 0
    for k in range(int(length // WINDOW_S)):
        calls = [t for t in _calls(package, k * WINDOW_S, (k + 1) * WINDOW_S, hits) if t < length - 0.2]
        if len(calls) < 2:
            continue
        live += 1
        dead += float(np.mean([answered(t) for t in calls])) < ANSWERED_ENOUGH
    if live >= 3:
        out["dead_time"] = dead / live
    return out


def main() -> int:
    sys.path.insert(0, str(Path(__file__).parent))
    import metrics

    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1].strip())
    frames = metrics.load_frames(Path(sys.argv[1]))
    figures = compute(metrics._luma(frames), 30.0, json.loads(Path(sys.argv[2]).read_text()))
    print(json.dumps({k: round(v, 3) for k, v in figures.items()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
