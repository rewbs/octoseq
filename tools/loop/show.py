#!/usr/bin/env python3
"""Edit a show by hand, and re-roll the rest of it without losing the edits.

    python3 tools/loop/show.py list .loop/shows/dontstop-1
    python3 tools/loop/show.py set .loop/shows/dontstop-1 3 --palette ice --speed 0.9
    python3 tools/loop/show.py set .loop/shows/dontstop-1 3 --scene swirl --transition 1.5
    python3 tools/loop/show.py split .loop/shows/dontstop-1 42.5 --scene lattice
    python3 tools/loop/show.py remove .loop/shows/dontstop-1 4
    python3 tools/loop/show.py pin .loop/shows/dontstop-1 0 1
    python3 tools/loop/show.py reroll .loop/shows/dontstop-1 --bundle path/to/package.json --seed 8
    python3 tools/loop/show.py check .loop/shows/dontstop-1
    python3 tools/loop/show.py selftest

The director (director.py) proposes a show: which scene plays from when, in which
colours, at what speed, and whether it cuts in or blends in. This tool is for the
person who watches the result and wants some of it different. Segments are numbered
from 0, as `list` shows them; the numbers shift after a `split` or a `remove`.

What the tool takes care of:

- A show directory holds its own copy of every scene, one per segment, and the
  renderer reads only those. An edit rewrites the copy of the segment it changes and
  no other, so the segments you did not touch keep rendering the same frames even
  after the scenes they came from have changed. A changed copy gets a new file name;
  the names of the others stay as they were.
- A segment you change belongs to you: it is marked `"pinned": true`. `reroll` asks
  the director for a fresh show and then puts every pinned segment back where it
  was, with the very same scene copy. Only the rest is replaced. `pin` and `unpin`
  set the mark by hand, for a segment the director got right or one you give back.
- Nothing is written unless the result is a show the engine will play (the rules in
  packages/visualiser/src/show.rs): the first segment starts at 0 and has nothing to
  blend in from, starts are in time order, and a blend is over before the next
  segment starts. An edit that breaks a rule is refused and the show is left alone.
- Each change is added to the `"edits"` list in show.json, so the file says what was
  done to it. Fields this tool does not know are kept as they are.
- Nothing here is chance, except the seed `reroll` draws when you do not give one.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import io
import json
import math
import os
import re
import shutil
import struct
import sys
import tempfile
from pathlib import Path
from typing import Callable, Iterable

sys.path.insert(0, str(Path(__file__).parent))
import director  # noqa: E402

SHOW_FILE = "show.json"
SPLIT_BLEND_S = 2.0  # how long the second part of a split takes to blend in, at most
COPY_NAME = re.compile(r"^(\d+)-.*\.rhai$")
# Scene copies an edit has made but `save` has not yet written, as {file name: text},
# held in the show itself so that an edit can be checked before anything is written.
# `save` writes them and leaves this key out of show.json.
PENDING = "_pending_copies"


class ShowError(ValueError):
    """An edit that cannot be made, or a show the engine would refuse. `problems` has one line per reason."""

    def __init__(self, problems: str | list[str]):
        self.problems = [problems] if isinstance(problems, str) else list(problems)
        super().__init__("; ".join(self.problems))


# ---------------------------------------------------------------------------
# Reading, checking and writing
# ---------------------------------------------------------------------------


def load(show_path: Path) -> tuple[dict, Path]:
    """Read a show from its directory or its show.json. Returns (show, directory)."""
    path = Path(show_path).expanduser()
    if path.is_dir():
        path = path / SHOW_FILE
    if path.name != SHOW_FILE:
        # `save` writes show.json, so reading any other file would edit one show into another.
        raise ShowError(f"{path} is not a show directory or a {SHOW_FILE}")
    if not path.is_file():
        raise ShowError(f"there is no show at {path}")
    try:
        show = json.loads(path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ShowError(f"{path} is not readable as a show: {error}") from error
    if not isinstance(show, dict) or not isinstance(show.get("segments"), list) or not show["segments"]:
        raise ShowError(f"{path} has no list of segments")
    for index, segment in enumerate(show["segments"]):
        # Every command reads the start times, so a show without them cannot be edited at all.
        if not isinstance(segment, dict) or not _number(segment.get("start")) or not math.isfinite(segment["start"]):
            raise ShowError(f"{path}: segment {index} has no start time")
    return show, path.parent


def _f32(value: float) -> float:
    """A number as the engine holds it: show.rs reads times as 32-bit floats."""
    return struct.unpack("f", struct.pack("f", value))[0]


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _end(show: dict, index: int) -> float | None:
    """When a segment stops playing: the next one's start, or the end of the track if the show knows it."""
    segments = show["segments"]
    if index + 1 < len(segments):
        return float(segments[index + 1]["start"])
    return float(show["duration"]) if _number(show.get("duration")) else None


