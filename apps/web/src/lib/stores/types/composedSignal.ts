/**
 * Composed Signal Types
 *
 * Composed Signals are human-authored interpretation curves defined in musical time (beats).
 * They are distinct from MIR-derived signals and express subjective interpretation
 * (intensity, tension, emotion).
 *
 * Key properties:
 * - Defined in beats, NOT seconds (requires BPM)
 * - Persisted as keyframes + interpolation (NOT sampled values)
 * - Consumed by scripts via inputs.composedSignals["name"]
 */

/**
 * Schema version for future migrations.
 */
export const COMPOSED_SIGNAL_SCHEMA_VERSION = 1;

/**
 * Interpolation types for keyframe transitions.
 * These match the easing functions available in the visualiser.
 */
export type InterpolationType =
  | "linear"
  | "ease_in"
  | "ease_out"
  | "ease_in_out"
  | "exponential_in"
  | "exponential_out"
  | "hold";

/**
 * Single keyframe node in a composed signal.
 */
export interface ComposedSignalNode {
  /** Unique identifier (nanoid). */
  id: string;
  /** Position in beats (x-axis). */
  time_beats: number;
  /** Value at this node, normalized 0-1 (y-axis). */
  value: number;
  /** Interpolation method to the next node. */
  interp_to_next: InterpolationType;
}

/**
 * Complete composed signal definition (persisted).
 */
export interface ComposedSignalDefinition {
  /** Unique identifier (nanoid). */
  id: string;
  /** User-editable display name. */
  name: string;
  /** Time domain - currently always "beats". Reserved for future "seconds" option. */
  domain: "beats";
  /** Ordered list of keyframe nodes. */
  nodes: ComposedSignalNode[];
  /** Whether this signal is enabled for script access. */
  enabled: boolean;
  /** Display order in lists. */
  sortOrder: number;
  /** Minimum output value (default 0). */
  valueMin: number;
  /** Maximum output value (default 1). */
  valueMax: number;
  /** ISO timestamp when created. */
  createdAt: string;
  /** ISO timestamp when last modified. */
  modifiedAt: string;
}

/**
 * Root structure for project persistence.
 * Contains all composed signals with versioning for migrations.
 */
export interface ComposedSignalStructure {
  /** Schema version for migrations. */
  version: number;
  /** All composed signals in the project. */
  signals: ComposedSignalDefinition[];
  /** ISO timestamp when structure was created. */
  createdAt: string;
  /** ISO timestamp when structure was last modified. */
  modifiedAt: string;
}

/**
 * Human-readable labels for interpolation types (for UI).
 */
export const INTERPOLATION_LABELS: Record<InterpolationType, string> = {
  linear: "Linear",
  ease_in: "Ease In",
  ease_out: "Ease Out",
  ease_in_out: "Ease In/Out",
  exponential_in: "Expo In",
  exponential_out: "Expo Out",
  hold: "Hold",
};

/**
 * All interpolation types as an ordered array (for dropdowns).
 */
export const INTERPOLATION_TYPES: InterpolationType[] = [
  "linear",
  "ease_in",
  "ease_out",
  "ease_in_out",
  "exponential_in",
  "exponential_out",
  "hold",
];

/**
 * Default interpolation for new nodes.
 */
export const DEFAULT_INTERPOLATION: InterpolationType = "linear";

/**
 * Default value range for new signals.
 */
export const DEFAULT_VALUE_MIN = 0;
export const DEFAULT_VALUE_MAX = 1;
