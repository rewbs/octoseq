#!/usr/bin/env python3
"""Self-tuning: search the analyser's parameters against tracker-module ground truth.

    python3 tools/loop/tune.py            # search, then report; changes nothing
    python3 tools/loop/tune.py --apply    # also adopt the result if it passes the rules

The search only ever sees the training split. The result is then judged on the
held-out split and on real recordings, and adopted only if all of these hold:

- held-out onset score improves by at least 0.005
- held-out beat score does not fall by more than 0.02
- held-out timing bias on clean audio stays within one 60 fps frame
- on real recordings, agreement between original and degraded audio does not fall
  by more than 0.03 (the guard against tuning to how clean tracker renders are)

Adopting means writing params.json, which analyse.py then uses by default. The
search is a deterministic coordinate descent, so the same corpus gives the same
answer.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import accuracy  # noqa: E402
import analyse  # noqa: E402
import corpus  # noqa: E402
import degrade  # noqa: E402
import score  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SEARCH_VARIANTS = ("clean", "reverb")  # the search uses two variants to keep each trial fast
GRID = {
    "threshold_k": [0.05, 0.1, 0.2, 0.4, 0.8],
    "min_gap_s": [0.04, 0.06, 0.08, 0.12],
    "log_gain": [10.0, 100.0, 1000.0],
    "hop": [221, 331, 441],
    "n_fft": [512, 1024, 2048],
    "floor_window_s": [0.2, 0.5, 1.0],
    "threshold_window_s": [0.5, 1.0, 2.0],
}
MIN_GAIN, MAX_BEAT_DROP, MAX_REAL_DROP = 0.005, 0.02, 0.03


def evaluate(params: dict, tracks: list[dict], variants: tuple[str, ...], pool) -> dict:
    results = accuracy.analyse_all(["standin"], tracks, variants, params, pool)["standin"]
    return accuracy.score_split(results, tracks, variants)


def objective(scores: dict) -> float:
    return scores.get("onsets_mean", 0.0) + 0.25 * scores.get("beats_mean", 0.0)


def clean_bias_ms(scores: dict) -> float:
    return scores["variants"]["clean"]["onsets"]["timing"]["bias_ms"] or 0.0


def search(start: dict, tracks: list[dict], pool, passes: int, log) -> dict:
    best, best_value = dict(start), objective(evaluate(start, tracks, SEARCH_VARIANTS, pool))
    log(f"start: objective {best_value:.4f}")
    for sweep in range(passes):
        improved = False
        for name, values in GRID.items():
            for value in values:
                if value == best[name]:
                    continue
                trial = dict(best, **{name: value})
                value_score = objective(evaluate(trial, tracks, SEARCH_VARIANTS, pool))
                if value_score > best_value + 1e-4:
                    best, best_value, improved = trial, value_score, True
                    log(f"pass {sweep + 1}: {name} = {value} -> {best_value:.4f}")
        if not improved:
            break
    # Timing bias is a constant offset, so it is cancelled exactly rather than searched for.
    bias = clean_bias_ms(evaluate(best, tracks, ("clean",), pool))
    best["onset_shift_s"] = round(best["onset_shift_s"] - bias / 1000.0, 4)
    log(f"training bias {bias:+.1f} ms cancelled: onset_shift_s = {best['onset_shift_s']}")
    return best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="adopt the tuned parameters if they pass the rules")
    parser.add_argument("--passes", type=int, default=2)
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--name", default=time.strftime("tune-%Y%m%d-%H%M%S"))
    args = parser.parse_args()

    lines: list[str] = []

    def log(message: str) -> None:
        print(message, flush=True)
        lines.append(message)

    all_variants = tuple(degrade.VARIANTS)
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        splits = {}
        for split in ("train", "heldout"):
            ready = pool.map(accuracy.prepare_safely, [(item, all_variants, False) for item in corpus.load(split)])
            splits[split] = [t for t in ready if not isinstance(t, str) and len(t["reference"]["merged"]) >= 20 and not t["reference"]["truncated"]]
        log(f"training on {len(splits['train'])} modules, judging on {len(splits['heldout'])} held-out modules")

        current = analyse.load_params()
        tuned = search(current, splits["train"], pool, args.passes, log)

        before = evaluate(current, splits["heldout"], all_variants, pool)
        after = evaluate(tuned, splits["heldout"], all_variants, pool)
        real_before = accuracy.real_music_check(["standin"], current, pool).get("standin", {})
        real_after = accuracy.real_music_check(["standin"], tuned, pool).get("standin", {})

    rules = {
        "held-out onset score improves": after["onsets_mean"] >= before["onsets_mean"] + MIN_GAIN,
        "held-out beat score holds": after.get("beats_mean", 0) >= before.get("beats_mean", 0) - MAX_BEAT_DROP,
        "held-out bias within one frame": abs(clean_bias_ms(after)) <= score.FRAME_S * 1000,
        "real-music agreement holds": real_after.get("agreement", 1) >= real_before.get("agreement", 1) - MAX_REAL_DROP,
    }
    accepted = all(rules.values())
    log("")
    log(f"held-out onsets: {before['onsets_mean']:.4f} -> {after['onsets_mean']:.4f}")
    log(f"held-out beats:  {before.get('beats_mean', 0):.4f} -> {after.get('beats_mean', 0):.4f}")
    log(f"held-out clean bias: {clean_bias_ms(before):+.1f} ms -> {clean_bias_ms(after):+.1f} ms")
    log(f"real-music agreement: {real_before.get('agreement')} -> {real_after.get('agreement')}")
    for rule, ok in rules.items():
        log(f"{'ok  ' if ok else 'FAIL'} {rule}")
    log(f"\nresult: {'accepted' if accepted else 'rejected'}; changed: " + (", ".join(f"{k}={tuned[k]}" for k in tuned if tuned[k] != current[k]) or "nothing"))

    out = ROOT / ".loop" / "accuracy" / args.name
    out.mkdir(parents=True, exist_ok=True)
    record = dict(
        params=tuned, previous=current, accepted=accepted, rules=rules,
        heldout=dict(before=before, after=after), real_music=dict(before=real_before, after=real_after),
        corpus=dict(train=len(splits["train"]), heldout=len(splits["heldout"])),
    )  # fmt: skip
    (out / "tune.json").write_text(json.dumps(record, indent=1))
    (out / "tune.md").write_text("\n".join(lines) + "\n")
    if accepted and args.apply:
        evidence = dict(
            heldout_onsets=[before["onsets_mean"], after["onsets_mean"]],
            heldout_beats=[before.get("beats_mean"), after.get("beats_mean")],
            heldout_clean_bias_ms=[clean_bias_ms(before), clean_bias_ms(after)],
            real_music_agreement=[real_before.get("agreement"), real_after.get("agreement")],
            corpus=record["corpus"],
        )  # fmt: skip
        analyse.PARAMS_FILE.write_text(json.dumps(dict(params=tuned, evidence=evidence), indent=2) + "\n")
        log(f"adopted: wrote {analyse.PARAMS_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
