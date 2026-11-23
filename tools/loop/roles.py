"""Musical roles: what a scene asks for, bound to what a bundle carries.

A scene does not name signals or event streams. It declares roles (`//! roles: kick,
energy`) and reads `roles.kick`, `roles.energy`; the bundle's `roles` table says what
each is bound to. The engine refuses to load a scene whose roles the bundle does not
provide (packages/visualiser/src/roles.rs).

This module is where the loop's bundles get that table. `bind` takes a package plus
whatever musical facts are known about the track (beats, downbeats, sections, drum
hits) and adds the event streams, the derived signals and the role bindings. A role
is bound when something real stands behind it. A bundle made with no bar lines has no
`downbeat` role, and a scene that needs one will say so. But a role that was looked
for and found empty is still bound: a track with no hi-hats has a `hat` role with no
events in it, and a scene's hat-driven parts simply stay still.

The role set, version 0. The type never varies: a scene can rely on `kick` being
events and `energy` being a signal on every bundle.

    events    beat              every beat
              downbeat          the first beat of every bar
              onset             every audible event
              kick, snare, hat  drum hits by type
              hit               the blows the whole picture may answer: kicks and snares, or the
                                strongest onsets where there are none, never closer than 0.5 s
              section           the start of each section; weight is how big the change is

    signals   energy            overall loudness, 0 to 1
              brightness        where the spectrum's weight sits, 0 (dark) to 1 (bright)
              flux              how fast the spectrum is changing
              onset_strength    the envelope the onsets were picked from
              bass              how loud the bass is (the bass stem if there are stems, else the bass band)
              drums             how loud the drums are (needs stems)
              melody            how loud everything else is: neither drums nor bass (nor, where the
                                separation gives them, vocals). Needs stems
              vocals            how loud the voice is (needs stems that have one)
              beat_phase        0 to 1 across each beat
              bar_phase         0 to 1 across each bar (needs downbeats)
              section_progress  0 to 1 across each section
              section_intensity how loud each section is against the loudest, held for the section

Which analyser supplies those facts, and where the finished bundle is kept, is the
analysis worker's business (worker.py).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

import analyse
import analysers

ROLES_VERSION = "roles-4"
DERIVED_RATE = 50.0  # samples per second of the derived signals: smooth at any frame rate
EVENT_ROLES = ("beat", "downbeat", "onset", "kick", "snare", "hat", "hit", "section")
HIT_MIN_GAP_S = 0.5  # whole-frame blows this far apart stay under the three-flashes-a-second limit
# The model environment's Python (tools/loop/models/setup.sh). The render loop runs
# under the system Python, which has no models, and borrows this one when it is there.
MODEL_PYTHON = Path(__file__).resolve().parents[2] / ".loop" / "venv" / "bin" / "python"
# A drum stem this far below the mix is what separation leaves behind on a track
# with no drums (-47 dB on the drumless test track, -2 dB on the one with drums).
DRUMLESS_DB = -30.0
SIGNAL_ROLES = ("energy", "brightness", "flux", "onset_strength", "bass", "drums", "melody", "vocals", "beat_phase", "bar_phase", "section_progress", "section_intensity")


def _stream(package: dict, name: str, events: list[tuple[float, float]]) -> None:
    """Add (or replace) a named event stream. Times in seconds, weights 0 to 1."""
    package["eventStreams"] = [s for s in package.get("eventStreams", []) if s["name"] != name]
    package["eventStreams"].append({"name": name, "events": [{"time": round(float(t), 4), "weight": round(float(min(max(w, 0.01), 1.0)), 4)} for t, w in sorted(events)]})


def _custom(package: dict, name: str, values: np.ndarray) -> None:
    package["customSignals"] = [s for s in package.get("customSignals", []) if s["name"] != name]
    package["customSignals"].append({"id": f"role-{name}", "name": name, "rate": DERIVED_RATE, "values": np.round(values, 4).tolist()})


def phase(marks: list[float], duration: float) -> np.ndarray:
    """A ramp from 0 to 1 between each pair of marks, sampled at DERIVED_RATE.

    Before the first mark and after the last it carries on at the spacing of the
    nearest pair, so a beat grid that starts late still gives a steady phase.
    """
    t = np.arange(int(np.ceil(duration * DERIVED_RATE)) + 1) / DERIVED_RATE
    marks = sorted(marks)
    if len(marks) < 2:
        return np.zeros(len(t))
    m = np.array(marks, dtype=float)
    lead, tail = m[1] - m[0], m[-1] - m[-2]
    before = np.arange(m[0] - lead, t[0] - lead, -lead)[::-1] if lead > 1e-6 else np.array([])
    after = np.arange(m[-1] + tail, t[-1] + 2 * tail, tail) if tail > 1e-6 else np.array([])
    grid = np.concatenate([before, m, after])
    i = np.clip(np.searchsorted(grid, t, side="right") - 1, 0, len(grid) - 2)
    return np.clip((t - grid[i]) / np.maximum(grid[i + 1] - grid[i], 1e-6), 0.0, 1.0)


def section_signals(starts: list[float], duration: float, energy: np.ndarray, energy_rate: float) -> tuple[np.ndarray, np.ndarray]:
    """Progress through each section (0 to 1), and each section's loudness against the loudest."""
    t = np.arange(int(np.ceil(duration * DERIVED_RATE)) + 1) / DERIVED_RATE
    edges = np.array(sorted({0.0, *[s for s in starts if 0.0 < s < duration], duration}))
    i = np.clip(np.searchsorted(edges, t, side="right") - 1, 0, len(edges) - 2)
    progress = np.clip((t - edges[i]) / np.maximum(edges[i + 1] - edges[i], 1e-6), 0.0, 1.0)
    level = []
    for a, b in zip(edges[:-1], edges[1:]):
        chunk = energy[int(a * energy_rate) : max(int(b * energy_rate), int(a * energy_rate) + 1)]
        level.append(float(np.mean(chunk)) if len(chunk) else 0.0)
    level = np.array(level) / (max(level) or 1.0)
    return progress, level[i]


