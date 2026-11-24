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
import multiprocessing
import shutil
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
import stems as stem_sources  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
CACHE = ROOT / ".loop" / "cache" / "references"
OUT = ROOT / ".loop" / "accuracy"
GATES = HERE / "gates.json"
BASELINE = HERE / "accuracy_baseline.json"
REAL_MUSIC = sorted((ROOT / "data").glob("*.mp3"))
# Stems are scored on a few held-out modules of each kind: separation is slow, and the
# hosted sources bill by the minute. See stem_tracks() for how they are picked.
STEM_TRACKS = {"synthetic": 3, "downloaded": 5}
STEM_MAX_SECONDS = 240.0
STEM_MIN_PURITY = 0.98  # share of a module's sound that sits on a channel of its own stem class
HOSTED_SCORES = HERE / "hosted_stem_scores.json"  # what the paid sources scored, so a machine without keys can still report it
DEFAULT_GPU_WORKERS = 3  # for a model analysers.GPU_WORKERS does not list
RESULTS = ROOT / ".loop" / "cache" / "model-results"  # what model analysers returned, by audio checksum
USER_STEMS_MIN_DB = 40.0  # true stems handed back through the stem interface must come out at least this intact
MAX_STEM_RESIDUAL_DB = -60.0  # a module whose channel stems do not add up to its mix this well is left out


def usable(track: dict) -> bool:
    """Whether a prepared module can serve as ground truth.

    Left out: near-empty modules, modules that never end, and the few whose
    per-channel renders do not add up to the full mix (the player's behaviour
    then depends on which channels are muted, so its stems cannot be trusted).
    """
    ref = track["reference"]
    return len(ref["merged"]) >= 20 and not ref["truncated"] and ref["stem_residual_db"] < MAX_STEM_RESIDUAL_DB


# ------------------------------------------------------------------ preparation


def prepare(item: dict, variant_names: tuple[str, ...], keep_stems: bool) -> dict:
    """Reference and degraded variants for one module (cached on disk)."""
    reference, work = modref.build_cached(item["path"], CACHE, keep_stems=keep_stems)
    variants = degrade.make(work / modref.MIX, work / "variants", variant_names)
    return dict(item, reference=reference, work=work, variants=variants)


def prepare_safely(job: tuple[dict, tuple[str, ...], bool]) -> dict | str:
    try:
        return prepare(*job)
    except Exception as error:  # noqa: BLE001 - reported by the caller
        return str(error)


def fresh_workers(count: int) -> ProcessPoolExecutor:
    """Workers started from scratch rather than forked, for anything that may use the GPU.

    A forked worker cannot use CUDA if its parent has, and the main process never
    should: it would hold GPU memory for the whole run.
    """
    return ProcessPoolExecutor(max_workers=count, mp_context=multiprocessing.get_context("spawn"))


def worker_device() -> str:
    try:
        return analysers.model_device()
    except ImportError:
        return "cpu"


def run_analyser(job: tuple[str, str, dict | None]) -> dict:
    name, path, params = job
    stored = None
    if name in analysers.MODELS:
        # A model's answer for a given file never changes and is slow to get: keep it.
        key = modref.sha256(Path(path))[:24]
        stored = RESULTS / name / analysers.result_version(name) / f"{key}.json"
        if stored.exists():
            return json.loads(stored.read_text())
    result = analysers.ANALYSERS[name](Path(path), params)
    result.pop("stems", None)  # arrays are scored in-process, not shipped between processes
    if stored is not None:
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_text(json.dumps(result))
    return result


def analyse_all(names: list[str], tracks: list[dict], variant_names: tuple[str, ...], params: dict | None, pool) -> dict:
    """results[analyser][track id][variant] for every analyser that is not stems-only."""
    jobs, keys = [], []
    results: dict = {}
    for name in names:
        for index, track in enumerate(tracks):
            for variant in variant_names:
                if name in analysers.SAMPLED and (variant != "clean" or index % analysers.SAMPLE_EVERY):
                    results.setdefault(name, {}).setdefault(track["id"], {})[variant] = {}
                    continue
                jobs.append((name, str(track["variants"][variant]), params if name in analysers.TUNABLE else None))
                keys.append((name, track["id"], variant))
    for (name, track_id, variant), result in zip(keys, pool.map(run_analyser, jobs, chunksize=4)):
        results.setdefault(name, {}).setdefault(track_id, {})[variant] = result
    return results


# ------------------------------------------------------------------ scoring


