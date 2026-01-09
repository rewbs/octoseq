/**
 * Type definitions for Derived Signals feature.
 *
 * Derived Signals are interpretation-layer artifacts that produce 1D control signals from:
 * - 2D spectral data (spectrograms, MFCC, HPSS) via reduction algorithms
 * - 1D MIR signals (amplitude envelope, spectral centroid, etc.) via transform chains
 * - Event streams (beats, onsets, authored events) via conversion algorithms
 *
 * Design Principles:
 * - Definitions are persisted, not computed samples
 * - All inputs reference existing MIR/event data by ID
 * - Transform chains are declarative, not imperative
 * - No oscillators, time modulation, or feedback (explicitly disallowed)
 * - Derived signals can reference other derived signals (with cycle detection)
 */

import type {
  BandMirFunctionId,
  BandCqtFunctionId,
  BandEventFunctionId,
} from "@octoseq/mir";

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/**
 * Current schema version for DerivedSignalStructure.
 * Increment when making breaking changes to the structure.
 */
export const DERIVED_SIGNAL_SCHEMA_VERSION = 1;

// ============================================================================
// SOURCE TYPES - 2D Spectral Data
// ============================================================================

/**
 * Available 2D source functions that can be reduced to 1D.
 */
export type Source2DFunctionId =
  | "melSpectrogram"
  | "hpssHarmonic"
  | "hpssPercussive"
  | "mfcc"
  | "mfccDelta"
  | "mfccDeltaDelta";

/**
 * Reduction algorithm identifiers for 2D -> 1D conversion.
 */
export type Reducer2DAlgorithmId =
  | "mean" // Average across bins per frame
  | "max" // Maximum value per frame
  | "sum" // Sum across bins per frame
  | "variance" // Variance across bins per frame
  | "amplitude" // Sum of magnitudes (energy envelope)
  | "spectralFlux" // L1 distance between consecutive frames
  | "spectralCentroid" // Weighted centroid frequency
  | "onsetStrength"; // Temporal derivative with smoothing

/**
 * Range specification for 2D extraction.
 */
export type RangeSpec2D =
  | { kind: "fullSpectrum" }
  | { kind: "bandReference"; bandId: string }
  | { kind: "frequencyRange"; lowHz: number; highHz: number }
  | { kind: "coefficientRange"; lowCoef: number; highCoef: number };

/**
 * Parameters specific to 2D reduction algorithms.
 */
export interface Reducer2DParams {
  // For onset strength
  smoothMs?: number;
  useLog?: boolean;
  diffMethod?: "rectified" | "abs";
  // For spectral flux
  normalized?: boolean;
}

/**
 * 2D source specification.
 * Extracts 1D signal from 2D spectral data using a reducer algorithm.
 */
export interface Source2D {
  kind: "2d";
  /** Audio source ID ("mixdown" or stem ID). */
  audioSourceId: string;
  /** The 2D MIR function to extract from. */
  functionId: Source2DFunctionId;
  /** Range of bins/frequencies to include. */
  range: RangeSpec2D;
  /** Algorithm to reduce 2D to 1D. */
  reducer: Reducer2DAlgorithmId;
  /** Algorithm-specific parameters. */
  reducerParams: Reducer2DParams;
}

// ============================================================================
// SOURCE TYPES - 1D Signals
// ============================================================================

/**
 * Available 1D MIR signals (global scope).
 */
export type Source1DGlobalFunctionId =
  | "amplitudeEnvelope"
  | "spectralCentroid"
  | "spectralFlux"
  | "onsetEnvelope"
  | "cqtHarmonicEnergy"
  | "cqtBassPitchMotion"
  | "cqtTonalStability";

/**
 * Reference to a 1D signal source.
 * Can be a MIR output, band signal, or another derived signal.
 */
export type Signal1DRef =
  | { type: "mir"; audioSourceId: string; functionId: Source1DGlobalFunctionId }
  | { type: "band"; bandId: string; functionId: BandMirFunctionId | BandCqtFunctionId }
  | { type: "derived"; signalId: string }; // Chaining - requires cycle detection

/**
 * 1D source specification.
 * References an existing 1D signal directly.
 * No reducer needed - transforms are applied via the transform chain.
 */
export interface Source1D {
  kind: "1d";
  /** Reference to the source signal. */
  signalRef: Signal1DRef;
}