def hits(package: dict, drums: dict[str, list[tuple[float, float]]] | None) -> list[tuple[float, float]]:
    """The moments worth a whole-frame blow, heaviest first, kept at least HIT_MIN_GAP_S apart.

    Kicks and snares when the bundle has enough of them; otherwise the strongest
    third of its onsets. Scenes use `kick`, `snare` and `hat` for small local
    movements at any rate, and `hit` for anything that flashes or jolts the frame.
    """
    candidates = [(t, w) for kind in ("kick", "snare") for t, w in (drums or {}).get(kind, [])]
    if len(candidates) < 8:
        streams = {s["name"]: s["events"] for s in package.get("eventStreams", [])}
        events = streams.get("events") or streams.get("onsetPeaks") or []
        if events:
            floor = float(np.percentile([e["weight"] for e in events], 67))
            candidates = [(e["time"], e["weight"]) for e in events if e["weight"] >= floor]
    kept: list[tuple[float, float]] = []
    for t, w in sorted(candidates, key=lambda c: (-c[1], c[0])):
        if all(abs(t - other) >= HIT_MIN_GAP_S for other, _ in kept):
            kept.append((t, w))
    return sorted(kept)


def bind(
    package: dict,
    beats: list[float] | None = None,
    downbeats: list[float] | None = None,
    sections: list[tuple[float, float]] | None = None,
    drums: dict[str, list[tuple[float, float]]] | None = None,
) -> dict:
    """Add roles to a package, in place, from the package itself and the facts given.

    `sections` are (start time, strength) and `drums` maps kick/snare/hat to (time,
    weight). The package must already carry its mix signals; `onset` is bound to
    its `events` or `onsetPeaks` stream. Returns the package.
    """
    duration = float(package["durationSec"])
    roles: dict[str, dict] = {}
    signal_names = {s["name"] for s in package.get("signals", [])}
    stream_names = {s["name"] for s in package.get("eventStreams", [])}

    for role, signal, script_name in (("energy", "energy", "energy"), ("brightness", "spectralCentroid", "centroid"), ("flux", "spectralFlux", "flux"), ("onset_strength", "onsetEnvelope", "onset")):
        if signal in signal_names:
            roles[role] = {"signal": script_name}
    for name in ("events", "onsetPeaks"):
        if name in stream_names:
            roles["onset"] = {"events": name}
            break

    stems = {label: stem_id for stem_id, label in package.get("availableStems", [])}
    stem_features = {(s["label"], s["feature"]) for s in package.get("stemSignals", [])}
    band_features = {(s["label"], s["feature"]) for s in package.get("bandSignals", [])}
    if ("Bass", "energy") in stem_features and "Bass" in stems:
        roles["bass"] = {"stem": "Bass", "feature": "energy"}
    elif ("Bass", "energy") in band_features:
        roles["bass"] = {"band": "Bass", "feature": "energy"}
    for role, label in (("drums", "Drums"), ("melody", "Other"), ("vocals", "Vocals")):
        if (label, "energy") in stem_features and label in stems:
            roles[role] = {"stem": label, "feature": "energy"}

    if beats and len(beats) >= 2:
        _stream(package, "beat", [(t, 1.0) for t in beats])
        roles["beat"] = {"events": "beat"}
        _custom(package, "beat_phase", phase(beats, duration))
        roles["beat_phase"] = {"custom": "beat_phase"}
    if downbeats and len(downbeats) >= 2:
        _stream(package, "downbeat", [(t, 1.0) for t in downbeats])
        roles["downbeat"] = {"events": "downbeat"}
        _custom(package, "bar_phase", phase(downbeats, duration))
        roles["bar_phase"] = {"custom": "bar_phase"}
    if drums is not None:
        # Someone listened for drums, so each type is bound even when there are none
        # of it: an empty stream says "this track has no hi-hats", which is true.
        for kind in ("kick", "snare", "hat"):
            _stream(package, kind, drums.get(kind) or [])
            roles[kind] = {"events": kind}
    blows = hits(package, drums)
    if blows:
        _stream(package, "hit", blows)
        roles["hit"] = {"events": "hit"}
    if sections is not None and "energy" in signal_names:
        _stream(package, "section", sections or [(0.0, 1.0)])
        roles["section"] = {"events": "section"}
        energy = next(s for s in package["signals"] if s["name"] == "energy")
        progress, intensity = section_signals([t for t, _ in sections], duration, np.asarray(energy["values"], dtype=float), energy["rate"])
        _custom(package, "section_progress", progress)
        _custom(package, "section_intensity", intensity)
        roles["section_progress"] = {"custom": "section_progress"}
        roles["section_intensity"] = {"custom": "section_intensity"}

    package["roles"] = dict(sorted(roles.items()))
    return package