def score_split(results: dict, tracks: list[dict], variant_names: tuple[str, ...]) -> dict:
    """Scores for one analyser on one split: per variant, plus the mean over variants."""
    out: dict = {"variants": {}}
    for variant in variant_names:
        tallies, beats, sections, downbeats, drums = [], [], [], [], []
        for track in tracks:
            result = results[track["id"]][variant]
            ref = track["reference"]
            if result.get("drums") is not None:
                drums.append(score.drum_tallies(ref["drums"], result["drums"]))
            if result.get("onsets") is not None:
                tallies.append(score.onset_tallies(ref["merged"], [t for t, _ in result["onsets"]], kinds=result.get("kinds")))
            if result.get("beats") is not None and len(ref["grid"]["beats"]) > 8:
                b = score.beat_scores(ref["grid"]["beats"], result["beats"], ref["grid"]["bpm"], result.get("bpm") or 0.0)
                b["steady"] = ref["grid"]["steady_tempo"]
                beats.append(b)
                if result.get("downbeats") and len(ref["grid"]["downbeats"]) > 4:
                    downbeats.append(score._f(np.array(ref["grid"]["downbeats"]), np.array(result["downbeats"]), score.BEAT_TOLERANCE_S)[2])
            if result.get("sections") is not None and len(ref["sections"]) > 1:
                sections.append(score.section_scores(ref["sections"], result["sections"]))
        entry: dict = {}
        if tallies:
            entry["onsets"] = score.onset_summary(score.pool(tallies))
        if beats:
            # Tempo is only well defined where the reference grid is regular. Beat F is
            # scored on every module, including those with short bars or tempo slides.
            steady = [b for b in beats if b["steady"]] or beats
            irregular = [b for b in beats if not b["steady"]]
            entry["beats"] = dict(
                f=round(float(np.mean([b["f"] for b in beats])), 4),
                best_f=round(float(np.mean([b["best_f"] for b in beats])), 4),
                best_f_steady=round(float(np.mean([b["best_f"] for b in steady])), 4),
                best_f_irregular=round(float(np.mean([b["best_f"] for b in irregular])), 4) if irregular else None,
                tempo_exact=round(float(np.mean([abs(b["tempo_ratio"] - 1) < 0.02 for b in steady])), 4),
                tempo_octave=round(float(np.mean([min(abs(b["tempo_ratio"] * m - 1) for m in (1 / 3, 0.5, 1, 2, 3)) < 0.02 for b in steady])), 4),
                tracks=len(beats), irregular_tracks=len(irregular),
                downbeat_f=round(float(np.mean(downbeats)), 4) if downbeats else None,
            )  # fmt: skip
        if sections:
            entry["sections"] = {k: round(float(np.mean([s[k] for s in sections])), 4) for k in ("f_0.5s", "f_3s")} | {"tracks": len(sections)}
        if drums and (summary := score.drum_summary(drums)):
            entry["drums"] = summary | {"tracks": len(drums)}
        out["variants"][variant] = entry
    for part, key in (("onsets", "f"), ("beats", "best_f"), ("sections", "f_3s"), ("drums", "mean_f")):
        values = [v[part][key] for v in out["variants"].values() if part in v]
        if values:
            out[f"{part}_mean"] = round(float(np.mean(values)), 4)
    if "drums" in out["variants"].get("clean", {}):
        # Drum analysers are compared on clean audio, the one variant all of them are run on.
        out["drums_clean"] = out["variants"]["clean"]["drums"]["mean_f"]
    return out


def reference_stems(track: dict) -> dict[str, np.ndarray]:
    """Drums, bass and other, summed from the true channel stems and resampled for scoring."""
    stems_dir = Path(track["work"]) / "stems"
    by_class: dict[str, np.ndarray] = {}
    for channel, cls in track["reference"]["channel_stem"].items():
        audio = analysers.decode(stems_dir / f"ch{int(channel):02d}.wav")
        by_class[cls] = by_class.get(cls, 0) + audio
    return by_class


def stem_tracks(tracks: list[dict], variant_names: tuple[str, ...]) -> list[dict]:
    """The held-out modules the stem sources are scored on, with their true stems kept.

    A fixed few of each kind, picked by what the reference says about the module
    and never by how any source does on it: the first ones that have all of drums,
    bass and other, keep each to its own channels, and are short enough to keep
    the hosted sources cheap.
    """
    chosen = []
    for source, count in STEM_TRACKS.items():
        fits = [
            t for t in tracks
            if t["source"] == source
            and {"drums", "bass", "other"} <= set(t["reference"]["channel_stem"].values())
            and t["reference"]["duration"] <= STEM_MAX_SECONDS
            and stem_purity(t["reference"]) >= STEM_MIN_PURITY
        ]  # fmt: skip
        chosen += fits[:count]
    return [prepare(track, variant_names, keep_stems=True) for track in chosen]