def validate(show: dict, directory: Path | None) -> list[str]:
    """Everything that would stop the engine playing this show, one line each; empty when it will play.

    The same checks as packages/visualiser/src/show.rs, on the same 32-bit numbers,
    and that every scene copy is there. With no directory the copies are not looked for.
    """
    segments = show.get("segments")
    if not isinstance(segments, list) or not segments:
        return ["a show needs at least one segment"]
    pending = show.get(PENDING, {})
    problems: list[str] = []
    timed = True
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            problems.append(f"segment {index} is not a JSON object")
            timed = False
            continue
        start = segment.get("start")
        if not _number(start) or not math.isfinite(start) or abs(start) > 1e9:
            problems.append(f"segment {index} has no usable start time ({start!r})")
            timed = False
        transition = segment.get("transition", 0.0)
        if not _number(transition) or not 0.0 <= transition <= 1e9:
            problems.append(f"segment {index}: a transition cannot take {transition!r} seconds")
            timed = False
        script = segment.get("script")
        if not isinstance(script, str) or not script:
            problems.append(f"segment {index} names no scene copy")
        elif directory is not None and script not in pending and not (Path(directory) / script).is_file():
            problems.append(f"segment {index}: its scene copy {script} is missing from {directory}")
    if not timed:
        return problems  # the checks below need every time to be a number

    starts = [_f32(s["start"]) for s in segments]
    blends = [_f32(s.get("transition", 0.0)) for s in segments]
    if abs(starts[0]) > 1e-6:
        problems.append(f"the first segment must start at 0, not {segments[0]['start']}")
    if blends[0] != 0.0:
        problems.append(f"the first segment has nothing to blend in from: its transition must be 0, not {segments[0]['transition']}")
    for index in range(1, len(segments)):
        if starts[index] <= starts[index - 1]:
            problems.append(f"segment {index} starts at {segments[index]['start']}, which is not after segment {index - 1} at {segments[index - 1]['start']}")
    for index in range(1, len(segments) - 1):
        # show.rs: before.start + before.transition > entry.start + 1e-6, all in 32 bits.
        if blends[index] > 0.0 and _f32(starts[index] + blends[index]) > _f32(starts[index + 1] + 1e-6):
            held = segments[index + 1]["start"] - segments[index]["start"]
            problems.append(f"segment {index} blends in over {segments[index]['transition']} s but is only held for {held:.3f} s: the blend must be over before segment {index + 1} starts")
    if _number(show.get("duration")) and starts[-1] >= show["duration"]:
        problems.append(f"segment {len(segments) - 1} starts at {segments[-1]['start']}, which is not before the end of the track at {show['duration']:.3f}")
    return problems


def notes(show: dict) -> list[str]:
    """Things the engine will play but the director would not have made. Worth a look; never a refusal."""
    found: list[str] = []
    segments = show["segments"]
    for index, segment in enumerate(segments):
        end = _end(show, index)
        if end is not None:
            held = end - segment["start"]
            if held < director.MIN_HOLD_S:
                found.append(f"segment {index} is held for {held:.2f} s, shorter than the director's {director.MIN_HOLD_S:g} s")
            if held > director.MAX_HOLD_S + 1e-6:
                found.append(f"segment {index} is held for {held:.2f} s, longer than the director's {director.MAX_HOLD_S:g} s")
        if index and segment.get("scene") is not None and segment.get("scene") == segments[index - 1].get("scene"):
            found.append(f"segments {index - 1} and {index} are the same scene twice running ({Path(segment['scene']).stem})")
    return found


def save(show: dict, directory: Path) -> Path:
    """Write a show back to its directory, if the engine would play it. Returns show.json.

    Raises ShowError, having written nothing, when `validate` finds a problem. New
    scene copies go in first, then show.json is swapped in whole, then the copies the
    show no longer names are removed: at every moment the directory holds a show
    that plays.
    """
    directory = Path(directory)
    problems = validate(show, directory)
    if problems:
        raise ShowError(problems)
    path = directory / SHOW_FILE
    named = {segment["script"] for segment in show["segments"]}
    before: set[str] = set()
    if path.is_file():
        with contextlib.suppress(ValueError, TypeError, KeyError, AttributeError):
            before = {s["script"] for s in json.loads(path.read_bytes().decode("utf-8"))["segments"] if isinstance(s.get("script"), str)}
    directory.mkdir(parents=True, exist_ok=True)
    for name, text in sorted(show.get(PENDING, {}).items()):
        if name in named:
            (directory / name).write_bytes(text.encode("utf-8"))
    body = json.dumps({key: value for key, value in show.items() if key != PENDING}, indent=1) + "\n"
    temporary = directory / (SHOW_FILE + ".tmp")
    temporary.write_bytes(body.encode("utf-8"))
    os.replace(temporary, path)  # all at once: a reader sees the old show or the new one, never half
    for name in sorted(before - named):
        # Only plain file names: a show may name a script elsewhere, and that is not ours to delete.
        if Path(name).name == name and (directory / name).is_file():
            (directory / name).unlink()
    show.pop(PENDING, None)
    return path


# ---------------------------------------------------------------------------
# Helpers for the edits
# ---------------------------------------------------------------------------


def _segment(show: dict, index: int) -> dict:
    segments = show["segments"]
    if not 0 <= index < len(segments):
        raise ShowError(f"there is no segment {index}: this show has segments 0 to {len(segments) - 1}")
    return segments[index]


def _record(show: dict, command: str, **arguments: object) -> None:
    """Add one line to the show's own account of what was done to it. No times: the same edits give the same file."""
    show.setdefault("edits", []).append({"command": command, **arguments})


def _scene_name(name: str) -> str:
    """`pulse`, `pulse.rhai` and `scenes/pulse.rhai` all mean the scene file pulse.rhai."""
    name = Path(str(name)).name
    return name if name.endswith(".rhai") else f"{name}.rhai"