def stem_levels(files: dict[str, Path], params: dict) -> tuple[list[dict], list[list[str]]]:
    """Each separated stem's loudness over time, for a bundle's `stemSignals`.

    Each stem is scaled so that its own loudest moments are 1: a quiet voice still
    uses the whole range. The exception is a stem with nothing in it (more than
    30 dB below the loudest stem), which is scaled like the loudest one and so
    stays near zero, instead of having the separation's leftovers stretched to
    full height.
    """
    frame_rate = analyse.SAMPLE_RATE / params["hop"]
    levels = {}
    for label, path in sorted(files.items()):
        mag = analyse.spectrogram(analysers.decode(path, analyse.SAMPLE_RATE), params["n_fft"], params["hop"])
        levels[label] = np.sqrt((mag**2).mean(axis=1))
    top = max((float(np.percentile(v, 99.5)) for v in levels.values() if len(v)), default=0.0) or 1.0
    signals, available = [], []
    for label, rms in levels.items():
        stem_id = f"stem-{label}"
        available.append([stem_id, label.capitalize()])
        own = float(np.percentile(rms, 99.5)) if len(rms) else 0.0
        amplitude = np.clip(rms / (own if own >= top * 10 ** (DRUMLESS_DB / 20) else top), 0.0, 1.0)
        for feature, values in (("amplitude", amplitude), ("energy", amplitude**2)):
            signals.append({"stemId": stem_id, "label": label.capitalize(), "feature": feature, "rate": frame_rate, "values": np.round(values, 5).tolist()})
    return signals, available
