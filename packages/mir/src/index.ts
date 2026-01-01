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
  MirAudioPayload,
  BeatCandidate,
  BeatCandidateSource,
  BeatCandidatesResult,
  TempoHypothesis,
  TempoHypothesisEvidence,
  TempoHypothesesResult,
  BeatGrid,
  PhaseHypothesis,
  PhaseAlignmentConfig,
  // Musical Time (B4)
  MusicalTimeProvenance,
  MusicalTimeSegment,
  MusicalTimeStructure,
  BeatPosition,
  // Frequency Bands (F1)
  FrequencyBandTimeScope,
  FrequencySegment,
  FrequencyBandProvenance,
  FrequencyBand,
  FrequencyBandStructure,
  FrequencyBoundsAtTime,
  // Frequency Bands (F2)
  FrequencyKeyframe,
  // Band-Scoped MIR (F3)
  BandMirFunctionId,
  BandCqtFunctionId,
  BandEventFunctionId,
  BandMirDiagnostics,
  BandMir1DResult,
  BandCqt1DResult,
  BandMirEvent,
  BandEventDiagnostics,
  BandEventsResult,
  // CQT (F5)
  CqtConfig,
  CqtSpectrogram,
  CqtSignalId,
  CqtSignalResult,
  // Band Proposals (F5)
  BandProposalSource,
  BandProposal,
  BandProposalConfig,
  BandProposalResult,
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

export type { AmplitudeEnvelopeConfig, AmplitudeEnvelopeResult } from "./dsp/spectral";
export { amplitudeEnvelope, spectralCentroid, spectralFlux } from "./dsp/spectral";

// ----------------------------
// Onsets / Peaks
// ----------------------------

export type { OnsetEnvelope, OnsetEnvelopeOptions, OnsetEnvelopeGpuResult } from "./dsp/onset";
export { onsetEnvelopeFromSpectrogram, onsetEnvelopeFromMel, onsetEnvelopeFromMelGpu } from "./dsp/onset";

export type { PeakPickEvent, PeakPickOptions } from "./dsp/peakPick";
export { peakPick } from "./dsp/peakPick";

// ----------------------------
// Beat Candidates
// ----------------------------

export type { BeatCandidatesOptions, BeatCandidatesOutput, BeatSalienceSignal } from "./dsp/beatCandidates";
export { detectBeatCandidates, beatSalienceFromMel } from "./dsp/beatCandidates";

// ----------------------------
// Tempo Hypotheses
// ----------------------------

export type { TempoHypothesesOptions, TempoHypothesesOutput } from "./dsp/tempoHypotheses";
export { generateTempoHypotheses } from "./dsp/tempoHypotheses";

// ----------------------------
// Phase Alignment (Beat Grid)
// ----------------------------

export { computePhaseHypotheses, generateBeatTimes } from "./dsp/phaseAlignment";

// ----------------------------
// Peak Picking
// ----------------------------

export {
    pickPeaks,
    pickPeaksAdaptive,
    computeAdaptiveThreshold,
    applyHysteresisGate,
    DEFAULT_PEAK_PICKING_PARAMS,
    type PeakPickingParams,
    type PeakPickingResult,
    type AdaptivePeakPickingResult,
    type HysteresisGateParams,
} from "./dsp/peakPicking";

// ----------------------------
// Musical Time (B4)
// ----------------------------

export {
    findSegmentAtTime,
    computeBeatPosition,
    computeBeatPositionFromStructure,
    generateSegmentId,
    createSegmentFromGrid,
    createMusicalTimeStructure,
    validateSegments,
    sortSegments,
    splitSegment,
    generateSegmentBeatTimes,
} from "./dsp/musicalTime";

// ----------------------------
// Frequency Bands (F1)
// ----------------------------