def _scene_source(scene: str, scenes_dir: Path, package: dict | None = None) -> str:
    """A scene's source, once it is known that the scene can be dressed (and, given a bundle, played)."""
    path = Path(scenes_dir) / scene
    if not path.is_file():
        raise ShowError(f"there is no scene {scene} in {scenes_dir}")
    source = path.read_bytes().decode("utf-8")
    if not director.STYLE_LINE.search(source):
        raise ShowError(f"{scene} has no style line, so it cannot be given a palette or a speed")
    if package is not None:
        missing = director.scene_roles(path) - set(package.get("roles", {}))
        if missing:
            raise ShowError(f"{scene} needs roles this track's bundle does not have: {', '.join(sorted(missing))}")
    return source


def _highest_copy_number(names: Iterable[object]) -> int:
    numbers = [int(match.group(1)) for name in names if isinstance(name, str) and (match := COPY_NAME.match(Path(name).name))]
    return max(numbers, default=-1)


def _names_in_use(show: dict, directory: Path | None) -> set[object]:
    names: set[object] = {segment.get("script") for segment in show["segments"]} | set(show.get(PENDING, {}))
    if directory is not None and Path(directory).is_dir():
        names |= {path.name for path in Path(directory).glob("*.rhai")}
    return names


def _dress(show: dict, segment: dict, source: str, name: str) -> None:
    """Give a segment a new scene copy under a new name. Written by `save`; the old copy goes then too."""
    if "colours" not in segment or "speed" not in segment:
        raise ShowError("this segment has no colours or no speed to dress a scene with: set its --palette and --speed")
    pending = show.setdefault(PENDING, {})
    pending.pop(segment.get("script"), None)
    pending[name] = director.dressed(source, segment)
    segment["script"] = name


def _fresh_name(show: dict, scene: str, directory: Path | None) -> str:
    """A copy name no segment or file has: one more than the highest number in use."""
    return f"{_highest_copy_number(_names_in_use(show, directory)) + 1:03d}-{Path(scene).stem}.rhai"


def _palette_colours(palette: str, vivid: bool) -> list[list[float]]:
    """A palette's three colours in order, as the director would write them into this show."""
    return [[round(c**director.SCREEN_GAMMA if vivid else c, 4) for c in colour] for colour in director.PALETTES[palette]]


def _scene_choices(show: dict, scenes_dir: Path, package: dict | None) -> list[str]:
    """Scenes that can play on this show's track, in name order.

    With the bundle, what the director would choose from. Without it, the scenes the
    show already uses: the director chose those for this track, so they are known to work.
    """
    if package is not None:
        return [path.name for path in director.usable_scenes(package, Path(scenes_dir))]
    used = sorted({s["scene"] for s in show["segments"] if isinstance(s.get("scene"), str)})
    return [name for name in used if (Path(scenes_dir) / name).is_file() and director.STYLE_LINE.search((Path(scenes_dir) / name).read_text())]


def _other_scene(choices: list[str], current: str | None, before: str | None, after: str | None) -> str:
    """The scene that repeats its neighbours least: the current one if it is as good as any, else the first by name."""
    return min(choices, key=lambda name: ((name == before) + (name == after), name != current, name))


# ---------------------------------------------------------------------------
# The edits. Each takes a show and returns a changed copy; nothing touches the disk
# until `save`.
# ---------------------------------------------------------------------------


def listing(show: dict) -> str:
    """The show as a table, one segment a line."""
    segments = show["segments"]
    length = f" over {show['duration']:.0f} s" if _number(show.get("duration")) else ""
    lines = [
        f"seed {show.get('seed', '?')}: {len(segments)} segments{length}",
        f"{'#':>3}  {'start':>8}  {'end':>8}  {'hold':>6}  {'scene':12}  {'palette':8}  {'speed':>5}  {'mist':>4}  {'comes in':14}  yours",
    ]
    for index, segment in enumerate(segments):
        end = _end(show, index)
        blend = segment.get("transition", 0.0)
        speed = f"{segment['speed']:5.2f}" if _number(segment.get("speed")) else f"{'-':>5}"
        mist = f"{segment['mist']:4.2f}" if _number(segment.get("mist")) else f"{'-':>4}"
        mark = ", ".join(word for word, on in (("pinned", segment.get("pinned")), ("edited", segment.get("edited"))) if on)
        lines.append(
            f"{index:3d}  {segment['start']:8.3f}  "
            + (f"{end:8.3f}  {end - segment['start']:6.2f}" if end is not None else f"{'-':>8}  {'-':>6}")
            + f"  {Path(str(segment.get('scene', '-'))).stem:12}  {str(segment.get('palette', '-')):8}  {speed}  {mist}"
            + f"  {(f'blend {blend:g} s' if blend else 'cut'):14}  {mark}"
        )
    return "\n".join(line.rstrip() for line in lines)


