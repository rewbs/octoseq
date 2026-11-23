"""Scoring analysis results against a tracker-module reference (see modref.py).

Every function takes plain lists of times in seconds and returns plain numbers, so
any analyser (signal processing, local model or hosted API) is scored the same way.
"""

from __future__ import annotations

import numpy as np

ONSET_TOLERANCE_S = 0.050  # a detection within this of a reference event is a hit
BEAT_TOLERANCE_S = 0.070
SECTION_TOLERANCES_S = (0.5, 3.0)
SIGNIFICANT_WEIGHT = 0.1  # reference events lighter than this are optional: never required, never penalised
FRAME_S = 1.0 / 60.0  # the timing target: one video frame at 60 fps


def match(ref: np.ndarray, det: np.ndarray, tolerance: float) -> list[tuple[int, int]]:
    """One-to-one matching of two sorted time lists, closest pairs first."""
    pairs = []
    start = 0
    for i, r in enumerate(ref):
        while start < len(det) and det[start] < r - tolerance:
            start += 1
        j = start
        while j < len(det) and det[j] <= r + tolerance:
            pairs.append((abs(det[j] - r), i, j))
            j += 1
    pairs.sort()
    used_ref, used_det, out = set(), set(), []
    for _, i, j in pairs:
        if i not in used_ref and j not in used_det:
            used_ref.add(i)
            used_det.add(j)
            out.append((i, j))
    return out


def onset_tallies(merged: list[dict], detections: list[float], primary: str = "steepest") -> dict:
    """Raw counts and timing errors for one track. Combine tracks with `pool`, then `onset_summary`.

    Detections are matched to reference events on the `primary` time. Recall is
    weighted by how much each event matters (loudness and masking). A detection that
    lands on any reference event, however faint, is not a false alarm.
    """
    ref_t = np.array([e[primary] for e in merged], dtype=float)
    order = np.argsort(ref_t)
    ref = [merged[i] for i in order]
    ref_t = ref_t[order]
    det = np.sort(np.asarray(detections, dtype=float))
    pairs = match(ref_t, det, ONSET_TOLERANCE_S)
    matched = {i: j for i, j in pairs}
    out = dict(detections=len(det), hits=len(pairs), kinds={})
    for kind in ("percussive", "soft", "legato"):
        idx = [i for i, e in enumerate(ref) if e["kind"] == kind]
        significant = [i for i in idx if ref[i]["weight"] >= SIGNIFICANT_WEIGHT]
        hit = [i for i in significant if i in matched]
        out["kinds"][kind] = dict(
            weight=float(sum(ref[i]["weight"] for i in idx)),
            weight_hit=float(sum(ref[i]["weight"] for i in idx if i in matched)),
            events=len(significant),
            events_hit=len(hit),
            errors={key: [float(det[matched[i]] - ref[i][key]) for i in hit] for key in ("onset", "steepest", "peak")},
        )
    return out


def pool(tallies: list[dict]) -> dict:
    """Add up per-track tallies."""
    out = dict(detections=0, hits=0, kinds={})
    for t in tallies:
        out["detections"] += t["detections"]
        out["hits"] += t["hits"]
        for kind, k in t["kinds"].items():
            o = out["kinds"].setdefault(kind, dict(weight=0.0, weight_hit=0.0, events=0, events_hit=0, errors={"onset": [], "steepest": [], "peak": []}))
            for field in ("weight", "weight_hit", "events", "events_hit"):
                o[field] += k[field]
            for key, errs in k["errors"].items():
                o["errors"][key] += errs
    return out


def _timing(errors: list[float]) -> dict:
    if not errors:
        return dict(n=0, bias_ms=None, spread_ms=None)
    e = np.asarray(errors) * 1000.0
    return dict(n=len(e), bias_ms=round(float(e.mean()), 2), spread_ms=round(float(e.std()), 2))


