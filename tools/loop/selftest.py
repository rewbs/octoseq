#!/usr/bin/env python3
"""Checks that the loop's own instruments work, using inputs with known answers.

    python3 tools/loop/selftest.py

Run this after changing analyse.py or metrics.py. A metric that cannot tell a
strobe from a slow fade would make every loop result meaningless.
"""

from __future__ import annotations

import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyse  # noqa: E402
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


if __name__ == "__main__":
    test_analyser()
    test_metrics()
    print(f"\n{len(failures)} failed" if failures else "\nall instrument checks passed")
    sys.exit(1 if failures else 0)
