#!/usr/bin/env python3
"""The analysis-accuracy loop: does the analysis put musical events at the right times?

    python3 tools/loop/accuracy.py                  # full run, both splits
    python3 tools/loop/accuracy.py --quick          # committed fixtures only, clean audio
    python3 tools/loop/accuracy.py --save-baseline  # accept this run as the baseline

Tracker modules are the ground truth. An instrumented player (tools/loop/modplayer)
renders each module and logs every note it triggers; modref.py turns that into a
reference of what is heard and when. Every analyser in analysers.py is then scored
against the reference on a training split and a held-out split, on clean audio and
through reverb, compression and MP3.

Results go to .loop/accuracy/<name>/report.md and report.json. Exit status is
non-zero if a hard gate fails. No step needs a person.

See docs/loop/README.md.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyse  # noqa: E402
import analysers  # noqa: E402
import corpus  # noqa: E402
import degrade  # noqa: E402
import modref  # noqa: E402
import score  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
CACHE = ROOT / ".loop" / "cache" / "references"
OUT = ROOT / ".loop" / "accuracy"
GATES = HERE / "gates.json"
BASELINE = HERE / "accuracy_baseline.json"
REAL_MUSIC = sorted((ROOT / "data").glob("*.mp3"))
STEM_TRACKS_PER_SPLIT = 3  # separation is slow to score, so only the first few tracks of each split


# ------------------------------------------------------------------ preparation


def prepare(item: dict, variant_names: tuple[str, ...], keep_stems: bool) -> dict:
    """Reference and degraded variants for one module (cached on disk)."""
    reference, work = modref.build_cached(item["path"], CACHE, keep_stems=keep_stems)
    variants = degrade.make(work / "mix.wav", work / "variants", variant_names)
    return dict(item, reference=reference, work=work, variants=variants)


def prepare_safely(job: tuple[dict, tuple[str, ...], bool]) -> dict | str:
    try:
        return prepare(*job)
    except Exception as error:  # noqa: BLE001 - reported by the caller
        return str(error)


def run_analyser(job: tuple[str, str, dict | None]) -> dict:
    name, path, params = job
    result = analysers.ANALYSERS[name](Path(path), params)
    result.pop("stems", None)  # arrays are scored in-process, not shipped between processes
    return result


def analyse_all(names: list[str], tracks: list[dict], variant_names: tuple[str, ...], params: dict | None, pool) -> dict:
    """results[analyser][track id][variant] for every analyser that is not stems-only."""
    jobs, keys = [], []
    for name in names:
        for track in tracks:
            for variant in variant_names:
                jobs.append((name, str(track["variants"][variant]), params if name in analysers.TUNABLE else None))
                keys.append((name, track["id"], variant))
    results: dict = {}
    for (name, track_id, variant), result in zip(keys, pool.map(run_analyser, jobs, chunksize=4)):
        results.setdefault(name, {}).setdefault(track_id, {})[variant] = result
    return results


# ------------------------------------------------------------------ scoring


def score_split(results: dict, tracks: list[dict], variant_names: tuple[str, ...]) -> dict:
    """Scores for one analyser on one split: per variant, plus the mean over variants."""
    out: dict = {"variants": {}}
    for variant in variant_names:
        tallies, beats, sections = [], [], []
        for track in tracks:
            result = results[track["id"]][variant]
            ref = track["reference"]
            if result.get("onsets") is not None:
                tallies.append(score.onset_tallies(ref["merged"], [t for t, _ in result["onsets"]]))
            if result.get("beats") is not None and ref["grid"]["steady_tempo"]:
                beats.append(score.beat_scores(ref["grid"]["beats"], result["beats"], ref["grid"]["bpm"], result.get("bpm") or 0.0))
            if result.get("sections") is not None and len(ref["sections"]) > 1:
                sections.append(score.section_scores(ref["sections"], result["sections"]))
        entry: dict = {}
        if tallies:
            entry["onsets"] = score.onset_summary(score.pool(tallies))
        if beats:
            entry["beats"] = dict(
                f=round(float(np.mean([b["f"] for b in beats])), 4),
                best_f=round(float(np.mean([b["best_f"] for b in beats])), 4),
                tempo_exact=round(float(np.mean([abs(b["tempo_ratio"] - 1) < 0.02 for b in beats])), 4),
                tempo_octave=round(float(np.mean([min(abs(b["tempo_ratio"] * m - 1) for m in (0.5, 1, 2)) < 0.02 for b in beats])), 4),
                tracks=len(beats),
            )  # fmt: skip
        if sections:
            entry["sections"] = {k: round(float(np.mean([s[k] for s in sections])), 4) for k in ("f_0.5s", "f_3s")} | {"tracks": len(sections)}
        out["variants"][variant] = entry
    for part, key in (("onsets", "f"), ("beats", "best_f"), ("sections", "f_3s")):
        values = [v[part][key] for v in out["variants"].values() if part in v]
        if values:
            out[f"{part}_mean"] = round(float(np.mean(values)), 4)
    return out


def reference_stems(track: dict) -> dict[str, np.ndarray]:
    """Drums, bass and other, summed from the true channel stems and resampled for scoring."""
    stems_dir = track["work"] / "stems"
    by_class: dict[str, np.ndarray] = {}
    for channel, cls in track["reference"]["channel_stem"].items():
        audio = analysers.decode(stems_dir / f"ch{int(channel):02d}.wav")
        by_class[cls] = by_class.get(cls, 0) + audio
    return by_class


def score_stems(name: str, tracks: list[dict]) -> dict | None:
    rows = []
    for track in tracks[:STEM_TRACKS_PER_SPLIT]:
        result = analysers.ANALYSERS[name](track["variants"]["clean"], None)
        if result.get("stems") is None:
            return None
        rows.append(score.stem_scores(reference_stems(track), result["stems"]))
    out = {}
    for cls in ("drums", "bass", "other"):
        values = [r[cls] for r in rows if cls in r]
        if values:
            out[cls] = dict(
                si_sdr_db=round(float(np.mean([v["si_sdr_db"] for v in values])), 2),
                improvement_db=round(float(np.mean([v["improvement_db"] for v in values])), 2),
            )  # fmt: skip
    out["mean_improvement_db"] = round(float(np.mean([v["improvement_db"] for v in out.values()])), 2) if out else None
    out["tracks"] = len(rows)
    return out


def real_music_check(names: list[str], params: dict | None, pool) -> dict:
    """Checks on real recordings, which have no ground truth.

    What can be measured without one: whether the detections survive degradation
    (the same events should be found in the MP3 as in the original) and whether
    the density of detections is plausible. A parameter set that scores well on
    modules but falls apart here is overfitted.
    """
    if not REAL_MUSIC:
        return {}
    work = ROOT / ".loop" / "cache" / "real-music"
    out: dict = {}
    for name in names:
        rows = []
        for track in REAL_MUSIC:
            variants = degrade.make(track, work / track.stem)
            jobs = [(name, str(p), params if name in analysers.TUNABLE else None) for p in variants.values()]
            results = dict(zip(variants, pool.map(run_analyser, jobs)))
            if results["clean"].get("onsets") is None:
                break
            clean = np.array([t for t, _ in results["clean"]["onsets"]])
            duration = float(clean.max()) if len(clean) else 1.0
            agreement = []
            for variant, result in results.items():
                if variant != "clean":
                    agreement.append(score._f(clean, np.array([t for t, _ in result["onsets"]]), score.ONSET_TOLERANCE_S)[2])
            rows.append(dict(agreement=float(np.mean(agreement)), per_second=len(clean) / max(duration, 1.0)))
        if rows:
            out[name] = dict(
                agreement=round(float(np.mean([r["agreement"] for r in rows])), 4),
                onsets_per_second=round(float(np.mean([r["per_second"] for r in rows])), 2),
                tracks=len(rows),
            )  # fmt: skip
    return out


# ------------------------------------------------------------------ instrument checks


def instrument_checks(tracks: list[dict], check_determinism: bool) -> list[dict]:
    """Checks on the measuring equipment itself, using synthetic modules whose answers are known."""
    checks = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append(dict(name=name, ok=bool(ok), detail=detail))

    problems = corpus.check_fixtures()
    add("committed fixtures are intact and reproducible", not problems, "; ".join(problems) or "ok")

    worst = max((t["reference"]["stem_residual_db"] for t in tracks), default=-200.0)
    add("channel stems add up to the mix", worst < -60.0, f"worst residual {worst:.0f} dB")

    synthetic = [t for t in tracks if t["truth"]]
    trigger_ok, class_ok, heard_ok, kind_ok, section_f = [], [], [], [], []
    expect_stem = dict(kick="drums", snare="drums", hat="drums", clap="drums", late="drums", bass="bass", lead="other", pad="other", swell="other")
    for t in synthetic:
        truth = json.loads(t["truth"].read_text())
        ref = t["reference"]
        log = json.loads((t["work"] / "events.json").read_text())
        expected = sorted((x["t"], x["channel"], x["sample"]) for x in truth["triggers"])
        logged = sorted((x["t"], x["channel"], x["sample"]) for x in log["notes"])
        trigger_ok.append(expected == logged)
        role = {s["number"]: s for s in truth["samples"]}
        seen = {}
        for e in ref["events"]:
            seen.setdefault(role[e["sample"]]["role"], e["stem"])
        class_ok.append(all(expect_stem[r] == c for r, c in seen.items()))
        for e in ref["events"]:
            sample = role[e["sample"]]
            if not e["audible"] or e["kind"] == "legato":
                continue
            if sample["role"] == "late":
                # The sample starts with a known stretch of silence, scaled by how fast it is played.
                log_note = next(n for n in log["notes"] if n["t"] == round(e["trigger"] * ref["sample_rate"]) and n["channel"] == e["channel"])
                lead_in = sample["lead_in_s"] * modgen_base_rate() / log_note["playback_rate"]
                heard_ok.append(abs((e["onset"] - e["trigger"]) - lead_in) < 0.003)
            if sample["role"] in ("kick", "snare", "hat"):
                kind_ok.append(e["kind"] == "percussive")
            if sample["role"] in ("pad", "swell"):
                kind_ok.append(e["kind"] == "soft")
        truth_times = np.array([s["start"] for s in truth["sections"] if s["start"] > 1.0])
        ref_times = np.array([s["time"] for s in ref["sections"] if s["time"] > 1.0])
        section_f.append(score._f(truth_times, ref_times, 0.5)[2])
    if synthetic:
        add("event log matches independently computed triggers", all(trigger_ok), f"{sum(trigger_ok)}/{len(trigger_ok)} modules exact")
        add("heard onset of a sample with leading silence", bool(heard_ok) and float(np.mean(heard_ok)) > 0.98, f"{np.mean(heard_ok) * 100:.1f}% within 3 ms" if heard_ok else "no cases")
        add("percussive and soft attacks labelled correctly", float(np.mean(kind_ok)) > 0.97, f"{np.mean(kind_ok) * 100:.1f}% correct")
        add("drums, bass and other assigned correctly", all(class_ok), f"{sum(class_ok)}/{len(class_ok)} modules")
        add("order-list sections agree with composed sections", float(np.mean(section_f)) >= 0.8, f"mean F {np.mean(section_f):.2f}")

    # The scorer itself: perfect detections must score perfectly, shifted ones must show the shift.
    if tracks:
        merged = tracks[0]["reference"]["merged"]
        times = [e["steepest"] for e in merged]
        perfect = score.onset_summary(score.onset_tallies(merged, times))
        shifted = score.onset_summary(score.onset_tallies(merged, [t + 0.020 for t in times]))
        add("scorer gives a perfect score to perfect detections", perfect["f"] > 0.999 and abs(perfect["timing"]["bias_ms"]) < 0.01, f"F {perfect['f']}, bias {perfect['timing']['bias_ms']} ms")
        add("scorer measures a known 20 ms delay", abs(shifted["timing"]["bias_ms"] - 20.0) < 0.5, f"measured {shifted['timing']['bias_ms']} ms")

    offsets = []
    for t in tracks[:4]:
        for name, path in t["variants"].items():
            if name != "clean":
                offsets.append((abs(degrade.alignment_ms(t["variants"]["clean"], path)), name))
    if offsets:
        worst_offset = max(offsets)
        add("degraded variants stay aligned with the original", worst_offset[0] <= 2.0, f"worst shift {worst_offset[0]:.2f} ms ({worst_offset[1]})")

    engine = ROOT / "packages" / "visualiser" / "target" / "release" / "visualiser"
    scene = ROOT / "example-scripts" / "01-spectral-flower.rhai"
    if synthetic and engine.exists() and scene.exists():
        import perfect_bundle

        bundle = perfect_bundle.build(synthetic[0]["path"])
        frames = bundle / "check-frames"
        cmd = [str(engine), "render", "--package", str(bundle / "package.json"), "--script", str(scene), "--out", str(frames),
               "--fps", "10", "--width", "160", "--height", "90", "--duration", "1", "--quiet"]  # fmt: skip
        result = subprocess.run(cmd, capture_output=True, text=True)
        rendered = len(list(frames.glob("frame_*.png"))) if frames.exists() else 0
        subprocess.run(["rm", "-rf", str(frames)], check=False)
        add("engine renders a scene from a perfect bundle", result.returncode == 0 and rendered > 0, f"{rendered} frames" if result.returncode == 0 else result.stderr.strip()[-200:])

    if check_determinism and tracks:
        t = tracks[0]
        again = t["work"].parent / (t["work"].name + "-again")
        modref.render(t["path"], again, stems=True)
        same = modref.sha256(again / "mix.wav") == modref.sha256(t["work"] / "mix.wav") and (again / "events.json").read_bytes() == (t["work"] / "events.json").read_bytes()
        subprocess.run(["rm", "-rf", str(again)], check=False)
        add("module rendering is deterministic", same, "two renders identical" if same else "two renders differ")
    return checks


def modgen_base_rate() -> float:
    from modgen import BASE_RATE

    return float(BASE_RATE)


# ------------------------------------------------------------------ gates and report


def choose(scores: dict) -> dict:
    """The best analyser for each part, judged on the held-out split."""
    chosen = {}
    for part, key in (("onsets", "onsets_mean"), ("beats", "beats_mean"), ("sections", "sections_mean")):
        candidates = {name: s["heldout"][key] for name, s in scores.items() if key in s.get("heldout", {})}
        if candidates:
            best = max(candidates, key=candidates.get)
            chosen[part] = dict(analyser=best, score=candidates[best], candidates=candidates)
    stems = {name: s["stems"]["mean_improvement_db"] for name, s in scores.items() if s.get("stems") and s["stems"].get("mean_improvement_db") is not None}
    if stems:
        best = max(stems, key=stems.get)
        chosen["stems"] = dict(analyser=best, score=stems[best], candidates=stems)
    return chosen


def evaluate_gates(report: dict, gates: dict, baseline: dict | None) -> tuple[list[str], list[str]]:
    hard = [f"instrument check failed: {c['name']} ({c['detail']})" for c in report["instrument_checks"] if not c["ok"]]
    target = []
    chosen = report["chosen"]
    if "onsets" in chosen:
        best = report["scores"][chosen["onsets"]["analyser"]]["heldout"]["variants"]
        clean = best.get("clean", {}).get("onsets")
        if clean:
            limit = gates["onset_bias_ms"]["max"]
            for kind in ("percussive", "soft"):
                bias = clean["kinds"].get(kind, {}).get("timing", {}).get("bias_ms")
                if bias is not None and abs(bias) > limit:
                    target.append(f"held-out {kind} onset bias {bias:+.1f} ms exceeds {limit} ms (one 60 fps frame)")
            for kind in ("percussive", "soft"):
                recall = clean["kinds"].get(kind, {}).get("recall")
                if recall is not None and recall < gates[f"{kind}_recall"]["min"]:
                    target.append(f"held-out {kind} recall {recall:.3f} below {gates[f'{kind}_recall']['min']}")
            if clean["f"] < gates["onset_f"]["min"]:
                target.append(f"held-out onset F {clean['f']:.3f} below {gates['onset_f']['min']}")
    if "beats" in chosen and chosen["beats"]["score"] < gates["beat_f"]["min"]:
        target.append(f"held-out beat F {chosen['beats']['score']:.3f} below {gates['beat_f']['min']}")
    if "sections" in chosen and chosen["sections"]["score"] < gates["section_f"]["min"]:
        target.append(f"held-out section F {chosen['sections']['score']:.3f} below {gates['section_f']['min']}")
    if baseline:
        drop = gates["regression"]["max_drop"]
        for part, entry in chosen.items():
            before = baseline.get("chosen", {}).get(part, {}).get("score")
            if before is not None and entry["score"] < before - (drop if part != "stems" else 1.0):
                hard.append(f"{part} regressed: best held-out score {entry['score']} was {before} in the baseline")
    return hard, target


def write_report(run_dir: Path, report: dict) -> None:
    lines = [f"# Accuracy run `{run_dir.name}`", ""]
    c = report["corpus"]
    lines.append(f"Corpus: {c['train']} training and {c['heldout']} held-out modules ({c['sources']}). Variants: {', '.join(report['variants'])}.")
    lines += ["", "## Instrument checks", ""]
    for check in report["instrument_checks"]:
        lines.append(f"- {'ok' if check['ok'] else '**FAIL**'}: {check['name']} ({check['detail']})")
    lines += ["", "## Held-out scores", "", "Onsets (clean audio; timing is detection minus the reference's steepest rise):", ""]
    lines.append("| Analyser | F | Precision | Recall | Percussive bias | Percussive spread | Soft bias | Soft recall | F through reverb / compression / MP3 |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for name, s in report["scores"].items():
        variants = s.get("heldout", {}).get("variants", {})
        o = variants.get("clean", {}).get("onsets")
        if not o:
            continue
        perc, soft = o["kinds"].get("percussive", {}), o["kinds"].get("soft", {})

        def ms(v):
            return "–" if v is None else f"{v:+.1f} ms"

        degraded = " / ".join(f"{variants[v]['onsets']['f']:.3f}" if v in variants and "onsets" in variants[v] else "–" for v in ("reverb", "compress", "mp3"))
        lines.append(
            f"| {name} | {o['f']:.3f} | {o['precision']:.3f} | {o['recall']:.3f} | {ms(perc.get('timing', {}).get('bias_ms'))} | "
            f"{ms(perc.get('timing', {}).get('spread_ms'))} | {ms(soft.get('timing', {}).get('bias_ms'))} | {soft.get('recall')} | {degraded} |"
        )
    lines += ["", "Other parts (held-out, mean over variants):", "", "| Analyser | Beat F | Beat F (any level) | Tempo right (allowing octave) | Section F at 3 s | Stem improvement |", "|---|---|---|---|---|---|"]
    for name, s in report["scores"].items():
        clean = s.get("heldout", {}).get("variants", {}).get("clean", {})
        beats, sections, stems = clean.get("beats"), clean.get("sections"), s.get("stems")
        if not (beats or sections or stems):
            continue
        lines.append(
            f"| {name} | {beats['f'] if beats else '–'} | {beats['best_f'] if beats else '–'} | {beats['tempo_octave'] if beats else '–'} | "
            f"{sections['f_3s'] if sections else '–'} | {str(stems['mean_improvement_db']) + ' dB' if stems else '–'} |"
        )
    lines += ["", "## Chosen analyser per part", ""]
    for part, entry in report["chosen"].items():
        lines.append(f"- **{part}**: `{entry['analyser']}` ({entry['score']}); candidates {entry['candidates']}")
    if report.get("real_music"):
        lines += ["", "## Real-music check (no ground truth)", ""]
        for name, r in report["real_music"].items():
            lines.append(f"- `{name}`: {r['agreement']:.3f} agreement between original and degraded audio, {r['onsets_per_second']} onsets per second")
    lines += ["", "## Gates", ""]
    lines += [f"- **FAIL** {p}" for p in report["hard"]] + [f"- target missed: {p}" for p in report["target"]]
    if not report["hard"] and not report["target"]:
        lines.append("All gates passed.")
    (run_dir / "report.md").write_text("\n".join(lines) + "\n")
    (run_dir / "report.json").write_text(json.dumps(report, indent=1))


def run(args, params: dict | None = None, pool=None) -> dict:
    variant_names = ("clean",) if args.quick else tuple(degrade.VARIANTS)
    sources = ("synthetic",) if args.quick else ("synthetic", "downloaded", "local")
    names = args.analysers or list(analysers.ANALYSERS)
    own_pool = pool is None
    pool = pool or ProcessPoolExecutor(max_workers=args.jobs)
    try:
        splits = {}
        for split in ("train", "heldout"):
            items = corpus.load(split, sources)
            if args.quick:
                items = [i for i in items if int(i["id"].split("-")[1]) in corpus.FIXTURE_SEEDS]
            ready = []
            jobs = [(item, variant_names, index < STEM_TRACKS_PER_SPLIT and not args.quick) for index, item in enumerate(items)]
            for item, result in zip(items, pool.map(prepare_safely, jobs)):
                if isinstance(result, str):  # a module the player cannot render is skipped, loudly
                    print(f"skipping {item['id']}: {result}", file=sys.stderr)
                else:
                    ready.append(result)
            # Very short or empty modules tell us nothing.
            splits[split] = [t for t in ready if len(t["reference"]["merged"]) >= 20 and not t["reference"]["truncated"]]
        all_tracks = splits["train"] + splits["heldout"]

        scores: dict = {}
        timed = [n for n in names if n != "bandsplit"]
        for split, tracks in splits.items():
            results = analyse_all(timed, tracks, variant_names, params, pool)
            for name in timed:
                scores.setdefault(name, {})[split] = score_split(results[name], tracks, variant_names)
        if not args.quick:
            for name in names:
                stems = score_stems(name, splits["heldout"]) if name == "bandsplit" else None
                if stems:
                    scores.setdefault(name, {})["stems"] = stems

        report = dict(
            name=args.name,
            params=params or analyse.load_params(),
            variants=list(variant_names),
            corpus=dict(
                train=len(splits["train"]), heldout=len(splits["heldout"]),
                sources=", ".join(f"{sum(t['source'] == s for t in all_tracks)} {s}" for s in sources),
            ),
            instrument_checks=instrument_checks(all_tracks, check_determinism=True),
            scores=scores,
            chosen=choose(scores),
            real_music={} if args.quick else real_music_check([n for n in timed if n in ("standin", "energy")], params, pool),
        )  # fmt: skip
    finally:
        if own_pool:
            pool.shutdown()
    gates = json.loads(GATES.read_text())["accuracy"]
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() and not args.quick else None
    report["hard"], report["target"] = evaluate_gates(report, gates, baseline)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--quick", action="store_true", help="committed fixtures only, clean audio, no stems")
    parser.add_argument("--analysers", nargs="+", choices=list(analysers.ANALYSERS))
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()

    report = run(args)
    run_dir = OUT / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    write_report(run_dir, report)
    for check in report["instrument_checks"]:
        print(f"{'ok  ' if check['ok'] else 'FAIL'} {check['name']} ({check['detail']})")
    for part, entry in report["chosen"].items():
        print(f"best {part}: {entry['analyser']} ({entry['score']})")
    for problem in report["hard"]:
        print(f"FAIL {problem}")
    for problem in report["target"]:
        print(f"target missed: {problem}")
    print(f"\nreport: {(run_dir / 'report.md').relative_to(ROOT)}")
    if args.save_baseline:
        BASELINE.write_text(json.dumps(dict(chosen=report["chosen"], corpus=report["corpus"], params=report["params"]), indent=2) + "\n")
        print(f"baseline saved to {BASELINE.relative_to(ROOT)}")
    return 1 if report["hard"] else 0


if __name__ == "__main__":
    sys.exit(main())
