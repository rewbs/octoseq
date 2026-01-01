/**
 * Type definitions for Custom Signal extraction feature.
 * Custom signals allow users to extract 1D signals from 2D spectral data
 * with configurable frequency ranges and reduction algorithms.
 */

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
export type ReductionAlgorithmId =
  | "mean"            // Average across bins per frame
  | "max"             // Maximum value per frame
  | "sum"             // Sum across bins per frame
  | "variance"        // Variance across bins per frame
  | "amplitude"       // Sum of magnitudes (like bandAmplitudeEnvelope)
  | "spectralFlux"    // L1 distance between consecutive frames
  | "spectralCentroid" // Weighted centroid frequency
  | "onsetStrength";  // Temporal derivative with smoothing

/**
 * Frequency/coefficient range specification for extraction.
 * For mel spectrogram and HPSS: frequency-based selection.
 * For MFCC: coefficient index-based selection.
 */
export type FrequencyRangeSpec =
  | { kind: "fullSpectrum" }
  | { kind: "bandReference"; bandId: string }
  | { kind: "custom"; lowHz: number; highHz: number }
  | { kind: "coefficientRange"; lowCoef: number; highCoef: number };

/**
 * Parameters specific to reduction algorithms.
 */
export interface ReductionAlgorithmParams {
  // For onset strength
  smoothMs?: number;
  useLog?: boolean;
  diffMethod?: "rectified" | "abs";
  // For spectral flux
  normalized?: boolean;
  // Future: weighting curve, custom formula, etc.
}

/**
 * Stabilization mode for noise reduction.
 * These are preset levels that map to internal smoothing parameters.
 */
export type StabilizationMode = "none" | "light" | "medium" | "heavy";

/**
 * Envelope mode for signal shaping.
 */
export type EnvelopeMode = "raw" | "attackRelease";

/**
 * Unit for attack/release time values.
 */
export type TimeUnit = "seconds" | "beats";

/**
 * Polarity interpretation mode for extracted signals.
 * Determines whether the signal preserves sign or represents magnitude only.
 */
export type PolarityMode = "signed" | "magnitude";

/**
 * Stabilization settings applied after reduction.
 */
export interface StabilizationSettings {
  /** Smoothing intensity preset. */
  mode: StabilizationMode;
  /** Envelope shaping mode. */
  envelopeMode: EnvelopeMode;
  /** Attack time (only used when envelopeMode is "attackRelease"). */
  attackTime?: number;
  /** Release time (only used when envelopeMode is "attackRelease"). */
  releaseTime?: number;
  /** Unit for attack/release times. */
  timeUnit?: TimeUnit;
}

/**
 * Default stabilization settings.
 */
export function getDefaultStabilizationSettings(): StabilizationSettings {
  return {
    mode: "none",
    envelopeMode: "raw",
    attackTime: 0.01,
    releaseTime: 0.1,
    timeUnit: "seconds",
  };
}

/**
 * Human-readable labels for stabilization modes.
 */
