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
  category: "timing" | "audio" | "spectral" | "onset" | "search";
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
 * All signals combined. This is the master list used throughout the app.
 */
export const ALL_SIGNALS: SignalMetadata[] = [
  ...TIMING_SIGNALS,
  ...AUDIO_SIGNALS,
  ...SPECTRAL_SIGNALS,
  ...ONSET_SIGNALS,
  ...SEARCH_SIGNALS,
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
    description: "Read-only structure containing frame-aligned audio & MIR signals",
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
