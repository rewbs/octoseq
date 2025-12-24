/**
 * Signal metadata for Rhai scripting DX.
 *
 * This is the SINGLE SOURCE OF TRUTH for:
 * - Runtime injection into the `inputs` struct
 * - Monaco hover tooltips
 * - Monaco autocomplete suggestions
 *
 * When adding new signals, add them here and they will automatically
 * appear in autocomplete, hover info, and be available at runtime.
 */

export interface SignalMetadata {
  /** The property name as it appears in `inputs.<name>` */
  name: string;
  /** Human-readable description for hover tooltips */
  description: string;
  /** Data type (always "number" for scalar signals) */
  type: "number";
  /** Value range or units, e.g. "0–1 (normalized)", "Hz" */
  range?: string;
  /** Category for grouping in documentation */
  category: "timing" | "audio" | "spectral" | "onset" | "search" | "musical-time";
}

/**
 * Core timing signals always available in scripts.
 */
export const TIMING_SIGNALS: SignalMetadata[] = [
  {
    name: "time",
    description: "Total elapsed playback time in seconds",
    type: "number",
    range: "seconds",
    category: "timing",
  },
  {
    name: "dt",
    description: "Delta time since last frame (for smooth animations)",
    type: "number",
    range: "seconds (typically ~0.016 at 60fps)",
    category: "timing",
  },
];

/**
 * Audio-derived signals.
 */
export const AUDIO_SIGNALS: SignalMetadata[] = [
  {
    name: "amplitude",
    description: "Audio amplitude (RMS envelope of the waveform)",
    type: "number",
    range: "0–1 (normalized)",
    category: "audio",
  },
];

/**
 * Spectral analysis signals.
 */
export const SPECTRAL_SIGNALS: SignalMetadata[] = [
  {
    name: "spectralCentroid",
    description: "Spectral centroid - the 'brightness' of the sound",
    type: "number",
    range: "0–1 (normalized from Hz)",
    category: "spectral",
  },
  {
    name: "spectralFlux",
    description: "Spectral flux - rate of spectral change between frames",
    type: "number",
    range: "0–1 (normalized)",
    category: "spectral",
  },
];

/**
 * Onset detection signals.
 */
export const ONSET_SIGNALS: SignalMetadata[] = [
  {
    name: "onsetEnvelope",
    description: "Onset detection envelope - rises sharply at note attacks",
    type: "number",
    range: "0–1 (normalized)",
    category: "onset",
  },
];

/**
 * Search/similarity signals (when search results are available).
 */
export const SEARCH_SIGNALS: SignalMetadata[] = [
  {
    name: "searchSimilarity",
    description: "Similarity to the current search query",
    type: "number",
    range: "0–1 (1 = perfect match)",
    category: "search",
  },
];

/**
 * Musical time signals (when musical time segments are authored).
 *
 * These signals are available when at least one musical time segment
 * exists and playback has entered a segment. Outside segments, they
 * freeze at the last known value.
 */
export const MUSICAL_TIME_SIGNALS: SignalMetadata[] = [
  {
    name: "beatPosition",
    description: "Continuous beat position (beatIndex + beatPhase)",
    type: "number",
    range: "0 to track beats (continuous)",
    category: "musical-time",
  },
  {
    name: "beatIndex",
    description: "Current beat number from segment start (integer)",
    type: "number",
    range: "integer (0, 1, 2, ...)",
    category: "musical-time",
  },
  {
    name: "beatPhase",
    description: "Phase within current beat (0 at beat, approaches 1 before next beat)",
    type: "number",
    range: "0–1",
    category: "musical-time",
  },
  {
    name: "bpm",
    description: "Current tempo in beats per minute",
    type: "number",
    range: "BPM value",
    category: "musical-time",
  },
];

/**
 * All signals combined. This is the master list used throughout the app.
 */
export const ALL_SIGNALS: SignalMetadata[] = [
  ...TIMING_SIGNALS,
  ...AUDIO_SIGNALS,
  ...SPECTRAL_SIGNALS,
  ...ONSET_SIGNALS,
  ...SEARCH_SIGNALS,
  ...MUSICAL_TIME_SIGNALS,
];

/**
 * Quick lookup map for signal metadata by name.
 */
export const SIGNAL_METADATA_MAP: Map<string, SignalMetadata> = new Map(
  ALL_SIGNALS.map((signal) => [signal.name, signal])
);

/**
 * Get signal names that should be available based on current data.
 */