def stem_purity(reference: dict) -> float:
    """How much of what is heard sits on a channel of its own stem class, by loudness.

    True stems are whole channels. A module that plays a kick and a bass line on
    the same channel has no true drum stem to score against, however it is cut.
    """
    own = total = 0.0
    for event in reference["events"]:
        if event["audible"]:
            loudness = event.get("loudness", 0.0)
            total += loudness
            if event["stem"] == reference["channel_stem"].get(str(event["channel"])):
                own += loudness
    return own / total if total else 0.0


def supply_true_stems(track: dict) -> None:
    """Lay a module's true stems out the way a user would supply their own: labelled files beside the track."""
    work = Path(track["work"])
    directory = (work / modref.MIX).with_suffix(".stems")
    classes = sorted(set(track["reference"]["channel_stem"].values()))
    if all((directory / f"{cls}.flac").exists() for cls in classes):
        return
    directory.mkdir(exist_ok=True)
    for cls in classes:
        total = 0
        for channel, channel_class in track["reference"]["channel_stem"].items():
            if channel_class == cls:
                total = total + np.asarray(modref.read_wav(work / "stems" / f"ch{int(channel):02d}.wav"), dtype=np.float32)
        stem_sources.write_flac(directory / f"{cls}.flac", total, rate=track["reference"]["sample_rate"])


def fold(estimate: dict[str, np.ndarray], names: set[str]) -> dict[str, np.ndarray]:
    """Stems the reference has no class for (vocals, guitar and so on) belong to its `other`."""
    out = {name: audio for name, audio in estimate.items() if name in names}
    extra = [audio for name, audio in estimate.items() if name not in names]
    if extra and "other" in names:
        parts = extra + ([out["other"]] if "other" in out else [])
        n = min(len(p) for p in parts)
        out["other"] = np.sum([p[:n] for p in parts], axis=0)
    return out


def stem_job(job: tuple[str, dict]) -> dict:
    """Separate one module with one source and score it against the true stems.

    Runs in the stem worker: a process of its own, so a model can hold the GPU
    without the main process ever starting CUDA.
    """
    name, track = job
    try:
        reference = reference_stems(track)
        if name in analysers.REFERENCE_FED:
            supply_true_stems(track)
        result = analysers.ANALYSERS[name](Path(track["work"]) / modref.MIX, None)
        if result.get("stems") is None:
            return dict(not_run="produces no stems")
        return dict(scores=score.stem_scores(reference, fold(result["stems"], set(reference))), detail=result.get("stem_detail"))
    except stem_sources.Unavailable as error:
        return dict(not_run=str(error))
    except stem_sources.StemError as error:
        return dict(failed=str(error))


