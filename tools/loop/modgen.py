#!/usr/bin/env python3
"""Generate synthetic tracker modules with known ground truth.

    python3 tools/loop/modgen.py --out tools/loop/fixtures/modules --count 12

Each module is an 8-channel ProTracker-format file built from samples synthesised
here (so there is no third-party content in it) plus a truth file listing exactly
which note triggers a correct player must produce and where the sections are.

Two uses:

- Checking the instrumented player. The truth file is written from the pattern
  data by this script, independently of the player, so comparing it with the
  player's event log tests the instrumentation itself.
- A licence-clean corpus for the analysis-accuracy loop. The modules deliberately
  include the awkward cases: tone-portamento glides, silent notes, cut notes,
  delayed notes, retriggers, slow attacks and samples that start with silence.

Output is fully determined by the seed.
"""

from __future__ import annotations

import argparse
import json
import random
import zlib
from pathlib import Path

import numpy as np

CHANNELS = 8
ROWS = 64
BASE_RATE = 16726  # playback rate of period 214 (ProTracker C-3) in OpenMPT
PERIODS = [
    856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
    428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
    214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
]  # fmt: skip
# Tempos whose tick length is a whole number of samples at 48 kHz, so expected
# trigger times are exact: samples per tick = 48000 * 2.5 / tempo.
TEMPOS = [96, 100, 120, 125, 150, 160]
RENDER_RATE = 48000

# Effects (ProTracker numbering).
FX_ARP, FX_PORTA, FX_VIBRATO, FX_OFFSET, FX_VOLUME, FX_EXT, FX_SPEED = 0x0, 0x3, 0x4, 0x9, 0xC, 0xE, 0xF


# --------------------------------------------------------------------------- samples


def _env(n: int, decay_s: float) -> np.ndarray:
    return np.exp(-np.arange(n) / (decay_s * BASE_RATE))


def _fade_out(x: np.ndarray, n: int = 64) -> np.ndarray:
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)
    return x


