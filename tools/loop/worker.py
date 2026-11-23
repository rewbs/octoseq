#!/usr/bin/env python3
"""The analysis worker: a track in, its analysis bundle out, made once and kept.

    python3 tools/loop/worker.py analyse data/dontstop.mp3      # make the bundle, or say where it is
    python3 tools/loop/worker.py analyse song.mp3 --reanalyse   # make it again; the old one is kept
    python3 tools/loop/worker.py analyse song.mp3 --stems user --stem-dir song.stems
    python3 tools/loop/worker.py show data/dontstop.mp3         # what the stored bundle was made with
    python3 tools/loop/worker.py choices                        # which analyser does each part, and why
    python3 tools/loop/worker.py check bundle.json              # can a scene run on this file

A bundle is everything a scene or the director may know about a track: its signals,
its events, and the roles those are bound to. It is made of parts (onsets, beats,
sections, drum hits, stems), and each part comes from one analyser registered in
analysers.py.

**Which analyser does each part** is not written here. The accuracy loop scores every
analyser on held-out modules and saves the scores (accuracy_baseline.json); the
worker reads them and takes, for each part, the best that can run on this machine.
Three rules sit on top of "the best":

- a hosted service is never chosen on its own, because it costs money for every new
  file. It is used when asked for by name (`--stems lalal --spend`);
- of analysers that score within a hair of each other (TIE), the cheapest to run
  wins: signal processing before a local model, a model before four models;
- a stem separation that does not reach the scoreboard's target is not worth
  having, and the bundle then has no stems rather than bad ones.

**A bundle is made once per audio file and kept** (`.loop/analysis/<audio hash>/`).
Models and services do not give the same answer twice, so "the same track" has to
mean the audio together with its stored bundle, or a show would stop rendering the
same frames. Asking for a track's bundle returns the stored one, even when the
analysers have since improved; the worker then says the bundle is out of date and
leaves it alone. Making a new one is an explicit act (`--reanalyse`, or the render
loop, whose job is to measure the analysis as it now is), and the bundle it
replaces is kept beside it, so a show made on the old one can still be played.

Every bundle says what made it (`analysis`: each part's analyser, its held-out score
and what was passed over), and is checked before it is stored (`validate`): a
bundle with a role bound to something that is not there is refused here, not
discovered by a scene.

Model analysers run in the optional model environment (tools/loop/models/setup.sh).
The worker itself runs under any Python and borrows that one when a part needs it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np  # noqa: E402

import analyse  # noqa: E402
import analysers  # noqa: E402
import roles  # noqa: E402
import stems as stem_sources  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / ".loop" / "analysis"  # not .loop/bundles, where perfect_bundle.py keeps the modules' known-correct ones
BASELINE = Path(__file__).parent / "accuracy_baseline.json"
GATES = Path(__file__).parent / "gates.json"
WORKER_VERSION = "worker-1"
STEM_LEVELS_VERSION = "levels-2"

PARTS = ("onsets", "beats", "sections", "drums", "stems")
MEASURES = {
    "onsets": "onset F",
    "beats": "beat F at any metrical level",
    "sections": "boundary F within 3 s",
    "drums": "mean F over kick, snare and hat",
    "stems": "dB better than the unseparated mix",
}
# Scores this close are a tie, and a tie goes to whatever is cheapest to run.
TIE = {"onsets": 0.01, "beats": 0.01, "sections": 0.01, "drums": 0.01, "stems": 0.5}
# What it costs to run an analyser, roughly: 0 is signal processing, 1 one local
# model, 4 the four-model Demucs, 10 a hosted service. Unlisted analysers cost 1.
COST = {
    "standin": 0, "energy": 0, "novelty": 0, "change": 0, "novelty_grid": 0, "drumbands": 0, "bandsplit": 0,
    "beat_this": 1, "drumbands_stem": 1, "demucs": 1, "demucs_ft": 4,
    "fal_demucs": 10, "lalal": 10, "musicai": 10,
}  # fmt: skip
SIGNAL_PROCESSING = {name for name, cost in COST.items() if cost == 0}
MODEL_BACKED = {"beat_this", "drumbands_stem", "demucs", "demucs_ft"}
# How a role's `signal` binding names the mix signals (see roles.bind).
SCRIPT_SIGNALS = {"amplitude": "amplitude", "energy": "energy", "centroid": "spectralCentroid", "flux": "spectralFlux", "onset": "onsetEnvelope"}


class WorkerError(RuntimeError):
    """The worker could not make, store or find a bundle."""


# ------------------------------------------------------------------ which analyser


def runnable(name: str) -> tuple[bool, str]:
    """Whether the worker may pick this analyser on its own on this machine, and if not, why."""
    if name in SIGNAL_PROCESSING:
        return True, "signal processing"
    if name in analysers.HOSTED:
        return False, "a hosted service, which costs money for every new file: used only when asked for"
    if name in analysers.REFERENCE_FED:
        return False, "needs stem files of your own: used only when asked for"
    if name in MODEL_BACKED:
        here = name in analysers.MODELS or (name in ("demucs", "demucs_ft") and stem_sources.demucs_installed())
        if here or roles.MODEL_PYTHON.exists():
            return True, "a local model"
        return False, "needs the model environment (tools/loop/models/setup.sh)"
    if name in analysers.ANALYSERS:
        return True, "registered"
    return False, "not registered on this machine"


def choose(stems: str | None = None, chosen: dict | None = None, can_run=runnable) -> dict:
    """The analyser for each part: {part: {analyser, score, why, passed_over}}.

    `chosen` is the accuracy loop's record of every candidate's held-out score (the
    `chosen` table of accuracy_baseline.json, read from there when not given).
    `stems` names a stem source to use whatever its score: "user", or a provider.
    A part nothing can do has analyser None.
    """
    if chosen is None:
        chosen = json.loads(BASELINE.read_text())["chosen"]
    target = float(json.loads(GATES.read_text())["accuracy"]["stem_improvement_db"]["min"])
    out = {}
    for part in PARTS:
        candidates = dict(chosen.get(part, {}).get("candidates", {}))
        passed, eligible = {}, {}
        for name, score in candidates.items():
            ok, why = can_run(name)
            if not ok:
                passed[name] = why
            elif part == "stems" and score < target:
                passed[name] = f"improves on the mix by {score:g} dB, under the {target:g} dB a separation must reach"
            else:
                eligible[name] = score
        if part == "stems" and stems:
            name = "user_stems" if stems == "user" else stems
            others = {n: f"scores {s:g}; {name} was asked for" for n, s in candidates.items() if n != name}
            out[part] = dict(analyser=name, source=stems, score=candidates.get(name), why="asked for by name", passed_over=others)
            continue
        if not eligible:
            out[part] = dict(analyser=None, score=None, why="nothing that can run here does this part well enough", passed_over=passed)
            continue
        best = max(eligible, key=lambda n: (eligible[n], n))
        near = [n for n in eligible if eligible[best] - eligible[n] <= TIE[part]]
        pick = min(near, key=lambda n: (COST.get(n, 1), -eligible[n], n))
        for name, score in eligible.items():
            if name == pick:
                continue
            passed[name] = f"scores {score:g}, a tie, and costs more to run" if name in near else f"scores {score:g}"
        why = "scores highest of those that can run here" if pick == best else f"ties with {best} ({eligible[best]:g}) and is cheaper to run"
        entry = dict(analyser=pick, score=eligible[pick], why=why, passed_over=passed)
        if part == "stems":
            entry["source"] = pick
        out[part] = entry
    return out


def recipe(choices: dict, params: dict) -> dict:
    """Everything a bundle's contents depend on besides the audio, and a short key for it."""
    made_with = dict(
        worker=WORKER_VERSION,
        parts={part: choices[part]["analyser"] for part in PARTS},
        standin=f"{analyse.ANALYSER_VERSION}-{analyse.params_key(params)}",
        roles=roles.ROLES_VERSION,
        drums=dict(stem=analyse.params_key(analysers.drum_params("stem")), mix=analyse.params_key(analysers.drum_params("mix")), drumless_db=roles.DRUMLESS_DB),
        stems=STEM_LEVELS_VERSION,
        models={name: analysers.result_version(name) for name in sorted(MODEL_BACKED) if name in {c["analyser"] for c in choices.values()}},
    )
    key = hashlib.sha256(json.dumps(made_with, sort_keys=True).encode()).hexdigest()[:16]
    return dict(key=key, made_with=made_with)