export function getAvailableSignalNames(options: {
  hasAudio: boolean;
  hasMirResults: boolean;
  hasSearchResults: boolean;
  hasMusicalTime: boolean;
  availableMirFeatures?: string[];
}): string[] {
  const signals: string[] = [];

  // Timing signals are always available
  signals.push(...TIMING_SIGNALS.map((s) => s.name));

  // Audio signals
  if (options.hasAudio) {
    signals.push(...AUDIO_SIGNALS.map((s) => s.name));
  }

  // MIR-based signals (only those that are computed)
  if (options.hasMirResults && options.availableMirFeatures) {
    // Map MIR feature names to signal names (they're the same)
    const mirSignalNames = new Set([
      ...SPECTRAL_SIGNALS.map((s) => s.name),
      ...ONSET_SIGNALS.map((s) => s.name),
    ]);

    for (const feature of options.availableMirFeatures) {
      if (mirSignalNames.has(feature)) {
        signals.push(feature);
      }
    }
  }

  // Search signals
  if (options.hasSearchResults) {
    signals.push(...SEARCH_SIGNALS.map((s) => s.name));
  }

  // Musical time signals (available when segments are authored)
  if (options.hasMusicalTime) {
    signals.push(...MUSICAL_TIME_SIGNALS.map((s) => s.name));
  }

  return signals;
}

/**
 * Cube state properties (controlled by scripts).
 */
export interface CubePropertyMetadata {
  name: string;
  description: string;
  type: "number";
  range?: string;
}

export const CUBE_PROPERTIES: CubePropertyMetadata[] = [
  {
    name: "rotation_x",
    description: "Rotation around the X axis",
    type: "number",
    range: "radians",
  },
  {
    name: "rotation_y",
    description: "Rotation around the Y axis",
    type: "number",
    range: "radians",
  },
  {
    name: "rotation_z",
    description: "Rotation around the Z axis",
    type: "number",
    range: "radians",
  },
  {
    name: "scale",
    description: "Uniform scale factor",
    type: "number",
    range: "1.0 = original size",
  },
];

export const CUBE_PROPERTY_MAP: Map<string, CubePropertyMetadata> = new Map(
  CUBE_PROPERTIES.map((prop) => [prop.name, prop])
);

/**
 * Top-level identifiers available in Rhai scripts.
 */
export const TOP_LEVEL_IDENTIFIERS = [
  {
    name: "inputs",
    description: "Signal namespace - access audio & MIR signals as Signal objects. Use .smooth, .normalise, .gate for processing, .eval() to get current value.",
    kind: "object" as const,
  },
  {
    name: "gen",
    description: "Signal generator namespace - create oscillators (sin, square, triangle, saw), noise (white, pink), and Perlin noise, all synced to beats",
    kind: "object" as const,
  },
  {
    name: "cube",
    description: "Mutable cube state - set rotation and scale properties",
    kind: "object" as const,
  },
  {
    name: "dt",
    description: "Delta time since last frame (shorthand for inputs.dt)",
    kind: "variable" as const,
  },
  {
    name: "dbg",
    description: "Debug module for emitting signals during analysis mode",
    kind: "object" as const,
  },
];

/**
 * Debug module methods.
 */
export const DEBUG_MODULE_METHODS = [
  {
    name: "emit",
    description: "Emit a named debug signal value. Use dbg.emit(\"name\", value) to record signals for visualization.",
    signature: "dbg.emit(name: string, value: number)",
    example: 'dbg.emit("energy", inputs.amplitude * 2.0)',
  },
];

/**
 * Signal API - Fluent, beat-aware signal processing.
 *
 * Signals are lazy computation graphs that can be chained together.
 * The `inputs.<name>` properties return Signal objects (not raw numbers).
 */

export interface SignalMethodMetadata {
  name: string;
  description: string;
  signature: string;
  example?: string;
  returns: string;
}

/**
 * Signal smoothing methods (accessed via signal.smooth.*)
 */
export const SIGNAL_SMOOTH_METHODS: SignalMethodMetadata[] = [
  {
    name: "moving_average",
    description: "Apply a moving average filter over a window of N beats",
    signature: "signal.smooth.moving_average(beats: float)",
    example: "inputs.onsetEnvelope.smooth.moving_average(0.5)",
    returns: "Signal",
  },
  {
    name: "exponential",
    description: "Asymmetric exponential smoothing with separate attack and release times in beats",
    signature: "signal.smooth.exponential(attack_beats: float, release_beats: float)",
    example: "inputs.amplitude.smooth.exponential(0.1, 0.5)",
    returns: "Signal",
  },
  {
    name: "gaussian",
    description: "Gaussian blur with sigma in beats",
    signature: "signal.smooth.gaussian(sigma_beats: float)",
    example: "inputs.spectralCentroid.smooth.gaussian(0.25)",
    returns: "Signal",
  },
];

/**
 * Signal normalization methods (accessed via signal.normalise.*)
 */
export const SIGNAL_NORMALISE_METHODS: SignalMethodMetadata[] = [
  {
    name: "global",
    description: "Normalize to [0,1] using whole-track min/max statistics",
    signature: "signal.normalise.global()",
    example: "inputs.amplitude.normalise.global()",
    returns: "Signal",
  },
  {
    name: "robust",
    description: "Normalize using 5th-95th percentiles (clips outliers)",
    signature: "signal.normalise.robust()",
    example: "inputs.spectralFlux.normalise.robust()",
    returns: "Signal",
  },
  {
    name: "to_range",
    description: "Map signal to a custom output range",
    signature: "signal.normalise.to_range(min: float, max: float)",
    example: "inputs.amplitude.normalise.to_range(0.5, 2.0)",
    returns: "Signal",
  },
];