def set_segment(
    show: dict,
    index: int,
    *,
    scene: str | None = None,
    palette: str | None = None,
    speed: float | None = None,
    mist: float | None = None,
    transition: float | None = None,
    start: float | None = None,
    scenes_dir: Path = director.SCENES,
    directory: Path | None = None,
    package: dict | None = None,
) -> dict:
    """Change one segment. It becomes pinned and edited; a change of scene, palette, speed or mist gives it a new scene copy.

    `directory` is the show's own, so that the new copy's name is not one already
    there. `package` is the track's bundle: given, a new scene is checked against it.
    """
    show = copy.deepcopy(show)
    segment = _segment(show, index)
    changed: dict[str, object] = {}
    if scene is not None:
        segment["scene"] = changed["scene"] = _scene_name(scene)
    if palette is not None:
        if palette not in director.PALETTES:
            raise ShowError(f"there is no palette called {palette}: choose from {', '.join(sorted(director.PALETTES))}")
        segment["palette"] = changed["palette"] = palette
        segment["colours"] = _palette_colours(palette, bool(show.get("vivid", False)))
    if speed is not None:
        if not math.isfinite(speed) or speed <= 0:
            raise ShowError(f"a speed must be more than 0, not {speed}")
        segment["speed"] = changed["speed"] = float(speed)
    if mist is not None:
        if not math.isfinite(mist) or not 0.0 <= mist <= 1.0:
            raise ShowError(f"mist runs from 0 (crisp) to 1 (misty), not {mist}")
        segment["mist"] = changed["mist"] = float(mist)
    if transition is not None:
        segment["transition"] = changed["transition"] = round(float(transition), 3)
    if start is not None:
        segment["start"] = changed["start"] = round(float(start), 3)
    if not changed:
        raise ShowError("nothing to change: give at least one of --scene, --palette, --speed, --mist, --transition, --start")
    if scene is not None or palette is not None or speed is not None or mist is not None:
        if not isinstance(segment.get("scene"), str):
            raise ShowError(f"segment {index} does not say which scene it plays: give --scene")
        # From the scenes folder, as the director dresses them. Only this segment's
        # copy: director.write would re-copy every scene and so change segments
        # nobody asked to change.
        source = _scene_source(segment["scene"], scenes_dir, package if scene is not None else None)
        _dress(show, segment, source, _fresh_name(show, segment["scene"], directory))
    segment["pinned"] = True
    segment["edited"] = True
    _record(show, "set", index=index, **changed)
    return show


def pin(show: dict, indices: Iterable[int]) -> dict:
    """Mark segments as yours: `reroll` will keep them."""
    show = copy.deepcopy(show)
    indices = list(indices)
    for index in indices:
        _segment(show, index)["pinned"] = True
    _record(show, "pin", indices=indices)
    return show


def unpin(show: dict, indices: Iterable[int]) -> dict:
    """Give segments back to the director: the next `reroll` replaces them."""
    show = copy.deepcopy(show)
    indices = list(indices)
    for index in indices:
        _segment(show, index).pop("pinned", None)
    _record(show, "unpin", indices=indices)
    return show


def split(
    show: dict,
    time: float,
    *,
    scene: str | None = None,
    scenes_dir: Path = director.SCENES,
    directory: Path | None = None,
    package: dict | None = None,
) -> dict:
    """Cut the segment playing at `time` in two there. The second part is new, pinned, and blends in.

    It keeps the first part's colours and speed. Its scene is the one named, or else
    the first by name that neither neighbour is showing.
    """
    show = copy.deepcopy(show)
    segments = show["segments"]
    if not _number(time) or not math.isfinite(time):
        raise ShowError(f"{time!r} is not a time to split at")
    time = round(float(time), 3)
    index = max((i for i, s in enumerate(segments) if s["start"] <= time), default=None)
    if index is None:
        raise ShowError(f"nothing is playing at {time} s: the show starts at {segments[0]['start']}")
    first, end = segments[index], _end(show, index)
    if time <= first["start"]:
        raise ShowError(f"segment {index} already starts at {time} s: there is nothing to split")
    if end is not None and time >= end:
        raise ShowError(f"{time} s is not before the end of the track at {end:.3f}")
    following = segments[index + 1].get("scene") if index + 1 < len(segments) else None
    if scene is None:
        choices = _scene_choices(show, scenes_dir, package)
        if not choices:
            raise ShowError(f"no scene in {scenes_dir} can be chosen for the new part: name one with --scene")
        name = _other_scene(choices, None, first.get("scene"), following)
    else:
        name = _scene_name(scene)
    blend = SPLIT_BLEND_S if end is None else min(SPLIT_BLEND_S, (end - time) * director.TRANSITION_MAX_SHARE)
    second: dict = {"start": time, "scene": name, "new_section": False}
    for key in ("palette", "colours", "speed", "mist"):
        if key in first:
            second[key] = copy.deepcopy(first[key])
    second["transition"] = round(blend, 3)
    second["pinned"] = True
    segments.insert(index + 1, second)
    _dress(show, second, _scene_source(name, scenes_dir, package), _fresh_name(show, name, directory))
    _record(show, "split", time=time, scene=name)
    return show


def remove(show: dict, index: int) -> dict:
    """Delete a segment. The one before it plays on until the next."""
    show = copy.deepcopy(show)
    segment = _segment(show, index)
    if index == 0:
        raise ShowError("the first segment cannot be removed, because a show must start at 0: change it with set instead")
    show.get(PENDING, {}).pop(segment.get("script"), None)
    del show["segments"][index]
    _record(show, "remove", index=index)
    return show


