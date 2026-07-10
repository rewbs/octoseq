import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "../viewStore";
import {
  addBand,
  addStemWithAudio,
  loadMixdown,
  removeStreamCascade,
  resetAllStreams,
} from "../streamActions";
import { MIXDOWN_STREAM_ID } from "../types";
import { makeAudioRef, makeBuffer, makeSegment } from "./fixtures";

const view = () => useViewStore.getState();

beforeEach(() => {
  resetAllStreams();
  view().reset();
});

describe("comparison set", () => {
  it("toggles stream membership and opens the panel on first add", () => {
    view().setComparisonOpen(false);
    view().toggleCompared("a");
    expect(view().comparedStreamIds.has("a")).toBe(true);
    expect(view().comparisonOpen).toBe(true);
    view().toggleCompared("a");
    expect(view().comparedStreamIds.has("a")).toBe(false);
  });

  it("setCompared replaces the set; clearCompared empties it", () => {
    view().setCompared(["a", "b"]);
    expect([...view().comparedStreamIds]).toEqual(["a", "b"]);
    view().clearCompared();
    expect(view().comparedStreamIds.size).toBe(0);
  });

  it("changes the comparison analysis", () => {
    view().setComparisonAnalysis("spectralFlux");
    expect(view().comparisonAnalysisId).toBe("spectralFlux");
  });
});

describe("integration with stream removal", () => {
  it("prunes removed streams (and their cascaded bands) from the compared set", () => {
    loadMixdown({ audio: makeAudioRef(), buffer: makeBuffer() });
    const stem = addStemWithAudio({ label: "Drums", audio: makeAudioRef(), buffer: makeBuffer() });
    const band = addBand({ parentId: stem, label: "Kick", frequencyShape: [makeSegment()] });
    view().setCompared([MIXDOWN_STREAM_ID, stem, band]);

    removeStreamCascade(stem);

    expect(view().comparedStreamIds.has(stem)).toBe(false);
    expect(view().comparedStreamIds.has(band)).toBe(false);
    expect(view().comparedStreamIds.has(MIXDOWN_STREAM_ID)).toBe(true);
  });

  it("resetAllStreams clears the compared set", () => {
    view().setCompared(["a", "b"]);
    resetAllStreams();
    expect(view().comparedStreamIds.size).toBe(0);
  });
});
