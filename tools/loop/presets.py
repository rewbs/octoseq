#!/usr/bin/env python3
"""The preset pool: Milkdrop presets chosen to be recreated as scenes, and what each one does.

    python3 tools/loop/presets.py survey            # what the whole collection uses, by category
    python3 tools/loop/presets.py choose            # pick the pool (tools/loop/preset_pool.json)
    python3 tools/loop/presets.py render [--only N] # projectM's render of each, measured as ours are
    python3 tools/loop/presets.py table             # the pool as a table (docs/design/preset-pool.md)

The collection ("Cream of the Crop", about 9,800 presets) is sorted by its curator
into ten categories and some 170 sub-categories by how a preset looks: Dancer/Glowsticks,
Fractal/Nested Square, Geometric/Tunnel Morph. The pool takes five presets from each
category, each from a different family of sub-categories (a sub-category and its
"Mirror" twin are one family), spread evenly through the category's list, and within
a sub-category the preset most typical of it by what it uses. Nothing is chosen by
eye, so the pool can be made again, and it leans towards no author or style.

A preset is read as a list of settings plus five kinds of code: per-frame and
per-pixel equations, a warp shader and a composite shader, and the code of up to
four custom waves and four custom shapes. `features` reduces that to what matters
for recreating it: how the previous frame is moved and faded, what is drawn on top,
and which of projectM's facilities it leans on.

The collection is not part of this repository; see milkdrop.py for where it is looked for.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
POOL = Path(__file__).parent / "preset_pool.json"
SURVEY = ROOT / ".loop" / "presets" / "survey.json"
OUT = ROOT / ".loop" / "presets"
PER_CATEGORY = 5
# Samplers a shader can name without needing an image file beside the preset.
BUILT_IN = {"main", "blur1", "blur2", "blur3", "noise_lq", "noise_lq_lite", "noise_mq", "noise_hq", "noisevol_lq", "noisevol_hq"}
FIELDS = ("zoom", "rot", "dx", "dy", "sx", "sy", "warp", "cx", "cy")
CODE = re.compile(r"^(per_frame_init|per_frame|per_pixel|warp|comp)_(\d+)$")
PART = re.compile(r"^(wave|shape)_(\d)_(init|per_frame|per_point)(\d+)$")


def parse(path: Path) -> dict:
    """A preset file as its plain settings and its blocks of code."""
    values: dict[str, str] = {}
    code: dict[str, list[str]] = {}
    for line in path.read_text(errors="replace").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        block = CODE.match(key)
        part = PART.match(key)
        if block:
            code.setdefault(block.group(1), []).append(value.lstrip("`"))
        elif part:
            code.setdefault(f"{part.group(1)}_{part.group(3)}", []).append(value)
            code.setdefault(f"{part.group(1)}{part.group(2)}", []).append(value)
        else:
            values[key] = value.strip()
    return dict(values=values, code={k: "\n".join(v) for k, v in code.items()})


def features(preset: dict) -> dict:
    """What a preset does, in the terms a scene would have to match."""
    v, code = preset["values"], preset["code"]

    def num(key: str, default: float = 0.0) -> float:
        try:
            return float(v.get(key, default))
        except ValueError:
            return default

    shaders = code.get("warp", "") + "\n" + code.get("comp", "")
    equations = "\n".join(code.get(k, "") for k in ("per_frame", "per_pixel", "wave_per_frame", "wave_per_point", "shape_per_frame"))
    per_pixel = code.get("per_pixel", "")
    waves = [i for i in range(4) if num(f"wavecode_{i}_enabled") >= 1]
    shapes = [i for i in range(4) if num(f"shapecode_{i}_enabled") >= 1]
    samplers = set(re.findall(r"sampler_(?:fw_|fc_|pw_|pc_)?(\w+)", shaders))
    return dict(
        # How the last frame comes back.
        decay=num("fDecay", 0.98),
        zoom=num("zoom", 1.0),
        rot=num("rot"),
        warp=num("warp"),
        zoom_exponent=num("fZoomExponent", 1.0),
        fields=sorted(f for f in FIELDS if re.search(rf"\b{f}\s*=", per_pixel)),
        by_place=bool(re.search(r"\b(rad|ang|x|y)\b", per_pixel)),
        echo=num("fVideoEchoAlpha") > 0.01,
        echo_flip=int(num("nVideoEchoOrientation")) if num("fVideoEchoAlpha") > 0.01 else 0,
        # What is drawn on top.
        waveform=num("fWaveAlpha") > 0.01,
        wave_mode=int(num("nWaveMode")),
        custom_waves=len(waves),
        spectrum_waves=sum(1 for i in waves if num(f"wavecode_{i}_bSpectrum") >= 1),
        custom_shapes=len(shapes),
        textured_shapes=sum(1 for i in shapes if num(f"shapecode_{i}_textured") >= 1),
        shape_copies=int(sum(max(num(f"shapecode_{i}_num_inst", 1.0), 1.0) for i in shapes)),
        borders=num("ob_a") > 0.01 or num("ib_a") > 0.01,
        motion_vectors=num("mv_a") > 0.01,
        # projectM's own facilities.
        warp_shader=bool(code.get("warp", "").strip()),
        comp_shader=bool(code.get("comp", "").strip()),
        blur=bool(re.search(r"blur[123]|GetBlur", shaders)),
        noise=bool(re.search(r"noise", shaders)),
        textures=sorted(samplers - BUILT_IN),
        gamma=num("fGammaAdj", 1.0),
        tone=sorted(k for k, key in (("darken", "bDarken"), ("brighten", "bBrighten"), ("solarize", "bSolarize"), ("invert", "bInvert")) if num(key) >= 1),
        # What it listens to.
        hears=sorted(band for band in ("bass", "mid", "treb") if re.search(rf"\b{band}(_att)?\b", equations)),
        rating=num("fRating", 3.0),
    )


def vector(f: dict) -> list[float]:
    """A preset's features as numbers, for saying which of a group is the most typical."""
    return [
        f["decay"], min(abs(f["zoom"] - 1.0), 0.5), min(abs(f["rot"]), 1.0), min(f["warp"], 2.0), len(f["fields"]), float(f["by_place"]),
        float(f["echo"]), float(f["waveform"]), f["custom_waves"], f["custom_shapes"], f["textured_shapes"], min(f["shape_copies"], 50) / 10,
        float(f["warp_shader"]), float(f["comp_shader"]), float(f["blur"]), float(f["noise"]), len(f["hears"]),
    ]  # fmt: skip