def onset_summary(tally: dict, primary: str = "steepest") -> dict:
    """Precision, weighted recall, F and timing, overall and per event type."""
    precision = tally["hits"] / tally["detections"] if tally["detections"] else 0.0
    weight = sum(k["weight"] for k in tally["kinds"].values())
    weight_hit = sum(k["weight_hit"] for k in tally["kinds"].values())
    recall = weight_hit / weight if weight else 0.0
    f = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    all_errors = {key: sum((k["errors"][key] for k in tally["kinds"].values()), []) for key in ("onset", "steepest", "peak")}
    out = dict(
        precision=round(precision, 4), recall=round(recall, 4), f=round(f, 4),
        timing=_timing(all_errors[primary]),
        timing_vs={key: _timing(all_errors[key]) for key in all_errors},
        kinds={},
    )  # fmt: skip
    for kind, k in tally["kinds"].items():
        out["kinds"][kind] = dict(
            recall=round(k["weight_hit"] / k["weight"], 4) if k["weight"] else None,
            events=k["events"], events_hit=k["events_hit"],
            timing=_timing(k["errors"][primary]),
        )  # fmt: skip
    return out


def _f(ref: np.ndarray, det: np.ndarray, tolerance: float) -> tuple[float, float, float]:
    if not len(ref) or not len(det):
        return 0.0, 0.0, 0.0
    hits = len(match(np.sort(ref), np.sort(det), tolerance))
    p, r = hits / len(det), hits / len(ref)
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def beat_scores(ref_beats: list[float], det_beats: list[float], ref_bpm: float, det_bpm: float) -> dict:
    """Beat F-measure at the reference's own level and at the usual alternatives.

    Trackers do not record which metrical level is "the beat", so a grid at half or
    double the tempo, or on the off-beats, is reported separately instead of simply
    counting as wrong.
    """
    ref, det = np.asarray(ref_beats, dtype=float), np.asarray(det_beats, dtype=float)
    levels = {"same": ref}
    if len(ref) > 2:
        mids = (ref[:-1] + ref[1:]) / 2
        levels["double"] = np.sort(np.concatenate([ref, mids]))
        levels["half"] = ref[::2]
        levels["half_offset"] = ref[1::2]
        levels["offbeat"] = mids
    scores = {name: _f(r, det, BEAT_TOLERANCE_S)[2] for name, r in levels.items()}
    best = max(scores, key=scores.get)
    ratio = det_bpm / ref_bpm if ref_bpm and det_bpm else 0.0
    return dict(
        f=round(scores["same"], 4), best_level=best, best_f=round(scores[best], 4),
        tempo_ratio=round(ratio, 4), ref_bpm=round(ref_bpm, 2), det_bpm=round(det_bpm, 2),
    )  # fmt: skip


def section_scores(ref_sections: list[dict], det_times: list[float]) -> dict:
    """Boundary hit rates at 0.5 s and 3 s. The boundary at the very start is ignored."""
    ref = np.array([s["time"] for s in ref_sections if s["time"] > 1.0], dtype=float)
    det = np.array([t for t in det_times if t > 1.0], dtype=float)
    out = {}
    for tol in SECTION_TOLERANCES_S:
        p, r, f = _f(ref, det, tol)
        out[f"f_{tol:g}s"] = round(f, 4)
        out[f"precision_{tol:g}s"] = round(p, 4)
        out[f"recall_{tol:g}s"] = round(r, 4)
    out["boundaries"] = int(len(ref))
    out["detected"] = int(len(det))
    return out


def si_sdr(reference: np.ndarray, estimate: np.ndarray) -> float:
    """Scale-invariant signal-to-distortion ratio in dB. Higher is better."""
    n = min(len(reference), len(estimate))
    ref, est = reference[:n].astype(np.float64), estimate[:n].astype(np.float64)
    ref_energy = float(np.dot(ref, ref))
    if ref_energy < 1e-10:
        return float("nan")
    target = (np.dot(est, ref) / ref_energy) * ref
    noise = est - target
    return float(10 * np.log10((np.dot(target, target) + 1e-12) / (np.dot(noise, noise) + 1e-12)))


def stem_scores(reference: dict[str, np.ndarray], estimate: dict[str, np.ndarray]) -> dict:
    """SI-SDR per stem, plus how much better that is than handing back the mix."""
    mix = np.sum(list(reference.values()), axis=0)
    out = {}
    for name, ref in reference.items():
        if name not in estimate or float(np.dot(ref, ref)) < 1e-10:
            continue
        sdr = si_sdr(ref, estimate[name])
        out[name] = dict(si_sdr_db=round(sdr, 2), improvement_db=round(sdr - si_sdr(ref, mix), 2))
    return out
