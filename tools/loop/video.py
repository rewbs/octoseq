#!/usr/bin/env python3
"""Track in, video out: one command from an audio file to an mp4.

    python3 tools/loop/video.py data/dontstop.mp3            # -> .loop/videos/dontstop-<seed>.mp4
    python3 tools/loop/video.py data/dontstop.mp3            # again: a different show
    python3 tools/loop/video.py data/dontstop.mp3 --seed 7   # the same show as seed 7 before
    python3 tools/loop/video.py song.xm --width 1280 --height 720
    python3 tools/loop/video.py data/super.mp3 --seed 7 --vivid   # the same show in stronger colours
    python3 tools/loop/video.py data/super.mp3 --scene scenes/pulse.rhai   # one scene, no director

This is milestone 1's command. What it does:

1. Builds the analysis bundle, once per track, with roles: the stand-in analysis for
   an audio file, or a perfect bundle for a tracker module.
2. Runs the director (director.py), which decides which scene plays when and in what
   colours. Each run makes a different show unless --seed names an earlier one. The
   show is kept in .loop/shows/, scenes and all.
3. Renders every frame with the engine (the GPU build if OCTOSEQ_ENGINE is set) and
   muxes the audio in.

Making a show is chance; rendering one is not. The same track, bundle and show give
the same frames every time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import director  # noqa: E402
import perfect_bundle  # noqa: E402
import roles  # noqa: E402
import run  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".loop" / "videos"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("track", type=Path, help="an audio file or a tracker module")
    parser.add_argument("-o", "--out", type=Path)
    parser.add_argument("--seed", type=int, help="repeat the show an earlier run made with this seed")
    parser.add_argument("--vivid", action="store_true", help="colours as written, not the paler ones the engine makes of them")
    parser.add_argument("--scene", type=Path, help="play this one scene throughout instead of directing a show")
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
    seconds = package["durationSec"] if args.seconds <= 0 else min(package["durationSec"], args.seconds)

    if args.scene:
        script = args.scene.expanduser().resolve()
        missing = director.scene_roles(script) - set(package.get("roles", {}))
        if missing:
            sys.exit(f"{script.name} needs roles this track's bundle does not have: {', '.join(sorted(missing))}")
        label = script.stem
        print(f"{track.name}: {seconds:.0f} s of {script.name}", flush=True)
    else:
        try:
            show = director.direct(package, args.seed, vivid=args.vivid)
        except ValueError as error:
            sys.exit(str(error))
        show["bundle_sha256"] = hashlib.sha256(package_path.read_bytes()).hexdigest()
        show["track"] = track.name
        label = f"{show['seed']}{'-vivid' if args.vivid else ''}"
        script = director.write(show, director.SHOWS / f"{track.stem}-{label}")
        print(f"{track.name}: {director.describe(show)}", flush=True)

    out = args.out.expanduser().resolve() if args.out else OUT / f"{track.stem}-{label}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = out.parent / f".{out.stem}-frames"
    print(f"rendering {seconds:.0f} s at {args.width}x{args.height}, {args.fps} fps", flush=True)
    ok, log = run.render_frames(package_path, script, frames, seconds, args)
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
