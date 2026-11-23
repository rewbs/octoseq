#!/usr/bin/env python3
"""Track in, video out: one command from an audio file to an mp4.

    python3 tools/loop/video.py data/dontstop.mp3                 # -> .loop/videos/dontstop.mp4
    python3 tools/loop/video.py song.xm --scene scenes/vortex.rhai --width 1280 --height 720
    python3 tools/loop/video.py data/super.mp3 -o ~/out.mp4 --seconds 30

This is milestone 1's command in its first, smallest form. What it does today:

1. Builds the analysis bundle, once per track, with roles: the stand-in analysis for
   an audio file, or a perfect bundle for a tracker module.
2. Chooses the scene. There is no director yet, so that is the scene named with
   --scene, or the first in scenes/ that the bundle has the roles for; one scene
   plays for the whole track.
3. Renders every frame with the engine (the GPU build if OCTOSEQ_ENGINE is set) and
   muxes the audio in.

The result is deterministic: the same track, bundle and scene give the same frames.
What is still to come is in docs/loop/README.md (chunk 4): more scenes, a director
that changes scene at section boundaries, and blended transitions.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import perfect_bundle  # noqa: E402
import roles  # noqa: E402
import run  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".loop" / "videos"


def scene_roles(scene: Path) -> set[str]:
    """The roles a scene declares in its `//! roles:` lines."""
    declared: set[str] = set()
    for line in scene.read_text().splitlines():
        line = line.strip()
        if line.startswith("//!") and line[3:].strip().startswith("roles:"):
            declared |= {name.strip() for name in line[3:].strip()[len("roles:") :].split(",") if name.strip()}
    return declared


def choose_scene(package: dict, wanted: Path | None) -> Path:
    """The scene to play: the one asked for, or the first whose roles the bundle provides."""
    available = set(package.get("roles", {}))
    if wanted:
        missing = scene_roles(wanted) - available
        if missing:
            sys.exit(f"{wanted.name} needs roles this track's bundle does not have: {', '.join(sorted(missing))}")
        return wanted
    for scene in sorted((ROOT / "scenes").glob("*.rhai")):
        if scene_roles(scene) <= available:
            return scene
    sys.exit("no scene in scenes/ can run on this track's bundle")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("track", type=Path, help="an audio file or a tracker module")
    parser.add_argument("-o", "--out", type=Path)
    parser.add_argument("--scene", type=Path)
    parser.add_argument("--seconds", type=float, default=0.0, help="stop after this long; 0 = the whole track")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--no-build", action="store_true", help="skip cargo build")
    args = parser.parse_args()

    track = args.track.expanduser().resolve()
    if not track.exists():
        sys.exit(f"{track} does not exist")
    if not args.no_build:
        run.build_engine()

    started = time.time()
    if track.suffix.lower() in run.MODULE_SUFFIXES:
        bundle = perfect_bundle.build(track)
        package_path, audio = bundle / "package.json", bundle / perfect_bundle.AUDIO
    else:
        package_path, audio = roles.standin_bundle_cached(track, run.LOOP_DIR / "cache"), track
    package = json.loads(package_path.read_text())
    scene = choose_scene(package, args.scene.expanduser().resolve() if args.scene else None)
    seconds = package["durationSec"] if args.seconds <= 0 else min(package["durationSec"], args.seconds)

    out = (args.out.expanduser().resolve() if args.out else OUT / f"{track.stem}.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = out.parent / f".{out.stem}-frames"
    print(f"{track.name}: {seconds:.0f} s with {scene.name} at {args.width}x{args.height}, {args.fps} fps", flush=True)
    ok, log = run.render_frames(package_path, scene, frames, seconds, args)
    if not ok:
        shutil.rmtree(frames, ignore_errors=True)
        sys.exit(f"render failed: {log.strip().splitlines()[-1] if log.strip() else 'no output'}")
    run.encode_clip(frames, audio, out, seconds, args.fps)
    shutil.rmtree(frames, ignore_errors=True)
    subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "default=nw=1", str(out)], check=False)
    print(f"{out}  ({time.time() - started:.0f} s to make)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
