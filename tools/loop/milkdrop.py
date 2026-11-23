#!/usr/bin/env python3
"""The Milkdrop reference: what projectM does with our test tracks, in the loop's own figures.

    tools/loop/projectm/build.sh                       # once: builds projectM and pm_render
    python3 tools/loop/milkdrop.py render              # render the reference presets on the test tracks
    python3 tools/loop/milkdrop.py compare [RUN]       # a loop run (default: the newest) beside the reference

Milkdrop is what the redesign is aiming at for dynamism, variety and pace. This
renders a fixed set of its presets (tools/loop/milkdrop_presets.txt, paths inside a
preset collection) on the loop's tracks, one preset per clip, and measures each clip
exactly as the loop measures ours. The spread of each figure over those clips is
kept in tools/loop/milkdrop_reference.json, so `compare` and the loop's report can
say where our output sits against it on a machine with no projectM.

The presets and projectM are not part of this repository. Set MILKDROP_PRESETS to
the collection's folder (default ~/code/presets-cream-of-the-crop, then the same
under /mnt/c/Users/*/code).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import metrics  # noqa: E402
import motion  # noqa: E402
import perfect_bundle  # noqa: E402
import roles  # noqa: E402
import run  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PM_RENDER = ROOT / ".loop" / "projectm" / "pm_render"
OUT = ROOT / ".loop" / "milkdrop"
PRESET_LIST = Path(__file__).parent / "milkdrop_presets.txt"
REFERENCE = motion.REFERENCE


def collection() -> Path:
    places = [os.environ.get("MILKDROP_PRESETS"), "~/code/presets-cream-of-the-crop", *glob.glob("/mnt/c/Users/*/code/presets-cream-of-the-crop")]
    for place in places:
        if place and Path(place).expanduser().is_dir():
            return Path(place).expanduser()
    sys.exit("no preset collection found: set MILKDROP_PRESETS to its folder")


def presets() -> list[str]:
    return [line.strip() for line in PRESET_LIST.read_text().splitlines() if line.strip() and not line.startswith("#")]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def bundle(track: Path) -> tuple[Path, Path]:
    """(package.json, audio file) for a track, as the render loop makes them."""
    if track.suffix.lower() in run.MODULE_SUFFIXES:
        directory = perfect_bundle.build(track)
        return directory / "package.json", directory / perfect_bundle.AUDIO
    return roles.standin_bundle_cached(track, run.LOOP_DIR / "cache"), track


def render_clip(preset_paths: list[Path], audio: Path, clip: Path, seconds: float, args, hold: float = 0.0) -> tuple[bool, str]:
    """One or more presets on one track, to an mp4 with the track's sound."""
    clip.parent.mkdir(parents=True, exist_ok=True)
    pcm = clip.with_suffix(".f32")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(audio), "-t", f"{seconds:.3f}", "-f", "f32le", "-ac", "2", "-ar", "44100", str(pcm)], check=True, stdin=subprocess.DEVNULL)
    size = f"{args.width}x{args.height}"
    draw = [str(PM_RENDER), "--audio", str(pcm), "--size", size, "--fps", str(args.fps), "--seconds", f"{seconds:.3f}"]
    if hold > 0:
        draw += ["--hold", f"{hold:.3f}", "--softcut", f"{args.softcut:.3f}"]
    draw += [str(p) for p in preset_paths]
    encode = [
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", size, "-r", str(args.fps), "-i", "-",
        "-i", str(audio), "-t", f"{seconds:.3f}", "-vf", "vflip", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
        "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clip),
    ]  # fmt: skip
    drawing = subprocess.Popen(draw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    encoding = subprocess.run(encode, stdin=drawing.stdout, capture_output=True)
    drawing.stdout.close()
    errors = drawing.stderr.read().decode(errors="replace")
    code = drawing.wait()
    pcm.unlink(missing_ok=True)
    if code != 0 or encoding.returncode != 0:
        clip.unlink(missing_ok=True)
        return False, (errors.strip().splitlines() or [encoding.stderr.decode(errors="replace").strip()[-200:] or "failed"])[-1]
    return True, ""


def measure(clip: Path, fps: float, package: dict) -> dict:
    """Every figure the loop has for a clip: the render loop's own, and the motion ones."""
    values = metrics.compute(metrics.load_frames(clip), fps, package)
    values.update(motion.compute(motion.load_frames(clip), fps))
    return {k: round(float(v), 4) for k, v in values.items()}


def spread(clips: list[dict]) -> dict:
    """For each figure, where the reference clips fall: the 10th, 25th, 50th, 75th and 90th percentile."""
    out = {}
    for name in motion.REFERENCE_FIGURES:
        values = [c["metrics"][name] for c in clips if name in c["metrics"]]
        if values:
            out[name] = {f"p{p}": round(float(np.percentile(values, p)), 4) for p in (10, 25, 50, 75, 90)} | {"clips": len(values)}
    return out


def cmd_render(args) -> int:
    if not PM_RENDER.exists():
        sys.exit("pm_render is not built: run tools/loop/projectm/build.sh")
    base = collection()
    tracks = sorted({Path(p).resolve() for pattern in args.tracks for p in glob.glob(str(ROOT / pattern))})
    names = presets()[: args.limit] if args.limit else presets()
    clips, failed = [], []
    for track in tracks:
        package_path, audio = bundle(track)
        package = json.loads(package_path.read_text())
        seconds = min(float(package["durationSec"]), args.seconds)
        for name in names:
            clip = OUT / track.stem / f"{slug(Path(name).stem)}.mp4"
            if not clip.exists() or args.again:
                ok, why = render_clip([base / name], audio, clip, seconds, args)
                if not ok:
                    failed.append((name, why))
                    print(f"FAIL  {track.stem}  {name}: {why}", flush=True)
                    continue
            entry = dict(track=track.stem, preset=name, clip=str(clip.relative_to(ROOT)), metrics=measure(clip, args.fps, package))
            clips.append(entry)
            m = entry["metrics"]
            print(f"ok    {track.stem:12} {Path(name).stem[:50]:50} speed {m['flow_speed']:.2f} swirl {m['flow_swirl']:.2f} change {m['change_quarter_s']:.2f}/{m['change_2s']:.2f} punch {m.get('punch', float('nan')):.1f}", flush=True)
    if not clips:
        sys.exit("nothing rendered")
    (OUT / "clips.json").write_text(json.dumps(clips, indent=1) + "\n")
    if not args.limit:
        reference = dict(
            what="Spread of the loop's figures over projectM renders of the presets in milkdrop_presets.txt, one preset per clip",
            tracks=[t.stem for t in tracks], seconds=args.seconds, size=[args.width, args.height], fps=args.fps,
            presets=len(names), clips=len(clips), failed=[name for name, _ in failed], figures=spread(clips),
        )  # fmt: skip
        REFERENCE.write_text(json.dumps(reference, indent=1) + "\n")
        print(f"reference written to {REFERENCE.relative_to(ROOT)} from {len(clips)} clips ({len(failed)} failed)")
    return 0


def cmd_compare(args) -> int:
    if not REFERENCE.exists():
        sys.exit("no reference yet: run `milkdrop.py render`")
    reference = json.loads(REFERENCE.read_text())
    runs = sorted((ROOT / ".loop" / "runs").glob("*/report.json"), key=lambda p: p.stat().st_mtime)
    report = ROOT / ".loop" / "runs" / args.run / "report.json" if args.run else (runs[-1] if runs else None)
    if not report or not report.exists():
        sys.exit("no loop run to compare")
    results = json.loads(report.read_text())
    ours = []
    for r in results if isinstance(results, list) else results.get("clips", []):
        if "clip" not in r or (args.only and args.only not in r["id"]):
            continue
        values = dict(r.get("metrics", {}))
        if "flow_speed" not in values:  # a run made before the loop measured motion itself
            values.update(motion.compute(motion.load_frames(ROOT / r["clip"]), 30.0))
        ours.append(dict(id=r["id"], metrics=values))
    print(f"{report.parent.name}: {len(ours)} of our clips against {reference['clips']} Milkdrop clips\n")
    print("\n".join(motion.reference_table([c["metrics"] for c in ours], reference)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render", help="render the reference presets and write the reference figures")
    r.add_argument("--tracks", nargs="+", default=run.DEFAULT_TRACKS)
    r.add_argument("--seconds", type=float, default=30.0)
    r.add_argument("--fps", type=int, default=30)
    r.add_argument("--width", type=int, default=480)
    r.add_argument("--height", type=int, default=270)
    r.add_argument("--softcut", type=float, default=3.0)
    r.add_argument("--limit", type=int, default=0, help="only the first N presets, and do not write the reference (for trying things)")
    r.add_argument("--again", action="store_true", help="render clips that already exist")
    r.set_defaults(func=cmd_render)
    c = sub.add_parser("compare", help="a loop run beside the reference")
    c.add_argument("run", nargs="?", help="name of a run under .loop/runs (default: the newest)")
    c.add_argument("--only", help="only our clips whose name contains this (e.g. director)")
    c.set_defaults(func=cmd_compare)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