def score_stems(name: str, tracks: list[dict], stem_pool) -> dict:
    """One source's scores over the stem tracks: per stem, per kind of module, and overall.

    A hosted source that cannot run here (no key) is given the scores recorded the
    last time it did run on the same module and reference, if there are any.
    """
    slim = [dict(id=t["id"], source=t["source"], work=str(t["work"]), reference={k: t["reference"][k] for k in ("channel_stem", "sample_rate")}) for t in tracks]
    results = list(stem_pool.map(stem_job, [(name, t) for t in slim]))
    recorded = json.loads(HOSTED_SCORES.read_text()) if HOSTED_SCORES.exists() else {}
    before = json.dumps(recorded, sort_keys=True)
    # Scores recorded against an older reference say nothing about this one.
    mine = recorded[name] = {k: v for k, v in recorded.get(name, {}).items() if k.endswith(modref.REFERENCE_VERSION)}
    from_record = False
    if name in analysers.HOSTED:
        for track, result in zip(tracks, results):
            key = track["work"].name  # module, its checksum and the reference version
            if "scores" in result:
                mine[key] = result["scores"]
            elif "not_run" in result and key in mine:
                result.clear()
                result["scores"] = mine[key]
                from_record = True
        if json.dumps(recorded, sort_keys=True) != before:
            HOSTED_SCORES.write_text(json.dumps({k: v for k, v in sorted(recorded.items()) if v}, indent=1, sort_keys=True) + "\n")
    for key in ("failed", "not_run"):
        problems = [r[key] for r in results if key in r]
        if problems:
            return {key: problems[0]}
    rows = [r["scores"] for r in results]
    out: dict = {}
    for cls in ("drums", "bass", "other"):
        values = [r[cls] for r in rows if cls in r]
        if values:
            out[cls] = dict(
                si_sdr_db=round(float(np.mean([v["si_sdr_db"] for v in values])), 2),
                improvement_db=round(float(np.mean([v["improvement_db"] for v in values])), 2),
            )  # fmt: skip
    out["mean_improvement_db"] = round(float(np.mean([v["improvement_db"] for v in out.values()])), 2) if out else None
    for source in STEM_TRACKS:
        values = [v["improvement_db"] for t, r in zip(tracks, rows) if t["source"] == source for v in r.values()]
        if values:
            out[f"{source}_improvement_db"] = round(float(np.mean(values)), 2)
    out["worst_si_sdr_db"] = round(float(min(v["si_sdr_db"] for r in rows for v in r.values())), 2)
    out["tracks"] = len(rows)
    out["per_track"] = {t["id"]: r for t, r in zip(tracks, rows)}
    if from_record:
        out["recorded"] = True
    detail = next((r.get("detail") for r in results if r.get("detail")), None)
    if detail:
        out["detail"] = {k: v for k, v in detail.items() if k in ("provider", "model", "models", "splitter", "endpoint", "device", "workflow")}
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
    trigger_ok, class_ok, heard_ok, kind_ok, section_f, drum_ok = [], [], [], [], [], []
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
        drum_ok += [ref["drum_samples"].get(str(number)) == s["role"] for number, s in role.items() if s["role"] in score.DRUM_TYPES and str(number) in ref["drum_samples"]]
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
        add("synthetic kicks, snares and hats typed correctly", bool(drum_ok) and all(drum_ok), f"{sum(drum_ok)}/{len(drum_ok)} samples")

    # Drum types again, against something independent of the audio: what the module's author called the sample.
    named = [
        (kind, by_name)
        for t in tracks
        for number, kind in t["reference"]["drum_samples"].items()
        if (by_name := modref.drum_by_name(t["reference"]["sample_names"], int(number))) is not None
    ]
    if len(named) >= 20:
        agree = float(np.mean([kind == by_name for kind, by_name in named]))
        add("drum types agree with what the samples are called", agree >= 0.85, f"{agree * 100:.0f}% of {len(named)} named kicks, snares and hats")

    # The scorer itself: perfect detections must score perfectly, shifted ones must show the shift.
    if tracks:
        merged = tracks[0]["reference"]["merged"]
        times = [e[score.PRIMARY] for e in merged]
        perfect = score.onset_summary(score.onset_tallies(merged, times))
        shifted = score.onset_summary(score.onset_tallies(merged, [t + 0.010 for t in times]))
        add("scorer gives a perfect score to perfect detections", perfect["f"] > 0.999 and abs(perfect["timing"]["bias_ms"]) < 0.01, f"F {perfect['f']}, bias {perfect['timing']['bias_ms']} ms")
        add("scorer measures a known 10 ms delay", abs(shifted["timing"]["bias_ms"] - 10.0) < 0.25, f"measured {shifted['timing']['bias_ms']} ms")

    offsets = []
    for t in tracks[:4]:
        for name, path in t["variants"].items():
            if name != "clean":
                offsets.append((abs(degrade.alignment_ms(t["variants"]["clean"], path)), name))
    if offsets:
        worst_offset = max(offsets)
        add("degraded variants stay aligned with the original", worst_offset[0] <= 2.0, f"worst shift {worst_offset[0]:.2f} ms ({worst_offset[1]})")

    engine = ROOT / "packages" / "visualiser" / "target" / "release" / ("visualiser" + modref.EXE)
    scene = ROOT / "scenes" / "pulse.rhai"
    if synthetic and engine.exists() and scene.exists():
        import perfect_bundle

        bundle = perfect_bundle.build(synthetic[0]["path"])
        frames = bundle / "check-frames"

        def render(script: Path) -> tuple[subprocess.CompletedProcess, int]:
            cmd = [str(engine), "render", "--package", str(bundle / "package.json"), "--script", str(script), "--out", str(frames),
                   "--fps", "10", "--width", "160", "--height", "90", "--duration", "1", "--quiet"]  # fmt: skip
            result = subprocess.run(cmd, capture_output=True, text=True)
            rendered = len(list(frames.glob("frame_*.png"))) if frames.exists() else 0
            shutil.rmtree(frames, ignore_errors=True)
            return result, rendered

        result, rendered = render(scene)
        add("engine renders a scene from a perfect bundle", result.returncode == 0 and rendered > 0, f"{rendered} frames" if result.returncode == 0 else result.stderr.strip()[-200:])
        # Roles: a scene that reads only roles renders, and one that needs a role no bundle has is refused by name.
        result, rendered = render(HERE / "fixtures" / "scenes" / "role-check.rhai")
        add("engine binds a bundle's roles to a scene", result.returncode == 0 and rendered > 0, f"{rendered} frames" if result.returncode == 0 else result.stderr.strip()[-200:])
        result, rendered = render(HERE / "fixtures" / "scenes" / "needs-missing-role.rhai")
        refused = result.returncode != 0 and rendered == 0 and "needs the role `vocal_presence`" in result.stderr
        add("engine refuses a scene whose role the bundle lacks", refused, "refused, naming the role" if refused else f"exit {result.returncode}, {rendered} frames: {result.stderr.strip()[-160:]}")

    if check_determinism and tracks:
        t = tracks[0]
        first, again = (t["work"].parent / (t["work"].name + suffix) for suffix in ("-check-a", "-check-b"))
        for directory in (first, again):
            modref.render(t["path"], directory, stems=True)
        same = all(modref.sha256(first / name) == modref.sha256(again / name) for name in ("mix.wav", "events.json", "stems/ch00.wav"))
        for directory in (first, again):
            shutil.rmtree(directory, ignore_errors=True)
        add("module rendering is deterministic", same, "two renders identical" if same else "two renders differ")
    return checks


