"""Reference ("what a listener hears, and when") for a tracker module.

Renders a module with the instrumented player (tools/loop/modplayer) and turns the
player's event log and per-channel audio into a reference that analysis results
can be scored against:

- events: for each note trigger, when the sound physically starts, when it rises
  fastest and when it peaks, whether the attack is percussive or soft, and how
  much it matters (loudness, and whether the rest of the mix masks it)
- merged events: the same, with simultaneous notes on different channels combined,
  for scoring analysis of the full mix
- beats and downbeats from the row/tempo grid
- section boundaries from the order list
- which channels make up the drums, bass and other stems

Nothing here needs human judgement, but several thresholds are judgement calls made
once; they are the named constants below and are listed in docs/loop/queue.md.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
MODRENDER = ROOT / ".loop" / "bin" / "modrender"
REFERENCE_VERSION = "ref-8"
# The single time an event is taken to be "heard" at: halfway up its rise. For a fast
# attack this is within a millisecond or two of the onset, the steepest rise and the
# peak. For a slow attack it is the only one of the four that is well defined: a
# linear fade-in has no steepest point, and a fade-in that accelerates is steepest at
# its very end.
HEARD = "half"
MIX = "mix.flac"  # the rendered mix kept beside each reference

PRE_S = 0.005  # how far before a trigger the previous level is measured
MAX_WINDOW_S = 2.0  # how long after a trigger its attack may take
FINE_SMOOTH_S = 0.002  # envelope smoothing used for onset and peak times
COARSE_SMOOTH_S = 0.006  # envelope smoothing used for the steepest rise
ONSET_FRACTION = 0.05  # physical onset: 5% of the way from the previous level to the peak
PERCUSSIVE_ATTACK_S = 0.020  # 10%-90% rise faster than this is "percussive", otherwise "soft"
MIN_RISE_FRACTION = 0.15  # a trigger that raises the level by less than this is "legato": no attack
LEGATO_WEIGHT = 0.5  # a legato note that changes pitch counts half; one that does not counts nothing
MERGE_S = 0.030  # notes heard closer together than this are one event
MERGE_SAME_TRIGGER_S = 0.050  # notes triggered on the same tick are one event if heard within this
MASK_WINDOW_S = 0.050
MASK_FLOOR_DB, MASK_CEIL_DB = -20.0, 0.0  # fully masked below the floor, fully heard above the ceiling
BANDS_HZ = [(0, 200), (200, 2000), (2000, 24000)]
DRUM_MAX_ATTACK_S = 0.050  # a one-pitch sample that peaks faster than this is a drum
BASS_MAX_HZ = 220.0  # a melodic sample whose strongest frequency is usually below this is bass
SECTION_CHANGE = 0.2  # how different two order positions must be to count as a section boundary


def read_wav(path: Path) -> np.ndarray:
    """Open a float32 WAV written by modrender. Returns (frames, channels).

    Memory-mapped: a long module with dozens of channels is several gigabytes of
    stems, and only short windows around each note are ever looked at.
    """
    with open(path, "rb") as f:
        header = f.read(44)
    channels = int.from_bytes(header[22:24], "little")
    data = np.memmap(path, dtype="<f4", mode="r", offset=44)
    return data[: len(data) - len(data) % channels].reshape(-1, channels)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render(module: Path, out_dir: Path, stems: bool = True) -> dict:
    """Run the instrumented player. Returns the parsed event log."""
    if not MODRENDER.exists():
        raise RuntimeError("instrumented player not built: run tools/loop/modplayer/build.sh")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    cmd = [str(MODRENDER), str(module), str(out_dir)] + ([] if stems else ["--no-stems"])
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"modrender failed on {module.name}: {result.stderr.strip()}")
    return json.loads((out_dir / "events.json").read_text())


def _smooth(x: np.ndarray, width: int) -> np.ndarray:
    """Centred moving average."""
    width = max(1, width | 1)
    c = np.cumsum(np.concatenate([[0.0], x]))
    half = width // 2
    hi = np.minimum(np.arange(len(x)) + half + 1, len(x))
    lo = np.maximum(np.arange(len(x)) - half, 0)
    return (c[hi] - c[lo]) / (hi - lo)


def _first_at_or_above(x: np.ndarray, level: float) -> int | None:
    idx = np.flatnonzero(x >= level)
    return int(idx[0]) if len(idx) else None


def measure_trigger(stem: np.ndarray, t0: int, t_next: int, rate: int) -> dict:
    """Measure the envelope rise that follows one trigger on its own channel."""
    pre = int(PRE_S * rate)
    end = min(len(stem), t_next, t0 + int(MAX_WINDOW_S * rate))
    start = max(0, t0 - pre)
    if end - t0 < int(0.002 * rate):
        return dict(audible=False)
    seg = np.abs(stem[start:end].astype(np.float64))
    fine = _smooth(seg, int(FINE_SMOOTH_S * rate))
    coarse = _smooth(seg, int(COARSE_SMOOTH_S * rate))
    k = t0 - start  # index of the trigger within the segment
    after = fine[k:]
    peak_level = float(after.max())
    if peak_level <= 1e-5:
        return dict(audible=False, peak_level=peak_level)
    # The new note replaces whatever the channel was playing, so the level it rises
    # from is the lowest point between the trigger and the peak, not the level before.
    reach = _first_at_or_above(after, 0.95 * peak_level) or 0
    low = int(np.argmin(after[: reach + 1]))
    base = float(after[low])
    rise = peak_level - base
    if rise < MIN_RISE_FRACTION * peak_level:
        # Same level as before: heard, if at all, as a change of pitch.
        return dict(audible=True, onset=t0 / rate, half=t0 / rate, steepest=t0 / rate, peak=t0 / rate, attack_s=0.0, kind="legato", peak_level=peak_level)

    def crossing(fraction: float) -> int:
        i = _first_at_or_above(after[low:], base + fraction * rise)
        return low + int(i if i is not None else 0)

    onset, t10, t90, peak = crossing(ONSET_FRACTION), crossing(0.10), crossing(0.90), crossing(0.95)
    half = crossing(0.50)
    lo, hi = k + onset, k + max(peak, onset + 1) + 1
    slope = np.diff(coarse[max(0, lo - 1) : min(len(coarse), hi + 1)])
    steepest = (max(0, lo - 1) + int(np.argmax(slope)) - k) if len(slope) else onset
    steepest = int(min(max(steepest, onset), max(peak, onset)))
    attack = (t90 - t10) / rate
    return dict(
        audible=True,
        onset=(t0 + onset) / rate,
        half=(t0 + half) / rate,
        steepest=(t0 + steepest) / rate,
        peak=(t0 + peak) / rate,
        attack_s=attack,
        kind="percussive" if attack < PERCUSSIVE_ATTACK_S else "soft",
        peak_level=peak_level,
    )


def _band_energies(x: np.ndarray, rate: int) -> np.ndarray:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1.0 / rate)
    return np.array([spec[(freqs >= lo) & (freqs < hi)].sum() for lo, hi in BANDS_HZ])


def masking_weight(stem: np.ndarray, everything: np.ndarray, rise_s: float, rate: int) -> tuple[float, float]:
    """How clearly an event stands out from everything else playing at that moment.

    Compares the event's channel with the rest of the mix (`everything` minus the
    channel itself) in three frequency bands
    over 50 ms around the middle of its rise and takes the band where it stands out most,
    since a hi-hat is heard over a loud bass. Returns (weight 0..1, ratio in dB).
    """
    a = max(0, int((rise_s - 0.2 * MASK_WINDOW_S) * rate))
    b = min(len(stem), a + int(MASK_WINDOW_S * rate))
    if b - a < 64:
        return 0.0, -120.0
    own, rest = _band_energies(stem[a:b], rate), _band_energies(everything[a:b] - stem[a:b], rate)
    significant = own >= 0.1 * own.sum()
    ratio_db = float(np.max(10 * np.log10((own[significant] + 1e-12) / (rest[significant] + 1e-12))))
    weight = float(np.clip((ratio_db - MASK_FLOOR_DB) / (MASK_CEIL_DB - MASK_FLOOR_DB), 0.0, 1.0))
    return weight, min(ratio_db, 99.0)


def classify_sample(stem_of: dict[int, np.ndarray], events: list[dict], rate: int) -> str:
    """Decide whether one sample (instrument) is drums, bass or other.

    Trackers make this easier than audio does. Drums are hit at one fixed pitch and
    have a quick attack (a clap's several bursts take longer to peak than a kick, so
    the limit is looser than the percussive/soft line); anything played at several
    pitches is melodic. A melodic
    sample whose strongest frequency is usually below BASS_MAX_HZ is bass.
    """
    audible = [e for e in events if e["audible"]]
    if not audible:
        return "other"
    attacks = [e["attack_s"] for e in audible if e["kind"] != "legato"]
    pitches = {e["note"] for e in audible}
    if attacks and float(np.median(attacks)) < DRUM_MAX_ATTACK_S and len(pitches) <= 2:
        return "drums"
    dominant = []
    for e in audible[:100]:
        stem = stem_of[e["channel"]]
        a = int(e["peak"] * rate)
        chunk = stem[a : a + int(min(0.2, max(0.05, e.get("gap_s", 0.2))) * rate)]
        if len(chunk) >= 256:
            spec = np.abs(np.fft.rfft((chunk - chunk.mean()) * np.hanning(len(chunk))))
            freqs = np.fft.rfftfreq(len(chunk), 1.0 / rate)
            spec[freqs < 25.0] = 0.0  # ignore any constant offset in the sample
            dominant.append(float(freqs[int(np.argmax(spec))]))
    if dominant and float(np.median(dominant)) < BASS_MAX_HZ:
        return "bass"
    return "other"


def merge_events(events: list[dict]) -> list[dict]:
    """Combine notes that are heard as one event.

    Notes heard within MERGE_S of each other merge. So do notes triggered on the
    same tick whose attacks differ a little (a kick with a slightly slower bass
    note): they were written, and are heard, as one hit. A pad that swells in
    well after a drum hit on the same row stays a separate, soft event.
    """
    audible = sorted((e for e in events if e["audible"]), key=lambda e: e[HEARD])
    merged: list[dict] = []
    group: list[dict] = []

    def flush() -> None:
        if not group:
            return
        lead = max(group, key=lambda e: e["weight"])
        merged.append(dict(
            onset=lead["onset"], half=lead["half"], steepest=lead["steepest"], peak=lead["peak"], kind=lead["kind"],
            weight=lead["weight"], channels=sorted({e["channel"] for e in group}),
            stems=sorted({e["stem"] for e in group}), members=len(group),
        ))  # fmt: skip

    for e in audible:
        if group:
            gap = e[HEARD] - group[0][HEARD]
            together = any(abs(e["trigger"] - g["trigger"]) < 0.005 for g in group)
            if gap > (MERGE_SAME_TRIGGER_S if together else MERGE_S):
                flush()
                group = []
        group.append(e)
    flush()
    return merged


def grid(log: dict) -> dict:
    """Beats, downbeats and tempo from the row log."""
    rate = log["sample_rate"]
    beats, downbeats = [], []
    for r in log["rows"]:
        rpb = r["rows_per_beat"] or 4
        rpm = r["rows_per_measure"] or 16
        if r["row"] % rpb == 0:
            beats.append(r["t"] / rate)
        if r["row"] % rpm == 0:
            downbeats.append(r["t"] / rate)
    intervals = np.diff(beats)
    bpm = float(60.0 / np.median(intervals)) if len(intervals) else 0.0
    steady = bool(len(intervals) and np.max(np.abs(intervals - np.median(intervals))) < 0.002)
    return dict(beats=beats, downbeats=downbeats, bpm=bpm, steady_tempo=steady)


def sections(log: dict, events: list[dict]) -> list[dict]:
    """Section boundaries from the order list.

    Each order position is summarised by which samples are heard in it. A boundary is placed wherever consecutive positions differ enough, weighted
    by how much they differ. The first row of the song is always a boundary.
    """
    rate = log["sample_rate"]
    starts: dict[int, float] = {}
    sequence: list[int] = []
    for r in log["rows"]:
        if not sequence or sequence[-1] != r["order"]:
            sequence.append(r["order"])
            starts.setdefault(len(sequence) - 1, r["t"] / rate)
    position_of_time = sorted(starts.items(), key=lambda kv: kv[1])
    signatures: list[set] = [set() for _ in position_of_time]
    times = np.array([t for _, t in position_of_time])
    for e in events:
        if not e["audible"] or e["weight"] < 0.1:
            continue
        i = int(np.searchsorted(times, e["trigger"], side="right") - 1)
        signatures[i].add(e["sample"])
    out = [dict(time=float(times[0]), strength=1.0, order=sequence[0])] if len(times) else []
    for i in range(1, len(signatures)):
        a, b = signatures[i - 1], signatures[i]
        union = len(a | b)
        change = 1.0 - (len(a & b) / union if union else 1.0)
        if change >= SECTION_CHANGE:
            out.append(dict(time=float(times[i]), strength=round(change, 3), order=sequence[i]))
    return out


def build(module: Path, work_dir: Path, keep_stems: bool = False) -> dict:
    """Render a module and derive its full reference. Leaves the mix (MIX) in work_dir."""
    log = render(module, work_dir)
    rate = log["sample_rate"]
    mix = read_wav(work_dir / "mix.wav")
    mix_mono = np.asarray(mix[:, 0], dtype=np.float32) * 0.5
    mix_mono += np.asarray(mix[:, 1], dtype=np.float32) * 0.5
    stems = {ch: read_wav(work_dir / "stems" / f"ch{ch:02d}.wav")[:, 0] for ch in log["stem_channels"]}
    stem_sum = np.zeros(len(mix_mono), dtype=np.float32)
    for stem in stems.values():
        m = min(len(stem), len(stem_sum))
        stem_sum[:m] += stem[:m]
    n = min(len(stem_sum), len(mix_mono))
    residual = float(np.sqrt(np.mean((stem_sum[:n] - mix_mono[:n]) ** 2)))
    level = float(np.sqrt(np.mean(mix_mono[:n] ** 2))) or 1e-12
    residual_db = float(20 * np.log10(max(residual, 1e-12) / level))

    by_channel: dict[int, list[dict]] = {}
    for note in log["notes"]:
        by_channel.setdefault(note["channel"], []).append(note)

    events: list[dict] = []
    for ch, notes in by_channel.items():
        if ch not in stems:
            continue
        notes.sort(key=lambda x: x["t"])
        for i, note in enumerate(notes):
            t_next = notes[i + 1]["t"] if i + 1 < len(notes) else len(stems[ch])
            m = measure_trigger(stems[ch], note["audible_t"], max(t_next, note["audible_t"] + 1), rate)
            m.update(
                trigger=note["t"] / rate, channel=ch, sample=note["sample"], instrument=note["instrument"],
                note=note["note"], order=note["order"], row=note["row"], tick=note["tick"],
                gap_s=(t_next - note["t"]) / rate,
            )  # fmt: skip
            events.append(m)

    audible_levels = [e["peak_level"] for e in events if e["audible"]]
    loud_ref = float(np.percentile(audible_levels, 90)) if audible_levels else 1.0
    by_sample: dict[int, list[dict]] = {}
    for e in events:
        by_sample.setdefault(e["sample"], []).append(e)
    sample_class = {smp: classify_sample(stems, evs, rate) for smp, evs in by_sample.items()}
    last_note: dict[int, int] = {}
    for e in sorted(events, key=lambda e: e["trigger"]):
        e["stem"] = sample_class[e["sample"]]
        previous, last_note[e["channel"]] = last_note.get(e["channel"]), e["note"]
        if not e["audible"]:
            e["weight"] = 0.0
            continue
        mask, ratio_db = masking_weight(stems[e["channel"]], stem_sum, e[HEARD], rate)
        loud = float(min(1.0, e["peak_level"] / loud_ref))
        e["loudness"], e["mask"], e["to_rest_db"] = round(loud, 4), round(mask, 4), round(ratio_db, 2)
        e["weight"] = loud * mask
        if e["kind"] == "legato":
            e["weight"] *= LEGATO_WEIGHT if e["note"] != previous else 0.0
        e["weight"] = round(e["weight"], 4)
    events.sort(key=lambda e: e["trigger"])
    # A channel's stem is whichever class carries most of what is heard on it.
    channel_class = {}
    for ch in stems:
        totals: dict[str, float] = {}
        for e in events:
            if e["channel"] == ch and e["audible"]:
                totals[e["stem"]] = totals.get(e["stem"], 0.0) + e.get("loudness", 0.0)
        channel_class[ch] = max(totals, key=totals.get) if totals else "other"

    reference = dict(
        version=REFERENCE_VERSION,
        module=module.name,
        module_sha256=sha256(module),
        title=log["title"],
        type=log["type"],
        sample_rate=rate,
        duration=log["frames"] / rate,
        truncated=log["truncated"],
        channels=log["channels"],
        stem_residual_db=round(residual_db, 2),
        channel_stem={str(ch): cls for ch, cls in sorted(channel_class.items())},
        grid=grid(log),
        sections=sections(log, events),
        orders=log["orders"],
        events=events,
        merged=merge_events(events),
        triggers_logged=len(log["notes"]),
    )
    (work_dir / "reference.json").write_text(json.dumps(reference))
    # Keep the mix losslessly compressed: the float WAV is several times larger and
    # a corpus of a few hundred modules would not fit on disk.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(work_dir / "mix.wav"), "-c:a", "flac", "-sample_fmt", "s16", str(work_dir / MIX)], check=True)
    (work_dir / "mix.wav").unlink()
    if not keep_stems:
        shutil.rmtree(work_dir / "stems", ignore_errors=True)
    return reference


def build_cached(module: Path, cache_dir: Path, keep_stems: bool = False) -> tuple[dict, Path]:
    """Build once per (module content, reference version). Returns (reference, work dir)."""
    work = cache_dir / f"{module.stem}-{sha256(module)[:12]}-{REFERENCE_VERSION}"
    ref_path = work / "reference.json"
    have_stems = (work / "stems").exists() and any((work / "stems").iterdir())
    if ref_path.exists() and (work / MIX).exists() and (have_stems or not keep_stems):
        return json.loads(ref_path.read_text()), work
    return build(module, work, keep_stems), work
