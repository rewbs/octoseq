#!/usr/bin/env python3
"""Checks that the loop's own instruments work, using inputs with known answers.

    python3 tools/loop/selftest.py

Run this after changing analyse.py or metrics.py. A metric that cannot tell a
strobe from a slow fade would make every loop result meaningless.
"""

from __future__ import annotations

import json
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyse  # noqa: E402
import director  # noqa: E402
import metrics  # noqa: E402

FPS = 30
H, W = metrics.METRIC_H, metrics.METRIC_W
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        failures.append(name)


def click_track(bpm: float, seconds: float = 20.0) -> np.ndarray:
    sr = analyse.SAMPLE_RATE
    samples = np.zeros(int(seconds * sr), dtype=np.float32)
    click = np.sin(2 * np.pi * 1000 * np.arange(int(0.01 * sr)) / sr).astype(np.float32)
    t = 0.25
    while t < seconds - 0.1:
        i = int(t * sr)
        samples[i : i + len(click)] += click
        t += 60.0 / bpm
    return samples


def write_wav(path: Path, samples: np.ndarray) -> None:
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(analyse.SAMPLE_RATE)
        f.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())


def frames_from_luma(luma: np.ndarray) -> np.ndarray:
    """(T, H, W) floats in [0, 1] -> (T, H, W, 3) uint8 grey frames."""
    return np.repeat((np.clip(luma, 0, 1) * 255).astype(np.uint8)[..., None], 3, axis=3)


def test_analyser() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for bpm in (90.0, 120.0, 140.0):
            wav = Path(tmp) / f"click{int(bpm)}.wav"
            write_wav(wav, click_track(bpm))
            pkg = analyse.analyse(wav)
            seg = pkg["musicalTime"]["segments"][0]
            check(f"tempo of {bpm:.0f} BPM click track", abs(seg["bpm"] - bpm) <= 1.0, f"-> {seg['bpm']}")
            period = 60.0 / bpm
            phase_err = abs((seg["phaseOffset"] - 0.25 + period / 2) % period - period / 2)
            check(f"beat phase at {bpm:.0f} BPM", phase_err <= 0.04, f"-> off by {phase_err * 1000:.0f} ms")
            onsets = len(pkg["eventStreams"][0]["events"])
            expected = int((20.0 - 0.35) / period) + 1
            check(f"onset count at {bpm:.0f} BPM", abs(onsets - expected) <= 2, f"-> {onsets} of {expected}")
        wav = Path(tmp) / "click120.wav"
        write_wav(wav, click_track(120.0))
        check("analysis is deterministic", analyse.analyse(wav) == analyse.analyse(wav))
        for sig in analyse.analyse(wav)["signals"]:
            v = np.asarray(sig["values"])
            check(f"signal {sig['name']} is in [0, 1]", v.min() >= 0 and v.max() <= 1.0)