def reroll(
    show: dict,
    package: dict,
    seed: int | None = None,
    *,
    scenes_dir: Path = director.SCENES,
    directory: Path | None = None,
) -> dict:
    """A fresh show from the director for the same bundle, with every pinned segment put back.

    A pinned segment keeps its start, its scene copy and everything else about it. It
    covers the time from its start to what was its end; the director's segments that
    start in that time are dropped, and the pinned segment plays until the next one
    left. The director's segments get new scene copies from `scenes_dir`.
    """
    try:
        fresh = director.direct(package, seed, Path(scenes_dir), bool(show.get("vivid", False)))
    except ValueError as error:
        raise ShowError(str(error)) from error
    duration = fresh["duration"]
    kept: list[tuple[dict, float]] = []
    for index, segment in enumerate(show["segments"]):
        if segment.get("pinned"):
            end = _end(show, index)
            kept.append((copy.deepcopy(segment), duration if end is None else end))
    merged = [dict(s) for s in fresh["segments"] if not any(mine["start"] <= s["start"] < end for mine, end in kept)]
    merged = sorted(merged + [mine for mine, _ in kept], key=lambda s: s["start"])

    # One of the director's segments left with only a moment before a pinned one
    # starts would flash past: let the segment before it play on instead.
    segments: list[dict] = []
    for index, segment in enumerate(merged):
        following = merged[index + 1] if index + 1 < len(merged) else None
        sliver = following is not None and following.get("pinned") and following["start"] - segment["start"] < director.MIN_HOLD_S
        if segments and not segment.get("pinned") and sliver:
            continue
        segments.append(segment)

    # The director never shows a scene twice running, but it did not know about the
    # pinned segments. Where two meet, the director's one gives way.
    choices = [path.name for path in director.usable_scenes(package, Path(scenes_dir))]
    for index, segment in enumerate(segments):
        if segment.get("pinned"):
            continue
        before = segments[index - 1].get("scene") if index else None
        after = segments[index + 1].get("scene") if index + 1 < len(segments) else None
        if segment["scene"] in (before, after):
            segment["scene"] = _other_scene(choices, segment["scene"], before, after)
        # A pinned segment may now start sooner than the director expected; a blend
        # must still be over in the first third of the time there is.
        end = segments[index + 1]["start"] if index + 1 < len(segments) else duration
        fits = (end - segment["start"]) * director.TRANSITION_MAX_SHARE
        segment["transition"] = 0.0 if index == 0 else round(min(float(segment["transition"]), fits), 3)

    result = copy.deepcopy(show)
    result.update(director=fresh["director"], seed=fresh["seed"], vivid=fresh["vivid"], duration=duration)
    number = _highest_copy_number(_names_in_use(show, directory))
    pending = {name: text for name, text in show.get(PENDING, {}).items() if any(name == mine.get("script") for mine, _ in kept)}
    result[PENDING] = pending
    result["segments"] = segments
    for segment in segments:
        if not segment.get("pinned"):
            number += 1
            _dress(result, segment, _scene_source(segment["scene"], scenes_dir), f"{number:03d}-{Path(segment['scene']).stem}.rhai")
    _record(result, "reroll", seed=fresh["seed"], pinned=len(kept))
    return result


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def _read_bundle(path: Path | None) -> tuple[dict | None, str | None]:
    """A bundle's package.json and the hash shows record for it."""
    if path is None:
        return None, None
    try:
        data = Path(path).expanduser().read_bytes()
        return json.loads(data.decode("utf-8")), hashlib.sha256(data).hexdigest()
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ShowError(f"{path} is not readable as a bundle's package.json: {error}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")

    def command(name: str, description: str, scenes: bool = False) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=description, description=description)
        sub.add_argument("show", type=Path, help="a show directory or its show.json")
        if scenes:
            sub.add_argument("--scenes-dir", type=Path, default=director.SCENES, help="where scenes are copied from (default: the repository's scenes folder)")
        return sub

    command("list", "show the segments as a table")
    sub = command("set", "change one segment; it becomes pinned", scenes=True)
    sub.add_argument("index", type=int)
    sub.add_argument("--scene", help="a scene's name, such as pulse")
    sub.add_argument("--palette", help=f"one of {', '.join(sorted(director.PALETTES))}")
    sub.add_argument("--speed", type=float)
    sub.add_argument("--mist", type=float, help="how misty the look is, from 0 (crisp: bright shapes on black) to 1 (misty: colour fills the frame)")
    sub.add_argument("--transition", type=float, metavar="SECONDS", help="how long it takes to blend in; 0 is a cut")
    sub.add_argument("--start", type=float, metavar="SECONDS")
    sub.add_argument("--bundle", type=Path, metavar="PACKAGE_JSON", help="the track's bundle, to check a new scene can play on it")
    for name in ("pin", "unpin"):
        sub = command(name, "mark segments as yours, so that reroll keeps them" if name == "pin" else "give segments back to the director")
        sub.add_argument("index", type=int, nargs="+")
    sub = command("split", "cut the segment playing at a time in two; the second part is pinned", scenes=True)
    sub.add_argument("time", type=float)
    sub.add_argument("--scene", help="the second part's scene (default: one that differs from its neighbours)")
    sub.add_argument("--bundle", type=Path, metavar="PACKAGE_JSON", help="the track's bundle, to choose from every scene that can play on it")
    sub = command("remove", "delete a segment; the one before it plays on")
    sub.add_argument("index", type=int)
    sub = command("reroll", "a fresh show from the director, keeping the pinned segments", scenes=True)
    sub.add_argument("--bundle", type=Path, required=True, metavar="PACKAGE_JSON", help="the track's bundle")
    sub.add_argument("--seed", type=int, help="the director's seed (default: a new one each time)")
    command("check", "say whether the engine will play the show")
    commands.add_parser("selftest", help="check this tool on a made-up show", description="check this tool on a made-up show")
    args = parser.parse_args(argv)

    if args.command == "selftest":
        failed = False
        for name, ok, detail in selftest():
            print(f"{'ok  ' if ok else 'FAIL'} {name} {detail}")
            failed |= not ok
        return 1 if failed else 0

    try:
        show, directory = load(args.show)
        if args.command == "list":
            print(listing(show))
            return 0
        if args.command == "check":
            problems = validate(show, directory)
            for problem in problems:
                print(f"problem: {problem}", file=sys.stderr)
            if problems:
                return 1
            print(f"ok: {len(show['segments'])} segments, every scene copy is there")
            for note in notes(show):
                print(f"note: {note}", file=sys.stderr)
            return 0
        package, sha = _read_bundle(getattr(args, "bundle", None))
        if args.command == "set":
            choices = dict(scene=args.scene, palette=args.palette, speed=args.speed, mist=args.mist, transition=args.transition, start=args.start)
            edited = set_segment(show, args.index, **choices, scenes_dir=args.scenes_dir, directory=directory, package=package)
        elif args.command == "pin":
            edited = pin(show, args.index)
        elif args.command == "unpin":
            edited = unpin(show, args.index)
        elif args.command == "split":
            edited = split(show, args.time, scene=args.scene, scenes_dir=args.scenes_dir, directory=directory, package=package)
        elif args.command == "remove":
            edited = remove(show, args.index)
        else:
            if show.get("bundle_sha256") not in (None, sha):
                print("note: this bundle is not the one the show was made from; pinned segments keep their times all the same", file=sys.stderr)
            edited = reroll(show, package, args.seed, scenes_dir=args.scenes_dir, directory=directory)
            edited["bundle_sha256"] = sha
        path = save(edited, directory)
    except ShowError as error:
        for problem in error.problems:
            print(f"{'problem' if args.command == 'check' else 'refused'}: {problem}", file=sys.stderr)
        return 1
    print(listing(edited))
    for note in notes(edited):
        print(f"note: {note}", file=sys.stderr)
    print(path)
    return 0


