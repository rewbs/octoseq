#!/usr/bin/env python3
"""Turn a tracker module straight into an analysis bundle with known-correct events.

    python3 tools/loop/perfect_bundle.py song.xm              # -> .loop/bundles/song/
    python3 tools/loop/run.py --tracks .loop/modules/train/song.xm

No analysis is involved in the events: they come from the instrumented player's
log of what was actually triggered, timed by what is actually heard. Scenes can be
developed against this bundle without analysis errors muddying the picture, and
the same scene can later be rendered from an analysed bundle to see what the
errors cost.

The bundle is an Interpretation Package v1 (the format the engine reads today):

- event streams from the reference: every merged event, one stream per stem
  (drums, bass, other), one per attack type, one per sample, plus section starts
- musical roles (see roles.py) bound to the truth: beats and downbeats from the
  module's grid, kicks, snares and hats as the reference types them, sections
- stem signals computed from the true channel stems, not from separation
- musical time from the module's own row and tempo grid, including tempo changes
- mix signals and frequency bands measured from the rendered audio, as usual

Output: <dir>/package.json and <dir>/audio.flac (the render the bundle describes).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyse  # noqa: E402
import analysers  # noqa: E402
import modref  # noqa: E402
import roles  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".loop" / "cache" / "references"
OUT = ROOT / ".loop" / "bundles"
PRIMARY_TIME = modref.HEARD
AUDIO = "audio.flac"


def _stream(name: str, events: list[dict]) -> dict:
    return {"name": name, "events": [{"time": round(e[PRIMARY_TIME], 4), "weight": round(max(e["weight"], 0.01), 4)} for e in events]}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def musical_time(reference: dict) -> dict:
    """Tempo segments from the beat grid: a new segment wherever the beat length changes."""
    beats = reference["grid"]["beats"]
    segments = []
    if len(beats) >= 2:
        start = 0
        intervals = np.diff(beats)
        for i in range(1, len(intervals) + 1):
            if i == len(intervals) or abs(intervals[i] - intervals[start]) > 0.0005:
                segments.append(dict(first=beats[start], end=beats[i] if i < len(intervals) else reference["duration"] + 1.0, bpm=60.0 / float(np.mean(intervals[start:i]))))
                start = i
    out = []
    for n, seg in enumerate(segments):
        out.append({
            "id": f"seg-{n + 1}", "bpm": round(seg["bpm"], 4), "phaseOffset": round(seg["first"], 5),
            "startTime": 0 if n == 0 else round(seg["first"], 5), "endTime": round(seg["end"], 5),
            "provenance": {"source": "manual_entry", "promotedAt": analyse.EPOCH},
        })  # fmt: skip
    return {"version": 1, "segments": out, "createdAt": analyse.EPOCH, "modifiedAt": analyse.EPOCH}


def stem_signals(work: Path, reference: dict, params: dict) -> tuple[list[dict], list[list[str]]]:
    """Signals for each stem, measured on the true stem audio."""
    by_class: dict[str, np.ndarray] = {}
    for channel, cls in reference["channel_stem"].items():
        audio = analysers.decode(work / "stems" / f"ch{int(channel):02d}.wav", analyse.SAMPLE_RATE)
        by_class[cls] = by_class.get(cls, 0) + audio
    frame_rate = analyse.SAMPLE_RATE / params["hop"]
    freqs = np.fft.rfftfreq(params["n_fft"], 1.0 / analyse.SAMPLE_RATE)
    signals, available = [], []
    for cls in sorted(by_class):
        mag = analyse.spectrogram(by_class[cls], params["n_fft"], params["hop"])
        rms = np.sqrt((mag**2).mean(axis=1))
        flux = analyse.flux_of(mag, params["log_gain"])
        features = {
            "amplitude": rms, "energy": rms**2, "flux": flux,
            "onset": analyse.onset_of(flux, frame_rate, params["floor_window_s"]),
            "centroid": analyse.centroid_of(mag, freqs),
        }  # fmt: skip
        stem_id = f"stem-{cls}"
        available.append([stem_id, cls.capitalize()])
        for feature, values in features.items():
            signals.append({
                "stemId": stem_id, "label": cls.capitalize(), "feature": feature,
                "rate": frame_rate, "values": np.round(analyse.normalise(values), 5).tolist(),
            })  # fmt: skip
    return signals, available


def build(module: Path, out_dir: Path | None = None) -> Path:
    """Write the bundle for `module`. Returns the output directory."""
    out_dir = out_dir or OUT / module.stem
    reference, work = modref.build_cached(module, CACHE, keep_stems=True)
    marker = out_dir / "source.json"
    stamp = dict(module_sha256=reference["module_sha256"], reference=reference["version"], analyser=analyse.ANALYSER_VERSION, roles=roles.ROLES_VERSION)
    if marker.exists() and json.loads(marker.read_text()) == stamp and (out_dir / "package.json").exists():
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(work / modref.MIX, out_dir / AUDIO)

    params = analyse.load_params()
    package = analyse.analyse(out_dir / AUDIO, params)  # mix signals and bands, measured from the audio

    merged = reference["merged"]
    heard = [e for e in reference["events"] if e["audible"] and e["weight"] > 0]
    streams = [_stream("onsetPeaks", merged), _stream("events", merged)]
    for cls in ("drums", "bass", "other"):
        streams.append(_stream(cls, [e for e in heard if e["stem"] == cls]))
    for kind in ("percussive", "soft", "legato"):
        streams.append(_stream(kind, [e for e in merged if e["kind"] == kind]))
    names = json.loads((work / "events.json").read_text())["samples"]
    for sample in sorted({e["sample"] for e in heard}):
        label = _slug(names[sample - 1]) if 0 < sample <= len(names) and names[sample - 1].strip() else ""
        streams.append(_stream(f"sample_{sample:02d}" + (f"_{label}" if label else ""), [e for e in heard if e["sample"] == sample]))
    sections = [{"time": round(s["time"], 4), "weight": s["strength"]} for s in reference["sections"]]

    package["eventStreams"] = streams
    package["authoredEventStreams"] = [{"name": "sections", "events": sections}]
    package["musicalTime"] = musical_time(reference)
    package["stemSignals"], package["availableStems"] = stem_signals(work, reference, params)
    package["projectName"] = reference["title"] or module.stem
    package["loop"] = dict(
        perfect=True, module=module.name, module_sha256=reference["module_sha256"], reference=reference["version"],
        sections=reference["sections"], bpm=reference["grid"]["bpm"], channel_stem=reference["channel_stem"],
    )  # fmt: skip
    # Roles, bound to the truth: the module's own beats and bars, its sections, and
    # its kicks, snares and hats as the reference types them.
    roles.bind(
        package,
        beats=reference["grid"]["beats"],
        downbeats=reference["grid"]["downbeats"],
        sections=[(s["time"], s["strength"]) for s in reference["sections"]],
        drums={kind: [(t, w) for t, w in reference["drums"][kind]] for kind in modref.DRUM_TYPES},
    )
    (out_dir / "package.json").write_text(json.dumps(package))
    marker.write_text(json.dumps(stamp))
    return out_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("module", type=Path)
    parser.add_argument("-o", "--out", type=Path)
    args = parser.parse_args()
    out = build(args.module.resolve(), args.out)
    package = json.loads((out / "package.json").read_text())
    print(f"{out / 'package.json'}")
    print(f"  {len(package['eventStreams'])} event streams, {len(package['availableStems'])} stems, {len(package['musicalTime']['segments'])} tempo segment(s), {len(package['authoredEventStreams'][0]['events'])} sections")
    print(f"{out / AUDIO}")


if __name__ == "__main__":
    main()