export const STABILIZATION_MODE_LABELS: Record<StabilizationMode, string> = {
  none: "None",
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

/**
 * Descriptions for stabilization modes.
 */
export const STABILIZATION_MODE_DESCRIPTIONS: Record<StabilizationMode, string> = {
  none: "No smoothing applied",
  light: "Subtle noise reduction, preserves fast transients",
  medium: "Balanced smoothing for cleaner control signals",
  heavy: "Strong smoothing for slow-moving modulation",
};

/**
 * Human-readable labels for envelope modes.
 */
export const ENVELOPE_MODE_LABELS: Record<EnvelopeMode, string> = {
  raw: "Raw",
  attackRelease: "Attack / Release",
};

/**
 * Human-readable labels for polarity modes.
 */
export const POLARITY_MODE_LABELS: Record<PolarityMode, string> = {
  signed: "Signed",
  magnitude: "Magnitude",
};

/**
 * Short labels for polarity modes (for compact UI).
 */
export const POLARITY_MODE_SHORT_LABELS: Record<PolarityMode, string> = {
  signed: "±",
  magnitude: "|x|",
};

/**
 * Descriptions for polarity modes.
 */
export const POLARITY_MODE_DESCRIPTIONS: Record<PolarityMode, string> = {
  signed: "Preserve direction (oscillates around zero)",
  magnitude: "Activity level only (always positive)",
};

/**
 * Definition of a custom signal extraction configuration.
 * This is what gets persisted in the project file.
 */
export interface CustomSignalDefinition {
  /** Unique identifier (nanoid). */
  id: string;
  /** User-editable name. */
  name: string;
  /** Audio source ID ("mixdown" or stem ID). */
  sourceAudioId: string;
  /** 2D function to extract from. */
  source2DFunction: Source2DFunctionId;
  /** Frequency range specification. */
  frequencyRange: FrequencyRangeSpec;
  /** Reduction algorithm. */
  reductionAlgorithm: ReductionAlgorithmId;
  /** Algorithm-specific parameters. */
  algorithmParams: ReductionAlgorithmParams;
  /** Polarity interpretation (signed vs magnitude). Applied after reduction, before stabilization. */
  polarityMode: PolarityMode;
  /** Stabilization settings (noise reduction, envelope shaping). */
  stabilization: StabilizationSettings;
  /** Whether auto-recompute is enabled for this signal. */
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

/**
 * Computed result of a custom signal extraction.
 * Not persisted - computed at runtime and cached.
 */
export interface CustomSignalResult {
  /** Definition ID this result is for. */
  definitionId: string;
  /** Frame times in seconds. */
  times: Float32Array;
  /** Signal values per frame (after stabilization). */
  values: Float32Array;
  /** Pre-stabilization values (for comparison, if stabilization was applied). */
  rawValues?: Float32Array;
  /** Value range for normalization (of stabilized signal). */
  valueRange: { min: number; max: number };
  /** Percentile range (5th to 95th) for reference. */
  percentileRange?: { p5: number; p95: number };
  /** Computation timestamp. */
  computedAt: string;
}

/**
 * Collection of custom signal definitions (persisted in project).
 */
export interface CustomSignalStructure {
  /** Schema version for migrations. */
  version: 1;
  /** All custom signal definitions. */
  signals: CustomSignalDefinition[];
  /** ISO timestamp when created. */
  createdAt: string;
  /** ISO timestamp when last modified. */
  modifiedAt: string;
}

/**
 * Human-readable labels for 2D source functions.
 */
export const SOURCE_2D_LABELS: Record<Source2DFunctionId, string> = {
  melSpectrogram: "Mel Spectrogram",
  hpssHarmonic: "HPSS Harmonic",
  hpssPercussive: "HPSS Percussive",
  mfcc: "MFCC",
  mfccDelta: "MFCC Delta",
  mfccDeltaDelta: "MFCC Delta-Delta",
};

/**
 * Short labels for 2D source functions (for compact UI).
 */
export const SOURCE_2D_SHORT_LABELS: Record<Source2DFunctionId, string> = {
  melSpectrogram: "Mel",
  hpssHarmonic: "Harmonic",
  hpssPercussive: "Percussive",
  mfcc: "MFCC",
  mfccDelta: "MFCC Δ",
  mfccDeltaDelta: "MFCC ΔΔ",
};

/**
 * Human-readable labels for reduction algorithms.
 */
export const REDUCTION_ALGORITHM_LABELS: Record<ReductionAlgorithmId, string> = {
  mean: "Mean",
  max: "Maximum",
  sum: "Sum",
  variance: "Variance",
  amplitude: "Amplitude Envelope",
  spectralFlux: "Spectral Flux",
  spectralCentroid: "Spectral Centroid",
  onsetStrength: "Onset Strength",
};

/**
 * Short labels for reduction algorithms (for compact UI).
 */
export const REDUCTION_ALGORITHM_SHORT_LABELS: Record<ReductionAlgorithmId, string> = {
  mean: "Mean",
  max: "Max",
  sum: "Sum",
  variance: "Var",
  amplitude: "Amp",
  spectralFlux: "Flux",
  spectralCentroid: "Centroid",
  onsetStrength: "Onset",
};

/**
 * Descriptions for reduction algorithms - musically meaningful explanations.
 */
export const REDUCTION_ALGORITHM_DESCRIPTIONS: Record<ReductionAlgorithmId, string> = {
  mean: "Overall energy in this band (smooth, stable control)",
  max: "Emphasises the strongest partials (useful for transients and percussive energy)",
  sum: "Total energy accumulation (sensitive to broadband content)",
  variance: "Timbre instability or texture change (higher when spectrum is varied)",
  amplitude: "Energy envelope following loudness contour",
  spectralFlux: "Rate of spectral change (reacts to new events and timbral shifts)",
  spectralCentroid: "Brightness / perceived pitch movement (higher = brighter sound)",
  onsetStrength: "Transient activity in this band (peaks at note onsets and attacks)",
};

/**
 * Whether the source supports frequency range selection.
 * MFCC bins are coefficients, not frequencies.
 */
export function sourceSupportsFrequencyRange(source: Source2DFunctionId): boolean {
  return source !== "mfcc" && source !== "mfccDelta" && source !== "mfccDeltaDelta";
}

/**
 * Whether the source uses coefficient indices (MFCC-based).
 */
export function sourceUsesCoefficientRange(source: Source2DFunctionId): boolean {
  return source === "mfcc" || source === "mfccDelta" || source === "mfccDeltaDelta";
}

/**
 * Create default algorithm params for a given algorithm.
 */
export function getDefaultAlgorithmParams(algorithm: ReductionAlgorithmId): ReductionAlgorithmParams {
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
 * Create an empty custom signal structure.
 */
export function createEmptyCustomSignalStructure(): CustomSignalStructure {
  const now = new Date().toISOString();
  return {
    version: 1,
    signals: [],
    createdAt: now,
    modifiedAt: now,
  };
}
