import { beforeEach, describe, expect, it } from "vitest";
import { useStreamStore } from "../streamStore";
import { MIXDOWN_STREAM_ID, isBandStream } from "../types";
import { makeAudioRef, makeSegment } from "./fixtures";

const store = () => useStreamStore.getState();

beforeEach(() => {
  store().reset();
});

describe("initializeMixdown", () => {
  it("creates the mixdown with the fixed id and sortOrder 0", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const mixdown = store().getMixdown();
    expect(mixdown).not.toBeNull();
    expect(mixdown!.id).toBe(MIXDOWN_STREAM_ID);
    expect(mixdown!.kind).toBe("mixdown");
    expect(mixdown!.sortOrder).toBe(0);
    expect(mixdown!.label).toBe("Mixdown");
  });

  it("replaces audio on re-initialize, preserving identity and createdAt", () => {
    store().initializeMixdown({ audio: makeAudioRef({ fileName: "a.wav" }), label: "Track A" });
    const first = store().getMixdown()!;
    store().initializeMixdown({ audio: makeAudioRef({ fileName: "b.wav" }) });
    const second = store().getMixdown()!;
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.audio.fileName).toBe("b.wav");
    expect(second.label).toBe("Track A"); // label kept when not provided
    expect(store().streams.size).toBe(1);
  });
});

describe("stems", () => {
  it("adds stems with increasing sortOrder and lists them in order", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const bass = store().addStem({ label: "Bass", audio: makeAudioRef() });
    const drums = store().addStem({ label: "Drums", audio: makeAudioRef() });
    const stems = store().getStems();
    expect(stems.map((s) => s.id)).toEqual([bass, drums]);
    expect(stems[0]!.sortOrder).toBeLessThan(stems[1]!.sortOrder);
  });

  it("getAudioStreams returns mixdown first, then stems", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    store().addStem({ label: "Bass", audio: makeAudioRef() });
    const all = store().getAudioStreams();
    expect(all[0]!.id).toBe(MIXDOWN_STREAM_ID);
    expect(all).toHaveLength(2);
  });
});

describe("bands", () => {
  beforeEach(() => {
    store().initializeMixdown({ audio: makeAudioRef() });
  });

  it("adds a band under the mixdown with sensible defaults", () => {
    const id = store().addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Sub bass",
      frequencyShape: [makeSegment()],
    });
    const band = store().getStream(id);
    expect(band).not.toBeNull();
    expect(isBandStream(band!)).toBe(true);
    if (isBandStream(band!)) {
      expect(band.parentId).toBe(MIXDOWN_STREAM_ID);
      expect(band.enabled).toBe(true);
      expect(band.timeScope).toEqual({ kind: "global" });
      expect(band.provenance.source).toBe("manual");
    }
  });

  it("supports bands of stems (per-stem bands)", () => {
    const stem = store().addStem({ label: "Drums", audio: makeAudioRef() });
    const id = store().addBand({
      parentId: stem,
      label: "Kick region",
      frequencyShape: [makeSegment()],
    });
    expect(
      store()
        .getBands(stem)
        .map((b) => b.id)
    ).toEqual([id]);
    expect(store().getBands(MIXDOWN_STREAM_ID)).toHaveLength(0);
  });

  it("rejects bands with a missing parent", () => {
    expect(() =>
      store().addBand({ parentId: "nope", label: "x", frequencyShape: [makeSegment()] })
    ).toThrow(/does not exist/);
  });

  it("rejects bands of bands", () => {
    const band = store().addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    expect(() =>
      store().addBand({ parentId: band, label: "Sub", frequencyShape: [makeSegment()] })
    ).toThrow(/bands of bands/);
  });

  it("updateBandShape replaces geometry and only geometry", () => {
    const id = store().addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    const newShape = [makeSegment({ lowHzStart: 40, lowHzEnd: 40 })];
    store().updateBandShape(id, { frequencyShape: newShape });
    const band = store().getStream(id);
    if (!band || !isBandStream(band)) throw new Error("band missing");
    expect(band.frequencyShape).toEqual(newShape);
    expect(band.label).toBe("Bass");
  });

  it("updateBandShape throws for non-band streams", () => {
    expect(() => store().updateBandShape(MIXDOWN_STREAM_ID, {})).toThrow(/not a band/);
  });

  it("updateAudio throws for band streams", () => {
    const id = store().addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    expect(() => store().updateAudio(id, makeAudioRef())).toThrow(/no backing audio/);
  });
});

describe("rename and reorder", () => {
  it("renames with trimming, ignores empty labels", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    store().renameStream(MIXDOWN_STREAM_ID, "  Full mix  ");
    expect(store().getMixdown()!.label).toBe("Full mix");
    store().renameStream(MIXDOWN_STREAM_ID, "   ");
    expect(store().getMixdown()!.label).toBe("Full mix");
  });

  it("reorderStreams reassigns sortOrder by position", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const a = store().addStem({ label: "A", audio: makeAudioRef() });
    const b = store().addStem({ label: "B", audio: makeAudioRef() });
    const c = store().addStem({ label: "C", audio: makeAudioRef() });
    store().reorderStreams([c, a, b]);
    expect(
      store()
        .getStems()
        .map((s) => s.id)
    ).toEqual([c, a, b]);
  });
});

describe("removeStream", () => {
  it("cascades from a stem to its dependent bands and returns all removed", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const stem = store().addStem({ label: "Drums", audio: makeAudioRef() });
    const band1 = store().addBand({
      parentId: stem,
      label: "Kick",
      frequencyShape: [makeSegment()],
    });
    const band2 = store().addBand({
      parentId: stem,
      label: "Snare",
      frequencyShape: [makeSegment()],
    });
    const mixBand = store().addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });

    const removed = store().removeStream(stem);
    expect(removed.map((s) => s.id)).toEqual([stem, band1, band2]);
    expect(store().getStream(stem)).toBeNull();
    expect(store().getStream(band1)).toBeNull();
    expect(store().getStream(band2)).toBeNull();
    expect(store().getStream(mixBand)).not.toBeNull();
  });

  it("clears selection when the selected stream is removed", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const stem = store().addStem({ label: "Drums", audio: makeAudioRef() });
    store().selectStream(stem);
    store().removeStream(stem);
    expect(store().selectedStreamId).toBeNull();
  });

  it("throws when removing the mixdown", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    expect(() => store().removeStream(MIXDOWN_STREAM_ID)).toThrow(/cannot remove the mixdown/);
  });

  it("returns [] for unknown ids", () => {
    expect(store().removeStream("nope")).toEqual([]);
  });

  it("restoreStreams reinstates removed streams (undo)", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    const stem = store().addStem({ label: "Drums", audio: makeAudioRef() });
    store().addBand({ parentId: stem, label: "Kick", frequencyShape: [makeSegment()] });
    const removed = store().removeStream(stem);
    store().restoreStreams(removed);
    expect(store().getStream(stem)).not.toBeNull();
    expect(store().getBands(stem)).toHaveLength(1);
  });
});

describe("reset", () => {
  it("clears the collection and selection", () => {
    store().initializeMixdown({ audio: makeAudioRef() });
    store().selectStream(MIXDOWN_STREAM_ID);
    store().reset();
    expect(store().streams.size).toBe(0);
    expect(store().selectedStreamId).toBeNull();
    expect(store().getMixdown()).toBeNull();
  });
});