def modgen_base_rate() -> float:
    from modgen import BASE_RATE

    return float(BASE_RATE)


# ------------------------------------------------------------------ gates and report


def choose(scores: dict) -> dict:
    """The best analyser for each part, judged on the held-out split."""
    chosen = {}
    for part, key in (("onsets", "onsets_mean"), ("beats", "beats_mean"), ("sections", "sections_mean"), ("drums", "drums_clean")):
        candidates = {name: s["heldout"][key] for name, s in scores.items() if key in s.get("heldout", {})}
        if candidates:
            best = max(candidates, key=candidates.get)
            chosen[part] = dict(analyser=best, score=candidates[best], candidates=candidates)
    stems = {
        name: s["stems"]["mean_improvement_db"]
        for name, s in scores.items()
        if name not in analysers.REFERENCE_FED and s.get("stems") and s["stems"].get("mean_improvement_db") is not None
    }
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
    if "beats" in chosen:
        beats = report["scores"][chosen["beats"]["analyser"]]["heldout"]["variants"].get("clean", {}).get("beats")
        if beats and beats["tempo_octave"] < gates["tempo_right"]["min"]:
            target.append(f"held-out tempo right on {beats['tempo_octave'] * 100:.0f}% of tracks, below {gates['tempo_right']['min'] * 100:.0f}%")
    if "stems" in chosen and chosen["stems"]["score"] < gates["stem_improvement_db"]["min"]:
        target.append(f"held-out stem improvement {chosen['stems']['score']} dB below {gates['stem_improvement_db']['min']} dB")
    if "sections" in chosen and chosen["sections"]["score"] < gates["section_f"]["min"]:
        target.append(f"held-out section F {chosen['sections']['score']:.3f} below {gates['section_f']['min']}")
    if baseline and baseline.get("corpus") == report["corpus"]:  # scores on a different corpus are not comparable
        drop = gates["regression"]["max_drop"]
        for part, entry in chosen.items():
            before = baseline.get("chosen", {}).get(part, {}).get("score")
            if before is not None and entry["score"] < before - (drop if part != "stems" else 1.0):
                hard.append(f"{part} regressed: best held-out score {entry['score']} was {before} in the baseline")
    return hard, target


