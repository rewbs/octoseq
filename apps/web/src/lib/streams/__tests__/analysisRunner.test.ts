/**
 * Integration tests for the unified analysis runner: real @octoseq/mir DSP on
 * synthesized audio, main-thread path (no Worker in the vitest environment).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AudioBufferLike } from "@octoseq/mir";
import { useConfigStore } from "@/lib/stores/configStore";
import { useAnalysisStore } from "../analysisStore";
import {
  cancelAllAnalyses,
  runStreamAnalyses,
  runStreamAnalysis,
} from "../analysisRunner";
import { addBand, addStemWithAudio, loadMixdown, resetAllStreams } from "../streamActions";
import { MIXDOWN_STREAM_ID, analysisKey } from "../types";
import { makeAudioRef, makeSegment } from "./fixtures";

const SAMPLE_RATE = 8000;
const DURATION_SEC = 2;

/** Synthesize a 220Hz tone with sharp amplitude bursts every 0.5s (clear onsets). */
function makeTestAudio(): AudioBufferLike {
  const n = SAMPLE_RATE * DURATION_SEC;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const sinceBurst = t % 0.5;
    const env = sinceBurst < 0.15 ? Math.exp(-sinceBurst * 20) : 0;
    samples[i] = 0.8 * env * Math.sin(2 * Math.PI * 220 * t);
  }
  return {
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

const analyses = () => useAnalysisStore.getState();

beforeAll(() => {
  // Main-thread runner, CPU only, no resampling (audio is already at 8kHz).
  useConfigStore.setState({ useWorker: false, enableGpu: false, mirSampleRate: 0 });
});

beforeEach(() => {
  resetAllStreams();
  cancelAllAnalyses();
  loadMixdown({
    audio: makeAudioRef({ sampleRate: SAMPLE_RATE, durationSec: DURATION_SEC }),
    buffer: makeTestAudio(),
  });
});

describe("audio-stream analyses", () => {
  it("runs a 1D analysis on the mixdown and stores the raw result", async () => {
    const result = await runStreamAnalysis(MIXDOWN_STREAM_ID, "amplitudeEnvelope");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("1d");
    if (result!.kind === "1d") {
      expect(result!.values.length).toBeGreaterThan(0);
      expect(Math.max(...result!.values)).toBeGreaterThan(0);
    }
    const stored = analyses().getResult(analysisKey(MIXDOWN_STREAM_ID, "amplitudeEnvelope"));
    expect(stored).toBe(result);
    expect(analyses().isPending(analysisKey(MIXDOWN_STREAM_ID, "amplitudeEnvelope"))).toBe(false);
  });

  it("returns the cached result on a second call, recomputes with force", async () => {
    const first = await runStreamAnalysis(MIXDOWN_STREAM_ID, "onsetEnvelope");
    const second = await runStreamAnalysis(MIXDOWN_STREAM_ID, "onsetEnvelope");
    expect(second).toBe(first);
    const forced = await runStreamAnalysis(MIXDOWN_STREAM_ID, "onsetEnvelope", { force: true });
    expect(forced).not.toBe(first);
  });

  it("runs analyses on a stem independently of the mixdown", async () => {
    const stem = addStemWithAudio({
      label: "Drums",
      audio: makeAudioRef({ sampleRate: SAMPLE_RATE }),
      buffer: makeTestAudio(),
    });
    await runStreamAnalysis(stem, "amplitudeEnvelope");
    expect(analyses().getResult(analysisKey(stem, "amplitudeEnvelope"))).not.toBeNull();
    expect(analyses().getResult(analysisKey(MIXDOWN_STREAM_ID, "amplitudeEnvelope"))).toBeNull();
  });

  it("records an error for streams with no decoded audio", async () => {
    const stem = addStemWithAudio({
      label: "Ghost",
      audio: makeAudioRef(),
      buffer: makeTestAudio(),
    });
    const { audioCache } = await import("../audioCache");
    audioCache.delete(stem);
    await expect(runStreamAnalysis(stem, "amplitudeEnvelope")).rejects.toThrow(/no decoded audio/);
  });
});

describe("band-stream analyses", () => {
  it("runs a band STFT analysis from the parent's audio", async () => {
    const band = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Low",
      frequencyShape: [
        makeSegment({ endTime: DURATION_SEC, lowHzStart: 100, highHzStart: 400, lowHzEnd: 100, highHzEnd: 400 }),
      ],
    });
    const result = await runStreamAnalysis(band, "amplitudeEnvelope");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("bandMir1d");
    if (result!.kind === "bandMir1d") {
      expect(result!.bandId).toBe(band);
      expect(result!.fn).toBe("bandAmplitudeEnvelope");
      expect(result!.values.length).toBeGreaterThan(0);
    }
  });

  it("computes the band-MIR dependency automatically for event extraction", async () => {
    const band = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Low",
      frequencyShape: [
        makeSegment({ endTime: DURATION_SEC, lowHzStart: 100, highHzStart: 400, lowHzEnd: 100, highHzEnd: 400 }),
      ],
    });
    const result = await runStreamAnalysis(band, "onsetPeaks");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("bandEvents");
    // The dependency (onsetEnvelope → bandOnsetStrength) was computed and cached too.
    const dep = analyses().getResult(analysisKey(band, "onsetEnvelope"));
    expect(dep).not.toBeNull();
    expect(dep!.kind).toBe("bandMir1d");
  });

  it("rejects analyses that have no band implementation", async () => {
    const band = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Low",
      frequencyShape: [makeSegment({ endTime: DURATION_SEC })],
    });
    await expect(runStreamAnalysis(band, "mfcc")).rejects.toThrow(/not available on band/);
  });

  it("batch-runs multiple bands of one parent, sharing the spectrogram", async () => {
    const low = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Low",
      frequencyShape: [
        makeSegment({ endTime: DURATION_SEC, lowHzStart: 80, highHzStart: 500, lowHzEnd: 80, highHzEnd: 500 }),
      ],
    });
    const high = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "High",
      frequencyShape: [
        makeSegment({ endTime: DURATION_SEC, lowHzStart: 1000, highHzStart: 3500, lowHzEnd: 1000, highHzEnd: 3500 }),
      ],
    });

    await runStreamAnalyses([MIXDOWN_STREAM_ID, low, high], ["amplitudeEnvelope", "onsetEnvelope"]);

    for (const streamId of [MIXDOWN_STREAM_ID, low, high]) {
      for (const analysisId of ["amplitudeEnvelope", "onsetEnvelope"] as const) {
        expect(
          analyses().getResult(analysisKey(streamId, analysisId)),
          `${streamId}:${analysisId}`
        ).not.toBeNull();
      }
    }

    // The low band (containing the 220Hz tone) should carry more energy than the high band.
    const lowResult = analyses().getResult(analysisKey(low, "amplitudeEnvelope"));
    const highResult = analyses().getResult(analysisKey(high, "amplitudeEnvelope"));
    if (lowResult?.kind === "bandMir1d" && highResult?.kind === "bandMir1d") {
      const sum = (v: Float32Array) => v.reduce((a, b) => a + b, 0);
      expect(sum(lowResult.values)).toBeGreaterThan(sum(highResult.values));
    } else {
      throw new Error("expected bandMir1d results");
    }
  });

  it("skips band-unsupported analyses in batch mode instead of failing the batch", async () => {
    const band = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Low",
      frequencyShape: [makeSegment({ endTime: DURATION_SEC })],
    });
    await runStreamAnalyses([MIXDOWN_STREAM_ID, band], ["mfcc"]);
    expect(analyses().getResult(analysisKey(MIXDOWN_STREAM_ID, "mfcc"))).not.toBeNull();
    expect(analyses().getResult(analysisKey(band, "mfcc"))).toBeNull();
    expect(analyses().getError(analysisKey(band, "mfcc"))).toBeNull();
  });
});