def collection() -> Path:
    import milkdrop

    return milkdrop.collection()


def family(sub_category: str) -> str:
    return sub_category.removesuffix(" Mirror").strip()


def survey(base: Path, category: str | None = None) -> dict:
    """Every preset's features, kept in .loop/presets/survey.json. One category at a time if asked."""
    known = json.loads(SURVEY.read_text()) if SURVEY.exists() else {}
    for directory in sorted(p for p in base.iterdir() if p.is_dir() and not p.name.startswith("!")):
        if category and directory.name != category:
            continue
        if directory.name in known and not category:
            continue
        found = {}
        for path in sorted(directory.rglob("*.milk")):
            try:
                found[str(path.relative_to(base))] = features(parse(path))
            except OSError:
                continue
        known[directory.name] = found
        SURVEY.parent.mkdir(parents=True, exist_ok=True)
        SURVEY.write_text(json.dumps(known))
        print(f"{directory.name}: {len(found)} presets", flush=True)
    return known


def choose(known: dict) -> list[dict]:
    """The pool: PER_CATEGORY presets from each category, with two alternates each."""
    pool = []
    for category in sorted(known):
        usable = {path: f for path, f in known[category].items() if not f["textures"]}
        families: dict[str, dict[str, dict]] = {}
        for path, f in usable.items():
            families.setdefault(family(Path(path).parent.name), {})[path] = f
        names = sorted(name for name, members in families.items() if len(members) >= 5)
        picks = [names[round(i * (len(names) - 1) / (PER_CATEGORY - 1))] for i in range(PER_CATEGORY)] if len(names) >= PER_CATEGORY else names
        for slot, name in enumerate(dict.fromkeys(picks)):
            members = families[name]
            # The middle pick of each category takes the family's mirrored twin where it has one.
            mirrored = {p: f for p, f in members.items() if Path(p).parent.name.endswith("Mirror")}
            plain = {p: f for p, f in members.items() if p not in mirrored}
            group = mirrored if slot == PER_CATEGORY // 2 and len(mirrored) >= 5 else (plain if len(plain) >= 5 else members)
            floor = float(np.median([f["rating"] for f in group.values()]))
            rated = {p: f for p, f in group.items() if f["rating"] >= floor}
            paths = sorted(rated)
            matrix = np.array([vector(rated[p]) for p in paths], dtype=float)
            scale = matrix.std(axis=0)
            scale[scale < 1e-9] = 1.0
            distance = np.linalg.norm((matrix - np.median(matrix, axis=0)) / scale, axis=1)
            order = [paths[i] for i in np.lexsort((np.arange(len(paths)), np.round(distance, 6)))]
            pool.append(dict(category=category, family=name, sub_category=Path(order[0]).parent.name, preset=order[0], alternates=order[1:3], features=rated[order[0]]))
    return pool