def write_report(run_dir: Path, report: dict) -> None:
    lines = [f"# Accuracy run `{run_dir.name}`", ""]
    c = report["corpus"]
    lines.append(f"Corpus: {c['train']} training and {c['heldout']} held-out modules ({c['sources']}; {c.get('left_out', 0)} more left out as unusable). Variants: {', '.join(report['variants'])}.")
    lines += ["", "## Instrument checks", ""]
    for check in report["instrument_checks"]:
        lines.append(f"- {'ok' if check['ok'] else '**FAIL**'}: {check['name']} ({check['detail']})")
    lines += ["", "## Held-out scores", "", "Onsets (clean audio; timing is detection minus the point halfway up the reference event's rise):", ""]
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
    lines += ["", "Other parts (held-out, mean over variants):", "", "| Analyser | Beat F | Beat F (any level) | Tempo right (at some level) | Section F at 3 s |", "|---|---|---|---|---|"]
    for name, s in report["scores"].items():
        clean = s.get("heldout", {}).get("variants", {}).get("clean", {})
        beats, sections = clean.get("beats"), clean.get("sections")
        if not (beats or sections):
            continue
        lines.append(
            f"| {name} | {beats['f'] if beats else '–'} | {beats['best_f'] if beats else '–'} | {beats['tempo_octave'] if beats else '–'} | "
            f"{sections['f_3s'] if sections else '–'} |"
        )
    with_drums = {name: s["heldout"]["variants"]["clean"]["drums"] for name, s in report["scores"].items() if "drums" in s.get("heldout", {}).get("variants", {}).get("clean", {})}
    if with_drums:
        lines += ["", "Drum hits by type (held-out, clean audio; F, precision and recall within 50 ms, and mean timing error):", "", "| Analyser | Mean F | Kick | Snare | Hat | Modules scored |", "|---|---|---|---|---|---|"]
        for name, drums in with_drums.items():
            cells = []
            for kind in score.DRUM_TYPES:
                d = drums.get(kind)
                cells.append(f"{d['f']:.3f} (P {d['precision']:.2f}, R {d['recall']:.2f}, {d['bias_ms']:+.1f} ms)" if d and d["bias_ms"] is not None else (f"{d['f']:.3f}" if d else "–"))
            lines.append(f"| {name} | {drums['mean_f']:.3f} | " + " | ".join(cells) + f" | {drums['tracks']} |")
    with_stems = {name: s["stems"] for name, s in report["scores"].items() if s.get("stems")}
    if with_stems:
        lines += [
            "",
            "Stems (SI-SDR improvement over handing back the unseparated mix, in dB, against the true stems of "
            f"{' and '.join(f'{n} {kind}' for kind, n in STEM_TRACKS.items())} held-out modules):",
            "",
            "| Source | Mean | Drums | Bass | Other | Synthetic modules | Downloaded modules | Notes |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for name, stems in with_stems.items():
            notes = []
            if name in analysers.REFERENCE_FED:
                notes.append("the true stems, supplied as a user would: checks the interface, not a candidate")
            if name in analysers.UNVERIFIED:
                notes.append("unverified: written from the provider's documentation, never run against it")
            if stems.get("recorded"):
                notes.append("scores recorded on an earlier run")
            if "not_run" in stems or "failed" in stems:
                notes.insert(0, f"not run: {stems['not_run']}" if "not_run" in stems else f"FAILED: {stems['failed']}")
                lines.append(f"| {name} | – | – | – | – | – | – | {'; '.join(notes)} |")
                continue
            detail = stems.get("detail") or {}
            if detail:
                notes.append(", ".join(f"{k} {v}" for k, v in detail.items() if isinstance(v, (str, int, float))))

            def db(v):
                return "–" if v is None else f"{v:+.2f}"

            lines.append(
                f"| {name} | {db(stems['mean_improvement_db'])} | " + " | ".join(db(stems.get(c, {}).get("improvement_db")) for c in ("drums", "bass", "other"))
                + f" | {db(stems.get('synthetic_improvement_db'))} | {db(stems.get('downloaded_improvement_db'))} | {'; '.join(notes)} |"
            )  # fmt: skip
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


def write_scoreboard(report: dict, gates: dict) -> None:
    """The committed record of where analysis stands against its targets.

    Rewritten whenever a run is accepted as the baseline, so the history of this
    file in git is the history of real improvements.
    """
    chosen, scores = report["chosen"], report["scores"]
    rows = []

    def row(part: str, measure: str, value, target: str, met: bool | None, analyser: str) -> None:
        status = "–" if met is None else ("met" if met else "**not met**")
        rows.append([part, measure, str(value), target, status, f"`{analyser}`"])

    if "onsets" in chosen:
        name = chosen["onsets"]["analyser"]
        variants = scores[name]["heldout"]["variants"]
        clean = variants["clean"]["onsets"]
        row("Onsets", "F on clean audio", f"{clean['f']:.3f}", f"at least {gates['onset_f']['min']}", clean["f"] >= gates["onset_f"]["min"], name)
        degraded = [variants[v]["onsets"]["f"] for v in variants if v != "clean" and "onsets" in variants[v]]
        if degraded:
            row("Onsets", "worst F through reverb, compression, MP3", f"{min(degraded):.3f}", "tracked", None, name)
        for kind in ("percussive", "soft"):
            k = clean["kinds"].get(kind)
            if not k or k["recall"] is None:
                continue
            limit = gates[f"{kind}_recall"]["min"]
            row("Onsets", f"{kind} recall", f"{k['recall']:.3f}", f"at least {limit}", k["recall"] >= limit, name)
            bias = k["timing"]["bias_ms"]
            if bias is not None:
                row("Onsets", f"{kind} timing bias / spread", f"{bias:+.1f} ms / {k['timing']['spread_ms']:.1f} ms", f"bias within {gates['onset_bias_ms']['max']} ms", abs(bias) <= gates["onset_bias_ms"]["max"], name)
        soft = clean["kinds"].get("soft", {})
        if soft.get("nearest_median_ms") is not None:
            row("Onsets", "soft: typical offset of the nearest detection", f"{soft['nearest_median_ms']:+.1f} ms", "tracked", None, name)
        if clean.get("kind_accuracy") is not None:
            row("Onsets", "attack type labelled correctly", f"{clean['kind_accuracy'] * 100:.0f}%", "tracked", None, name)
    if "beats" in chosen:
        name = chosen["beats"]["analyser"]
        beats = scores[name]["heldout"]["variants"]["clean"]["beats"]
        row("Beats", "F at any metrical level, mean over variants", f"{chosen['beats']['score']:.3f}", f"at least {gates['beat_f']['min']}", chosen["beats"]["score"] >= gates["beat_f"]["min"], name)
        row("Beats", "F at the module's own level", f"{beats['f']:.3f}", "tracked", None, name)
        if beats.get("best_f_irregular") is not None:
            row("Beats", f"F at any level on the {beats['irregular_tracks']} modules with irregular beat grids", f"{beats['best_f_irregular']:.3f}", "tracked", None, name)
        if beats.get("downbeat_f") is not None:
            row("Beats", "downbeat F against the module's own bar setting", f"{beats['downbeat_f']:.3f}", "tracked", None, name)
        row("Beats", "tempo right at some metrical level", f"{beats['tempo_octave'] * 100:.0f}%", f"at least {gates['tempo_right']['min'] * 100:.0f}%", beats["tempo_octave"] >= gates["tempo_right"]["min"], name)
    if "sections" in chosen:
        name = chosen["sections"]["analyser"]
        row("Sections", "boundary F within 3 s, mean over variants", f"{chosen['sections']['score']:.3f}", f"at least {gates['section_f']['min']}", chosen["sections"]["score"] >= gates["section_f"]["min"], name)
    if "sections" in chosen:
        for other, entry in scores.items():
            if other != chosen["sections"]["analyser"] and "sections_mean" in entry.get("heldout", {}):
                row("Sections", "boundary F within 3 s, for comparison", f"{entry['heldout']['sections_mean']:.3f}", "tracked", None, other)
    if "drums" in chosen:
        name = chosen["drums"]["analyser"]
        drums = scores[name]["heldout"]["variants"]["clean"]["drums"]
        row("Drum hits", f"mean F over kick, snare and hat, clean audio ({drums['tracks']} modules)", f"{drums['mean_f']:.3f}", "tracked", None, name)
        for kind in score.DRUM_TYPES:
            if kind in drums:
                bias = "" if drums[kind]["bias_ms"] is None else f", bias {drums[kind]['bias_ms']:+.1f} ms"
                row("Drum hits", f"{kind} F", f"{drums[kind]['f']:.3f}{bias}", "tracked", None, name)
        blows = drums.get("blows")
        if blows:
            row("Drum hits", "blows found, kick or snare, whichever each was taken for", f"{blows['recall']:.3f}", f"at least {gates['blow_recall']['min']}", blows["recall"] >= gates["blow_recall"]["min"], name)
            row("Drum hits", "of the detected blows, those that are real", f"{blows['precision']:.3f}", "tracked", None, name)
            if blows.get("roll_recall") is not None:
                row("Drum hits", f"blows inside a roll found ({blows['rolled']} of them)", f"{blows['roll_recall']:.3f}", f"at least {gates['roll_recall']['min']}", blows["roll_recall"] >= gates["roll_recall"]["min"], name)
            if blows.get("break_false_per_s") is not None:
                row("Drum hits", f"false blows a second where the drums have stopped ({blows['break_s']:.0f} s of breaks)", f"{blows['break_false_per_s']:.3f}", f"at most {gates['break_false_per_s']['max']}", blows["break_false_per_s"] <= gates["break_false_per_s"]["max"], name)
        for other, entry in scores.items():
            if other != name and "drums_clean" in entry.get("heldout", {}):
                row("Drum hits", f"mean F, for comparison ({entry['heldout']['variants']['clean']['drums']['tracks']} modules)", f"{entry['heldout']['drums_clean']:.3f}", "tracked", None, other)
    if "stems" in chosen:
        name = chosen["stems"]["analyser"]
        row("Stems", "SI-SDR improvement over the unseparated mix", f"{chosen['stems']['score']:+.2f} dB", f"at least {gates['stem_improvement_db']['min']} dB", chosen["stems"]["score"] >= gates["stem_improvement_db"]["min"], name)
        best = scores[name]["stems"]
        for cls in ("drums", "bass", "other"):
            if cls in best:
                row("Stems", f"{cls}: improvement", f"{best[cls]['improvement_db']:+.2f} dB", "tracked", None, name)
        if best.get("downloaded_improvement_db") is not None:
            row("Stems", "improvement on downloaded modules only", f"{best['downloaded_improvement_db']:+.2f} dB", "tracked", None, name)
        for other, entry in scores.items():
            stems = entry.get("stems") or {}
            if other != name and other not in analysers.REFERENCE_FED and stems.get("mean_improvement_db") is not None:
                row("Stems", "improvement, for comparison", f"{stems['mean_improvement_db']:+.2f} dB", "tracked", None, other)

    # Column-aligned, so the file is already in the form the repository's formatter produces.
    header = ["Part", "Measure", "Now", "Target", "Status", "Best analyser"]
    widths = [max(len(r[i]) for r in [header, *rows]) for i in range(len(header))]
    table = ["| " + " | ".join(cell.ljust(w) for cell, w in zip(r, widths)) + " |" for r in [header, *rows]]
    table.insert(1, "| " + " | ".join("-" * w for w in widths) + " |")
    c = report["corpus"]
    checks = report["instrument_checks"]
    lines = [
        "# Accuracy Scoreboard",
        "",
        "Generated by `python3 tools/loop/accuracy.py --save-baseline`. Do not edit by hand.",
        "",
        f"Held-out split: {c['heldout']} modules ({c['train']} more are used for tuning; {c['sources']} in total;",
        f"{c.get('left_out', 0)} others left out as unusable).",
        f"Instrument checks: {sum(ch['ok'] for ch in checks)} of {len(checks)} pass.",
        "",
        *table,
        "",
        "Each row is the best analyser for that part on the held-out split. Targets live in",
        "`tools/loop/gates.json`. A change to analysis counts as an improvement only if it",
        "moves a row here without moving another row backwards.",
    ]
    (ROOT / "docs" / "loop" / "scoreboard.md").write_text("\n".join(lines) + "\n")


def run(args, params: dict | None = None, pool=None) -> dict:
    variant_names = ("clean",) if args.quick else tuple(degrade.VARIANTS)
    sources = ("synthetic",) if args.quick else ("synthetic", "downloaded", "local")
    names = args.analysers or list(analysers.ANALYSERS)
    own_pool = pool is None
    pool = pool or ProcessPoolExecutor(max_workers=args.jobs)
    try:
        splits = {}
        left_out = 0
        for split in ("train", "heldout"):
            items = corpus.load(split, sources)
            if args.quick:
                items = [i for i in items if int(i["id"].split("-")[1]) in corpus.FIXTURE_SEEDS]
            ready = []
            jobs = [(item, variant_names, False) for item in items]
            for item, result in zip(items, pool.map(prepare_safely, jobs)):
                if isinstance(result, str):  # a module the player cannot render is skipped, loudly
                    print(f"skipping {item['id']}: {result}", file=sys.stderr)
                else:
                    ready.append(result)
            splits[split] = [t for t in ready if usable(t)]
            left_out += len(ready) - len(splits[split])
        all_tracks = splits["train"] + splits["heldout"]

        scores: dict = {}
        timed = [n for n in names if n not in analysers.STEMS_ONLY]
        # Models that run on a GPU get a few workers of their own instead of one per
        # core: every process that touches the GPU keeps its own copy of the model there.
        models = [n for n in timed if n in analysers.MODELS]
        on_gpu = False
        if models:
            with fresh_workers(1) as probe:
                on_gpu = probe.submit(worker_device).result() != "cpu"
        for split, tracks in splits.items():
            # Models are slow and are never tuned here, so they are only run where
            # they are judged: on the held-out split.
            run_here = [n for n in timed if split == "heldout" or n not in analysers.MODELS]
            on_cpu = [n for n in run_here if not (on_gpu and n in analysers.MODELS)]
            results = analyse_all(on_cpu, tracks, variant_names, params, pool)
            for name in run_here:
                if name not in on_cpu:  # one model at a time on the GPU, each with as many workers as fit
                    with fresh_workers(analysers.GPU_WORKERS.get(name, DEFAULT_GPU_WORKERS)) as gpu_pool:
                        results.update(analyse_all([name], tracks, variant_names, params, gpu_pool))
            for name in run_here:
                scores.setdefault(name, {})[split] = score_split(results[name], tracks, variant_names)
        stem_names = [n for n in names if n in analysers.STEMS_ONLY]
        if stem_names and not args.quick:
            on = stem_tracks(splits["heldout"], variant_names)
            with fresh_workers(1) as stem_pool:  # one at a time: a separation model fills the GPU
                for name in stem_names:
                    scores.setdefault(name, {})["stems"] = score_stems(name, on, stem_pool)
                    if "failed" in scores[name]["stems"]:
                        print(f"stem source {name} failed: {scores[name]['stems']['failed']}", file=sys.stderr)

        report = dict(
            name=args.name,
            params=params or analyse.load_params(),
            variants=list(variant_names),
            corpus=dict(
                train=len(splits["train"]), heldout=len(splits["heldout"]), left_out=left_out,
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
    fed = scores.get("user_stems", {}).get("stems", {})
    if "worst_si_sdr_db" in fed:
        report["instrument_checks"].append(dict(
            name="user-supplied stems come through the stem interface intact",
            ok=fed["worst_si_sdr_db"] >= USER_STEMS_MIN_DB,
            detail=f"true stems handed back score at least {fed['worst_si_sdr_db']:.0f} dB SI-SDR",
        ))  # fmt: skip
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
        write_scoreboard(report, json.loads(GATES.read_text())["accuracy"])
        print(f"baseline saved to {BASELINE.relative_to(ROOT)}; scoreboard written to docs/loop/scoreboard.md")
    return 1 if report["hard"] else 0


if __name__ == "__main__":
    sys.exit(main())