// ============================================================================
// SOURCE TYPES - Event Streams
// ============================================================================

/**
 * Reference to an event stream.
 */
export type EventStreamRef =
  | { type: "candidateOnsets"; audioSourceId: string }
  | { type: "candidateBeats"; audioSourceId: string }
  | { type: "bandOnsetPeaks"; bandId: string }
  | { type: "bandBeatCandidates"; bandId: string }
  | { type: "authoredEvents"; streamId: string };

/**
 * Event reducer algorithm identifiers.
 */
export type ReducerEventAlgorithmId =
  | "eventCount" // Count of events per window
  | "eventDensity" // Normalized count (events per second)
  | "weightedSum" // Sum of event weights per window
  | "weightedMean" // Mean of event weights per window
  | "envelope"; // Generate envelope from events

/**
 * Window specification for event aggregation.
 */
export type EventWindow =
  | { kind: "seconds"; windowSize: number }
  | { kind: "beats"; windowSize: number }; // Requires beat grid

/**
 * Envelope shape for event-to-signal conversion.
 */
export type EventEnvelopeShape =
  | { kind: "impulse" }
  | { kind: "gaussian"; widthMs: number }
  | { kind: "attackDecay"; attackMs: number; decayMs: number };

/**
 * Parameters for event reduction.
 */
export interface ReducerEventParams {
  /** Window for aggregation (count, density, weighted operations). */
  window?: EventWindow;
  /** Envelope shape (only for "envelope" reducer). */
  envelopeShape?: EventEnvelopeShape;
  /** Whether to normalize output to 0-1 range. */
  normalizeOutput?: boolean;
}

/**
 * Event source specification.
 * Converts discrete events to a continuous 1D signal.
 */
export interface SourceEvents {
  kind: "events";
  /** Reference to the event stream. */
  streamRef: EventStreamRef;
  /** Algorithm to convert events to signal. */
  reducer: ReducerEventAlgorithmId;
  /** Reducer parameters. */
  reducerParams: ReducerEventParams;
}

// ============================================================================
// COMBINED SOURCE TYPE
// ============================================================================

/**
 * Source specification discriminated union.
 * Determines where the signal data comes from and initial processing.
 */
export type DerivedSignalSource = Source2D | Source1D | SourceEvents;

// ============================================================================
// TRANSFORM CHAIN
// ============================================================================

/**
 * Smoothing algorithm.
 */
export type SmoothingAlgorithm = "movingAverage" | "exponential" | "gaussian";

/**
 * Smoothing transform.
 */
export interface TransformSmooth {
  kind: "smooth";
  algorithm: SmoothingAlgorithm;
  /** Window size in milliseconds (for movingAverage, gaussian). */
  windowMs?: number;
  /** Time constant in milliseconds (for exponential). */
  timeConstantMs?: number;
}

/**
 * Normalization method.
 */
export type NormalizationMethod = "minMax" | "robust" | "zScore";

/**
 * Normalization transform.
 */
export interface TransformNormalize {
  kind: "normalize";
  method: NormalizationMethod;
  /** Percentile range for robust normalization (default: 5-95). */
  percentileLow?: number;
  percentileHigh?: number;
  /** Target range for output. */
  targetMin?: number;
  targetMax?: number;
}

/**
 * Scale and offset transform.
 * Linear transformation: output = input * scale + offset
 */
export interface TransformScale {
  kind: "scale";
  /** Multiplicative scale factor. */
  scale: number;
  /** Additive offset. */
  offset: number;
}

/**
 * Polarity transform.
 */
export interface TransformPolarity {
  kind: "polarity";
  /** Whether to take absolute value (magnitude). */
  mode: "signed" | "magnitude";
}

/**
 * Clamp transform.
 */
export interface TransformClamp {
  kind: "clamp";
  min: number;
  max: number;
}

/**
 * Remap transform.
 * Maps input range to output range with optional curve.
 */
export interface TransformRemap {
  kind: "remap";
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  /** Curve exponent (1 = linear, >1 = ease-in, <1 = ease-out). */
  curve?: number;
}

/**
 * Combined transform step union.
 */
export type TransformStep =
  | TransformSmooth
  | TransformNormalize
  | TransformScale
  | TransformPolarity
  | TransformClamp
  | TransformRemap;

/**
 * Ordered list of transform steps.
 * Applied sequentially to the source signal.
 */
export type TransformChain = TransformStep[];