def slug(entry: dict, index: int) -> str:
    return f"{index:02d}-{re.sub(r'[^a-z0-9]+', '-', (entry['category'] + ' ' + entry['sub_category']).lower()).strip('-')}"


def uses(f: dict) -> str:
    """A preset's features in a few words."""
    words = []
    if f["fields"]:
        words.append("moves by place (" + ", ".join(f["fields"]) + ")")
    if f["warp_shader"]:
        words.append("warp shader")
    if f["comp_shader"]:
        words.append("composite shader")
    if f["blur"]:
        words.append("blur")
    if f["echo"]:
        words.append("echo")
    if f["waveform"]:
        words.append(f"waveform {f['wave_mode']}")
    if f["custom_waves"]:
        words.append(f"{f['custom_waves']} custom wave{'s' if f['custom_waves'] > 1 else ''}")
    if f["custom_shapes"]:
        words.append(f"{f['custom_shapes']} shape{'s' if f['custom_shapes'] > 1 else ''}" + (f", {f['textured_shapes']} textured with the frame" if f["textured_shapes"] else ""))
    if f["borders"]:
        words.append("borders")
    if f["motion_vectors"]:
        words.append("motion vectors")
    return "; ".join(words) or "settings only"


RENDER_TRACKS = ("data/dontstop.mp3", "tools/loop/fixtures/modules/synth-0101.mod")