def make_samples(rng: np.random.Generator) -> list[dict]:
    """Synthesise the sample set. Each entry: name, data (float -1..1), loop, role."""
    sr = BASE_RATE
    out = []

    n = int(0.28 * sr)
    t = np.arange(n) / sr
    f = 45 + (rng.uniform(140, 190) - 45) * np.exp(-t / 0.035)
    kick = np.sin(2 * np.pi * np.cumsum(f) / sr) * _env(n, rng.uniform(0.06, 0.1))
    out.append(dict(name="kick", data=_fade_out(kick), loop=None, role="kick"))

    n = int(0.2 * sr)
    t = np.arange(n) / sr
    noise = rng.standard_normal(n)
    snare = 0.7 * noise * _env(n, rng.uniform(0.04, 0.07)) + 0.5 * np.sin(2 * np.pi * 185 * t) * _env(n, 0.03)
    out.append(dict(name="snare", data=_fade_out(snare / np.abs(snare).max()), loop=None, role="snare"))

    n = int(0.06 * sr)
    noise = np.diff(rng.standard_normal(n + 1))  # crude high-pass
    hat = noise * _env(n, rng.uniform(0.008, 0.02))
    out.append(dict(name="hat", data=_fade_out(hat / np.abs(hat).max(), 16), loop=None, role="hat"))

    cycle = 128
    saw = np.linspace(-1, 1, cycle, endpoint=False)
    bass = np.tile(0.6 * saw + 0.4 * np.sin(2 * np.pi * np.arange(cycle) / cycle), 8)
    out.append(dict(name="bass", data=bass, loop=(0, len(bass)), role="bass"))

    cycle = 32
    duty = rng.choice([8, 12, 16])
    pulse = np.where(np.arange(cycle) < duty, 0.8, -0.8)
    lead = np.tile(pulse, 16)
    out.append(dict(name="lead", data=lead, loop=(0, len(lead)), role="lead"))

    # Pad: the slow attack is baked into the sample, as trackers of this era did.
    attack = int(rng.uniform(0.18, 0.3) * sr)
    cycle = 32
    wave = sum(np.sin(2 * np.pi * k * np.arange(cycle) / cycle) / k for k in (1, 2, 3, 5))
    body = np.tile(wave / np.abs(wave).max(), (attack // cycle) + 40)
    ramp = np.ones(len(body))
    ramp[:attack] = np.linspace(0, 1, attack) ** 1.5
    loop_start = (attack // cycle + 1) * cycle
    out.append(dict(name="pad", data=0.8 * body * ramp, loop=(loop_start, len(body) - loop_start), role="pad"))

    attack = int(rng.uniform(0.45, 0.7) * sr)
    cycle = 24
    wave = np.sin(2 * np.pi * np.arange(cycle) / cycle) + 0.3 * np.sin(4 * np.pi * np.arange(cycle) / cycle)
    body = np.tile(wave / np.abs(wave).max(), (attack // cycle) + 30)
    ramp = np.ones(len(body))
    ramp[:attack] = np.linspace(0, 1, attack) ** 2
    loop_start = (attack // cycle + 1) * cycle
    out.append(dict(name="swell", data=0.8 * body * ramp, loop=(loop_start, len(body) - loop_start), role="swell"))

    # A hit preceded by silence: what is heard starts well after the trigger.
    lead_in = int(rng.uniform(0.04, 0.08) * sr)
    n = int(0.15 * sr)
    t = np.arange(n) / sr
    blip = np.sin(2 * np.pi * 660 * t) * _env(n, 0.03)
    out.append(dict(name="late", data=np.concatenate([np.zeros(lead_in), _fade_out(blip)]), loop=None, role="late", lead_in_s=lead_in / sr))

    n = int(0.22 * sr)
    clap = np.zeros(n)
    for start in (0.0, 0.011, 0.023):
        i = int(start * sr)
        m = n - i
        clap[i:] += rng.standard_normal(m) * _env(m, 0.012)
    clap += 0.6 * rng.standard_normal(n) * _env(n, 0.05) * (np.arange(n) > int(0.03 * sr))
    out.append(dict(name="clap", data=_fade_out(clap / np.abs(clap).max()), loop=None, role="clap"))

    for i, s in enumerate(out):
        s["number"] = i + 1
        s["looped"] = s["loop"] is not None
    return out


# --------------------------------------------------------------------------- song


class Cell:
    __slots__ = ("sample", "note", "fx", "param")

    def __init__(self, sample=0, note=None, fx=0, param=0):
        self.sample, self.note, self.fx, self.param = sample, note, fx, param


def empty_pattern() -> list[list[Cell]]:
    return [[Cell() for _ in range(CHANNELS)] for _ in range(ROWS)]


SCALE = [0, 2, 3, 5, 7, 8, 10]  # natural minor


def build_song(seed: int) -> dict:
    """Compose a song: samples, patterns, order list and section labels."""
    rnd = random.Random(seed)
    samples = make_samples(np.random.default_rng(seed))
    by_role = {s["role"]: s["number"] for s in samples}
    tempo = rnd.choice(TEMPOS)
    speed = rnd.choice([6, 6, 6, 4, 5, 8])
    root = rnd.randrange(0, 5)
    progression = [rnd.choice([0, 3, 5, 6, 4]) for _ in range(4)]
    progression[0] = 0
    busy = rnd.random()

    def degree_note(octave: int, degree: int) -> int:
        return max(0, min(35, octave * 12 + root + SCALE[degree % 7] + 12 * (degree // 7)))

    def kick_rows(style: int) -> list[int]:
        base = {0: [0, 4, 8, 12], 1: [0, 6, 8, 14], 2: [0, 3, 8, 11], 3: [0, 8, 10]}[style]
        return [bar * 16 + r for bar in range(4) for r in base]

    kick_style, hat_step = rnd.randrange(4), rnd.choice([2, 2, 1, 4])

    def make_pattern(kind: str, variant: int) -> list[list[Cell]]:
        prng = random.Random(seed * 1000 + zlib.crc32(kind.encode()) % 997 + variant)  # not hash(): that varies per process
        pat = empty_pattern()
        drums = kind in ("verse", "chorus", "build")
        full = kind == "chorus"

        if drums:
            for r in kick_rows(kick_style if kind != "build" else 0):
                pat[r][0] = Cell(by_role["kick"], 12)
            for bar in range(4):
                for r in (4, 12):
                    row = bar * 16 + r
                    which = "clap" if (full and prng.random() < 0.4) else "snare"
                    cell = Cell(by_role[which], 24)
                    if prng.random() < 0.12:  # flam: delayed by a couple of ticks
                        cell.fx, cell.param = FX_EXT, 0xD0 | prng.randrange(1, min(speed, 4))
                    pat[row][1] = cell
            if kind == "build":
                for r in range(48, 64, 2):
                    pat[r][1] = Cell(by_role["snare"], 24, FX_VOLUME, 20 + (r - 48) * 2)
                pat[60][1] = Cell(by_role["snare"], 24, FX_EXT, 0x90 | max(1, speed // 3))  # roll

        if kind != "break":
            for r in range(0, ROWS, hat_step):
                if prng.random() < 0.15:
                    continue
                cell = Cell(by_role["hat"], 24, FX_VOLUME, prng.choice([24, 32, 40, 48]) if r % 4 else 56)
                roll = prng.random()
                if roll < 0.05:
                    cell.fx, cell.param = FX_VOLUME, 0  # silent note: must not be reported
                elif roll < 0.09:
                    cell.fx, cell.param = FX_EXT, 0xC0  # cut on tick 0: must not be reported
                elif roll < 0.13 and speed >= 4:
                    cell.fx, cell.param = FX_EXT, 0x90 | (speed // 2)  # double hit
                pat[r][2] = cell

        if kind in ("verse", "chorus", "build", "outro"):
            previous = None
            for r in range(0, ROWS, 2 if busy > 0.4 else 4):
                if prng.random() < 0.2:
                    continue
                chord = progression[(r // 16) % 4]
                note = degree_note(0, chord + prng.choice([0, 0, 0, 4, 7]))
                if previous is not None and prng.random() < 0.18:
                    # Glide to the new pitch: no new trigger.
                    pat[r][3] = Cell(0, note, FX_PORTA, prng.choice([0x10, 0x20, 0x30]))
                else:
                    pat[r][3] = Cell(by_role["bass"], note, FX_VOLUME, 48)
                previous = note

        if kind in ("chorus", "break", "verse") and (kind != "verse" or variant % 2):
            r = 0
            while r < ROWS:
                if prng.random() < 0.35:
                    r += prng.choice([2, 4])
                    continue
                chord = progression[(r // 16) % 4]
                note = degree_note(1, chord + prng.choice([0, 2, 4, 6, 7]))
                cell = Cell(by_role["lead"], note, FX_VOLUME, 40)
                roll = prng.random()
                if roll < 0.15:
                    cell.fx, cell.param = FX_VIBRATO, 0x46
                elif roll < 0.25:
                    cell.fx, cell.param = FX_ARP, prng.choice([0x37, 0x47, 0x38])
                elif roll < 0.33:
                    cell.fx, cell.param = FX_EXT, 0xD0 | prng.randrange(1, speed)  # delayed note
                elif roll < 0.38:
                    cell.fx, cell.param = FX_OFFSET, 0x01
                pat[r][4] = cell
                length = prng.choice([2, 2, 4, 4, 6, 8])
                if r + length < ROWS and prng.random() < 0.3:
                    pat[r + length - 1][4] = Cell(0, None, FX_EXT, 0xC0 | prng.randrange(0, speed))  # cut it short
                r += length

        if kind in ("intro", "break", "chorus", "outro"):
            for r in range(0, ROWS, 16 if kind != "chorus" else 32):
                chord = progression[(r // 16) % 4]
                pat[r][5] = Cell(by_role["pad"], degree_note(1, chord), FX_VOLUME, 44)

        if kind in ("intro", "build", "break"):
            pat[0 if kind != "build" else 32][7] = Cell(by_role["swell"], degree_note(1, progression[0] + 4), FX_VOLUME, 40)

        if kind in ("verse", "chorus", "break"):
            for r in range(6, ROWS, 16):
                if prng.random() < 0.5:
                    pat[r][6] = Cell(by_role["late"], 24, FX_VOLUME, 50)
        return pat

    plan = rnd.choice([
        ["intro", "verse", "verse", "chorus", "chorus", "break", "build", "chorus", "chorus", "outro"],
        ["intro", "verse", "chorus", "verse", "chorus", "break", "chorus", "outro"],
        ["intro", "intro", "verse", "verse", "build", "chorus", "chorus", "break", "verse", "chorus", "outro"],
        ["verse", "verse", "chorus", "break", "build", "chorus", "chorus", "outro"],
    ])  # fmt: skip

    patterns, order, pattern_ids = [], [], {}
    for position, kind in enumerate(plan):
        # Repeats of a section alternate between two variants of its pattern.
        variant = sum(1 for k in plan[:position] if k == kind) % 2
        key = (kind, variant)
        if key not in pattern_ids:
            pattern_ids[key] = len(patterns)
            patterns.append(make_pattern(kind, variant))
        order.append(pattern_ids[key])

    # Set speed and tempo on the very first row (channel 7 unless it is occupied).
    first = patterns[order[0]][0]
    free = [c for c in range(CHANNELS) if first[c].fx == 0 and first[c].param == 0]
    first[free[-1]].fx, first[free[-1]].param = FX_SPEED, speed
    first[free[-2]].fx, first[free[-2]].param = FX_SPEED, tempo

    return dict(seed=seed, tempo=tempo, speed=speed, samples=samples, patterns=patterns, order=order, plan=plan)


# --------------------------------------------------------------------------- truth


def expected_triggers(song: dict) -> list[dict]:
    """Which note triggers a correct ProTracker-compatible player must report.

    Derived from the pattern data only. Rules: a note with a sample starts that
    sample; a note with tone portamento glides instead (no trigger) as long as the
    channel is still sounding; a note at volume 0 or cut on tick 0 is never heard;
    EDx delays the trigger to tick x; E9x repeats it every x ticks.
    """
    speed, tempo = song["speed"], song["tempo"]
    samples_per_tick = RENDER_RATE * 5 // (tempo * 2)
    looped = {s["number"]: s["looped"] for s in song["samples"]}
    out = []
    current_sample = [0] * CHANNELS  # last sample number used on each channel
    sounding = [False] * CHANNELS  # channel holds a looped note that has not been cut
    for position, pattern_index in enumerate(song["order"]):
        for row in range(ROWS):
            row_start_tick = (position * ROWS + row) * speed
            for ch in range(CHANNELS):
                cell = song["patterns"][pattern_index][row][ch]
                ext = cell.param >> 4 if cell.fx == FX_EXT else None
                ext_arg = cell.param & 0x0F
                if cell.note is None:
                    if ext == 0xC:
                        sounding[ch] = False
                    continue
                if cell.sample:
                    current_sample[ch] = cell.sample
                if cell.fx == FX_PORTA and sounding[ch]:
                    continue
                sample = current_sample[ch]
                silent = (cell.fx == FX_VOLUME and cell.param == 0) or (ext == 0xC and ext_arg == 0)
                ticks = [0]
                if ext == 0xD:
                    ticks = [ext_arg] if ext_arg < speed else []
                elif ext == 0x9 and ext_arg:
                    ticks = list(range(0, speed, ext_arg))
                sounding[ch] = looped[sample] and not silent and not (ext == 0xC)
                if silent:
                    continue
                for tick in ticks:
                    out.append(dict(
                        t=(row_start_tick + tick) * samples_per_tick, order=position, row=row, tick=tick,
                        channel=ch, sample=sample, note_index=cell.note,
                    ))  # fmt: skip
    return out


def truth(song: dict) -> dict:
    speed, tempo = song["speed"], song["tempo"]
    samples_per_tick = RENDER_RATE * 5 // (tempo * 2)
    pattern_frames = ROWS * speed * samples_per_tick
    sections = []
    for position, kind in enumerate(song["plan"]):
        if not sections or sections[-1]["label"] != kind:
            sections.append(dict(label=kind, start=position * pattern_frames / RENDER_RATE))
    return dict(
        seed=song["seed"], tempo=tempo, speed=speed, render_rate=RENDER_RATE,
        bpm=tempo * 6 / speed,  # four rows to the beat
        order=song["order"], plan=song["plan"], sections=sections,
        duration=len(song["order"]) * pattern_frames / RENDER_RATE,
        samples=[{k: s[k] for k in ("number", "name", "role", "looped")} | ({"lead_in_s": s["lead_in_s"]} if "lead_in_s" in s else {}) for s in song["samples"]],
        triggers=expected_triggers(song),
    )  # fmt: skip


# --------------------------------------------------------------------------- writer


def module_bytes(song: dict) -> bytes:
    out = bytearray()
    out += f"octoseq synth {song['seed']:04d}".encode().ljust(20, b"\0")
    pcm = []
    for i in range(31):
        if i < len(song["samples"]):
            s = song["samples"][i]
            data = np.clip(np.round(s["data"] * 127), -128, 127).astype(np.int8)
            if len(data) % 2:
                data = np.append(data, np.int8(0))
            loop_start, loop_len = (s["loop"][0] // 2, s["loop"][1] // 2) if s["loop"] else (0, 1)
            out += s["name"].encode().ljust(22, b"\0")
            out += (len(data) // 2).to_bytes(2, "big") + bytes([0, 64])
            out += loop_start.to_bytes(2, "big") + loop_len.to_bytes(2, "big")
            pcm.append(data.tobytes())
        else:
            out += bytes(22) + bytes([0, 0, 0, 0, 0, 0, 0, 1])
    out += bytes([len(song["order"]), 127])
    out += bytes(song["order"]).ljust(128, b"\0")
    out += b"8CHN"
    for pattern in song["patterns"]:
        for row in pattern:
            for cell in row:
                period = PERIODS[cell.note] if cell.note is not None else 0
                out += bytes([
                    (cell.sample & 0xF0) | (period >> 8), period & 0xFF,
                    ((cell.sample & 0x0F) << 4) | cell.fx, cell.param,
                ])  # fmt: skip
    for data in pcm:
        out += data
    return bytes(out)


def generate(seed: int) -> tuple[bytes, dict]:
    song = build_song(seed)
    return module_bytes(song), truth(song)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--first-seed", type=int, default=1)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for seed in range(args.first_seed, args.first_seed + args.count):
        data, info = generate(seed)
        stem = f"synth-{seed:04d}"
        (args.out / f"{stem}.mod").write_bytes(data)
        (args.out / f"{stem}.truth.json").write_text(json.dumps(info, separators=(",", ":")))
        print(f"{stem}: {info['bpm']:.1f} BPM, {len(info['order'])} patterns, {len(info['triggers'])} triggers, {info['duration']:.1f}s")


if __name__ == "__main__":
    main()