# ------------------------------------------------------------------ running analysers


def _last_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[-1] if lines else "no message"


def _run(name: str, audio: Path) -> dict:
    """One analyser's answer, from this Python if it is registered here, else from the model environment."""
    if name in analysers.ANALYSERS:
        return analysers.ANALYSERS[name](audio)
    if not roles.MODEL_PYTHON.exists():
        raise WorkerError(f"{name} cannot run here: it needs the model environment (tools/loop/models/setup.sh)")
    done = subprocess.run([str(roles.MODEL_PYTHON), str(Path(__file__)), "part", name, str(audio)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if done.returncode != 0:
        raise WorkerError(f"{name} failed on {audio.name}: {_last_line(done.stderr)}")
    return json.loads(_last_line(done.stdout))


def _separate(source: str, audio: Path, **options) -> stem_sources.StemSet:
    """A track's stems from a source. Local Demucs is run in the model environment when this Python has none."""
    try:
        return stem_sources.separate(source, audio, **options)
    except stem_sources.Unavailable as error:
        if source not in ("demucs", "demucs_ft") or not roles.MODEL_PYTHON.exists():
            raise WorkerError(f"stems from {source}: {error}") from error
    except stem_sources.StemError as error:
        raise WorkerError(f"stems from {source}: {error}") from error
    done = subprocess.run([str(roles.MODEL_PYTHON), str(Path(__file__).with_name("stems.py")), source, str(audio)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if done.returncode != 0:
        raise WorkerError(f"{source} failed on {audio.name}: {_last_line(done.stderr)}")
    try:
        return stem_sources.separate(source, audio)
    except stem_sources.StemError as error:
        raise WorkerError(f"stems from {source}: {error}") from error


def analyse_track(audio: Path, choices: dict, stem_options: dict | None = None) -> dict:
    """Make a bundle for a track from the analysers chosen. Nothing is stored."""
    params = analyse.load_params()
    package = analyse.analyse(audio, params)  # the mix's signals and bands, and the stand-in's onsets
    parts = {part: dict(analyser=c["analyser"], score=c["score"], measure=MEASURES[part], why=c["why"], passedOver=c["passed_over"]) for part, c in choices.items()}

    name = choices["onsets"]["analyser"]
    if name not in (None, "standin"):
        found = _run(name, audio)["onsets"]
        top = max((w for _, w in found), default=1.0) or 1.0
        roles._stream(package, "onsetPeaks", [(t, w / top) for t, w in found])

    name = choices["beats"]["analyser"]
    grid = {} if name is None else analyse.detect(audio, params) if name == "standin" else _run(name, audio)

    name = choices["sections"]["analyser"]
    starts = None if name is None else _run(name, audio)["sections"]

    name = choices["drums"]["analyser"]
    hits = None
    if name == "drumbands_stem":
        # As scored: the drum stem local Demucs separates. Where that stem is all but
        # silent the track has no drums, and the mix's low, middle and high bands
        # stand in for kick, snare and hat, so scenes built on drums still move.
        heard, heard_in, drum_params = analysers.decode(_separate("demucs", audio).files["drums"]), "stem", analysers.drum_params("stem")
        mix = analysers.decode(audio)
        level = 20.0 * np.log10(max(float(np.sqrt(np.mean(heard**2))), 1e-9) / max(float(np.sqrt(np.mean(mix**2))), 1e-9))
        if level < roles.DRUMLESS_DB:
            heard, heard_in, drum_params = mix, "mix (no drums in the track)", analysers.drum_params("mix")
        hits = analysers.drum_hits(analysers.drum_envelopes(heard), drum_params)
        parts["drums"]["heardIn"] = heard_in
        package["drumSource"] = heard_in
    elif name is not None:
        hits = _run(name, audio)["drums"]
        parts["drums"]["heardIn"] = package["drumSource"] = "mix"

    if choices["stems"]["analyser"]:
        separated = _separate(choices["stems"]["source"], audio, **(stem_options or {}))
        # The band taken apart: each stem's level goes in, so a scene can follow the
        # drums, the bass, the voice and the rest separately.
        package["stemSignals"], package["availableStems"] = roles.stem_levels(dict(separated.files), params)
        parts["stems"]["labels"] = sorted(separated.files)

    roles.bind(
        package,
        beats=grid.get("beats"),
        downbeats=grid.get("downbeats"),
        sections=None if starts is None else [(0.0, 1.0)] + [(t, 0.5) for t in starts],
        drums=None if hits is None else {kind: [(t, 1.0) for t in times] for kind, times in hits.items()},
    )
    made = recipe(choices, params)
    package["analysis"] = dict(
        worker=WORKER_VERSION,
        audio=audio.name,
        audioSha256=analyse.file_sha256(audio),
        made=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        recipe=made["key"],
        madeWith=made["made_with"],
        parts=parts,
    )
    return package


# ------------------------------------------------------------------ is it a bundle


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate(bundle: dict) -> list[str]:
    """What is wrong with a bundle, in words. An empty list means a scene can run on it."""
    problems: list[str] = []
    if not isinstance(bundle, dict):
        return ["not a bundle: the file does not hold an object"]
    if bundle.get("formatVersion") != 1:
        problems.append(f"formatVersion is {bundle.get('formatVersion')!r}, not 1")
    duration = bundle.get("durationSec")
    if not _number(duration) or duration <= 0:
        return problems + [f"durationSec is {duration!r}: a bundle must say how long its track is"]

    def series(entry: dict, label: str) -> None:
        rate, values = entry.get("rate"), entry.get("values")
        if not _number(rate) or rate <= 0:
            problems.append(f"{label}: no sample rate")
            return
        if not isinstance(values, list) or not values or not all(_number(v) for v in values):
            problems.append(f"{label}: its values are missing or are not all numbers")
            return
        expected = duration * rate
        if abs(len(values) - expected) > max(0.02 * expected, 4.0):
            problems.append(f"{label}: {len(values)} values at {rate:g} a second is {len(values) / rate:.1f} s, but the track is {duration:.1f} s")

    signals = {}
    for entry in bundle.get("signals", []):
        signals[entry.get("name")] = entry
        series(entry, f"signal {entry.get('name')!r}")
    customs = {}
    for entry in bundle.get("customSignals", []):
        customs[entry.get("name")] = entry
        series(entry, f"derived signal {entry.get('name')!r}")
    grouped = {"stemSignals": set(), "bandSignals": set()}
    for group, seen in grouped.items():
        for entry in bundle.get(group, []):
            seen.add((entry.get("label"), entry.get("feature")))
            series(entry, f"{group[:4]} signal {entry.get('label')}/{entry.get('feature')}")
    stem_labels = {label for _, label in bundle.get("availableStems", [])}

    streams = {}
    for stream in bundle.get("eventStreams", []):
        name, events = stream.get("name"), stream.get("events")
        if name in streams:
            problems.append(f"two event streams are both called {name!r}")
        streams[name] = events
        if not isinstance(events, list):
            problems.append(f"event stream {name!r}: no list of events")
            continue
        last = -math.inf
        for event in events:
            t, w = event.get("time"), event.get("weight")
            if not _number(t) or not _number(w):
                problems.append(f"event stream {name!r}: an event has no time or no weight")
                break
            if t < last:
                problems.append(f"event stream {name!r}: its events are out of order at {t:g} s")
                break
            if t < -0.001 or t > duration + 0.25:
                problems.append(f"event stream {name!r}: an event at {t:g} s is outside the track (0 to {duration:.1f} s)")
                break
            if w < 0 or w > 1.0001:
                problems.append(f"event stream {name!r}: an event's weight is {w:g}, not between 0 and 1")
                break
            last = t

    bound = bundle.get("roles")
    if not isinstance(bound, dict) or not bound:
        problems.append("no roles: a scene would have nothing to ask for")
        bound = {}
    for role, binding in bound.items():
        if role not in roles.EVENT_ROLES and role not in roles.SIGNAL_ROLES:
            problems.append(f"role {role!r} is not one a scene can ask for")
            continue
        if not isinstance(binding, dict):
            problems.append(f"role {role!r} is bound to {binding!r}, which is not a binding")
            continue
        if role in roles.EVENT_ROLES:
            if set(binding) != {"events"}:
                problems.append(f"role {role!r} is events, but is bound as {sorted(binding)}")
            elif binding["events"] not in streams:
                problems.append(f"role {role!r} is bound to event stream {binding['events']!r}, which the bundle does not have")
        elif "signal" in binding:
            if SCRIPT_SIGNALS.get(binding["signal"]) not in signals:
                problems.append(f"role {role!r} is bound to mix signal {binding['signal']!r}, which the bundle does not have")
        elif "custom" in binding:
            if binding["custom"] not in customs:
                problems.append(f"role {role!r} is bound to derived signal {binding['custom']!r}, which the bundle does not have")
        elif "stem" in binding:
            if (binding["stem"], binding.get("feature")) not in grouped["stemSignals"] or binding["stem"] not in stem_labels:
                problems.append(f"role {role!r} is bound to the {binding['stem']} stem's {binding.get('feature')}, which the bundle does not have")
        elif "band" in binding:
            if (binding["band"], binding.get("feature")) not in grouped["bandSignals"]:
                problems.append(f"role {role!r} is bound to the {binding['band']} band's {binding.get('feature')}, which the bundle does not have")
        else:
            problems.append(f"role {role!r} is a signal, but is bound as {sorted(binding)}")

    made = bundle.get("analysis")
    if not isinstance(made, dict):
        problems.append("no `analysis`: the bundle does not say what made it")
    else:
        sha = made.get("audioSha256")
        if not isinstance(sha, str) or len(sha) != 64:
            problems.append("`analysis` does not name the audio it was made from (audioSha256)")
        if not isinstance(made.get("recipe"), str):
            problems.append("`analysis` has no recipe, so the worker could not tell whether the bundle is out of date")
        for part in PARTS:
            if part not in made.get("parts", {}):
                problems.append(f"`analysis` does not say what made the {part}")
    return problems


# ------------------------------------------------------------------ the store


def store_dir(audio: Path, store: Path = STORE) -> Path:
    return store / analyse.file_sha256(audio)[:16]


def stored(audio: Path, store: Path = STORE) -> Path | None:
    """The track's current bundle, if one has been made."""
    path = store_dir(audio, store) / "bundle.json"
    return path if path.exists() else None


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find(audio: Path, bundle_sha256: str, store: Path = STORE) -> Path | None:
    """The bundle of this track with this content, current or replaced: the one a show was made on."""
    directory = store_dir(audio, store)
    kept = directory / "history" / f"{bundle_sha256[:16]}.json"
    for path in (directory / "bundle.json", kept):
        if path.exists() and _sha(path) == bundle_sha256:
            return path
    return None


def bundle(
    audio: Path,
    stale: str = "keep",
    stems: str | None = None,
    store: Path = STORE,
    quiet: bool = False,
    choices: dict | None = None,
    stem_options: dict | None = None,
    force: bool = False,
) -> Path:
    """The path of a track's bundle, made now only if the track has none.

    `stale` says what to do with a stored bundle that the analysers of today would
    not make: "keep" returns it as it is and says so; "reanalyse" makes a new one
    and puts the old one in the track's history. `force` makes a new one whatever
    is stored.
    """
    if stale not in ("keep", "reanalyse"):
        raise ValueError(f"stale must be 'keep' or 'reanalyse', not {stale!r}")
    audio = Path(audio)
    choices = choices or choose(stems)
    want = recipe(choices, analyse.load_params())["key"]
    directory = store_dir(audio, store)
    path, meta = directory / "bundle.json", directory / "analysis.json"
    if path.exists() and not force:
        have = json.loads(meta.read_text()).get("recipe") if meta.exists() else None
        if have == want:
            return path
        if stale == "keep":
            if not quiet:
                print(f"note: the stored bundle for {audio.name} was made by an older analysis; it is used as it is (worker.py analyse --reanalyse makes a new one)", file=sys.stderr)
            return path
    made = analyse_track(audio, choices, stem_options)
    problems = validate(made)
    if problems:
        raise WorkerError(f"the analysis of {audio.name} did not make a usable bundle: " + "; ".join(problems))
    directory.mkdir(parents=True, exist_ok=True)
    if path.exists():
        history = directory / "history"
        history.mkdir(exist_ok=True)
        shutil.move(str(path), str(history / f"{_sha(path)[:16]}.json"))
    fresh = directory / "bundle.json.new"
    fresh.write_text(json.dumps(made))
    fresh.replace(path)
    meta.write_text(json.dumps(made["analysis"], indent=1) + "\n")
    return path


def describe(made: dict) -> str:
    """A bundle's `analysis` in a few lines."""
    lines = [f"{made.get('audio', '?')}: made {made.get('made', '?')} by {made.get('worker', '?')} (recipe {made.get('recipe', '?')})"]
    for part in PARTS:
        entry = made.get("parts", {}).get(part, {})
        name = entry.get("analyser")
        if name is None:
            lines.append(f"  {part:9} none: {entry.get('why', '')}")
            continue
        score = f"{entry['score']:g} {entry.get('measure', '')}" if entry.get("score") is not None else "not scored"
        extra = "".join(f", {k} {v}" for k, v in (("heard in the", entry.get("heardIn")), ("stems:", ", ".join(entry.get("labels", [])))) if v)
        lines.append(f"  {part:9} {name:15} {score}; {entry.get('why', '')}{extra}")
    return "\n".join(lines)


# ------------------------------------------------------------------ checking itself


def selftest() -> list[tuple[str, bool, str]]:
    """Checks on the worker's rules, with no model and no network: (name, ok, detail)."""
    rows: list[tuple[str, bool, str]] = []
    only_signal = lambda name: (name in SIGNAL_PROCESSING, "signal processing" if name in SIGNAL_PROCESSING else "cannot run in this test")  # noqa: E731
    everything = lambda name: (name not in analysers.HOSTED and name not in analysers.REFERENCE_FED, "a hosted service" if name in analysers.HOSTED else "ok")  # noqa: E731
    table = {
        "onsets": {"candidates": {"standin": 0.86, "energy": 0.71}},
        "beats": {"candidates": {"standin": 0.933, "beat_this": 0.930}},
        "sections": {"candidates": {"novelty": 0.52, "novelty_grid": 0.54}},
        "drums": {"candidates": {"drumbands": 0.57, "drumbands_stem": 0.73}},
        "stems": {"candidates": {"bandsplit": 2.48, "lalal": 17.87, "demucs": 6.11, "demucs_ft": 6.26}},
    }
    picked = choose(chosen=table, can_run=everything)
    rows.append(("worker: each part goes to the analyser that scores best", picked["drums"]["analyser"] == "drumbands_stem" and picked["sections"]["analyser"] == "novelty_grid", f"-> drums {picked['drums']['analyser']}, sections {picked['sections']['analyser']}"))
    rows.append(("worker: a tie goes to the cheaper analyser", picked["beats"]["analyser"] == "standin" and picked["stems"]["analyser"] == "demucs", f"-> beats {picked['beats']['analyser']}, stems {picked['stems']['analyser']}"))
    clear = choose(chosen=dict(table, beats={"candidates": {"standin": 0.933, "beat_this": 0.96}}), can_run=everything)
    rows.append(("worker: a clear lead beats a lower cost", clear["beats"]["analyser"] == "beat_this", f"-> {clear['beats']['analyser']}"))
    rows.append(("worker: a hosted service is never chosen unasked", picked["stems"]["analyser"] != "lalal" and "lalal" in picked["stems"]["passed_over"], f"-> {picked['stems']['analyser']}"))
    asked = choose(stems="lalal", chosen=table, can_run=everything)
    rows.append(("worker: and is used when asked for by name", asked["stems"]["analyser"] == "lalal", f"-> {asked['stems']['analyser']}"))
    plain = choose(chosen=table, can_run=only_signal)
    rows.append(("worker: an analyser that cannot run is passed over", plain["drums"]["analyser"] == "drumbands" and "drumbands_stem" in plain["drums"]["passed_over"], f"-> {plain['drums']['analyser']}"))
    rows.append(("worker: no stems rather than a separation under target", plain["stems"]["analyser"] is None, f"-> {plain['stems']['analyser']}"))

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # Twelve seconds of clicks at 120 BPM over a tone that changes halfway.
        rate, seconds = 22050, 12.0
        t = np.arange(int(rate * seconds)) / rate
        tone = 0.2 * np.sin(2 * np.pi * np.where(t < 6.0, 220.0, 330.0) * t)
        clicks = np.zeros_like(t)
        for beat in np.arange(0.25, seconds, 0.5):
            i = int(beat * rate)
            clicks[i : i + 400] += np.hanning(400) * np.random.default_rng(int(beat * 100)).standard_normal(400)
        samples = np.clip(tone + 0.6 * clicks, -1.0, 1.0)
        audio = tmp / "clicks.wav"
        with wave.open(str(audio), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes((samples * 32767).astype("<i2").tobytes())
        store = tmp / "bundles"
        calls = []
        real = analyse_track

        def counted(*args, **kwargs):
            calls.append(1)
            return real(*args, **kwargs)

        globals()["analyse_track"] = counted
        try:
            first = bundle(audio, store=store, choices=plain, quiet=True)
            made = json.loads(first.read_text())
            rows.append(("worker: a bundle it makes passes its own check", validate(made) == [], f"-> {len(made['roles'])} roles" if not validate(made) else f"-> {validate(made)[0]}"))
            rows.append(("worker: the bundle says what made each part", made["analysis"]["parts"]["drums"]["analyser"] == "drumbands" and made["analysis"]["parts"]["stems"]["analyser"] is None, f"-> drums by {made['analysis']['parts']['drums']['analyser']}"))
            before = first.read_bytes()
            again = bundle(audio, store=store, choices=plain, quiet=True)
            rows.append(("worker: a stored bundle is reused, not made again", again == first and len(calls) == 1 and again.read_bytes() == before, f"-> analysed {len(calls)} time(s)"))
            other = choose(chosen=dict(table, sections={"candidates": {"novelty": 0.60, "novelty_grid": 0.54}}), can_run=only_signal)
            kept = bundle(audio, store=store, choices=other, quiet=True)
            rows.append(("worker: an out-of-date bundle is kept unless a new one is asked for", len(calls) == 1 and kept.read_bytes() == before, f"-> analysed {len(calls)} time(s)"))
            old_sha = hashlib.sha256(before).hexdigest()
            renewed = bundle(audio, stale="reanalyse", store=store, choices=other, quiet=True)
            found = find(audio, old_sha, store)
            rows.append(("worker: asked for, a new one is made and the old one is still to be found", len(calls) == 2 and json.loads(renewed.read_text())["analysis"]["parts"]["sections"]["analyser"] == "novelty" and found is not None and found.read_bytes() == before, f"-> analysed {len(calls)} time(s), old bundle {'kept' if found else 'lost'}"))
        finally:
            globals()["analyse_track"] = real

        def broken(change) -> list[str]:
            copy = json.loads(json.dumps(made))
            change(copy)
            return validate(copy)

        def unbind(b):
            b["roles"]["kick"] = {"events": "no-such-stream"}

        def disorder(b):
            events = next(s for s in b["eventStreams"] if s["name"] == "beat")["events"]
            events[0], events[-1] = events[-1], events[0]

        def shorten(b):
            b["signals"][0]["values"] = b["signals"][0]["values"][: len(b["signals"][0]["values"]) // 2]

        def anonymous(b):
            del b["analysis"]

        for label, change, word in (
            ("a role bound to a stream that is not there", unbind, "kick"),
            ("events out of order", disorder, "out of order"),
            ("a signal half as long as the track", shorten, "but the track is"),
            ("a bundle that does not say what made it", anonymous, "what made it"),
        ):
            found = broken(change)
            rows.append((f"worker: the check refuses {label}", any(word in problem for problem in found), f"-> {found[0] if found else 'nothing found'}"))
    return rows


# ------------------------------------------------------------------ command line


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    sub = commands.add_parser("analyse", help="make a track's bundle, or say where it is")
    sub.add_argument("track", type=Path)
    sub.add_argument("--reanalyse", action="store_true", help="make a new bundle even if the track has one; the old one is kept")
    sub.add_argument("--stems", choices=sorted(stem_sources.SOURCES), help="take the stems from this source, whatever its score")
    sub.add_argument("--stem-dir", type=Path, help="with --stems user: the directory holding your stem files")
    sub.add_argument("--spend", action="store_true", help="allow a hosted stem source, which bills for every file it has not separated before")
    sub = commands.add_parser("show", help="what a track's stored bundle was made with")
    sub.add_argument("track", type=Path)
    commands.add_parser("choices", help="which analyser does each part on this machine, and why")
    sub = commands.add_parser("check", help="whether a file is a bundle a scene can run on")
    sub.add_argument("bundle", type=Path, nargs="+")
    commands.add_parser("selftest", help="check the worker's own rules")
    sub = commands.add_parser("part", help=argparse.SUPPRESS)  # one analyser's answer as JSON, for the model environment
    sub.add_argument("analyser")
    sub.add_argument("track", type=Path)
    args = parser.parse_args()

    try:
        if args.command == "selftest":
            rows = selftest()
            for name, ok, detail in rows:
                print(f"{'ok  ' if ok else 'FAIL'} {name} {detail}")
            return 0 if all(ok for _, ok, _ in rows) else 1
        if args.command == "choices":
            for part, entry in choose().items():
                score = f"{entry['score']:g} {MEASURES[part]}" if entry["score"] is not None else ""
                print(f"{part:9} {entry['analyser'] or 'none':15} {score}\n{'':9} {entry['why']}")
                for name, why in entry["passed_over"].items():
                    print(f"{'':9}   not {name}: {why}")
            return 0
        if args.command == "check":
            wrong = 0
            for path in args.bundle:
                problems = validate(json.loads(path.read_text()))
                for problem in problems:
                    print(f"  {problem}")
                print(f"{path}: {'a usable bundle' if not problems else f'{len(problems)} problem(s)'}")
                wrong += bool(problems)
            return 1 if wrong else 0
        if args.command == "part":
            answer = analysers.ANALYSERS[args.analyser](args.track)
            print(json.dumps({key: value for key, value in answer.items() if key != "stems"}))
            return 0
        track = args.track.expanduser().resolve()
        if not track.exists():
            raise WorkerError(f"{track} does not exist")
        if args.command == "show":
            path = stored(track)
            if path is None:
                raise WorkerError(f"{track.name} has no stored bundle yet (worker.py analyse makes one)")
            print(describe(json.loads(path.read_text())["analysis"]))
            print(path)
            return 0
        if args.stems in stem_sources.HOSTED and not args.spend:
            raise WorkerError(f"{args.stems} is a hosted service and bills for every file it has not separated before; add --spend to allow it")
        options = dict(directory=args.stem_dir.expanduser().resolve()) if args.stem_dir else None
        path = bundle(track, stale="reanalyse" if args.reanalyse or args.stems else "keep", stems=args.stems, stem_options=options, force=args.reanalyse)
        made = json.loads(path.read_text())
        print(describe(made["analysis"]))
        print(f"  roles     {', '.join(made['roles'])}")
        print(path)
        return 0
    except WorkerError as error:
        print(f"worker: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
