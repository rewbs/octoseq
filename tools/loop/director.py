#!/usr/bin/env python3
"""The rule-based director: a bundle in, a show out.

    python3 tools/loop/director.py data/dontstop.mp3            # a fresh show each time
    python3 tools/loop/director.py data/dontstop.mp3 --seed 7   # the same show again

A show says which scene plays when and how it is dressed. The rules:

- Change the look at section starts. Review 1 found one look boring in under ten
  seconds, so no look is held longer than MAX_HOLD_S: a longer section is changed
  again on the beat, in equal parts.
- A new section is a cut: the music changed at once, and so does the picture. A
  change inside a section is a blend over TRANSITION_BEATS beats: the music did
  not change, so the picture moves on without a jolt.
- Never the same scene twice running.
- A new palette at each section start. Cuts inside a section keep the palette and
  swap which colour plays which part, so a section holds together but does not
  repeat itself. (A new palette at every look was tried and did not make the
  picture measure as changing more.)
- A new place in the frame at every change of look, never the one before: every
  scene is built round one point, and a show of them all round the middle kept
  one layout however the scenes differed.
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
DIRECTOR_VERSION = "director-7"

MAX_HOLD_S = 9.0  # the longest any one look is held (review 1: boring in under ten seconds)
MIN_HOLD_S = 3.0  # section starts closer together than this are treated as one
CUT_BEATS = 4  # cuts inside a section land on a multiple of this many beats from its start
TRANSITION_BEATS = 4  # how long a change of look inside a section takes to blend in
TRANSITION_MAX_SHARE = 1 / 3  # of the time the new look is held, at most

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
# Where in the frame a look sits: its centre, as an offset from the middle (x to the
# right, y down, in frame widths and heights). Every scene was built round the
# middle, so a show of them kept one layout however the scenes differed. Each look
# now gets a place, never the one before it.
PLACES = [(0.0, 0.0), (-0.2, 0.0), (0.2, 0.0), (0.0, -0.14), (0.0, 0.14), (-0.17, -0.1), (0.17, 0.1), (-0.17, 0.1), (0.17, -0.1)]
# How misty each look is, from 0 (crisp) to 1 (misty): see `style.mist` in the
# scenes. The owner asked for a variety of it, "some scenes should be misty, others
# should be crisp". Only the two ends are used, and a look is never within MIST_STEP
# of the one before, so crisp and misty looks alternate. Values nearer the middle
# were tried first and left shows much of a muchness: a scene's own settings are
# already most of the way to misty.
MISTS = [0.0, 0.1, 0.9, 1.0]
MIST_STEP = 0.4
# How a look answers a blow with the whole frame: see `post.answer` in the engine
# (1 punch, 2 flash, 3 jolt, 4 split, 5 burst, 6 ghost, which arrive at once and
# ease back; 7 notch, 8 swing, 9 slide, which turn or move the picture and leave
# it there until the next blow). Review 3 found the shows
# "nowhere close to being sufficiently responsive", and that when several things
# answered several parts of the band no link between sound and picture could be
# made out. So every look answers every blow in one plain way, and a different way
# from the look before.
ANSWERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
# The two families: those that ease back and those that stay. A look takes its
# answer from the family the look before did not, so a cut changes the kind of
# answer as well as the answer. (Measured on ten scenes, the ones that stay answer
# every blow with almost nothing taken back; the ones that ease back answer nine
# in ten or more, with a fifth to a third taken back two frames later.)
STAYING = {7, 8, 9}
# A finish is one more thing laid over a whole look, last of all, that changes what
# the picture is made of and not what it shows: see `post.finish` in the engine.
# Review 3 asked for "film-grain, dithering, low-fi, type things" and "even some
# ascii-art type filters". About one look in three gets one, and never the same
# one twice running: a show that is all finish has no plain picture to set it off.
FINISHES = {"grain": 1, "dither": 2, "two-tone": 3, "ascii": 4, "tape": 5, "dots": 6}
FINISH_SHARE = 1 / 3
STYLE_LINE = re.compile(r"^let style = .*// @style\s*$", re.MULTILINE)

# A brief is what whoever asks for a show may say about it, as plain data; every
# part can be left out. It is the door a prompt will come in by: something that
# turns a person's words into a brief needs to know nothing else about the
# director, and `contract.py catalogue` tells it what each scene is. A brief that
# is wrong is refused with a message that says what would have been right, so
# whatever wrote it can correct itself.
BRIEF_PARTS = {
    "scenes": "use only these scenes (a list of names, as in the catalogue)",
    "avoid": "never use these scenes (a list of names)",
    "palettes": f"use only these palettes (a list, from {', '.join(sorted(PALETTES))})",
    "mist": "crisp, misty or both: which kind of look to use (both if left out)",
    "finishes": f"use only these finishes (a list, from {', '.join(FINISHES)}; an empty list for none)",
    "hold": "the longest one look is held, in seconds",
    "vivid": "true for colours as written, false for the paler default",
    "seed": "a whole number: the same brief and seed on the same track give the same show",
}
MIST_KINDS = {"crisp": [m for m in MISTS if m < 0.5], "misty": [m for m in MISTS if m >= 0.5], "both": MISTS}
LONGEST_HOLD_S = 120.0


def read_brief(brief: dict | None, scenes_dir: Path = SCENES) -> dict:
    """Check a brief. Returns it; raises ValueError saying what is wrong and what would be right."""
    if brief is None:
        return {}
    if not isinstance(brief, dict):
        raise ValueError("a brief is a set of named parts: " + "; ".join(f"{k}: {v}" for k, v in BRIEF_PARTS.items()))
    unknown = sorted(set(brief) - set(BRIEF_PARTS))
    if unknown:
        raise ValueError(f"a brief has no part called {', '.join(unknown)}. Its parts are: " + "; ".join(f"{k}: {v}" for k, v in BRIEF_PARTS.items()))
    known = sorted(s.stem for s in scenes_dir.glob("*.rhai") if STYLE_LINE.search(s.read_text()))
    for part in ("scenes", "avoid"):
        if part in brief:
            names = brief[part]
            if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
                raise ValueError(f"a brief's {part} is a list of scene names, such as {known[:3]}")
            missing = sorted(set(names) - set(known))
            if missing:
                raise ValueError(f"no scene is called {', '.join(missing)}. The scenes are: {', '.join(known)}")
    if "palettes" in brief:
        names = brief["palettes"]
        if not isinstance(names, list) or not names or not all(isinstance(n, str) for n in names) or set(names) - set(PALETTES):
            raise ValueError(f"a brief's palettes is a list of one or more of: {', '.join(sorted(PALETTES))}")
    if "mist" in brief and brief["mist"] not in MIST_KINDS:
        raise ValueError(f"a brief's mist is one of: {', '.join(MIST_KINDS)}")
    if "finishes" in brief:
        names = brief["finishes"]
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names) or set(names) - set(FINISHES):
            raise ValueError(f"a brief's finishes is a list of any of: {', '.join(FINISHES)} (an empty list for none)")
    if "hold" in brief:
        hold = brief["hold"]
        if isinstance(hold, bool) or not isinstance(hold, (int, float)) or not MIN_HOLD_S <= hold <= LONGEST_HOLD_S:
            raise ValueError(f"a brief's hold is a number of seconds from {MIN_HOLD_S:g} to {LONGEST_HOLD_S:g}")
    if "vivid" in brief and not isinstance(brief["vivid"], bool):
        raise ValueError("a brief's vivid is true or false")
    if "seed" in brief and (isinstance(brief["seed"], bool) or not isinstance(brief["seed"], int) or brief["seed"] < 0):
        raise ValueError("a brief's seed is a whole number, 0 or more")
    return dict(brief)


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


def cut_points(package: dict, max_hold: float = MAX_HOLD_S) -> list[tuple[float, bool]]:
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
        while end - previous > max_hold:
            # Aim for equal parts, but never past the limit: on a strong beat if one
            # is in reach, else on any beat, else wherever the limit falls.
            remaining = end - previous
            wanted = previous + remaining / int(-(-remaining // max_hold))
            reach = lambda b: previous + MIN_HOLD_S <= b <= previous + max_hold and end - b >= MIN_HOLD_S  # noqa: E731
            choices = [b for b in strong if reach(b)] or [b for b in inside if reach(b)]
            cut = min(choices, key=lambda b: abs(b - wanted)) if choices else min(wanted, previous + max_hold)
            cuts.append((float(cut), False))
            previous = cut
    return cuts


def direct(package: dict, seed: int | None = None, scenes_dir: Path = SCENES, vivid: bool = False, max_hold: float = MAX_HOLD_S, brief: dict | None = None) -> dict:
    """Make a show for a bundle. Returns the show as plain data (see `write`).

    `brief` narrows what the director may do (see BRIEF_PARTS); where it names
    a seed, vividness or hold, it is the brief's that count. A show made from a
    brief carries it, so the show says what was asked for.
    """
    asked = read_brief(brief, scenes_dir)
    seed, vivid, max_hold = asked.get("seed", seed), asked.get("vivid", vivid), float(asked.get("hold", max_hold))
    scenes = usable_scenes(package, scenes_dir)
    if not scenes:
        raise ValueError("no scene can run on this bundle: none has all its roles")
    playable = [s.stem for s in scenes]
    if "scenes" in asked:
        scenes = [s for s in scenes if s.stem in asked["scenes"]]
    scenes = [s for s in scenes if s.stem not in asked.get("avoid", [])]
    if not scenes:
        raise ValueError(f"the brief leaves no scene that can run on this track. Those that can are: {', '.join(playable)}")
    palettes = [p for p in PALETTES if p in asked.get("palettes", PALETTES)]
    mists = MIST_KINDS[asked.get("mist", "both")]
    seed = secrets.randbelow(2**31) if seed is None else int(seed)
    rng = random.Random(seed)
    # Mist is drawn from a stream of its own, so that adding it left every show's
    # scenes, colours and places as they were.
    weather = random.Random(f"{seed}:mist")
    # And so is the answer, for the same reason.
    blows = random.Random(f"{seed}:answer")
    # And the finish.
    surface = random.Random(f"{seed}:finish")
    finishes = [FINISHES[name] for name in FINISHES if name in asked.get("finishes", FINISHES)]
    last_finish = None
    intensity, rate = _signal(package, "section_intensity")
    cuts = cut_points(package, max_hold)
    beats = [e["time"] for e in _stream(package, "beat")]
    beat_s = sorted(b - a for a, b in zip(beats, beats[1:]))[len(beats) // 2 - 1] if len(beats) > 2 else 0.5
    segments = []
    scene, palette, order, place, mist, answer = None, None, [0, 1, 2], None, None, None
    for index, (start, new_section) in enumerate(cuts):
        scene = rng.choice([s for s in scenes if s != scene] or scenes)
        if new_section or palette is None:
            palette = rng.choice([p for p in palettes if p != palette] or palettes)
            order = rng.sample([0, 1, 2], 3)
        else:
            order = order[1:] + order[:1]
        place = rng.choice([p for p in PLACES if p != place])
        mist = weather.choice([m for m in mists if mist is None or abs(m - mist) >= MIST_STEP - 1e-9] or mists)
        answer = blows.choice([a for a in ANSWERS if answer is None or (a in STAYING) != (answer in STAYING)])
        finish = 0
        if finishes and surface.random() < FINISH_SHARE:
            finish = last_finish = surface.choice([f for f in finishes if f != last_finish] or finishes)
        end = cuts[index + 1][0] if index + 1 < len(cuts) else float(package["durationSec"])
        middle = intensity[min(int((start + end) / 2 * rate), len(intensity) - 1)] if intensity else 0.5
        colours = [tuple(c**SCREEN_GAMMA if vivid else c for c in PALETTES[palette][i]) for i in order]
        segments.append(dict(
            start=round(start, 3), scene=scene.name, new_section=new_section, palette=palette,
            colours=[[round(c, 4) for c in colour] for colour in colours],
            speed=round(0.75 + 0.6 * float(middle), 2),
            at=list(place),
            mist=mist,
            answer=answer,
            kick=round(0.85 + 0.4 * float(middle), 2),
            finish=finish,
            transition=0.0 if new_section else round(min(TRANSITION_BEATS * beat_s, (end - start) * TRANSITION_MAX_SHARE), 3),
        ))  # fmt: skip
    show = dict(director=DIRECTOR_VERSION, seed=seed, vivid=vivid, duration=float(package["durationSec"]), segments=segments)
    if asked:
        show["brief"] = asked
    return show


def dressed(source: str, segment: dict) -> str:
    """A scene's source with its style line replaced by this segment's style."""
    a, b, c = segment["colours"]
    at = [float(v) for v in segment.get("at", (0.0, 0.0))]
    mist = float(segment.get("mist", 0.5))
    answer, kick, finish = int(segment.get("answer", 1)), float(segment.get("kick", 1.0)), int(segment.get("finish", 0))
    line = f"let style = #{{ a: {list(a)}, b: {list(b)}, c: {list(c)}, speed: {segment['speed']}, at: {at}, mist: {mist}, answer: {answer}, kick: {kick}, finish: {finish} }}; // @style"
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
        lines.append(f"  {s['start']:7.2f}  {Path(s['scene']).stem:10} {s['palette']:6} speed {s['speed']:.2f}{'  (new section, cut)' if s['new_section'] else f'  (blend over {s["transition"]:.1f} s)'}")
    return "\n".join(lines)


def main() -> int:
    import perfect_bundle
    import worker
    import run

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("track", type=Path, help="an audio file or a tracker module")
    parser.add_argument("--seed", type=int, help="repeat an earlier show instead of making a new one")
    parser.add_argument("--vivid", action="store_true", help="colours as written, not the paler ones the engine makes of them")
    parser.add_argument("--brief", type=Path, metavar="JSON", help="a brief: which scenes, palettes and kind of look to use (see BRIEF_PARTS)")
    parser.add_argument("-o", "--out", type=Path, help="show directory (default .loop/shows/<track>-<seed>)")
    args = parser.parse_args()
    track = args.track.expanduser().resolve()
    if track.suffix.lower() in run.MODULE_SUFFIXES:
        package_path = perfect_bundle.build(track) / "package.json"
    else:
        package_path = worker.bundle(track)
    try:
        show = direct(json.loads(package_path.read_text()), args.seed, vivid=args.vivid, brief=json.loads(args.brief.read_text()) if args.brief else None)
    except ValueError as error:
        sys.exit(str(error))
    show["bundle_sha256"] = hashlib.sha256(package_path.read_bytes()).hexdigest()
    path = write(show, args.out or SHOWS / f"{track.stem}-{show['seed']}{'-vivid' if args.vivid else ''}")
    print(describe(show))
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