def render(known: dict, only: int | None = None, seconds: float = 30.0) -> int:
    """projectM's render of each preset in the pool on two tracks, with a contact sheet and the loop's figures.

    A preset projectM cannot load is replaced in the pool by its first alternate
    that loads. Results are kept in .loop/presets/pool.json; clips already there
    are measured again, not rendered again.
    """
    import milkdrop
    import run

    if not milkdrop.PM_RENDER.exists():
        sys.exit("pm_render is not built: run tools/loop/projectm/build.sh")
    base = collection()
    pool = json.loads(POOL.read_text())
    args = argparse.Namespace(width=480, height=270, fps=30, softcut=3.0)
    bundles = {}
    for name in RENDER_TRACKS:
        package_path, audio = milkdrop.bundle(ROOT / name)
        bundles[name] = (json.loads(package_path.read_text()), audio)
    results_path = OUT / "pool.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else {}
    changed = False
    for index, entry in enumerate(pool):
        if only is not None and index != only:
            continue
        name = slug(entry, index)
        figures = {}
        for track in RENDER_TRACKS:
            package, audio = bundles[track]
            length = min(float(package["durationSec"]), seconds)
            clip = OUT / name / f"{Path(track).stem}.mp4"
            if not clip.exists():
                for candidate in [entry["preset"], *entry["alternates"]]:
                    ok, why = milkdrop.render_clip([base / candidate], audio, clip, length, args)
                    if ok:
                        if candidate != entry["preset"]:
                            print(f"      {name}: {Path(entry['preset']).name} would not load ({why}); using {Path(candidate).name}", flush=True)
                            entry["alternates"] = [p for p in entry["alternates"] if p != candidate]
                            entry["preset"], entry["sub_category"] = candidate, Path(candidate).parent.name
                            entry["features"] = known[entry["category"]][candidate]
                            changed = True
                        break
                else:
                    print(f"FAIL  {name}: neither the preset nor its alternates would load ({why})", flush=True)
                    break
                run.contact_sheet(clip, clip.with_suffix(".png"), int(length * args.fps))
            figures[Path(track).stem] = milkdrop.measure(clip, args.fps, package)
        if figures:
            results[name] = dict(preset=entry["preset"], figures=figures)
            m = next(iter(figures.values()))
            print(f"ok    {name:42} speed {m['flow_speed']:.2f} swirl {m['flow_swirl']:.2f} zoom {m['flow_zoom']:.2f} spin {m['flow_spin']:.2f} change {m['change_quarter_s']:.2f} punch {m.get('punch', float('nan')):.1f} wash {m['wash']:.2f}", flush=True)
            results_path.write_text(json.dumps(results, indent=1) + "\n")
    if changed:
        POOL.write_text(json.dumps(pool, indent=1) + "\n")
    return 0


TABLE = ROOT / "docs" / "design" / "preset-pool.md"
COMPARED = (("flow_speed", "speed"), ("flow_swirl", "swirl"), ("punch", "punch"), ("look_change", "look change"), ("wash", "wash"))


