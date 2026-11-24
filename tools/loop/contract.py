#!/usr/bin/env python3
"""The contract every scene in scenes/ keeps, checked.

A show is put together from scenes by something that has never seen them: the
director today, a prompt later. That only works while every scene keeps the same
few promises, so they are written down here and checked:

- It asks for musical roles (`//! roles: ...`), reads only roles it asked for,
  and never reads `inputs` directly, so it runs on any track's bundle.
- It carries the style line the director rewrites (three colours, a speed, a
  place in the frame and how misty it is), and uses each part: the colours, the
  place (in its camera and in its loop's centre) and the mist (through `misted`).
- It says in words what it is: a title, a description and what each role does.
  `catalogue` prints those, which is what a prompt would be given to choose from.
- Rendered as it stands, at its crispest and at its mistiest, it passes every
  hard gate: not black, not blown out, not frozen, not strobing.

    python3 tools/loop/contract.py                    # every scene, written parts only
    python3 tools/loop/contract.py --render           # and render them (slow)
    python3 tools/loop/contract.py --render scenes/a.rhai scenes/b.rhai
    python3 tools/loop/contract.py catalogue          # the scenes in words, as JSON

The rendered half goes through run.py, so its clips, sheets and figures are in
.loop/runs/<name> and .loop/runs/<name>-mist like any other run's.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCENES = ROOT / "scenes"
TRACKS = ["data/dontstop.mp3", "tools/loop/fixtures/modules/synth-0101.mod"]
STYLE_LINE = re.compile(r"^let style = #\{(.*)\}; // @style$", re.M)
STYLE_KEYS = ("a", "b", "c", "speed", "at", "mist", "answer", "kick")
MISTS = {"crisp": 0.0, "misty": 1.0}
ROLE_LINE = re.compile(r"^//!\s*roles:\s*(.+)$", re.M)
ROLE_NOTE = re.compile(r"^//   (\w+(?:, \w+)*)\s{2,}(.+)$", re.M)  # "//   kick, snare   what they do"
FIGURES = ("answered", "answered_rolls", "jump_size", "dead_time", "punch", "look_change", "flow_swirl", "active_area", "black_fraction")


def declared(text: str) -> list[str]:
    return [r.strip() for line in ROLE_LINE.findall(text) for r in line.split(",") if r.strip()]


def words(scene: Path) -> dict:
    """What the scene says about itself: its title, description and role notes."""
    text = scene.read_text()
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith("// ") and not line.startswith("//!")), None)
    title, about = "", []
    if start is not None:
        title = lines[start][3:].strip()
        for line in lines[start + 1 :]:
            if not line.startswith("//") or ROLE_NOTE.match(line) or line.strip() == "//":
                break
            about.append(line[3:].strip())
    notes = {role: note.strip() for names, note in ROLE_NOTE.findall(text) for role in names.split(", ")}
    return dict(name=scene.stem, title=title, about=" ".join(about), roles=notes, asks=declared(text))


def written(scene: Path) -> list[str]:
    """The promises that can be checked by reading the scene. Returns what it breaks."""
    text = scene.read_text()
    code = "\n".join(line.split("//")[0] for line in text.splitlines())
    said = words(scene)
    broken = []
    asks = set(said["asks"])
    if not asks:
        broken.append("asks for no roles (`//! roles: ...`)")
    reads = set(re.findall(r"\broles\.(\w+)", code))
    if reads - asks:
        broken.append(f"reads roles it did not ask for: {', '.join(sorted(reads - asks))}")
    if asks - reads:
        broken.append(f"asks for roles it never reads: {', '.join(sorted(asks - reads))}")
    if re.search(r"\binputs\.", code):
        broken.append("reads `inputs` directly; a scene reads roles")
    style = STYLE_LINE.search(text)
    if not style:
        broken.append("has no style line (`let style = #{ ... }; // @style`)")
    else:
        missing = [k for k in STYLE_KEYS if not re.search(rf"\b{k}:", style.group(1))]
        if missing:
            broken.append(f"its style line lacks: {', '.join(missing)}")
        if not re.search(r"mist: 0\.5\b", style.group(1)):
            broken.append("its style line's mist is not 0.5, which is where a scene's settings are its own")
    for part, pattern in (("a", r"style\.a\b"), ("b", r"style\.b\b"), ("c", r"style\.c\b"), ("speed", r"style\.speed\b"), ("at", r"style\.at\b"), ("mist", r"style\.mist\b")):
        if not re.search(pattern, code):
            broken.append(f"never uses style.{part}")
    if "fn misted(" not in code:
        broken.append("has no `misted` function")
    if not re.search(r"post\.answer\(style\.answer, style\.kick, \w+, style\.at\);", code):
        broken.append("does not answer a blow with the whole frame (`post.answer(style.answer, style.kick, hit, style.at);`)")
    # A scene whose eye circles it can only be placed up and down, so either part
    # of style.at will do.
    if "feedback.builder()" in code and not re.search(r"\.centre\([^)]*style\.at\[", code):
        broken.append("its loop is not centred on style.at")
    if "camera.position" not in code:
        broken.append("does not place its camera (style.at moves the eye)")
    if not said["title"] or not said["about"]:
        broken.append("does not say what it is (a title line and a description in comments)")
    unsaid = asks - set(said["roles"])
    if unsaid:
        broken.append(f"does not say what these roles do: {', '.join(sorted(unsaid))}")
    return broken


def variants(scenes: list[Path], out: Path) -> list[Path]:
    """Each scene at its crispest and its mistiest, as the director would dress it."""
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.rhai"):
        old.unlink()
    made = []
    for scene in scenes:
        text = scene.read_text()
        for label, mist in MISTS.items():
            path = out / f"{scene.stem}@{label}.rhai"
            path.write_text(re.sub(r"mist: 0\.5\b", f"mist: {mist}", text, count=1))
            made.append(path)
    return made


def rendered(name: str, tracks: list[str], scenes: list[Path]) -> list[dict]:
    cmd = [sys.executable, str(ROOT / "tools/loop/run.py"), "--tracks", *tracks, "--scenes", *[str(s) for s in scenes], "--name", name, "--no-checks", "--no-build"]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    report = ROOT / ".loop/runs" / name / "report.json"
    if not report.exists():
        sys.exit(f"run.py wrote no report:\n{(result.stdout + result.stderr)[-3000:]}")
    return json.loads(report.read_text())


def overviews(run: Path, results: list[dict], track: str) -> None:
    """Six frames of each clip, ten clips to a picture: what the batch looks like at a glance."""
    clips = [ROOT / r["clip"] for r in results if r.get("clip") and Path(r["track"]).stem == track and (ROOT / r["clip"]).exists()]
    for page in range(0, len(clips), 10):
        part = clips[page : page + 10]
        inputs = [arg for clip in part for arg in ("-i", str(clip))]
        chains = "".join(f"[{i}:v]select='not(mod(n\\,150))',scale=320:180,tile=6x1[v{i}];" for i in range(len(part)))
        stack = "".join(f"[v{i}]" for i in range(len(part))) + (f"vstack=inputs={len(part)}[out]" if len(part) > 1 else "null[out]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", chains + stack, "-map", "[out]", "-frames:v", "1", str(run / f"overview-{track}-{page // 10}.png")], check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scenes", nargs="*", help="scenes to check, or `catalogue`; default every scene in scenes/")
    parser.add_argument("--render", action="store_true", help="also render each scene and hold it to the hard gates")
    parser.add_argument("--mist-only", action="store_true", help="with --render: only the crisp and misty renders (the render loop already holds every scene to the gates as it stands)")
    parser.add_argument("--tracks", nargs="+", default=TRACKS)
    parser.add_argument("--name", default="contract")
    args = parser.parse_args()

    catalogue = args.scenes == ["catalogue"]
    scenes = sorted(SCENES.glob("*.rhai")) if catalogue or not args.scenes else [Path(s) if Path(s).is_absolute() else ROOT / s for s in args.scenes]
    if catalogue:
        print(json.dumps([words(s) for s in scenes], indent=2))
        return 0

    failed = False
    for scene in scenes:
        for fault in written(scene):
            failed = True
            print(f"FAIL  {scene.stem}: {fault}")
    if not failed:
        print(f"ok    {len(scenes)} scene{'s' if len(scenes) != 1 else ''} keep the written half of the contract")
    if not args.render:
        return 1 if failed else 0

    own = [] if args.mist_only else rendered(args.name, args.tracks, scenes)
    dressed = rendered(f"{args.name}-mist", args.tracks[:1], variants(scenes, ROOT / ".loop/tmp/contract" / args.name))
    print(f"\n{'clip':<34}" + "".join(f"{f.split('_')[0][:7]:>8}" for f in FIGURES))
    for r in own + dressed:
        m = r.get("metrics") or {}
        row = "".join(f"{m[f]:8.2f}" if isinstance(m.get(f), (int, float)) else f"{'-':>8}" for f in FIGURES)
        print(f"{r['id']:<34}{row}")
        problems = list(r.get("hard") or [])
        if r.get("status") not in ("pass", "warn") and not problems:
            problems = [str(r.get("error") or r.get("log") or r.get("status"))[-400:]]
        for problem in problems:
            failed = True
            print(f"FAIL  {r['id']}: {problem}")
    for track in args.tracks if own else []:
        overviews(ROOT / ".loop/runs" / args.name, own, Path(track).stem)
    overviews(ROOT / ".loop/runs" / f"{args.name}-mist", dressed, Path(args.tracks[0]).stem)
    print("\nall scenes keep the contract" if not failed else "\nthe contract is broken")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
