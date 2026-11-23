#!/usr/bin/env python3
"""The rule-based director: a bundle in, a show out.

    python3 tools/loop/director.py data/dontstop.mp3            # a fresh show each time
    python3 tools/loop/director.py data/dontstop.mp3 --seed 7   # the same show again

A show says which scene plays when and how it is dressed. The rules:

- Cut at section starts. Review 1 found one look boring in under ten seconds, so no
  look is held longer than MAX_HOLD_S: a longer section is cut again on the beat,
  in equal parts.
- Never the same scene twice running.
- A new palette at each section start. Cuts inside a section keep the palette and
  swap which colour plays which part, so a section holds together but does not
  repeat itself.
- Louder sections run faster.

Everything else is chance. Each run draws a fresh seed, so running the director
again is how you re-roll; the seed is written into the show, and the same seed on
the same bundle gives the same show.

A show is a directory: `show.json`, plus a copy of each scene as it was when the show
was made, with its style line filled in. The renderer reads only those copies, so a
show keeps rendering the same frames after the scenes it came from have changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parents[2]
SCENES = ROOT / "scenes"
SHOWS = ROOT / ".loop" / "shows"
DIRECTOR_VERSION = "director-1"

MAX_HOLD_S = 9.0  # the longest any one look is held (review 1: boring in under ten seconds)
MIN_HOLD_S = 3.0  # section starts closer together than this are treated as one
CUT_BEATS = 4  # cuts inside a section land on a multiple of this many beats from its start

# Three colours each, for the three parts every scene has (see the style line in
# scenes/*.rhai). Each palette spreads its colours round the colour wheel, so that no
# one hue takes the frame over (review 1: nearly all one colour was rated ugly).
PALETTES = {
    "ember": [(1.0, 0.32, 0.1), (0.1, 0.75, 1.0), (0.62, 0.3, 1.0)],
    "acid": [(0.55, 1.0, 0.1), (1.0, 0.15, 0.7), (0.1, 0.9, 0.9)],
    "ice": [(1.0, 0.93, 0.82), (0.2, 0.4, 1.0), (1.0, 0.25, 0.5)],
    "dusk": [(1.0, 0.25, 0.2), (0.1, 0.8, 0.6), (0.4, 0.25, 1.0)],
    "neon": [(0.1, 1.0, 0.5), (0.3, 0.4, 1.0), (1.0, 0.9, 0.2)],
}
# The engine works in linear light, so a palette colour comes out paler on screen
# than its numbers read: a channel set to 0.1 shows at about 0.35. A vivid show
# converts the colours first, so they show as written. Review 2 was shown the same
# show both ways and chose the paler default; vivid is also darker overall, and on
# one test track dark enough to fail the mostly-black gate.
SCREEN_GAMMA = 2.2
STYLE_LINE = re.compile(r"^let style = .*// @style\s*$", re.MULTILINE)


def scene_roles(scene: Path) -> set[str]:
    """The roles a scene declares in its `//! roles:` lines."""
    declared: set[str] = set()
    for line in scene.read_text().splitlines():
        line = line.strip()
        if line.startswith("//!") and line[3:].strip().startswith("roles:"):
            declared |= {name.strip() for name in line[3:].strip()[len("roles:") :].split(",") if name.strip()}
    return declared


def usable_scenes(package: dict, scenes_dir: Path = SCENES) -> list[Path]:
    """Scenes that have a style line and whose roles the bundle provides."""
    available = set(package.get("roles", {}))
    return [s for s in sorted(scenes_dir.glob("*.rhai")) if scene_roles(s) <= available and STYLE_LINE.search(s.read_text())]


def _stream(package: dict, role: str) -> list[dict]:
    binding = package.get("roles", {}).get(role, {})
    name = binding.get("events")
    return next((s["events"] for s in package.get("eventStreams", []) if s["name"] == name), []) if name else []


def _signal(package: dict, role: str) -> tuple[list[float], float]:
    binding = package.get("roles", {}).get(role, {})
    for signal in package.get("customSignals", []):
        if signal["name"] == binding.get("custom"):
            return signal["values"], signal["rate"]
    return [], 1.0


def cut_points(package: dict) -> list[tuple[float, bool]]:
    """When the look changes: (time, whether a new section starts there)."""
    duration = float(package["durationSec"])
    sections = [0.0]
    for event in _stream(package, "section"):
        if event["time"] - sections[-1] >= MIN_HOLD_S and duration - event["time"] >= MIN_HOLD_S:
            sections.append(float(event["time"]))
    beats = [e["time"] for e in _stream(package, "beat")]
    cuts: list[tuple[float, bool]] = []
    for start, end in zip(sections, sections[1:] + [duration]):
        cuts.append((start, True))
        inside = [b for b in beats if start < b < end]
        strong = inside[CUT_BEATS - 1 :: CUT_BEATS]  # multiples of CUT_BEATS from the section's start
        previous = start
        while end - previous > MAX_HOLD_S:
            # Aim for equal parts, but never past the limit: on a strong beat if one
            # is in reach, else on any beat, else wherever the limit falls.
            remaining = end - previous
            wanted = previous + remaining / int(-(-remaining // MAX_HOLD_S))
            reach = lambda b: previous + MIN_HOLD_S <= b <= previous + MAX_HOLD_S and end - b >= MIN_HOLD_S  # noqa: E731
            choices = [b for b in strong if reach(b)] or [b for b in inside if reach(b)]
            cut = min(choices, key=lambda b: abs(b - wanted)) if choices else min(wanted, previous + MAX_HOLD_S)
            cuts.append((float(cut), False))
            previous = cut
    return cuts


def direct(package: dict, seed: int | None = None, scenes_dir: Path = SCENES, vivid: bool = False) -> dict:
    """Make a show for a bundle. Returns the show as plain data (see `write`)."""
    scenes = usable_scenes(package, scenes_dir)
    if not scenes:
        raise ValueError("no scene can run on this bundle: none has all its roles")
    seed = secrets.randbelow(2**31) if seed is None else int(seed)
    rng = random.Random(seed)
    intensity, rate = _signal(package, "section_intensity")
    cuts = cut_points(package)
    segments = []
    scene, palette, order = None, None, [0, 1, 2]
    for index, (start, new_section) in enumerate(cuts):
        scene = rng.choice([s for s in scenes if s != scene] or scenes)
        if new_section or palette is None:
            palette = rng.choice([p for p in PALETTES if p != palette])
            order = rng.sample([0, 1, 2], 3)
        else:
            order = order[1:] + order[:1]
        end = cuts[index + 1][0] if index + 1 < len(cuts) else float(package["durationSec"])
        middle = intensity[min(int((start + end) / 2 * rate), len(intensity) - 1)] if intensity else 0.5
        colours = [tuple(c**SCREEN_GAMMA if vivid else c for c in PALETTES[palette][i]) for i in order]
        segments.append(dict(
            start=round(start, 3), scene=scene.name, new_section=new_section, palette=palette,
            colours=[[round(c, 4) for c in colour] for colour in colours],
            speed=round(0.75 + 0.6 * float(middle), 2),
        ))  # fmt: skip
    return dict(director=DIRECTOR_VERSION, seed=seed, vivid=vivid, duration=float(package["durationSec"]), segments=segments)


def dressed(source: str, segment: dict) -> str:
    """A scene's source with its style line replaced by this segment's style."""
    a, b, c = segment["colours"]
    line = f"let style = #{{ a: {list(a)}, b: {list(b)}, c: {list(c)}, speed: {segment['speed']} }}; // @style"
    return STYLE_LINE.sub(lambda _: line, source, count=1)


def write(show: dict, out_dir: Path, scenes_dir: Path = SCENES) -> Path:
    """Write a show directory: show.json and the scene copies it pins. Returns show.json."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.rhai"):
        old.unlink()
    segments = []
    for index, segment in enumerate(show["segments"]):
        name = f"{index:03d}-{Path(segment['scene']).stem}.rhai"
        (out_dir / name).write_text(dressed((scenes_dir / segment["scene"]).read_text(), segment))
        segments.append(dict(segment, script=name))
    path = out_dir / "show.json"
    path.write_text(json.dumps(dict(show, segments=segments), indent=1) + "\n")
    return path