// ============================================================================
// STABILIZATION (Legacy, simplified for new system)
// ============================================================================

/**
 * Stabilization mode for noise reduction.
 */
export type StabilizationMode = "none" | "light" | "medium" | "heavy";

/**
 * Envelope mode for signal shaping.
 */
export type EnvelopeMode = "raw" | "attackRelease";

/**
 * Stabilization settings applied after transforms.
 */
export interface StabilizationSettings {
  /** Smoothing intensity preset. */
  mode: StabilizationMode;
  /** Envelope shaping mode. */
  envelopeMode: EnvelopeMode;
  /** Attack time in seconds (for attackRelease mode). */
  attackTime?: number;
  /** Release time in seconds (for attackRelease mode). */
  releaseTime?: number;
}

// ============================================================================
// DERIVED SIGNAL DEFINITION
// ============================================================================

/**
 * Complete derived signal definition.
 * This is the persisted entity.
 */
export interface DerivedSignalDefinition {
  /** Stable unique identifier (nanoid). */
  id: string;

  /** User-editable display name. */
  name: string;

  /**
   * Source specification.
   * Discriminated union determining input type and initial processing.
   */
  source: DerivedSignalSource;

  /**
   * Transform chain applied after source reduction.
   * Ordered list of transforms applied sequentially.
   */
  transforms: TransformChain;

  /**
   * Stabilization settings (noise reduction, envelope shaping).
   * Applied after transforms.
   */
  stabilization: StabilizationSettings;

  /** Whether auto-recompute is enabled. */
  autoRecompute: boolean;

  /** Whether this signal is enabled. */
  enabled: boolean;

  /** Sort order for display. */
  sortOrder: number;

  /** ISO timestamp when created. */
  createdAt: string;

  /** ISO timestamp when last modified. */
  modifiedAt: string;
}

// ============================================================================
// DERIVED SIGNAL STRUCTURE (Collection)
// ============================================================================

/**
 * Versioned collection of derived signal definitions.
 * This is what gets persisted in the project file.
 */
export interface DerivedSignalStructure {
  /**
   * Schema version for migrations.
   */
  version: number;

  /** All derived signal definitions. */
  signals: DerivedSignalDefinition[];

  /** ISO timestamp when created. */
  createdAt: string;

  /** ISO timestamp when last modified. */
  modifiedAt: string;
}

// ============================================================================
// COMPUTED RESULT (Not Persisted)
// ============================================================================

/**
 * Computation status for a derived signal.
 */
export type DerivedSignalStatus =
  | "pending" // Not yet computed
  | "computing" // Currently being computed
  | "computed" // Successfully computed
  | "stale" // Definition changed since last compute
  | "error"; // Computation failed

/**
 * Computed result of a derived signal.
 * Cached at runtime, never persisted.
 */
export interface DerivedSignalResult {
  /** Definition ID this result is for. */
  definitionId: string;

  /** Computation status. */
  status: DerivedSignalStatus;

  /** Error message if status is "error". */
  errorMessage?: string;

  /** Frame times in seconds. */
  times: Float32Array;

  /** Signal values per frame (after all transforms). */
  values: Float32Array;

  /** Pre-transform values (for debugging/comparison). */
  rawValues?: Float32Array;

  /** Value range for normalization. */
  valueRange: { min: number; max: number };

  /** Percentile range (for robust normalization reference). */
  percentileRange?: { p5: number; p95: number };

  /** Computation timestamp. */
  computedAt: string;

  /** Computation duration in milliseconds. */
  computeTimeMs?: number;

