#!/usr/bin/env python3
"""The build loop: render every scene on every test track and score the result.

    python3 tools/loop/run.py                      # a directed show and every scene, on every track, 30 s each
                                                   # (data/ and two fixture modules)
    python3 tools/loop/run.py --scenes director    # only the directed shows
    python3 tools/loop/run.py --seconds 0          # whole tracks
    python3 tools/loop/run.py --scenes 'scenes/*.rhai' --tracks data/super.mp3
    python3 tools/loop/run.py --save-baseline      # accept this run as the baseline
    python3 tools/loop/run.py --tracks tools/loop/fixtures/modules/synth-0001.mod
    OCTOSEQ_ENGINE=/path/to/visualiser.exe python3 tools/loop/run.py   # another engine build

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
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np  # noqa: E402

import director  # noqa: E402
import metrics  # noqa: E402
import motion  # noqa: E402
import perfect_bundle  # noqa: E402
import roles  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LOOP_DIR = ROOT / ".loop"
ENGINE_DIR = ROOT / "packages" / "visualiser"
BUILT_ENGINE = ENGINE_DIR / "target" / "release" / ("visualiser.exe" if sys.platform == "win32" else "visualiser")
# OCTOSEQ_ENGINE names another build of the engine to render with. Its main use is
# under WSL, which has no GPU Vulkan driver: point it at an engine built natively
# on Windows and the frames are rendered on the GPU (see docs/loop/setup.md).
ENGINE = Path(os.environ["OCTOSEQ_ENGINE"]) if os.environ.get("OCTOSEQ_ENGINE") else BUILT_ENGINE
WINDOWS_ENGINE_FROM_WSL = ENGINE.suffix.lower() == ".exe" and sys.platform != "win32"
GATES = Path(__file__).parent / "gates.json"
BASELINE = Path(__file__).parent / "baseline.json"
CHECK_SCENES = Path(__file__).parent / "fixtures" / "scenes"
CHECK_SHOWS = Path(__file__).parent / "fixtures" / "shows"

# What a plain run covers: the real test tracks plus one training and one held-out
# fixture module (rendered from perfect bundles). Each gets a directed show, which is
# what a viewer sees, and each scene on its own, which is how a scene is debugged.
DEFAULT_TRACKS = ["data/*.mp3", "tools/loop/fixtures/modules/synth-0001.mod", "tools/loop/fixtures/modules/synth-0101.mod"]
DIRECTED = Path("director")  # in place of a scene: let the director make a show for the track
DIRECTED_SEED = 1  # the loop's shows must not change from run to run, so it fixes the director's seed
DEFAULT_SCENES = ["director", "scenes/*.rhai"]
MODULE_SUFFIXES = {".mod", ".xm", ".s3m", ".it", ".mptm"}
DETERMINISM_SECONDS = 3.0
SHEET_COLS, SHEET_ROWS = 6, 4


def sh(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def build_engine() -> None:
    if ENGINE != BUILT_ENGINE:
        if not ENGINE.exists():
            sys.exit(f"OCTOSEQ_ENGINE is set to {ENGINE}, which does not exist")
        return  # someone else's build: use it as it is
    result = sh(["cargo", "build", "--release", "--quiet"], cwd=ENGINE_DIR)
    if result.returncode != 0:
        sys.exit(f"engine build failed:\n{result.stderr[-3000:]}")


def engine_path(path: Path) -> str:
    """A path in the form the engine needs: a Windows engine run from WSL wants Windows paths."""
    if not WINDOWS_ENGINE_FROM_WSL:
        return str(path)
    return subprocess.run(["wslpath", "-w", str(path)], check=True, capture_output=True, text=True).stdout.strip()


def render_frames(package: Path, scene: Path, out: Path, seconds: float, args) -> tuple[bool, str]:
    """Render a scene, or a show if `scene` is a show.json, to numbered frames."""
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    cmd = [
        str(ENGINE), "render", "--package", engine_path(package),
        "--show" if scene.name == "show.json" else "--script", engine_path(scene),
        "--out", engine_path(out), "--fps", str(args.fps), "--width", str(args.width),
        "--height", str(args.height), "--duration", f"{seconds:.3f}", "--quiet",
    ]  # fmt: skip
    if getattr(args, "step_rate", 0):
        cmd += ["--step-rate", str(args.step_rate)]
    if getattr(args, "shutter", 0):
        cmd += ["--shutter", str(args.shutter)]
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
    result: dict = {"id": name, "track": str(track.relative_to(ROOT)), "scene": "director" if scene == DIRECTED else str(scene.relative_to(ROOT))}

    audio = track
    if track.suffix.lower() in MODULE_SUFFIXES:
        # A tracker module: render it and use its known-correct events instead of analysing.
        bundle = perfect_bundle.build(track)
        package_path, audio = bundle / "package.json", bundle / perfect_bundle.AUDIO
        result["perfect_bundle"] = True
    else:
        package_path = roles.standin_bundle_cached(track, LOOP_DIR / "cache")
    package = json.loads(package_path.read_text())
    seconds = package["durationSec"]
    if args.seconds > 0:
        seconds = min(seconds, args.seconds)
    result["seconds"] = round(seconds, 2)
    if scene == DIRECTED:
        try:
            show = director.direct(package, DIRECTED_SEED)
        except ValueError as error:
            result.update(status="fail", hard=[f"director: {error}"], target=[])
            return result
        scene = director.write(show, out / "show")
        result["looks"] = sum(s["start"] < seconds for s in show["segments"])

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
    values.update(motion.compute(motion.load_frames(clip), args.fps))
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


def engine_checks(track: Path, run_dir: Path, gates: dict, args) -> list[dict]:
    """Checks on the engine itself, using scenes whose right answer is known.

    Bounded feedback: a loop built to run away must stay below white, and the same
    loop with the bound switched off must blow out. The second half is what shows
    the first can fail.

    Transitions: see `transition_checks`.
    """
    small = argparse.Namespace(**{**vars(args), "seconds": 10.0, "width": 240, "height": 136, "fps": 30})
    limit = gates["hard"]["blown_fraction"]["max"]
    cases = [
        ("feedback-runaway.rhai", False, "a feedback loop built to run away stays below white"),
        ("feedback-runaway-unbounded.rhai", True, "the same loop with the bound switched off blows out"),
    ]
    checks = []
    for scene, should_blow, name in cases:
        result = run_pair(track, CHECK_SCENES / scene, run_dir / "checks", gates, small)
        blown = result.get("metrics", {}).get("blown_fraction")
        if blown is None:
            checks.append(dict(name=name, ok=False, detail=result["hard"][0] if result.get("hard") else "did not render"))
        else:
            checks.append(dict(name=name, ok=(blown > limit) == should_blow, detail=f"{blown * 100:.0f}% of frames blown out"))
    return checks + light_checks(track, run_dir / "checks", small) + transition_checks(track, run_dir / "checks", small) + frame_rate_checks(track, run_dir / "checks", small)


def load_frames_full(frames: Path, width: int, height: int) -> np.ndarray:
    """Numbered frames as rendered, at their own size: uint8, (frames, H, W, 3)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(frames), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 3)


