export type MirVersion = "0.1.0";

export type {
  MirBackend,
  MirRunTimings,
  MirRunMeta,
  Mir1DResult,
  Mir2DResult,
  MirResult,
  MirFunctionId,
  MirRunRequest,
  MirAudioPayload
} from "./types";

export const MIR_VERSION: MirVersion = "0.1.0";

// ----------------------------
// Core Types
// ----------------------------

export type AudioBufferLike = {
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
  numberOfChannels: number;
};

// ----------------------------
// GPU
// ----------------------------

export { MirGPU } from "./gpu/context";

// ----------------------------
// Shared runner (main thread / worker)
// ----------------------------

export { runMir } from "./runner/runMir";

// ----------------------------
// Spectrogram (shared primitive)
// ----------------------------

export type { SpectrogramConfig, Spectrogram } from "./dsp/spectrogram";
export { spectrogram } from "./dsp/spectrogram";

// ----------------------------
// Derived spectral features (CPU, reuse spectrogram)
// ----------------------------

export { spectralCentroid, spectralFlux } from "./dsp/spectral";

// ----------------------------
// Onsets / Peaks
// ----------------------------

export type { OnsetEnvelope, OnsetEnvelopeOptions, OnsetEnvelopeGpuResult } from "./dsp/onset";
export { onsetEnvelopeFromSpectrogram, onsetEnvelopeFromMel, onsetEnvelopeFromMelGpu } from "./dsp/onset";

export type { PeakPickEvent, PeakPickOptions } from "./dsp/peakPick";
export { peakPick } from "./dsp/peakPick";

// ----------------------------
// HPSS
// ----------------------------

export type { SpectrogramLike2D, HpssOptions } from "./dsp/hpss";
export { hpss } from "./dsp/hpss";

// ----------------------------
// MFCC + Deltas
// ----------------------------

export type { MfccOptions, MfccResult, DeltaOptions, Features2D } from "./dsp/mfcc";
export { mfcc, delta, deltaDelta } from "./dsp/mfcc";

// ----------------------------
// Mel spectrogram
// ----------------------------

export type { MelConfig, MelSpectrogram } from "./dsp/mel";
export { melSpectrogram } from "./dsp/mel";

// ----------------------------
// Visualisation utilities
// ----------------------------

export { normaliseForWaveform } from "./util/normalise";
export type { Spectrogram2D, SpectrogramToDbOptions } from "./util/display";
export { spectrogramToDb, clampDb } from "./util/display";

// ----------------------------
// Utility helpers
// ----------------------------

export type { MinMax } from "./util/stats";
export { minMax } from "./util/stats";

// ----------------------------
// Search (deterministic within-track similarity)
// ----------------------------

export type { MirFingerprintV1 } from "./search/fingerprintV1";
export { fingerprintV1 } from "./search/fingerprintV1";

export type { MirFingerprintVectorWeights } from "./search/similarity";
export { fingerprintToVectorV1, similarityFingerprintV1 } from "./search/similarity";

export type { MirSearchCandidate, MirSearchOptionsV1, MirSearchResultV1 } from "./search/searchTrackV1";
export { searchTrackV1 } from "./search/searchTrackV1";

export type { MirRefinementCandidateLabelV1, MirSearchCurveKindV1, MirSearchGuidedOptionsV1, MirSearchResultV1Guided } from "./search/searchTrackV1Guided";
export { searchTrackV1Guided } from "./search/searchTrackV1Guided";

/**
 * Backwards-compat placeholder from the initial skeleton.
 *
 * Note: kept so existing internal references/tests don't break.
 */
export function helloMir(name = "world") {
  return `Hello, ${name} from @octoseq/mir v${MIR_VERSION}`;
}