/**
 * Signal gating methods (accessed via signal.gate.*)
 */
export const SIGNAL_GATE_METHODS: SignalMethodMetadata[] = [
  {
    name: "threshold",
    description: "Binary gate: outputs 1.0 when signal >= threshold, else 0.0",
    signature: "signal.gate.threshold(threshold: float)",
    example: "inputs.onsetEnvelope.gate.threshold(0.7)",
    returns: "Signal",
  },
  {
    name: "hysteresis",
    description: "Schmitt trigger gate with separate on/off thresholds (prevents flickering)",
    signature: "signal.gate.hysteresis(on_threshold: float, off_threshold: float)",
    example: "inputs.amplitude.gate.hysteresis(0.6, 0.4)",
    returns: "Signal",
  },
];

/**
 * Signal arithmetic methods (accessed directly on Signal)
 */
export const SIGNAL_ARITHMETIC_METHODS: SignalMethodMetadata[] = [
  {
    name: "add",
    description: "Add another signal or constant value",
    signature: "signal.add(other: Signal | float)",
    example: "inputs.amplitude.add(0.5)",
    returns: "Signal",
  },
  {
    name: "mul",
    description: "Multiply by another signal or constant",
    signature: "signal.mul(other: Signal | float)",
    example: "inputs.amplitude.mul(inputs.onsetEnvelope)",
    returns: "Signal",
  },
  {
    name: "scale",
    description: "Multiply by a constant factor",
    signature: "signal.scale(factor: float)",
    example: "inputs.amplitude.scale(2.0)",
    returns: "Signal",
  },
  {
    name: "mix",
    description: "Linear interpolation between this signal and another (weight 0.0 = this, 1.0 = other)",
    signature: "signal.mix(other: Signal, weight: float)",
    example: "inputs.amplitude.mix(inputs.spectralFlux, 0.5)",
    returns: "Signal",
  },
  {
    name: "debug",
    description: "Attach a debug probe to emit this signal's value during analysis",
    signature: "signal.debug(name: string)",
    example: 'inputs.amplitude.smooth.exponential(0.1, 0.5).debug("smoothed_amp")',
    returns: "Signal (same signal, for chaining)",
  },
  {
    name: "eval",
    description: "Evaluate the signal at current time, returning a float value",
    signature: "signal.eval()",
    example: "let amp = inputs.amplitude.smooth.exponential(0.1, 0.5).eval();",
    returns: "float",
  },
];

/**
 * Generator functions (accessed via gen.*)
 * These produce beat-synced oscillators and noise.
 */
export const SIGNAL_GENERATOR_METHODS: SignalMethodMetadata[] = [
  {
    name: "sin",
    description: "Sine wave oscillator synced to beats",
    signature: "gen.sin(freq_beats: float, phase: float)",
    example: "gen.sin(1.0, 0.0)  // 1 beat period",
    returns: "Signal",
  },
  {
    name: "square",
    description: "Square wave oscillator with configurable duty cycle",
    signature: "gen.square(freq_beats: float, phase: float, duty: float)",
    example: "gen.square(0.5, 0.0, 0.5)  // 2 beat period, 50% duty",
    returns: "Signal",
  },
  {
    name: "triangle",
    description: "Triangle wave oscillator synced to beats",
    signature: "gen.triangle(freq_beats: float, phase: float)",
    example: "gen.triangle(1.0, 0.0)",
    returns: "Signal",
  },
  {
    name: "saw",
    description: "Sawtooth wave oscillator synced to beats",
    signature: "gen.saw(freq_beats: float, phase: float)",
    example: "gen.saw(2.0, 0.0)  // 2 cycles per beat",
    returns: "Signal",
  },
  {
    name: "noise_white",
    description: "White noise generator (uniform random)",
    signature: "gen.noise_white(seed: int)",
    example: "gen.noise_white(42)",
    returns: "Signal",
  },
  {
    name: "noise_pink",
    description: "Pink noise generator (1/f spectrum, Voss-McCartney algorithm)",
    signature: "gen.noise_pink(seed: int)",
    example: "gen.noise_pink(42)",
    returns: "Signal",
  },
  {
    name: "perlin",
    description: "1D Perlin noise, scaled by beats",
    signature: "gen.perlin(scale_beats: float, seed: int)",
    example: "gen.perlin(4.0, 42)  // 4 beats per noise cycle",
    returns: "Signal",
  },
  {
    name: "constant",
    description: "Create a constant signal (useful for mixing)",
    signature: "gen.constant(value: float)",
    example: "gen.constant(0.5)",
    returns: "Signal",
  },
];

/**
 * All Signal API methods combined for easy access.
 */
export const ALL_SIGNAL_METHODS = {
  smooth: SIGNAL_SMOOTH_METHODS,
  normalise: SIGNAL_NORMALISE_METHODS,
  gate: SIGNAL_GATE_METHODS,
  arithmetic: SIGNAL_ARITHMETIC_METHODS,
  generators: SIGNAL_GENERATOR_METHODS,
};