def to_light(frames: np.ndarray) -> np.ndarray:
    """Screen values back to amounts of light (the sRGB curve undone), 0 to 1."""
    x = frames.astype(np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def hue_of(colour) -> float:
    """Where a colour sits on the colour wheel, 0 to 1."""
    r, g, b = (float(c) for c in colour)
    top, bottom = max(r, g, b), min(r, g, b)
    if top - bottom < 1e-6:
        return 0.0
    if top == r:
        return (((g - b) / (top - bottom)) % 6.0) / 6.0
    if top == g:
        return ((b - r) / (top - bottom) + 2.0) / 6.0
    return ((r - g) / (top - bottom) + 4.0) / 6.0


BRIGHT_COLOUR, BRIGHT_TIMES = (1.0, 0.2, 0.05), 4.0  # as in fixtures/scenes/brighter-than-white.rhai
SAME_COLOUR = 0.05  # of the colour wheel: 18 degrees


def light_checks(track: Path, out: Path, args) -> list[dict]:
    """A light brighter than white must keep its colour.

    The fixture draws two rings of one red, the right one four times as bright as
    the left, which is at full brightness. Everything is drawn in float and
    tone-mapped at the end, so the right ring should be the same red, paler and
    brighter. An engine that cuts each channel off at white shows it orange: the
    check works out from the scene's numbers how far round the colour wheel that
    would put it, and it must be further than the allowance, or the check could
    not tell the two engines apart.
    """
    name = "a light four times brighter than white keeps its colour"
    if track.suffix.lower() in MODULE_SUFFIXES:
        bundle = perfect_bundle.build(track)
        package_path = bundle / "package.json"
    else:
        package_path = roles.standin_bundle_cached(track, LOOP_DIR / "cache")
    frames_dir = out / "brighter-than-white" / "frames"
    plain = argparse.Namespace(**{**vars(args), "step_rate": 0, "shutter": 0.0})
    ok, log = render_frames(package_path, CHECK_SCENES / "brighter-than-white.rhai", frames_dir, 1.0, plain)
    if not ok:
        return [dict(name=name, ok=False, detail=f"did not render: {log.strip().splitlines()[-1] if log.strip() else '?'}")]
    frame = load_frames_full(frames_dir / "frame_%05d.png", plain.width, plain.height)[-1].astype(np.float32) / 255.0
    shutil.rmtree(frames_dir)
    half = frame.shape[1] // 2
    seen = []
    for side in (frame[:, :half], frame[:, half:]):
        lit = side[side.max(axis=-1) - side.min(axis=-1) > 0.08]  # the ring, not the grey behind it
        if len(lit) < 20:
            return [dict(name=name, ok=False, detail="the fixture's rings did not show")]
        seen.append(lit.mean(axis=0))
    screen = lambda c: [min(v, 1.0) ** (1 / 2.2) for v in c]  # noqa: E731
    wheel = lambda a, b: min(abs(a - b), 1.0 - abs(a - b))  # noqa: E731
    moved = wheel(hue_of(seen[0]), hue_of(seen[1]))
    cut_off = wheel(hue_of(screen(BRIGHT_COLOUR)), hue_of(screen([c * BRIGHT_TIMES for c in BRIGHT_COLOUR])))
    brighter = float(seen[1].mean()) > float(seen[0].mean()) + 0.05
    return [dict(
        name=name,
        ok=moved <= SAME_COLOUR < cut_off and brighter,
        detail=f"its colour moves {moved * 360:.0f} degrees round the wheel; cut off at white it would move {cut_off * 360:.0f}"
        + f" (shown as {', '.join(f'{v:.2f}' for v in seen[0])} and {', '.join(f'{v:.2f}' for v in seen[1])})"
        + ("" if brighter else "; but it is no brighter than the ring at full brightness"),
    )]  # fmt: skip


SAME_PICTURE = 1.0 / 255.0  # mean difference of one grey level: the same picture


def frame_rate_checks(track: Path, out: Path, args) -> list[dict]:
    """What a render's frame rate may and may not change, on eight seconds of `liquid`.

    Trails must last as long at 120 frames a second as at 30. The feedback loop runs
    once a step, so its fade, growth, turn and bend are scaled to the step's length,
    or a faster render would fade and flow faster. The share of the frame that is
    lit, which is how far the trails reach before they fade, must agree. An engine
    that fades once a frame regardless lights a fifth less of the frame at 120.

    That alone does not make the two the same picture: at 120 a moving shape is
    stamped into the loop four times as often, so its trail is a continuous smear
    rather than a row of stamps. A step rate closes that. A 30 fps render stepped
    120 times a second must be the 120 fps
    render with three frames in four left out: frame j of one against frame 4j + 3
    of the other, to within a grey level. The plain 30 fps render is measured against
    the same frames and must be further off than that, or the check proves nothing.
    """
    trails = "trails last as long at 120 frames a second as at 30"
    same = "a 30 fps render stepped 120 times a second is the 120 fps picture"
    blur = "with the shutter open, a frame is the average of its steps"
    if track.suffix.lower() in MODULE_SUFFIXES:
        bundle = perfect_bundle.build(track)
        package_path, audio = bundle / "package.json", bundle / perfect_bundle.AUDIO
    else:
        package_path, audio = roles.standin_bundle_cached(track, LOOP_DIR / "cache"), track
    package = json.loads(package_path.read_text())
    seconds = min(8.0, float(package["durationSec"]))
    renders = {"30": (30, 0, 0.0), "120": (120, 0, 0.0), "30-stepped": (30, 120, 0.0), "30-blurred": (30, 120, 1.0)}
    lit, bright, pictures, files, full = {}, {}, {}, {}, {}
    for key, (fps, step_rate, shutter) in renders.items():
        at = argparse.Namespace(**{**vars(args), "fps": fps, "step_rate": step_rate, "shutter": shutter})
        frames_dir = out / f"fps-{key}" / "frames"
        ok, log = render_frames(package_path, ROOT / "scenes" / "liquid.rhai", frames_dir, seconds, at)
        if not ok:
            detail = f"did not render at {fps} fps{' stepped' if step_rate else ''}: {log.strip().splitlines()[-1] if log.strip() else '?'}"
            return [dict(name=trails, ok=False, detail=detail), dict(name=same, ok=False, detail=detail), dict(name=blur, ok=False, detail=detail)]
        clip = frames_dir.parent / "clip.mp4"
        encode_clip(frames_dir, audio, clip, seconds, fps)
        # The frames as rendered, before the video encoder has touched them; the
        # last step of each 30 fps frame is every fourth frame at 120, from the fourth.
        every = fps // 30
        pictures[key] = metrics.load_frames(frames_dir / "frame_%05d.png")[every - 1 :: every].astype(np.float32)
        files[key] = [hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(frames_dir.glob("frame_*.png"))][every - 1 :: every]
        if key in ("120", "30-blurred"):  # the first two seconds at full size, for the shutter check
            full[key] = load_frames_full(frames_dir / "frame_%05d.png", at.width, at.height)[: 2 * fps]
        shutil.rmtree(frames_dir)
        frames = metrics.load_frames(clip)[::every]  # the same moments from each
        lit[key] = float((frames.max(axis=-1) > 40).mean())
        bright[key] = float(frames.mean()) / 255.0
    checks = [dict(
        name=trails,
        ok=abs(lit["120"] - lit["30"]) <= 0.15 * max(lit["30"], 1e-6),
        detail=f"lit {lit['30']:.2f} and {lit['120']:.2f} of the frame; mean brightness {bright['30']:.2f} and {bright['120']:.2f}",
    )]  # fmt: skip
    count = min(len(pictures["120"]), len(pictures["30-stepped"]), len(pictures["30"]))
    apart = {key: float(np.abs(pictures[key][:count] - pictures["120"][:count]).mean()) / 255.0 for key in ("30", "30-stepped")}
    identical = sum(1 for x, y in zip(files["30-stepped"][:count], files["120"][:count]) if x == y)
    checks.append(dict(
        name=same,
        ok=apart["30-stepped"] <= SAME_PICTURE < apart["30"],
        detail=f"{identical} of {count} frames identical to the byte, mean difference {apart['30-stepped']:.4f}; one step a frame differs by {apart['30']:.4f}",
    ))  # fmt: skip
    # The shutter. Open for the whole frame, a 30 fps frame stepped 120 times a second
    # is the average of four steps, and those steps are the frames of the 120 fps
    # render. Averaged as light, not as screen values, the two must agree to a grey
    # level; and a single step must be clearly further from the average than that,
    # or the check could not tell a blurred frame from a sharp one.
    count = min(len(full["30-blurred"]), len(full["120"]) // 4)
    steps = to_light(full["120"][: count * 4]).reshape(count, 4, *full["120"].shape[1:])
    average = steps.mean(axis=1)
    off = float(np.abs(to_light(full["30-blurred"][:count]) - average).mean())
    sharp = float(np.abs(steps[:, 3] - average).mean())
    checks.append(dict(
        name=blur,
        ok=off <= SAME_PICTURE and sharp >= 3 * off,
        detail=f"mean difference from the average of the four steps {off:.4f}; a single step differs from it by {sharp:.4f}",
    ))  # fmt: skip
    return checks


def transition_checks(track: Path, out: Path, args) -> list[dict]:
    """A blended transition shows both scenes at once; a cut does not.

    Two fixture shows play a red ring on the left for two seconds and then a blue
    ring on the right. In one the blue scene blends in over two seconds, in the
    other it cuts. Neither scene leaves a trail that lasts. So one second after the
    change the blend must still show red beside the blue, each well below full
    strength, and the cut must show no red at all. The cut is what shows the blend's
    check can fail. The top of the frame, where neither scene draws, must stay black
    all the way through: a blend that lost the old scene's settings showed there as
    a grey flash.
    """
    if track.suffix.lower() in MODULE_SUFFIXES:
        bundle = perfect_bundle.build(track)
        package_path, audio = bundle / "package.json", bundle / perfect_bundle.AUDIO
    else:
        package_path, audio = roles.standin_bundle_cached(track, LOOP_DIR / "cache"), track
    seconds, at = 6.0, dict(before=1.5, during=3.0, after=5.5)
    seen: dict[str, dict[str, tuple[float, float]]] = {}
    background = 0.0
    for name in ("blend", "cut"):
        frames_dir = out / f"transition-{name}" / "frames"
        ok, log = render_frames(package_path, CHECK_SHOWS / name / "show.json", frames_dir, seconds, args)
        if not ok:
            return [dict(name="a blended transition shows both scenes at once", ok=False, detail=f"{name} show did not render: {log.strip().splitlines()[-1] if log.strip() else '?'}")]
        clip = frames_dir.parent / "clip.mp4"
        encode_clip(frames_dir, audio, clip, seconds, args.fps)
        shutil.rmtree(frames_dir)
        frames = metrics.load_frames(clip).astype(float) / 255.0
        half = frames.shape[2] // 2
        seen[name] = {}
        if name == "blend":
            background = float(frames[:, : frames.shape[1] // 8].max(axis=-1).mean(axis=(1, 2)).max())
        for label, t in at.items():
            frame = frames[min(int(t * args.fps), len(frames) - 1)]
            red = float(np.clip(frame[:, :half, 0] - frame[:, :half, 1:].max(axis=-1), 0, None).mean())
            blue = float(np.clip(frame[:, half:, 2] - frame[:, half:, :2].max(axis=-1), 0, None).mean())
            seen[name][label] = (red, blue)
    full_red, full_blue = seen["blend"]["before"][0], seen["blend"]["after"][1]
    if full_red < 0.005 or full_blue < 0.005:
        return [dict(name="a blended transition shows both scenes at once", ok=False, detail="the fixture scenes drew nothing to measure")]
    red, blue = seen["blend"]["during"][0] / full_red, seen["blend"]["during"][1] / full_blue
    clean = seen["blend"]["before"][1] / full_blue < 0.05 and seen["blend"]["after"][0] / full_red < 0.05
    cut_red = seen["cut"]["during"][0] / full_red
    return [
        dict(
            name="a blended transition shows both scenes at once",
            ok=clean and 0.15 < red < 0.9 and 0.15 < blue < 0.9,
            detail=f"halfway: old scene at {red * 100:.0f}% of full, new at {blue * 100:.0f}%" + ("" if clean else "; but one scene shows outside the transition"),
        ),
        dict(name="and leaves the background alone", ok=background < 0.03, detail=f"empty part of the frame never brighter than {background * 100:.0f}%"),
        dict(name="a cut does not", ok=cut_red < 0.05, detail=f"one second after a cut: old scene at {cut_red * 100:.0f}% of full"),
    ]


SUMMARY_COLUMNS = ["punch", "look_change", "flow_speed", "flow_swirl", "one_hue_share", "wash", "wash_spread", "active_area", "jerkiness", "audio_sync", "variety", "colourfulness"]


def write_report(run_dir: Path, results: list[dict], baseline: dict | None, checks: list[dict] | None = None) -> None:
    lines = [f"# Loop run `{run_dir.name}`", ""]
    if checks:
        lines += ["Engine checks:", ""] + [f"- {'ok' if c['ok'] else '**FAIL**'}: {c['name']} ({c['detail']})" for c in checks] + [""]
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
    if motion.REFERENCE.exists():
        reference = json.loads(motion.REFERENCE.read_text())
        for title, wanted in (("The directed shows", lambda r: r["scene"] == "director"), ("Single scenes", lambda r: r["scene"] != "director")):
            ours = [r["metrics"] for r in results if "metrics" in r and wanted(r)]
            if ours:
                lines += ["", f"## Beside Milkdrop: {title.lower()}", "", f"{len(ours)} of our clips against {reference['clips']} clips of projectM presets on the same tracks (see docs/loop/README.md).", ""]
                lines += motion.reference_table(ours, reference)

    (run_dir / "report.md").write_text("\n".join(lines))
    (run_dir / "report.json").write_text(json.dumps(results, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tracks", nargs="+", default=DEFAULT_TRACKS)
    parser.add_argument("--scenes", nargs="+", default=DEFAULT_SCENES)
    parser.add_argument("--seconds", type=float, default=30.0, help="clip length; 0 = whole track")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--step-rate", type=int, default=0, help="steps the engine takes a second (see video.py); 0 = one a frame")
    parser.add_argument("--shutter", type=float, default=0.0, help="motion blur: the share of each frame its shutter is open (see video.py); needs --step-rate")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=270)
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--no-build", action="store_true", help="skip cargo build")
    parser.add_argument("--no-checks", action="store_true", help="skip the engine checks")
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()

    def expand(patterns: list[str]) -> list[Path]:
        found = sorted({Path(p).resolve() for pat in patterns for p in glob.glob(str(ROOT / pat))})
        if not found:
            sys.exit(f"nothing matches {patterns}")
        return found

    tracks = expand(args.tracks)
    scenes = [DIRECTED] if "director" in args.scenes else []
    if [s for s in args.scenes if s != "director"]:
        scenes += expand([s for s in args.scenes if s != "director"])
    if not args.no_build:
        build_engine()
    gates = json.loads(GATES.read_text())
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else None

    run_dir = LOOP_DIR / "runs" / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    checks = [] if args.no_checks else engine_checks(tracks[0], run_dir, gates, args)
    for check in checks:
        print(f"{'ok  ' if check['ok'] else 'FAIL'} {check['name']} ({check['detail']})", flush=True)
    results = []
    for track in tracks:
        for scene in scenes:
            r = run_pair(track, scene, run_dir, gates, args)
            results.append(r)
            print(f"{r['status']:5} {r['id']} ({r['render_seconds']}s)", flush=True)
            for problem in r["hard"]:
                print(f"      FAIL {problem}")

    write_report(run_dir, results, baseline, checks)
    print(f"\nreport: {(run_dir / 'report.md').relative_to(ROOT)}")
    if args.save_baseline:
        BASELINE.write_text(json.dumps({r["id"]: r.get("metrics", {}) for r in results}, indent=2) + "\n")
        print(f"baseline saved to {BASELINE.relative_to(ROOT)}")
    return 1 if any(r["status"] == "fail" for r in results) or not all(c["ok"] for c in checks) else 0


if __name__ == "__main__":
    sys.exit(main())