# ---------------------------------------------------------------------------
# Self-test: every command, on a made-up show in a temporary directory.
# ---------------------------------------------------------------------------


def _made_up_package() -> dict:
    """The bundle selftest.py tests the director on: 60 s, sections at 0, 20 and 26 s, a beat every half second."""
    return {
        "durationSec": 60.0,
        "roles": {r: {"events": r} for r in ("hit", "kick", "snare", "hat", "beat", "section")}
        | {"energy": {"signal": "energy"}, "bass": {"band": "Bass", "feature": "energy"}, "section_intensity": {"custom": "section_intensity"}},
        "eventStreams": [
            {"name": "section", "events": [{"time": 0.0, "weight": 1.0}, {"time": 20.0, "weight": 0.5}, {"time": 26.0, "weight": 0.5}]},
            {"name": "beat", "events": [{"time": i * 0.5, "weight": 1.0} for i in range(120)]},
        ],
        "customSignals": [{"id": "x", "name": "section_intensity", "rate": 1.0, "values": [0.2] * 20 + [1.0] * 40}],
    }


def _made_up_scene(name: str) -> str:
    return (
        "//! roles: beat, energy\n"
        f"// a made-up scene called {name}\n"
        "let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0 }; // @style\n"
        "fn update(dt, frame) {}\n"
    )


