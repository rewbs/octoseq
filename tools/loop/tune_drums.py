#!/usr/bin/env python3
"""Tune the kick/snare/hat detector on the training split.

    python3 tools/loop/tune_drums.py                    # search, and print what it found
    python3 tools/loop/tune_drums.py --apply            # also write drum_params.json
    .loop/venv/bin/python tools/loop/tune_drums.py --apply   # include the drum-stem version

The detector in analysers.py listens either to the full mix or to a separated drum
stem, and the two want different settings, so each is searched separately. The
search is a deterministic coordinate descent over the detector's few settings, on a
third of the training modules; the result is then measured on all of them and the
remaining timing bias is cancelled with one constant. The held-out split is never
read: accuracy.py is where the result is judged.

The drum-stem version needs local Demucs (the model environment). Without it only
the mix settings are searched and the stem settings in the file are left alone.
Separation is slow, so the stem settings are both searched and measured on that
third of the training modules, where the mix settings are measured on all of them.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import accuracy  # noqa: E402
import analysers  # noqa: E402
import corpus  # noqa: E402
import score  # noqa: E402
import stems as stem_sources  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ENVELOPES = ROOT / ".loop" / "cache" / "drum-envelopes"
CHOICES = dict(
    ratio=[1.5, 2.0, 3.0, 4.0, 6.0],
    delta=[0.02, 0.05, 0.1, 0.2, 0.3, 0.5],
    gap_s=[0.04, 0.06, 0.09],
    hat_over_snare=[0.5, 1.0, 1.5, 3.0, 1e9],
    snare_over_kick=[1.0, 2.0, 3.0, 6.0, 1e9],
)
PER_BAND = ("ratio", "delta")
PASSES = 2


def envelopes(job: tuple[str, str, str]) -> None:
    """Compute and store one module's band envelopes, from its mix or from its drum stem."""
    source, mix, out = job
    if Path(out).exists():
        return
    audio = Path(mix) if source == "mix" else stem_sources.separate("demucs", Path(mix)).files["drums"]
    np.save(out, analysers.drum_envelopes(analysers.decode(audio)).astype(np.float32))


def measure(tracks: list[dict], envs: dict, params: dict) -> dict:
    return score.drum_summary([score.drum_tallies(t["reference"]["drums"], analysers.drum_hits(envs[t["id"]], params)) for t in tracks])


def search(tracks: list[dict], envs: dict) -> tuple[dict, dict]:
    subset = [t for t in tracks[::3] if t["id"] in envs]
    tracks = [t for t in tracks if t["id"] in envs]
    params = copy.deepcopy(analysers.DRUM_PARAMS_START)
    best = measure(subset, envs, params).get("mean_f", 0.0)
    for _ in range(PASSES):
        for name, values in CHOICES.items():
            for slot in range(3) if name in PER_BAND else [None]:
                for value in values:
                    trial = copy.deepcopy(params)
                    if slot is None:
                        trial[name] = value
                    else:
                        trial[name][slot] = value
                    f = measure(subset, envs, trial).get("mean_f", 0.0)
                    if f > best + 1e-4:
                        best, params = f, trial
    result = measure(tracks, envs, params)
    biases = [result[kind]["bias_ms"] for kind in score.DRUM_TYPES if kind in result and result[kind]["bias_ms"] is not None]
    params["offset_s"] = round(-float(np.mean(biases)) / 1000.0, 4) if biases else 0.0
    return params, measure(tracks, envs, params)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the result to drum_params.json")
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()

    ENVELOPES.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        ready = pool.map(accuracy.prepare_safely, [(item, ("clean",), False) for item in corpus.load("train")])
        tracks = [t for t in ready if not isinstance(t, str) and accuracy.usable(t)]
        tracks = [t for t in tracks if sum(len(t["reference"]["drums"][kind]) for kind in score.DRUM_TYPES) >= 20]
        sources = ["mix"] + (["stem"] if stem_sources.demucs_installed() else [])
        found = json.loads(analysers.DRUM_PARAMS_FILE.read_text()) if analysers.DRUM_PARAMS_FILE.exists() else {}
        for source in sources:
            using = tracks if source == "mix" else tracks[::3]
            jobs = [(source, str(t["variants"]["clean"]), str(ENVELOPES / f"{t['work'].name}-{source}.npy")) for t in using]
            if source == "mix":
                list(pool.map(envelopes, jobs))
            else:
                with accuracy.fresh_workers(1) as gpu:  # Demucs holds the GPU: one at a time, in a process of its own
                    list(gpu.map(envelopes, jobs))
            envs = {t["id"]: np.load(ENVELOPES / f"{t['work'].name}-{source}.npy") for t in using}
            params, result = search(tracks, envs)
            found[source] = params
            print(f"{source}: mean F {result.get('mean_f')} on {len(using)} training modules  {json.dumps(params)}")
            for kind in score.DRUM_TYPES:
                if kind in result:
                    r = result[kind]
                    print(f"  {kind:5} F {r['f']:.3f}  P {r['precision']:.3f}  R {r['recall']:.3f}  bias {r['bias_ms']:+.1f} ms  ({r['tracks']} modules)")
    if args.apply:
        analysers.DRUM_PARAMS_FILE.write_text(json.dumps(found, indent=2) + "\n")
        print(f"written to {analysers.DRUM_PARAMS_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