def describe(show: dict) -> str:
    lines = [f"seed {show['seed']}: {len(show['segments'])} looks over {show['duration']:.0f} s"]
    for s in show["segments"]:
        lines.append(f"  {s['start']:7.2f}  {Path(s['scene']).stem:10} {s['palette']:6} speed {s['speed']:.2f}{'  (new section)' if s['new_section'] else ''}")
    return "\n".join(lines)


def main() -> int:
    import perfect_bundle
    import roles
    import run

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("track", type=Path, help="an audio file or a tracker module")
    parser.add_argument("--seed", type=int, help="repeat an earlier show instead of making a new one")
    parser.add_argument("--vivid", action="store_true", help="colours as written, not the paler ones the engine makes of them")
    parser.add_argument("-o", "--out", type=Path, help="show directory (default .loop/shows/<track>-<seed>)")
    args = parser.parse_args()
    track = args.track.expanduser().resolve()
    if track.suffix.lower() in run.MODULE_SUFFIXES:
        package_path = perfect_bundle.build(track) / "package.json"
    else:
        package_path = roles.standin_bundle_cached(track, run.LOOP_DIR / "cache")
    show = direct(json.loads(package_path.read_text()), args.seed, vivid=args.vivid)
    show["bundle_sha256"] = hashlib.sha256(package_path.read_bytes()).hexdigest()
    path = write(show, args.out or SHOWS / f"{track.stem}-{show['seed']}{'-vivid' if args.vivid else ''}")
    print(describe(show))
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