  /** Hash of the definition used to compute this result. */
  definitionHash?: string;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an empty derived signal structure.
 */
export function createEmptyDerivedSignalStructure(): DerivedSignalStructure {
  const now = new Date().toISOString();
  return {
    version: DERIVED_SIGNAL_SCHEMA_VERSION,
    signals: [],
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Create default stabilization settings.
 */
export function getDefaultStabilizationSettings(): StabilizationSettings {
  return {
    mode: "none",
    envelopeMode: "raw",
    attackTime: 0.01,
    releaseTime: 0.1,
  };
}

/**
 * Create default 2D reducer params for a given algorithm.
 */
export function getDefaultReducer2DParams(
  algorithm: Reducer2DAlgorithmId
): Reducer2DParams {
  switch (algorithm) {
    case "onsetStrength":
      return {
        smoothMs: 10,
        useLog: true,
        diffMethod: "rectified",
      };
    case "spectralFlux":
      return {
        normalized: true,
      };
    default:
      return {};
  }
}

/**
 * Create default event reducer params for a given algorithm.
 */
export function getDefaultReducerEventParams(
  algorithm: ReducerEventAlgorithmId
): ReducerEventParams {
  switch (algorithm) {
    case "eventCount":
    case "eventDensity":
    case "weightedSum":
    case "weightedMean":
      return {
        window: { kind: "seconds", windowSize: 0.5 },
        normalizeOutput: true,
      };
    case "envelope":
      return {
        envelopeShape: { kind: "attackDecay", attackMs: 5, decayMs: 100 },
        normalizeOutput: true,
      };
  }
}

/**
 * Create a default 2D-sourced derived signal definition.
 */
export function createDefault2DSignal(
  audioSourceId: string = "mixdown"
): Omit<DerivedSignalDefinition, "id" | "createdAt" | "modifiedAt"> {
  return {
    name: "New Signal",
    source: {
      kind: "2d",
      audioSourceId,
      functionId: "melSpectrogram",
      range: { kind: "fullSpectrum" },
      reducer: "mean",
      reducerParams: {},
    },
    transforms: [],
    stabilization: getDefaultStabilizationSettings(),
    autoRecompute: true,
    enabled: true,
    sortOrder: 0,
  };
}

/**
 * Create a default 1D-sourced derived signal definition.
 */
export function createDefault1DSignal(
  audioSourceId: string = "mixdown"
): Omit<DerivedSignalDefinition, "id" | "createdAt" | "modifiedAt"> {
  return {
    name: "New Signal",
    source: {
      kind: "1d",
      signalRef: {
        type: "mir",
        audioSourceId,
        functionId: "amplitudeEnvelope",
      },
    },
    transforms: [],
    stabilization: getDefaultStabilizationSettings(),
    autoRecompute: true,
    enabled: true,
    sortOrder: 0,
  };
}

/**
 * Create a default event-sourced derived signal definition.
 */
export function createDefaultEventSignal(
  audioSourceId: string = "mixdown"
): Omit<DerivedSignalDefinition, "id" | "createdAt" | "modifiedAt"> {
  return {
    name: "New Signal",
    source: {
      kind: "events",
      streamRef: {
        type: "candidateOnsets",
        audioSourceId,
      },
      reducer: "envelope",
      reducerParams: getDefaultReducerEventParams("envelope"),
    },
    transforms: [],
    stabilization: getDefaultStabilizationSettings(),
    autoRecompute: true,
    enabled: true,
    sortOrder: 0,
  };
}

// ============================================================================
// LABELS AND DESCRIPTIONS
// ============================================================================

export const SOURCE_KIND_LABELS: Record<DerivedSignalSource["kind"], string> = {
  "2d": "2D Spectral",
  "1d": "1D Signal",
  events: "Events",
};

export const SOURCE_2D_LABELS: Record<Source2DFunctionId, string> = {
  melSpectrogram: "Mel Spectrogram",
  hpssHarmonic: "HPSS Harmonic",
  hpssPercussive: "HPSS Percussive",
  mfcc: "MFCC",
  mfccDelta: "MFCC Delta",
  mfccDeltaDelta: "MFCC Delta-Delta",
};

export const SOURCE_2D_SHORT_LABELS: Record<Source2DFunctionId, string> = {
  melSpectrogram: "Mel",
  hpssHarmonic: "Harmonic",
  hpssPercussive: "Percussive",
  mfcc: "MFCC",
  mfccDelta: "MFCC Δ",
  mfccDeltaDelta: "MFCC ΔΔ",
};

export const REDUCER_2D_LABELS: Record<Reducer2DAlgorithmId, string> = {
  mean: "Mean",
  max: "Maximum",
  sum: "Sum",
  variance: "Variance",
  amplitude: "Amplitude Envelope",
  spectralFlux: "Spectral Flux",
  spectralCentroid: "Spectral Centroid",
  onsetStrength: "Onset Strength",
};

export const REDUCER_2D_SHORT_LABELS: Record<Reducer2DAlgorithmId, string> = {
  mean: "Mean",
  max: "Max",
  sum: "Sum",
  variance: "Var",
  amplitude: "Amp",
  spectralFlux: "Flux",
  spectralCentroid: "Centroid",
  onsetStrength: "Onset",
};

export const REDUCER_2D_DESCRIPTIONS: Record<Reducer2DAlgorithmId, string> = {
  mean: "Overall energy in this band (smooth, stable control)",
  max: "Emphasises the strongest partials (useful for transients)",
  sum: "Total energy accumulation (sensitive to broadband content)",
  variance: "Timbre instability or texture change",
  amplitude: "Energy envelope following loudness contour",
  spectralFlux: "Rate of spectral change (reacts to new events)",
  spectralCentroid: "Brightness / perceived pitch movement",
  onsetStrength: "Transient activity (peaks at note onsets)",
};

export const REDUCER_EVENT_LABELS: Record<ReducerEventAlgorithmId, string> = {
  eventCount: "Event Count",
  eventDensity: "Event Density",
  weightedSum: "Weighted Sum",
  weightedMean: "Weighted Mean",
  envelope: "Envelope",
};

export const REDUCER_EVENT_DESCRIPTIONS: Record<ReducerEventAlgorithmId, string> = {
  eventCount: "Count of events in each time window",
  eventDensity: "Normalized event count (events per second)",
  weightedSum: "Sum of event weights in each window",
  weightedMean: "Mean of event weights in each window",
  envelope: "Continuous envelope generated from event impulses",
};

export const TRANSFORM_LABELS: Record<TransformStep["kind"], string> = {
  smooth: "Smooth",
  normalize: "Normalize",
  scale: "Scale & Offset",
  polarity: "Polarity",
  clamp: "Clamp",
  remap: "Remap",
};

export const STABILIZATION_MODE_LABELS: Record<StabilizationMode, string> = {
  none: "None",
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

export const STABILIZATION_MODE_DESCRIPTIONS: Record<StabilizationMode, string> = {
  none: "No smoothing applied",
  light: "Subtle noise reduction, preserves fast transients",
  medium: "Balanced smoothing for cleaner control signals",
  heavy: "Strong smoothing for slow-moving modulation",
};

export const ENVELOPE_MODE_LABELS: Record<EnvelopeMode, string> = {
  raw: "Raw",
  attackRelease: "Attack / Release",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Whether the source supports frequency range selection.
 * MFCC bins are coefficients, not frequencies.
 */
export function source2DSupportsFrequencyRange(
  source: Source2DFunctionId
): boolean {
  return (
    source !== "mfcc" && source !== "mfccDelta" && source !== "mfccDeltaDelta"
  );
}

/**
 * Whether the source uses coefficient indices (MFCC-based).
 */
export function source2DUsesCoefficientRange(
  source: Source2DFunctionId
): boolean {
  return (
    source === "mfcc" || source === "mfccDelta" || source === "mfccDeltaDelta"
  );
}

/**
 * Get a human-readable description of a derived signal's source.
 */
export function getSourceDescription(source: DerivedSignalSource): string {
  switch (source.kind) {
    case "2d": {
      const fn = SOURCE_2D_SHORT_LABELS[source.functionId];
      const reducer = REDUCER_2D_SHORT_LABELS[source.reducer];
      if (source.range.kind === "fullSpectrum") {
        return `${fn} → ${reducer}`;
      } else if (source.range.kind === "frequencyRange") {
        return `${fn} ${source.range.lowHz}-${source.range.highHz}Hz → ${reducer}`;
      } else if (source.range.kind === "bandReference") {
        return `${fn} (band) → ${reducer}`;
      } else {
        return `${fn} coeffs → ${reducer}`;
      }
    }
    case "1d": {
      const ref = source.signalRef;
      if (ref.type === "mir") {
        return `MIR: ${ref.functionId}`;
      } else if (ref.type === "band") {
        return `Band: ${ref.functionId}`;
      } else {
        return `Derived: ${ref.signalId}`;
      }
    }
    case "events": {
      const ref = source.streamRef;
      const reducer = REDUCER_EVENT_LABELS[source.reducer];
      if (ref.type === "authoredEvents") {
        return `Authored events → ${reducer}`;
      } else {
        return `${ref.type} → ${reducer}`;
      }
    }
  }
}

/**
 * Get a human-readable description of the transform chain.
 */
export function getTransformDescription(transforms: TransformChain): string {
  if (transforms.length === 0) {
    return "No transforms";
  }
  return transforms.map((t) => TRANSFORM_LABELS[t.kind]).join(" → ");
}