def _selftest_session(root: Path, row: Callable[..., None]) -> dict[str, bytes]:
    """Make a show under `root`, run every command on it and report through `row`. Returns the files it ends with."""
    names = ("alpha", "bravo", "charlie")
    scenes = root / "scenes"
    scenes.mkdir(parents=True)
    for name in names:
        (scenes / f"{name}.rhai").write_text(_made_up_scene(name))
    package = _made_up_package()
    bundle = root / "package.json"
    bundle.write_text(json.dumps(package))
    where = root / "show"
    made = director.direct(package, seed=11, scenes_dir=scenes)
    made["track"] = "made-up.mod"  # two fields this tool knows nothing about
    made["segments"][1]["note"] = "kept"
    director.write(made, where, scenes)
    # The scenes move on after the show is made, as they do in the repository. A copy
    # holding this line was made after the show; a copy without it was left alone.
    moved_on = b"// changed after the show was made"
    for name in names:
        with (scenes / f"{name}.rhai").open("a") as scene:
            scene.write(moved_on.decode() + "\n")

    def run(*arguments: object) -> tuple[int, str]:
        said = io.StringIO()
        with contextlib.redirect_stdout(said), contextlib.redirect_stderr(said):
            code = main([str(a) for a in arguments])
        return code, said.getvalue()

    def files(directory: Path = where) -> dict[str, bytes]:
        return {path.name: path.read_bytes() for path in sorted(directory.iterdir())}

    def untouched(before: dict[str, bytes], after: dict[str, bytes], *changed: str) -> bool:
        return all(after.get(name) == data for name, data in before.items() if name not in (SHOW_FILE, *changed))

    # list
    show, _ = load(where)
    count = len(show["segments"])
    code, said = run("list", where)
    row("list shows every segment", code == 0 and len(said.strip().splitlines()) == count + 2, f"-> {count} segments")

    # set: a palette and a speed
    before, old = files(), show["segments"][2]
    palette = next(p for p in sorted(director.PALETTES) if p != old["palette"])
    code, said = run("set", where, 2, "--palette", palette, "--speed", 1.3, "--mist", 0.25, "--scenes-dir", scenes)
    after, (edited, _) = files(), load(where)
    new = edited["segments"][2]
    fresh_copy = after.get(new["script"], b"")
    row(
        "set gives the segment it changes a new scene copy",
        code == 0 and new["script"] != old["script"] and old["script"] not in after and b"speed: 1.3, at:" in fresh_copy and b"mist: 0.25, answer:" in fresh_copy and moved_on in fresh_copy,
        f"-> {old['script']} became {new['script']}",
    )
    same_names = [s["script"] for i, s in enumerate(show["segments"]) if i != 2] == [s["script"] for i, s in enumerate(edited["segments"]) if i != 2]
    row("set leaves every other copy byte for byte as it was", same_names and untouched(before, after, old["script"]) and sum(moved_on in data for data in after.values()) == 1)
    in_order = new["colours"] == [list(colour) for colour in director.PALETTES[palette]] and str(new["colours"][0]) in fresh_copy.decode()
    row("set pins the segment and gives it the palette's colours in order", new.get("pinned") is True and new.get("edited") is True and new["palette"] == palette and in_order)
    row("fields the tool does not know are kept", edited.get("track") == "made-up.mod" and edited["segments"][1].get("note") == "kept" and "note" not in edited["segments"][2])

    # set: a scene and a transition
    current = edited["segments"][5]["scene"]
    other = next(name for name in names if f"{name}.rhai" != current)
    code, said = run("set", where, 5, "--scene", other, "--transition", 1.0, "--scenes-dir", scenes, "--bundle", bundle)
    show, _ = load(where)
    new = show["segments"][5]
    row(
        "set --scene dresses the scene it names",
        code == 0 and new["scene"] == f"{other}.rhai" and new["script"].endswith(f"-{other}.rhai") and f"called {other}".encode() in files()[new["script"]] and new["transition"] == 1.0,
        f"-> {new['script']}",
    )

    # edits the engine would not play, or that make no sense
    before = files()
    refusals = [
        ("a blend longer than the hold", ("set", where, 3, "--transition", 100)),
        ("the same with a new palette", ("set", where, 3, "--palette", palette, "--transition", 100, "--scenes-dir", scenes)),
        ("the first segment off 0", ("set", where, 0, "--start", 1.0)),
        ("a blend into the first segment", ("set", where, 0, "--transition", 1.0)),
        ("starts out of order", ("set", where, 3, "--start", show["segments"][5]["start"])),
        ("an unknown palette", ("set", where, 3, "--palette", "no-such-palette", "--scenes-dir", scenes)),
        ("an unknown scene", ("set", where, 3, "--scene", "no-such-scene", "--scenes-dir", scenes)),
        ("a segment that is not there", ("set", where, 99, "--speed", 1.0, "--scenes-dir", scenes)),
        ("removing the first segment", ("remove", where, 0)),
        ("splitting where a segment starts", ("split", where, show["segments"][3]["start"], "--scenes-dir", scenes)),
    ]
    results = [(what, *run(*arguments)) for what, arguments in refusals]
    allowed = [what for what, code, said in results if code == 0 or "refused: " not in said]
    row("edits that would break the show are refused, with a reason", not allowed, f"-> {len(results)} tried" + (f", allowed: {', '.join(allowed)}" if allowed else ""))
    row("a refused edit writes nothing", files() == before)

    # split
    segments = show["segments"]
    index = max((i for i in range(count - 1) if not segments[i].get("pinned")), key=lambda i: (segments[i + 1]["start"] - segments[i]["start"], -i))
    time = round((segments[index]["start"] + segments[index + 1]["start"]) / 2, 3)
    before = files()
    code, said = run("split", where, time, "--scenes-dir", scenes, "--bundle", bundle)
    after, (show, _) = files(), load(where)
    part = show["segments"][index + 1]
    expected_blend = round(min(SPLIT_BLEND_S, (segments[index + 1]["start"] - time) / 3), 3)
    row(
        "split cuts a segment in two and pins the new part",
        code == 0 and len(show["segments"]) == count + 1 and part["start"] == time and part.get("pinned") is True and part["transition"] == expected_blend
        and part["palette"] == segments[index]["palette"] and part["scene"] not in (segments[index]["scene"], segments[index + 1]["scene"]),
        f"-> segment {index} at {time} s, then {Path(part['scene']).stem} blending in over {part['transition']} s",
    )  # fmt: skip
    row("split leaves a show that plays, and the other copies alone", validate(show, where) == [] and untouched(before, after) and part["script"] not in before)

    # remove
    last = len(show["segments"]) - 1
    gone, before = show["segments"][last]["script"], files()
    code, said = run("remove", where, last)
    after, (show, _) = files(), load(where)
    row(
        "remove drops a segment and its copy, and the show still plays",
        code == 0 and len(show["segments"]) == last and gone not in after and validate(show, where) == [] and untouched(before, after, gone),
        f"-> {gone} gone",
    )

    # pin and unpin
    code_pin, _ = run("pin", where, 1, 3)
    code_unpin, _ = run("unpin", where, 3)
    show, _ = load(where)
    row("pin and unpin mark segments", code_pin == 0 and code_unpin == 0 and show["segments"][1].get("pinned") is True and "pinned" not in show["segments"][3])

    # reroll, with several seeds, each on its own copy of the show
    before = files()
    pinned = [s for s in show["segments"] if s.get("pinned")]
    rest = [(s["start"], s["scene"], s["palette"], s["colours"]) for s in show["segments"] if not s.get("pinned")]
    kept = plays = no_repeat = dressed_anew = True
    different = 0
    seeds = (1, 2, 3, 4)
    for seed in seeds:
        trial = root / f"reroll-{seed}"
        shutil.copytree(where, trial)
        code, said = run("reroll", trial, "--bundle", bundle, "--seed", seed, "--scenes-dir", scenes)
        rolled, _ = load(trial)
        now = files(trial)
        at = {s["start"]: s for s in rolled["segments"]}
        kept &= code == 0 and all(at.get(mine["start"]) == mine and now.get(mine["script"]) == before[mine["script"]] for mine in pinned)
        plays &= validate(rolled, trial) == [] and rolled["seed"] == seed and set(now) == {s["script"] for s in rolled["segments"]} | {SHOW_FILE}
        order = [s["scene"] for s in rolled["segments"]]
        no_repeat &= all(a != b for a, b in zip(order, order[1:]))
        dressed_anew &= all(moved_on in now[s["script"]] and s["script"] not in before for s in rolled["segments"] if not s.get("pinned"))
        different += [(s["start"], s["scene"], s["palette"], s["colours"]) for s in rolled["segments"] if not s.get("pinned")] != rest
    row("reroll keeps every pinned segment: its time, its scene and its copy byte for byte", kept, f"-> {len(pinned)} pinned, {len(seeds)} seeds")
    row("reroll replaces the rest", different > 0 and dressed_anew, f"-> different for {different} of {len(seeds)} seeds")
    row("a rerolled show plays, and records its seed", plays)
    row("reroll never leaves the same scene twice running", no_repeat)

    # reroll when a pinned segment starts a little after one of the director's own
    # cuts, so that the director's segment there is left with less time than it had.
    # No directory is needed for this: the edits are made and checked in memory.
    plain = copy.deepcopy(made)
    plain["segments"] = [dict(s, script=f"{i:03d}-x.rhai") for i, s in enumerate(plain["segments"])]
    late = next(i for i, s in enumerate(plain["segments"]) if s["transition"] > director.MIN_HOLD_S / 3 and i + 1 < len(plain["segments"]))
    start, blend = plain["segments"][late]["start"], plain["segments"][late]["transition"]
    squeezed = reroll(set_segment(plain, late, start=start + director.MIN_HOLD_S), package, 3, scenes_dir=scenes)
    at_cut = [s for s in squeezed["segments"] if s["start"] == start and not s.get("pinned")]
    row(
        "reroll shortens a blend that no longer fits before a pinned segment",
        len(at_cut) == 1 and 0 < at_cut[0]["transition"] <= director.MIN_HOLD_S / 3 + 1e-9 and validate(squeezed, None) == [],
        f"-> {blend} s became {at_cut[0]['transition'] if at_cut else '?'} s",
    )
    crowded = reroll(set_segment(plain, late, start=start + 1.0), package, 3, scenes_dir=scenes)
    row("reroll drops a segment that would only flash past before a pinned one", all(s["start"] != start for s in crowded["segments"]) and validate(crowded, None) == [])

    # the show the commands above made, rerolled in place, and checked
    code, said = run("reroll", where, "--bundle", bundle, "--seed", 5, "--scenes-dir", scenes)
    code_check, said = run("check", where)
    show, _ = load(where)
    row("check passes a show that plays", code == 0 and code_check == 0 and said.startswith("ok"))
    broken = root / "broken"
    shutil.copytree(where, broken)
    (broken / show["segments"][0]["script"]).unlink()
    code, said = run("check", broken)
    row("check names a scene copy that is missing", code != 0 and show["segments"][0]["script"] in said)
    did = [edit["command"] for edit in show.get("edits", [])]
    row("the show records what was done to it, and nothing that was refused", did == ["set", "set", "split", "remove", "pin", "unpin", "reroll"], f"-> {' '.join(did)}")
    return files()


def selftest() -> list[tuple[str, bool, str]]:
    """Every command on a made-up show. Returns (name, passed, detail) for the loop's self-test."""
    rows: list[tuple[str, bool, str]] = []

    def row(name: str, ok: object, detail: str = "") -> None:
        rows.append((f"show: {name}", bool(ok), detail))

    with tempfile.TemporaryDirectory() as tmp:
        first = _selftest_session(Path(tmp) / "one", row)
        second = _selftest_session(Path(tmp) / "two", lambda *_: None)
        same = first == second
        row("the same commands twice give the same files, show.json included", same and SHOW_FILE in first, f"-> {len(first)} files")
    return rows


if __name__ == "__main__":
    sys.exit(main())
