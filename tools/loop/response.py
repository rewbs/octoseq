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
- jump_size       how much more of the frame changes at a blow than changes when
                  the picture is at rest, as a share of the frame
- undone          how much of a jump is taken back within two frames: near 1 the
                  answer was a blip; near 0 it eased back, or stayed
- stray_jumps     the share of the picture's jumps that land on no sound at all
- dead_time       the share of two-second stretches with music in them in which
                  the picture answers under a third of what it is called to

A jump is a frame in which the picture starts to change far more than it was the
frame before, and than it does at rest: the picture's own onset. It is counted on
how much the picture changed, not on how bright it is, so a scene can answer a roll
by turning or stepping as well as by flaring.

    python3 tools/loop/response.py clip.mp4 package.json    # the figures for one clip
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

CHANGED = 0.05  # a pixel has visibly changed if its brightness moved this much between frames
CHANGE_FLOOR = 0.004  # a jump changes the picture's brightness by at least this much on average...
JUMP_FLOOR = 0.015  # (the same floor for a series of changed area)
JUMP_RATIO = 1.6  # ...and this many times what it did the frame before, and what it does at rest
AROUND_S = 0.75  # "at rest" is judged over this long either side...
REST_PERCENTILE = 25  # ...as the lower quartile of what the picture does there
ANSWER_FRAMES = 3  # a blow is answered by a jump within this many frames after it (0.1 s at 30 fps)
UNDO_FRAMES = 2  # a jump is "undone" by how far the picture is back where it was this many frames after it
ROLL_GAP_S = 0.2  # blows closer than this are a roll
WINDOW_S = 2.0
ANSWERED_ENOUGH = 1 / 3


def changed_area(luma: np.ndarray) -> np.ndarray:
    """For each frame, the share of the picture that visibly changed since the one before."""
    if len(luma) < 2:
        return np.zeros(len(luma))
    area = (np.abs(np.diff(luma, axis=0)) > CHANGED).mean(axis=(1, 2))
    return np.concatenate([[0.0], area])


def change(luma: np.ndarray) -> np.ndarray:
    """For each frame, how much the picture changed since the one before: the mean change in brightness."""
    if len(luma) < 2:
        return np.zeros(len(luma))
    return np.concatenate([[0.0], np.abs(np.diff(luma, axis=0)).mean(axis=(1, 2))])


def jumps(area: np.ndarray, fps: float, floor: float = JUMP_FLOOR) -> np.ndarray:
    """The frames at which the picture jumps: it starts to change far more than it was, and than it does at rest.

    Given how much the picture changed at each frame. A jump is a rise: the
    frame changes `JUMP_RATIO` times what the frame before did, and that many
    times what the picture does at rest (the lower quartile of the second and a
    half around it). It is not asked to be a peak standing clear of everything
    near it: a picture that hits and eases back goes on changing for several
    frames after the hit, and in a detailed picture each of those changes as
    many pixels by as much as the hit did, so a hit followed by its own easing
    would not stand clear of it, and would not be counted.
    """
    n = len(area)
    half = max(2, int(round(AROUND_S * fps)))
    found = []
    for i in range(1, n):
        if area[i] < floor or area[i] < JUMP_RATIO * area[i - 1]:
            continue
        if area[i] >= JUMP_RATIO * float(np.percentile(area[max(0, i - half) : i + half + 1], REST_PERCENTILE)):
            found.append(i)
    return np.array(found, dtype=int)


def _stream(package: dict, role: str) -> list[dict]:
    """A role's events, or the stream of that name if the bundle binds no such role."""
    name = package.get("roles", {}).get(role, {}).get("events", role)
    return next((s["events"] for s in package.get("eventStreams", []) if s["name"] == name), [])


def blows(package: dict) -> list[float]:
    """Every blow the picture is given to answer, in order; two within a thirtieth of a second are one.

    That is the bundle's `hit` role: every kick and snare where the track has
    drums, and the strongest onsets where it has none. (Where it has none the
    kick and snare streams hold stand-ins, the mix's low and middle bands, which
    no scene's main movement follows: asked about those, every scene on a track
    without drums answered a third of them and looked dead.) A bundle with no
    such role is asked about its kicks and snares.
    """
    given = package.get("roles", {}).get("hit", {}).get("events")
    own = next((s["events"] for s in package.get("eventStreams", []) if s["name"] == given), None) if given else None
    times = sorted(float(e["time"]) for e in own) if own else sorted(float(e["time"]) for role in ("kick", "snare") for e in _stream(package, role))
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
    moved = change(luma)
    jump_frames = jumps(moved, fps, CHANGE_FLOOR)
    is_jump = np.zeros(n + ANSWER_FRAMES + 2, dtype=bool)
    is_jump[jump_frames] = True

    def answered(t: float) -> bool:
        i = int(round(t * fps))
        return bool(is_jump[max(0, i - 1) : i + ANSWER_FRAMES + 1].any())

    hits = [t for t in blows(package) if 0.5 <= t < length - 0.5]
    out: dict[str, float] = {}
    half = max(2, int(round(AROUND_S * fps)))
    # Twitch: how much of a jump is taken back at once. The picture just before
    # the jump is compared with the picture two frames after it: if that is where
    # it was, the answer was a blip, there for a frame and gone, and reads as a
    # glitch. Review 3's second round was all blips, and was called "twitchy, not
    # punchy". An answer that eases back is still on its way two frames later, and
    # one that stays (the picture turns the other way, or steps and holds) has
    # nothing to take back: both are sudden and neither is a twitch. Only blows
    # with room after them are asked: one followed at once by another says
    # nothing about how its own answer ends.
    undone = []
    for k, t in enumerate(hits):
        room = ((hits[k + 1] if k + 1 < len(hits) else length) - t) * fps
        i = int(round(t * fps))
        landed = [j for j in range(max(1, i - 1), min(n - UNDO_FRAMES - 1, i + ANSWER_FRAMES + 1)) if is_jump[j]]
        if not landed or room < UNDO_FRAMES + ANSWER_FRAMES:
            continue
        j = landed[0]
        # The jump may take two frames to arrive (the first catches it part-way).
        top = j + 1 if j + 1 < n and moved[j + 1] > moved[j] else j
        there = float(np.abs(luma[top] - luma[j - 1]).mean())
        if there <= 0:
            continue
        after = float(np.abs(luma[top + UNDO_FRAMES] - luma[j - 1]).mean())
        undone.append(max(0.0, 1.0 - after / there))
    if len(undone) >= 6:
        out["undone"] = float(np.median(undone))
    if len(hits) >= 8:
        out["answered"] = float(np.mean([answered(t) for t in hits]))
        # How much more of the frame moves at a blow than moves when the picture is
        # at rest: a picture that is always in motion does not get credit for that
        # here. At rest, and not the middle of what is around: with a blow every
        # quarter of a second and each answer easing back, the middle is an answer.
        sizes = []
        for t in hits:
            i = int(round(t * fps))
            around = area[max(0, i - half) : i + half + 1]
            sizes.append(max(0.0, float(area[i : i + ANSWER_FRAMES + 1].max()) - float(np.percentile(around, REST_PERCENTILE))))
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