def table() -> int:
    """docs/design/preset-pool.md: each preset, the scene made from it, and the two measured side by side.

    The presets' figures are projectM's renders (`presets.py render`); the
    scenes' are the render loop's saved baseline. Both are of the first thirty
    seconds of the same track, measured by the same code.
    """
    pool = json.loads(POOL.read_text())
    theirs = json.loads((OUT / "pool.json").read_text()) if (OUT / "pool.json").exists() else {}
    baseline = Path(__file__).parent / "baseline.json"
    ours = json.loads(baseline.read_text()) if baseline.exists() else {}
    track = Path(RENDER_TRACKS[0]).stem

    def figures(m: dict | None) -> str:
        if not m:
            return "not measured"
        return ", ".join(f"{label} {m[key]:.2f}" for key, label in COMPARED if isinstance(m.get(key), (int, float)) and m[key] == m[key])

    lines = [
        "# The preset pool",
        "",
        "Fifty Milkdrop presets, and the Octoseq scene written from each. This file is",
        "written by `python3 tools/loop/presets.py table`; do not edit it by hand. The",
        "presets, the scenes' names and the notes are in `tools/loop/preset_pool.json`.",
        "",
        "The presets were chosen by rule, not by taste: five from each of the collection's",
        "ten categories, each from a different sub-category, picked to spread across what a",
        "preset can use (`presets.py choose`). Each was rendered by projectM on the loop's",
        "test tracks and looked at before its scene was written. A scene is meant to be",
        "similar or better, not a copy: where a preset was dull, or drew nothing, the note",
        "says what was done instead.",
        "",
        f"Figures are for the first thirty seconds of `{track}`: speed (frame widths a second",
        "where the picture moves), swirl (how far the motion is from one rigid slide, zoom or",
        "turn), punch (how hard the picture jumps on hits), look change (how different it is",
        "from eight seconds before) and wash (how much of the frame is filled with soft",
        "colour). A scene is not required to match its preset's figures, and most punch harder.",
        "",
    ]
    category = None
    for index, entry in enumerate(pool):
        if entry["category"] != category:
            category = entry["category"]
            lines += [f"## {category}", ""]
        scene = entry.get("scene")
        lines += [
            f"### {index:02d}. {entry['sub_category']}: `{scene}`" if scene else f"### {index:02d}. {entry['sub_category']}",
            "",
            f"- Preset: `{entry['preset']}`",
            f"- It uses: {uses(entry['features'])}",
        ]
        if entry.get("saw"):
            lines.append(f"- It looks like: {entry['saw']}")
        if scene:
            lines.append(f"- Scene: [`scenes/{scene}.rhai`](../../scenes/{scene}.rhai); {entry.get('made', '')}")
        lines += [
            f"- Preset measured: {figures((theirs.get(slug(entry, index)) or {}).get('figures', {}).get(track))}",
            f"- Scene measured: {figures(ours.get(f'{track}__{scene}'))}" if scene else "- Scene: not written",
            "",
        ]
    TABLE.write_text("\n".join(lines))
    print(f"wrote {TABLE.relative_to(ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("table", help="write docs/design/preset-pool.md: each preset beside the scene made from it")
    r = sub.add_parser("render", help="projectM's render of each preset in the pool, measured as ours are")
    r.add_argument("--only", type=int, help="only the preset with this number")
    s = sub.add_parser("survey", help="read every preset's features (kept in .loop/presets/survey.json)")
    s.add_argument("--category", help="only this category (for reading the collection a piece at a time)")
    sub.add_parser("choose", help="pick the pool")
    sub.add_parser("summary", help="what the collection and the pool use")
    args = parser.parse_args()

    if args.command == "table":
        return table()
    if args.command == "survey":
        survey(collection(), args.category)
        return 0
    if not SURVEY.exists():
        sys.exit("no survey yet: run `presets.py survey`")
    known = json.loads(SURVEY.read_text())
    if args.command == "render":
        return render(known, args.only)
    if args.command == "choose":
        pool = choose(known)
        # A preset already in the pool keeps the scene made from it and its notes.
        kept = {e["preset"]: e for e in json.loads(POOL.read_text())} if POOL.exists() else {}
        for entry in pool:
            for key in ("scene", "saw", "made"):
                if key in kept.get(entry["preset"], {}):
                    entry[key] = kept[entry["preset"]][key]
        POOL.write_text(json.dumps(pool, indent=1) + "\n")
        for index, entry in enumerate(pool):
            print(f"{slug(entry, index):42} {Path(entry['preset']).name[:60]}")
            print(f"{'':42} {uses(entry['features'])}")
        print(f"{len(pool)} presets written to {POOL.relative_to(ROOT)}")
        return 0
    if args.command == "summary":
        everything = [f for members in known.values() for f in members.values()]
        pool = [e["features"] for e in json.loads(POOL.read_text())] if POOL.exists() else []
        rows = [
            ("moves the frame differently in different places", lambda f: bool(f["fields"]) and f["by_place"]),
            ("warp shader", lambda f: f["warp_shader"]),
            ("composite shader", lambda f: f["comp_shader"]),
            ("blurred copy of the frame", lambda f: f["blur"]),
            ("noise texture", lambda f: f["noise"]),
            ("needs an image file", lambda f: bool(f["textures"])),
            ("video echo", lambda f: f["echo"]),
            ("built-in waveform", lambda f: f["waveform"]),
            ("custom waves", lambda f: f["custom_waves"] > 0),
            ("custom waves fed the spectrum", lambda f: f["spectrum_waves"] > 0),
            ("custom shapes", lambda f: f["custom_shapes"] > 0),
            ("shapes textured with the frame", lambda f: f["textured_shapes"] > 0),
            ("borders", lambda f: f["borders"]),
            ("motion vectors", lambda f: f["motion_vectors"]),
            ("listens to bass, mid or treble", lambda f: bool(f["hears"])),
        ]
        print(f"{'':48} {'collection':>10} {'pool':>6}")
        for label, test in rows:
            share = lambda group: f"{100 * sum(1 for f in group if test(f)) / len(group):.0f}%" if group else "-"  # noqa: E731
            print(f"{label:48} {share(everything):>10} {share(pool):>6}")
        print(f"{'presets':48} {len(everything):>10} {len(pool):>6}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
