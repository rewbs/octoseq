import { beforeEach, describe, expect, it } from "vitest";
import { useAnalysisStore } from "../analysisStore";
import { audioCache } from "../audioCache";
import {
  addBand,
  addStemWithAudio,
  loadMixdown,
  removeStreamCascade,
  replaceStreamAudio,
  resetAllStreams,
  toFrequencyBand,
  updateBandShape,
} from "../streamActions";
import { useStreamStore } from "../streamStore";
import {
  MIXDOWN_STREAM_ID,
  analysisKey,
  isBandStream,
  type AnalysisResult,
  type StreamId,
} from "../types";
import { makeAudioRef, makeBuffer, makeSegment } from "./fixtures";

const streams = () => useStreamStore.getState();
const analyses = () => useAnalysisStore.getState();

function seedResult(streamId: StreamId): void {
  analyses().setResult(analysisKey(streamId, "onsetEnvelope"), {
    kind: "1d",
  } as unknown as AnalysisResult);
}

function hasResult(streamId: StreamId): boolean {
  return analyses().getResult(analysisKey(streamId, "onsetEnvelope")) !== null;
}

beforeEach(() => {
  resetAllStreams();
});

describe("loadMixdown", () => {
  it("creates the mixdown and caches its PCM", () => {
    const buffer = makeBuffer();
    loadMixdown({ audio: makeAudioRef(), buffer });
    expect(streams().getMixdown()).not.toBeNull();
    expect(audioCache.get(MIXDOWN_STREAM_ID)).toBe(buffer);
  });

  it("on replace, invalidates mixdown and mixdown-band analyses but not stems", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const mixBand = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    seedResult(MIXDOWN_STREAM_ID);
    seedResult(stem);
    seedResult(mixBand);

    loadMixdown({ audio: makeAudioRef({ fileName: "new.wav" }), buffer: makeBuffer() });

    expect(hasResult(MIXDOWN_STREAM_ID)).toBe(false);
    expect(hasResult(mixBand)).toBe(false);
    expect(hasResult(stem)).toBe(true);
  });
});

describe("replaceStreamAudio", () => {
  it("invalidates the stream and its dependent bands only", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const stemBand = addBand({ parentId: stem, label: "Kick", frequencyShape: [makeSegment()] });
    seedResult(MIXDOWN_STREAM_ID);
    seedResult(stem);
    seedResult(stemBand);

    const newBuffer = makeBuffer(48000);
    replaceStreamAudio(stem, makeAudioRef({ sampleRate: 48000 }), newBuffer);

    expect(hasResult(stem)).toBe(false);
    expect(hasResult(stemBand)).toBe(false);
    expect(hasResult(MIXDOWN_STREAM_ID)).toBe(true);
    expect(audioCache.get(stem)).toBe(newBuffer);
  });
});

describe("updateBandShape", () => {
  it("invalidates only that band", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const band1 = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    const band2 = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Highs",
      frequencyShape: [makeSegment()],
    });
    seedResult(MIXDOWN_STREAM_ID);
    seedResult(band1);
    seedResult(band2);

    updateBandShape(band1, { frequencyShape: [makeSegment({ lowHzStart: 30, lowHzEnd: 30 })] });

    expect(hasResult(band1)).toBe(false);
    expect(hasResult(band2)).toBe(true);
    expect(hasResult(MIXDOWN_STREAM_ID)).toBe(true);
  });
});

describe("removeStreamCascade", () => {
  it("drops analyses and PCM for the stream and its bands", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const band = addBand({ parentId: stem, label: "Kick", frequencyShape: [makeSegment()] });
    seedResult(stem);
    seedResult(band);

    const removed = removeStreamCascade(stem);

    expect(removed.map((s) => s.id)).toEqual([stem, band]);
    expect(hasResult(stem)).toBe(false);
    expect(hasResult(band)).toBe(false);
    expect(audioCache.has(stem)).toBe(false);
    expect(streams().getStream(stem)).toBeNull();
  });
});

describe("resetAllStreams", () => {
  it("clears collection, analyses, and PCM cache", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    seedResult(MIXDOWN_STREAM_ID);
    resetAllStreams();
    expect(streams().streams.size).toBe(0);
    expect(analyses().results.size).toBe(0);
    expect(audioCache.size()).toBe(0);
  });
});

describe("toFrequencyBand", () => {
  it("maps a BandStream onto the @octoseq/mir FrequencyBand wire shape", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const shape = [makeSegment()];
    const bandId = addBand({ parentId: stem, label: "Kick", frequencyShape: shape });
    const band = streams().getStream(bandId);
    if (!band || !isBandStream(band)) throw new Error("band missing");

    const wire = toFrequencyBand(band);

    expect(wire).toEqual({
      id: bandId,
      label: "Kick",
      sourceId: stem,
      enabled: true,
      timeScope: { kind: "global" },
      frequencyShape: shape,
      sortOrder: band.sortOrder,
      provenance: band.provenance,
    });
  });
});

describe("band editing state pruning", () => {
  it("clears solo/mute/hidden refs for removed streams only", async () => {
    const { useBandEditingStore } = await import("../bandEditingStore");
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const band1 = addBand({ parentId: stem, label: "Kick", frequencyShape: [makeSegment()] });
    const band2 = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });

    const editing = useBandEditingStore.getState();
    editing.setSoloedBand(band1);
    editing.toggleMutedBand(band1);
    editing.toggleMutedBand(band2);
    editing.toggleEventVisibility(band1);

    removeStreamCascade(stem); // cascades to band1

    const after = useBandEditingStore.getState();
    expect(after.soloedBandId).toBeNull();
    expect(after.mutedBandIds.has(band1)).toBe(false);
    expect(after.mutedBandIds.has(band2)).toBe(true);
    expect(after.hiddenEventBandIds.has(band1)).toBe(false);
  });

  it("resetAllStreams clears all band-editing stream refs", async () => {
    const { useBandEditingStore } = await import("../bandEditingStore");
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const band = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    useBandEditingStore.getState().setSoloedBand(band);
    useBandEditingStore.getState().toggleMutedBand(band);

    resetAllStreams();

    expect(useBandEditingStore.getState().soloedBandId).toBeNull();
    expect(useBandEditingStore.getState().mutedBandIds.size).toBe(0);
  });
});