export {
    // ID generation
    generateBandId,
    // Validation
    validateFrequencySegments,
    validateFrequencyBand,
    validateBandStructure,
    // Creation
    createBandStructure,
    createConstantBand,
    createSectionedBand,
    createStandardBands,
    // Queries
    bandsActiveAt,
    frequencyBoundsAt,
    allFrequencyBoundsAt,
    findBandById,
    // Sorting
    sortBands,
    sortFrequencySegments,
    // Modification
    touchStructure,
    addBandToStructure,
    removeBandFromStructure,
    updateBandInStructure,
    // Keyframe Helpers (F2)
    keyframesFromBand,
    segmentsFromKeyframes,
    splitBandSegmentAt,
    mergeAdjacentSegments,
    removeKeyframe,
    updateKeyframe,
    moveKeyframeTime,
} from "./dsp/frequencyBand";

// ----------------------------
// Band-Scoped MIR (F3)
// ----------------------------

export type { BandMaskOptions, MaskedSpectrogram } from "./dsp/bandMask";
export {
    binToHz,
    hzToBin,
    computeBandMaskAtTime,
    applyBandMaskToSpectrogram,
    computeFrameEnergy,
    computeFrameAmplitude,
} from "./dsp/bandMask";

export type { BandMirOptions, BandMirBatchRequest, BandMirBatchResult } from "./dsp/bandMir";
export {
    bandAmplitudeEnvelope,
    bandOnsetStrength,
    bandSpectralFlux,
    bandSpectralCentroid,
    runBandMirBatch,
    getBandMirFunctionLabel,
} from "./dsp/bandMir";

// ----------------------------
// Band Events (F3)
// ----------------------------

export type {
    BandOnsetPeaksOptions,
    BandBeatCandidatesOptions,
    BandEventsBatchRequest,
    BandEventsBatchResult,
} from "./dsp/bandEvents";
export {
    bandOnsetPeaks,
    bandBeatCandidates,
    runBandEventsBatch,
    getBandEventFunctionLabel,
} from "./dsp/bandEvents";

// ----------------------------
// Band CQT (F3)
// ----------------------------

export type {
    BandCqtOptions,
    MaskedCqtSpectrogram,
    BandCqtBatchRequest,
    BandCqtBatchResult,
} from "./dsp/bandCqt";
export {
    applyBandMaskToCqt,
    bandCqtHarmonicEnergy,
    bandCqtBassPitchMotion,
    bandCqtTonalStability,
    runBandCqtBatch,
    getBandCqtFunctionLabel,
} from "./dsp/bandCqt";

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

export type { MelConfig, MelSpectrogram, MelConversionConfig } from "./dsp/mel";
export { melSpectrogram, hzToMel, melToHz, hzToFeatureIndex, featureIndexToHz } from "./dsp/mel";

// ----------------------------
// CQT (F5)
// ----------------------------

export type { CqtOptions } from "./dsp/cqt";
export {
    cqtSpectrogram,
    computeCqt,
    cqtBinToHz,
    hzToCqtBin,
    getNumOctaves,
    getNumBins,
    getCqtBinFrequencies,
    withCqtDefaults,
    CQT_DEFAULTS,
} from "./dsp/cqt";

export {
    harmonicEnergy,
    bassPitchMotion,
    tonalStability,
    computeCqtSignal,
    computeAllCqtSignals,
} from "./dsp/cqtSignals";

// ----------------------------
// Band Proposals (F5)
// ----------------------------

export type { BandProposalOptions } from "./dsp/bandProposal";
export { generateBandProposals } from "./dsp/bandProposal";

// ----------------------------
// Custom Signal Reduction
// ----------------------------

export type {
    ReductionInput,
    ReductionAlgorithmId,
    BinRangeOptions,
    OnsetStrengthOptions,
    SpectralFluxOptions,
    ReductionOptions,
    ReductionResult,
    // Polarity
    PolarityMode,
    // Stabilization
    StabilizationMode,
    EnvelopeMode,
    StabilizationOptions,
} from "./dsp/customSignalReduction";
export {
    reduce2DToSignal,
    getReductionAlgorithmLabel,
    getReductionAlgorithmDescription,
    // Polarity
    applyPolarity,
    // Stabilization
    stabilizeSignal,
    // Statistics
    computePercentiles,
    computeLocalStats,
} from "./dsp/customSignalReduction";

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