def test_metrics() -> None:
    n = FPS * 10
    t = np.arange(n) / FPS
    yy, xx = np.mgrid[0:H, 0:W]
    pkg = {"signals": []}

    black = metrics.compute(frames_from_luma(np.zeros((n, H, W))), FPS, pkg)
    check("black clip is all black", black["black_fraction"] == 1.0)
    check("black clip is static", black["static_fraction"] == 1.0)

    white = metrics.compute(frames_from_luma(np.ones((n, H, W))), FPS, pkg)
    check("white clip is blown out", white["blown_fraction"] == 1.0)

    strobe_luma = (0.5 + 0.4 * np.sign(np.sin(2 * np.pi * 8 * t)))[:, None, None] * np.ones((n, H, W))
    strobe = metrics.compute(frames_from_luma(strobe_luma), FPS, pkg)
    check("8 Hz strobe is flagged", strobe["max_flashes_per_sec"] > 3, f"-> {strobe['max_flashes_per_sec']}")
    check("strobe is jerky", strobe["jerkiness"] > 1.0, f"-> {strobe['jerkiness']:.2f}")

    # A small bright square sitting still on a flat grey background.
    square = np.full((n, H, W), 0.3)
    square[:, 30:40, 60:70] = 0.9
    small = metrics.compute(frames_from_luma(square), FPS, pkg)
    check("small object on flat background has low active area", small["active_area"] < 0.1, f"-> {small['active_area']:.2f}")
    check("still object is static", small["static_fraction"] > 0.9)

    # A full-frame pattern drifting smoothly.
    phase = 2 * np.pi * (xx[None] / 24.0 + yy[None] / 31.0 + t[:, None, None] * 0.4)
    flow = metrics.compute(frames_from_luma(0.5 + 0.35 * np.sin(phase)), FPS, pkg)
    check("flowing full-frame pattern has high active area", flow["active_area"] > 0.9, f"-> {flow['active_area']:.2f}")
    check("flowing pattern is not static", flow["static_fraction"] == 0.0)
    check("flowing pattern is smooth", flow["jerkiness"] < 0.4, f"-> {flow['jerkiness']:.2f}")
    check("flowing pattern does not flash", flow["max_flashes_per_sec"] <= 3, f"-> {flow['max_flashes_per_sec']}")
    check("smooth flow is smoother than strobe", flow["jerkiness"] < strobe["jerkiness"])

    # Brightness that follows an audio envelope should register as in sync.
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 2 * t) * np.sin(2 * np.pi * 0.3 * t)
    synced_pkg = {"signals": [{"name": "energy", "rate": FPS, "values": envelope.tolist()}]}
    pulse = (0.2 + 0.6 * envelope)[:, None, None] * (0.6 + 0.4 * np.sin(xx / 9.0))[None]
    synced = metrics.compute(frames_from_luma(pulse), FPS, synced_pkg)
    check("brightness following the audio is in sync", synced["audio_sync"] > 0.9, f"-> {synced['audio_sync']:.2f}")
    unsynced = metrics.compute(frames_from_luma(0.5 + 0.35 * np.sin(phase)), FPS, synced_pkg)
    check("unrelated motion is not in sync", unsynced["audio_sync"] < 0.3, f"-> {unsynced['audio_sync']:.2f}")

    # A clip whose second half looks different should show variety.
    two_looks = 0.5 + 0.35 * np.sin(phase)
    two_looks[n // 2 :] = 0.15 + 0.1 * np.sin(phase[n // 2 :] * 3)
    varied = metrics.compute(frames_from_luma(two_looks), FPS, pkg)
    check("clip that changes look has more variety", varied["variety"] > flow["variety"] + 0.05, f"-> {varied['variety']:.2f} vs {flow['variety']:.2f}")


    # --- What review 1 found, and the metrics that now catch it.
    hits = np.arange(1.0, 9.0, 0.5)
    hit_pkg = {"signals": [], "eventStreams": [{"name": "kick", "events": [{"time": float(h), "weight": 1.0} for h in hits]}]}
    base = 0.5 + 0.2 * np.sin(xx / 9.0)[None] * np.ones((n, 1, 1))
    # The same pattern growing brighter around each hit: once as a bell centred on the hit, once as a jump at it.
    bell = sum(np.exp(-0.5 * ((t - h) / 0.08) ** 2) for h in hits)
    jump = sum(np.where(t >= h, np.exp(-(t - h) / 0.12), 0.0) for h in hits)
    eased = metrics.compute(frames_from_luma(base * (0.7 + 0.3 * bell[:, None, None])), FPS, hit_pkg)
    struck = metrics.compute(frames_from_luma(base * (0.7 + 0.3 * jump[:, None, None])), FPS, hit_pkg)
    check("a picture that jumps on the hits has punch", struck["punch"] > 3.0, f"-> {struck['punch']:.1f}")
    check("a picture that eases through the hits has less", eased["punch"] < 0.6 * struck["punch"], f"-> {eased['punch']:.1f} vs {struck['punch']:.1f}")
    check("no hits, no punch score", "punch" not in flow)

    long_n = FPS * 24
    long_t = np.arange(long_n) / FPS
    rings = 0.5 + 0.35 * np.sin(np.hypot(xx - W / 2, yy - H / 2)[None] / 4.0 - long_t[:, None, None] * 3.0)
    same = metrics.compute(frames_from_luma(rings), FPS, pkg)
    cut = rings.copy()
    bars = 0.5 + 0.35 * np.sin(xx[None] / 5.0 + long_t[:, None, None] * 3.0) * np.ones((long_n, H, 1))
    for start in range(8, 24, 16):
        cut[start * FPS : (start + 8) * FPS] = bars[start * FPS : (start + 8) * FPS]
    changed = metrics.compute(frames_from_luma(cut), FPS, pkg)
    check("one composition held throughout does not change look", same["look_change"] < 0.1, f"-> {same['look_change']:.2f}")
    check("a cut to another composition does", changed["look_change"] > same["look_change"] + 0.25, f"-> {changed['look_change']:.2f}")

    def coloured(hues: list[float], level: float) -> np.ndarray:
        """Vertical stripes of the given hues at one brightness."""
        import colorsys

        frame = np.zeros((H, W, 3), dtype=np.uint8)
        for i, hue in enumerate(hues):
            a, b = i * W // len(hues), (i + 1) * W // len(hues)
            frame[:, a:b] = (np.array(colorsys.hsv_to_rgb(hue, 0.9, level)) * 255).astype(np.uint8)
        return np.repeat(frame[None], FPS * 2, axis=0)

    fog = metrics.compute(coloured([0.85, 0.86, 0.84], 0.75), FPS, pkg)
    several = metrics.compute(coloured([0.0, 0.33, 0.6], 0.75), FPS, pkg)
    dark = coloured([0.0, 0.33, 0.6], 0.9)
    dark[:, :, : W // 2 : 2] = 0  # the same colours as sparse bright lines on black
    lines = metrics.compute(dark, FPS, pkg)
    check("one colour everywhere is flagged", fog["one_hue_share"] > 0.9, f"-> {fog['one_hue_share']:.2f}")
    check("three colours are not", several["one_hue_share"] < 0.6, f"-> {several['one_hue_share']:.2f}")
    check("a frame of saturated mid-tone is a wash", fog["wash"] > 0.8, f"-> {fog['wash']:.2f}")
    check("bright colour on black is less of one", lines["wash"] < fog["wash"] - 0.2, f"-> {lines['wash']:.2f}")


def test_director() -> None:
    """The director's rules, on a made-up bundle: 60 s, sections at 0, 20 and 26 s, a beat every half second."""
    package = {
        "durationSec": 60.0,
        "roles": {r: {"events": r} for r in ("hit", "kick", "snare", "hat", "beat", "section")}
        | {"energy": {"signal": "energy"}, "bass": {"band": "Bass", "feature": "energy"}, "section_intensity": {"custom": "section_intensity"}},
        "eventStreams": [
            {"name": "section", "events": [{"time": 0.0, "weight": 1.0}, {"time": 20.0, "weight": 0.5}, {"time": 26.0, "weight": 0.5}]},
            {"name": "beat", "events": [{"time": i * 0.5, "weight": 1.0} for i in range(120)]},
        ],
        "customSignals": [{"id": "x", "name": "section_intensity", "rate": 1.0, "values": [0.2] * 20 + [1.0] * 40}],
    }
    show = director.direct(package, seed=11)
    starts = [s["start"] for s in show["segments"]]
    holds = [b - a for a, b in zip(starts, starts[1:] + [60.0])]
    check("director: no look is held longer than the limit", max(holds) <= director.MAX_HOLD_S + 1e-6, f"-> longest {max(holds):.1f} s")
    check("director: nor shorter than the minimum", min(holds) >= director.MIN_HOLD_S, f"-> shortest {min(holds):.1f} s")
    check("director: cuts at every section start", all(t in starts for t in (0.0, 20.0, 26.0)))
    check("director: cuts inside a section land on the beat", all(abs(t * 2 - round(t * 2)) < 1e-6 for t in starts))
    scenes = [s["scene"] for s in show["segments"]]
    check("director: never the same scene twice running", all(a != b for a, b in zip(scenes, scenes[1:])))
    palettes = {s["start"]: s["palette"] for s in show["segments"]}
    kept = all(s["palette"] == p["palette"] for p, s in zip(show["segments"], show["segments"][1:]) if not s["new_section"])
    check("director: a new palette at each section, the same one within it", kept and palettes[20.0] != palettes[starts[starts.index(20.0) - 1]])
    check("director: louder sections run faster", show["segments"][-1]["speed"] > show["segments"][0]["speed"])
    check("director: the same seed gives the same show", director.direct(package, seed=11) == show)
    vivid = director.direct(package, seed=11, vivid=True)
    same_cuts = [(s["start"], s["scene"], s["palette"]) for s in vivid["segments"]] == [(s["start"], s["scene"], s["palette"]) for s in show["segments"]]
    darker = all(v <= c for a, b in zip(vivid["segments"], show["segments"]) for x, y in zip(a["colours"], b["colours"]) for v, c in zip(x, y))
    check("director: a vivid show is the same show in stronger colours", same_cuts and darker and vivid != show)
    others = {json.dumps(director.direct(package)["segments"]) for _ in range(6)}
    check("director: without a seed, runs differ", len(others) > 1, f"-> {len(others)} different shows in 6 runs")
    with tempfile.TemporaryDirectory() as tmp:
        path = director.write(show, Path(tmp))
        written = json.loads(path.read_text())
        first = (Path(tmp) / written["segments"][0]["script"]).read_text()
        check("director: the show pins a dressed copy of each scene", "// @style" in first and str(show["segments"][0]["speed"]) in first)


if __name__ == "__main__":
    test_analyser()
    test_metrics()
    test_director()
    print(f"\n{len(failures)} failed" if failures else "\nall instrument checks passed")
    sys.exit(1 if failures else 0)
