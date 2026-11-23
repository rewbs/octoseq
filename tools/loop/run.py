#!/usr/bin/env python3
"""The build loop: render every scene on every test track and score the result.

    python3 tools/loop/run.py                      # all scenes x all tracks, 30 s each
    python3 tools/loop/run.py --seconds 0          # whole tracks
    python3 tools/loop/run.py --scenes 'scenes/*.rhai' --tracks data/super.mp3
    python3 tools/loop/run.py --save-baseline      # accept this run as the baseline
    python3 tools/loop/run.py --tracks tools/loop/fixtures/modules/synth-0001.mod

A track may be a tracker module instead of an audio file. It is then rendered with
the instrumented player and the scene is driven by a bundle of known-correct events
(see perfect_bundle.py) rather than by analysis.

For each (track, scene) pair it renders a clip with the native engine, checks the
render is deterministic, computes the metrics in metrics.py, applies the gates in
gates.json and writes a contact sheet. Results go to .loop/runs/<name>/ with a
report.md summary. Exit status is non-zero if any hard gate fails.

See docs/loop/README.md for how this fits into building Octoseq autonomously.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyse  # noqa: E402
import metrics  # noqa: E402
import perfect_bundle  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LOOP_DIR = ROOT / ".loop"
ENGINE_DIR = ROOT / "packages" / "visualiser"
ENGINE = ENGINE_DIR / "target" / "release" / ("visualiser.exe" if sys.platform == "win32" else "visualiser")
GATES = Path(__file__).parent / "gates.json"
BASELINE = Path(__file__).parent / "baseline.json"

MODULE_SUFFIXES = {".mod", ".xm", ".s3m", ".it", ".mptm"}
DETERMINISM_SECONDS = 3.0
SHEET_COLS, SHEET_ROWS = 6, 4


def sh(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def build_engine() -> None:
    result = sh(["cargo", "build", "--release", "--quiet"], cwd=ENGINE_DIR)
    if result.returncode != 0:
        sys.exit(f"engine build failed:\n{result.stderr[-3000:]}")


def render_frames(package: Path, scene: Path, out: Path, seconds: float, args) -> tuple[bool, str]:
    if out.exists():
        shutil.rmtree(out)
    cmd = [
        str(ENGINE), "render", "--package", str(package), "--script", str(scene),
        "--out", str(out), "--fps", str(args.fps), "--width", str(args.width),
        "--height", str(args.height), "--duration", f"{seconds:.3f}", "--quiet",
    ]  # fmt: skip
    result = sh(cmd)
    ok = result.returncode == 0 and any(out.glob("frame_*.png"))
    return ok, (result.stderr or result.stdout)[-2000:]


def hash_frames(frames_dir: Path, count: int | None = None) -> str:
    h = hashlib.sha256()
    for frame in sorted(frames_dir.glob("frame_*.png"))[:count]:
        h.update(frame.read_bytes())
    return h.hexdigest()


def encode_clip(frames_dir: Path, audio: Path, clip: Path, seconds: float, fps: int) -> None:
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "frame_%05d.png"), "-i", str(audio), "-t", f"{seconds:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clip),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)


def contact_sheet(clip: Path, sheet: Path, frame_count: int) -> None:
    cells = SHEET_COLS * SHEET_ROWS
    every = max(1, frame_count // cells)
    vf = f"select='not(mod(n\\,{every}))',scale=320:-1,tile={SHEET_COLS}x{SHEET_ROWS}"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-vf", vf, "-frames:v", "1", str(sheet)]
    subprocess.run(cmd, check=True)


def apply_gates(values: dict, gates: dict) -> tuple[list[str], list[str]]:
    """Return (hard failures, missed targets) as human-readable strings."""

    def check(level: str) -> list[str]:
        problems = []
        for name, rule in gates[level].items():
            v = values.get(name)
            if v is None:
                continue
            if "max" in rule and v > rule["max"]:
                problems.append(f"{name} {v:.3f} > {rule['max']} ({rule['why']})")
            if "min" in rule and v < rule["min"]:
                problems.append(f"{name} {v:.3f} < {rule['min']} ({rule['why']})")
        return problems

    return check("hard"), check("target")


def run_pair(track: Path, scene: Path, run_dir: Path, gates: dict, args) -> dict:
    name = f"{track.stem}__{scene.stem}"
    out = run_dir / name
    out.mkdir(parents=True, exist_ok=True)
    result: dict = {"id": name, "track": str(track.relative_to(ROOT)), "scene": str(scene.relative_to(ROOT))}

    audio = track
    if track.suffix.lower() in MODULE_SUFFIXES:
        # A tracker module: render it and use its known-correct events instead of analysing.
        bundle = perfect_bundle.build(track)
        package_path, audio = bundle / "package.json", bundle / perfect_bundle.AUDIO
        result["perfect_bundle"] = True
    else:
        package_path = analyse.analyse_cached(track, LOOP_DIR / "cache")
    package = json.loads(package_path.read_text())
    seconds = package["durationSec"]
    if args.seconds > 0:
        seconds = min(seconds, args.seconds)
    result["seconds"] = round(seconds, 2)

    frames_dir = out / "frames"
    started = time.time()
    ok, log = render_frames(package_path, scene, frames_dir, seconds, args)
    result["render_seconds"] = round(time.time() - started, 1)
    if not ok:
        result.update(status="fail", hard=[f"render failed: {log.strip().splitlines()[-1] if log.strip() else '?'}"], target=[])
        (out / "render.log").write_text(log)
        return result

    # Determinism: render the opening again and compare frame bytes.
    check_seconds = min(seconds, DETERMINISM_SECONDS)
    check_frames = int(check_seconds * args.fps)
    again = out / "frames_again"
    ok_again, _ = render_frames(package_path, scene, again, check_seconds, args)
    deterministic = ok_again and hash_frames(frames_dir, check_frames) == hash_frames(again, check_frames)
    shutil.rmtree(again, ignore_errors=True)

    clip = out / "clip.mp4"
    encode_clip(frames_dir, audio, clip, seconds, args.fps)
    shutil.rmtree(frames_dir)

    frames = metrics.load_frames(clip)
    values = metrics.compute(frames, args.fps, package)
    contact_sheet(clip, out / "sheet.png", len(frames))

    hard, target = apply_gates(values, gates)
    if not deterministic:
        hard.insert(0, "render is not deterministic: two runs produced different frames")
    result.update(
        status="fail" if hard else ("warn" if target else "pass"),
        deterministic=deterministic,
        metrics={k: round(v, 4) for k, v in values.items()},
        hard=hard,
        target=target,
        clip=str(clip.relative_to(ROOT)),
        sheet=str((out / "sheet.png").relative_to(ROOT)),
    )
    return result


SUMMARY_COLUMNS = ["active_area", "jerkiness", "audio_sync", "variety", "colourfulness", "motion"]


def write_report(run_dir: Path, results: list[dict], baseline: dict | None) -> None:
    lines = [f"# Loop run `{run_dir.name}`", ""]
    counts = {s: sum(r["status"] == s for r in results) for s in ("pass", "warn", "fail")}
    lines.append(
        f"{len(results)} clips: {counts['fail']} failed a hard gate, "
        f"{counts['warn']} missed a target, {counts['pass']} clean."
    )
    lines += ["", "| Clip | Status | " + " | ".join(SUMMARY_COLUMNS) + " |"]
    lines.append("|---|---|" + "---|" * len(SUMMARY_COLUMNS))
    for r in results:
        cells = []
        for col in SUMMARY_COLUMNS:
            v = r.get("metrics", {}).get(col)
            if v is None:
                cells.append("–")
                continue
            cell = f"{v:.3f}"
            before = (baseline or {}).get(r["id"], {}).get(col)
            if before is not None and abs(v - before) > 0.005:
                cell += f" ({v - before:+.3f})"
            cells.append(cell)
        lines.append(f"| {r['id']} | {r['status']} | " + " | ".join(cells) + " |")
    lines.append("")
    if baseline:
        lines += ["Figures in brackets are the change from the saved baseline.", ""]
    for r in results:
        if r["hard"] or r["target"]:
            lines.append(f"## {r['id']}")
            lines += [f"- **FAIL** {p}" for p in r["hard"]]
            lines += [f"- target missed: {p}" for p in r["target"]]
            lines.append("")
    (run_dir / "report.md").write_text("\n".join(lines))
    (run_dir / "report.json").write_text(json.dumps(results, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tracks", nargs="+", default=["data/*.mp3"])
    parser.add_argument("--scenes", nargs="+", default=["example-scripts/*.rhai"])
    parser.add_argument("--seconds", type=float, default=30.0, help="clip length; 0 = whole track")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=270)
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--no-build", action="store_true", help="skip cargo build")
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()

    def expand(patterns: list[str]) -> list[Path]:
        found = sorted({Path(p).resolve() for pat in patterns for p in glob.glob(str(ROOT / pat))})
        if not found:
            sys.exit(f"nothing matches {patterns}")
        return found

    tracks, scenes = expand(args.tracks), expand(args.scenes)
    if not args.no_build:
        build_engine()
    gates = json.loads(GATES.read_text())
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else None

    run_dir = LOOP_DIR / "runs" / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for track in tracks:
        for scene in scenes:
            r = run_pair(track, scene, run_dir, gates, args)
            results.append(r)
            print(f"{r['status']:5} {r['id']} ({r['render_seconds']}s)", flush=True)
            for problem in r["hard"]:
                print(f"      FAIL {problem}")

    write_report(run_dir, results, baseline)
    print(f"\nreport: {(run_dir / 'report.md').relative_to(ROOT)}")
    if args.save_baseline:
        BASELINE.write_text(json.dumps({r["id"]: r.get("metrics", {}) for r in results}, indent=2) + "\n")
        print(f"baseline saved to {BASELINE.relative_to(ROOT)}")
    return 1 if any(r["status"] == "fail" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
