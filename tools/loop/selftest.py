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
import motion  # noqa: E402
import show as shows  # noqa: E402
import metrics  # noqa: E402
import worker  # noqa: E402

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

    # The response figures, on pictures whose right answer is known: one that jumps
    # on every blow and at no other time, the same jumps a quarter of a second
    # late, and one that slides steadily and never jumps.
    import response

    blows = [1.0 + 0.5 * i for i in range(12)] + [7.0 + 0.1 * i for i in range(8)]
    drummed = {"durationSec": 10.0, "roles": {}, "eventStreams": [{"name": "kick", "events": [{"time": t, "weight": 1.0} for t in blows]}]}
    texture = np.random.default_rng(3).random((72, 128)) * 0.8

    def picture(jump_times: list[float]) -> np.ndarray:
        shown, out = texture, []
        frames_of = {int(round(t * 30)) + 1 for t in jump_times}
        for i in range(300):
            if i in frames_of:
                shown = np.roll(shown, 17, axis=1)
            out.append(shown)
        return np.stack(out)

    on_time = response.compute(picture(blows), 30.0, drummed)
    late = response.compute(picture([t + 0.25 for t in blows[:12]]), 30.0, drummed)
    sliding = response.compute(np.stack([np.roll(texture, i, axis=1) for i in range(300)]), 30.0, drummed)
    check("response: a picture that jumps on every blow answers them all, rolls included", on_time["answered"] > 0.95 and on_time["answered_rolls"] > 0.95 and on_time["dead_time"] == 0.0 and on_time["stray_jumps"] == 0.0, f"-> {on_time}")
    check("response: the same jumps a quarter of a second late answer nothing, and are stray", late["answered"] < 0.2 and late["stray_jumps"] > 0.8, f"-> {late}")
    check("response: a picture that only slides answers nothing", sliding.get("answered", 0.0) < 0.05 and sliding["dead_time"] > 0.95, f"-> {sliding}")
    check("response: a jump is most of the frame when the whole frame moves", on_time["jump_size"] > 0.5, f"-> {on_time['jump_size']:.2f}")

    # Twitch: the same blows answered by a blip (there one frame, gone the next),
    # by a hit that eases back over eight frames, and by a step that stays, on a
    # pattern that can be moved by any distance.
    rows, cols = np.mgrid[0:72, 0:128]
    frames_of = {int(round(t * 30)) + 1 for t in blows}

    def moved_by(distance: float) -> np.ndarray:
        return 0.4 + 0.4 * np.sin(2 * np.pi * (cols - distance) / 24.0) * np.cos(2 * np.pi * rows / 36.0)

    def answering(ease_frames: int) -> np.ndarray:
        age, out = 99, []
        for i in range(300):
            age = 0 if i in frames_of else age + 1
            out.append(moved_by(12.0 * max(0.0, 1.0 - age / ease_frames) ** 2))
        return np.stack(out)

    def stepping() -> np.ndarray:
        count, out = 0, []
        for i in range(300):
            count += i in frames_of
            out.append(moved_by(5.0 * count))
        return np.stack(out)

    blip = response.compute(answering(1), 30.0, drummed)
    eased = response.compute(answering(8), 30.0, drummed)
    stays = response.compute(stepping(), 30.0, drummed)
    check("response: a blip is taken back at once", blip["undone"] > 0.9 and blip["answered"] > 0.95, f"-> {blip}")
    check("response: a hit that eases back is not", eased["undone"] < 0.4 and eased["answered"] > 0.95, f"-> {eased}")
    check("response: nor is a step that stays, and it answers every blow of a roll", stays["undone"] < 0.05 and stays["answered"] > 0.95 and stays["answered_rolls"] > 0.95, f"-> {stays}")
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
    # Wash is not to be kept down but to vary: a clip that is misty for half its
    # length and crisp for the rest has a wide spread, and one look held has none.
    misty, crisp = coloured([0.85, 0.86, 0.84], 0.75), dark
    both = metrics.compute(np.concatenate([misty] * 4 + [crisp] * 4), FPS, pkg)
    held = metrics.compute(np.concatenate([misty] * 8), FPS, pkg)
    check("a clip that is misty and then crisp has a wide wash spread", both.get("wash_spread", 0) > 0.2, f"-> {both.get('wash_spread', 0):.2f}")
    check("one look held throughout has none", held.get("wash_spread", 1) < 0.02, f"-> {held.get('wash_spread', 1):.2f}")


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
    blends = [s["transition"] for s in show["segments"]]
    cut_at_sections = all(b == 0.0 for s, b in zip(show["segments"], blends) if s["new_section"])
    blend_inside = all(b > 0.0 for s, b in zip(show["segments"], blends) if not s["new_section"])
    check("director: cuts at section starts and blends inside sections", cut_at_sections and blend_inside and any(blends))
    check("director: a blend is over well before the next change", all(b <= h / 3 + 1e-6 for b, h in zip(blends, holds)), f"-> longest {max(blends):.1f} s")
    places = [tuple(s["at"]) for s in show["segments"]]
    check("director: each look sits somewhere else in the frame than the last", all(a != b for a, b in zip(places, places[1:])) and len(set(places)) > 2)
    mists = [s["mist"] for s in show["segments"]]
    check("director: a crisp look follows a misty one, and a misty one a crisp", all((a < 0.5) != (b < 0.5) for a, b in zip(mists, mists[1:])), f"-> {mists[:6]}")
    check("director: louder sections run faster", show["segments"][-1]["speed"] > show["segments"][0]["speed"])
    answers = [s["answer"] for s in show["segments"]]
    check("director: each look answers a blow in a different way from the last, easing back and staying by turns", all((a in director.STAYING) != (b in director.STAYING) for a, b in zip(answers, answers[1:])) and set(answers) <= set(director.ANSWERS), f"-> {answers[:8]}")
    laid = [s["finish"] for s in show["segments"] if s["finish"]]
    check("director: some looks get a finish, never the same one twice running", set(laid) <= set(director.FINISHES.values()) and all(a != b for a, b in zip(laid, laid[1:])) and len(laid) < len(show["segments"]), f"-> {[s['finish'] for s in show['segments']][:12]}")
    no_finish = director.direct(package, seed=4, brief={"finishes": []})
    one_finish = director.direct(package, seed=4, brief={"finishes": ["ascii"]})
    check("director: a brief can ask for no finish, or for one kind only", not any(s["finish"] for s in no_finish["segments"]) and {s["finish"] for s in one_finish["segments"]} <= {0, director.FINISHES["ascii"]} and [s["scene"] for s in no_finish["segments"]] == [s["scene"] for s in one_finish["segments"]], f"-> {[s['finish'] for s in one_finish['segments']][:12]}")
    check("director: and harder in a louder section", show["segments"][-1]["kick"] > show["segments"][0]["kick"])
    check("director: the same seed gives the same show", director.direct(package, seed=11) == show)
    vivid = director.direct(package, seed=11, vivid=True)
    same_cuts = [(s["start"], s["scene"], s["palette"]) for s in vivid["segments"]] == [(s["start"], s["scene"], s["palette"]) for s in show["segments"]]
    darker = all(v <= c for a, b in zip(vivid["segments"], show["segments"]) for x, y in zip(a["colours"], b["colours"]) for v, c in zip(x, y))
    check("director: a vivid show is the same show in stronger colours", same_cuts and darker and vivid != show)
    check("director: a brief that asks for nothing gives the same show", director.direct(package, seed=11, brief={})["segments"] == show["segments"])
    names = sorted({Path(s["scene"]).stem for s in show["segments"]})
    only = director.direct(package, seed=11, brief={"scenes": names[:2], "palettes": ["ice"], "mist": "crisp", "hold": 5.0})
    only_holds = [b - a for a, b in zip([s["start"] for s in only["segments"]], [s["start"] for s in only["segments"]][1:] + [60.0])]
    check(
        "director: a brief's scenes, palettes, mist and hold are kept to",
        {Path(s["scene"]).stem for s in only["segments"]} <= set(names[:2]) and {s["palette"] for s in only["segments"]} == {"ice"} and all(s["mist"] < 0.5 for s in only["segments"]) and max(only_holds) <= 5.0 + 1e-6 and only["brief"]["mist"] == "crisp",
        f"-> scenes {sorted({Path(s['scene']).stem for s in only['segments']})}, longest hold {max(only_holds):.1f} s",
    )
    avoided = director.direct(package, seed=11, brief={"avoid": names[:1]})
    check("director: a brief's avoided scenes are not used", names[0] not in {Path(s["scene"]).stem for s in avoided["segments"]})
    check("director: a brief's seed is the show's", director.direct(package, brief={"seed": 11})["segments"] == show["segments"])
    refusals = []
    for wrong, must_say in (({"colour": "red"}, "palettes"), ({"scenes": ["no-such-scene"]}, names[0]), ({"mist": "foggy"}, "crisp"), ({"hold": 0.5}, "seconds"), ({"palettes": []}, "ice"), ({"scenes": [], "avoid": []}, names[0])):
        try:
            director.direct(package, seed=11, brief=wrong)
            refusals.append(f"{wrong} was accepted")
        except ValueError as error:
            if must_say not in str(error):
                refusals.append(f"{wrong}: the refusal does not mention {must_say}")
    check("director: a wrong brief is refused, and the refusal says what would be right", not refusals, f"-> {refusals}")
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
    for name, ok, detail in motion.selftest() + shows.selftest() + worker.selftest():
        check(name, ok, detail)
    print(f"\n{len(failures)} failed" if failures else "\nall instrument checks passed")
    sys.exit(1 if failures else 0)
