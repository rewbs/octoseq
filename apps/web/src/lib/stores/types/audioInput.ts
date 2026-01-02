import type { AudioBufferLike } from "@octoseq/mir";

/**
 * Tracks how an audio input was created/sourced.
 */
export type AudioInputOrigin =
  | { kind: "file"; fileName: string }
  | { kind: "url"; url: string; fileName?: string }
  | { kind: "stem"; sourceId: string; method: string }
  | { kind: "synthetic"; generatedFrom?: string[] };

/**
 * Metadata about an audio input's audio content.
 */
export interface AudioInputMetadata {
  sampleRate: number;
  totalSamples: number;
  duration: number;
}

/**
 * A single audio input in the collection.
 * Can be the mixdown (always present) or a stem (optional).
 */
export interface AudioInput {
  /** Stable identifier. "mixdown" for the mixdown, nanoid for stems. */
  id: string;
  /** User-facing display name. */
  label: string;
  /** Whether this is the mixdown or a stem. */
  role: "mixdown" | "stem";
  /** The decoded audio buffer. Null if not yet loaded. */
  audioBuffer: AudioBufferLike | null;
  /** Audio metadata. Null if not yet loaded. */
  metadata: AudioInputMetadata | null;
  /** Blob URL for playback/auditioning. Null if not created. */
  audioUrl: string | null;
  /** How this audio was sourced. */
  origin: AudioInputOrigin;
  /** ISO timestamp when this input was added. */
  createdAt: string;
  /**
   * Reference to asset in the local asset registry.
   * Populated on-demand when audio is persisted to IndexedDB.
   */
  assetId?: string;
  /**
   * Original ArrayBuffer from file (for asset registration).
   * Kept temporarily during loading, then cleared after registration.
   */
  rawBuffer?: ArrayBuffer;
}

/**
 * The collection of audio inputs.
 * Always contains a mixdown; may contain additional stems.
 */
export interface AudioInputCollection {
  /** Schema version for future migrations. */
  version: 1;
  /** All audio inputs keyed by id. */
  inputs: Record<string, AudioInput>;
  /** Ordered list of stem IDs (excludes mixdown). */
  stemOrder: string[];
}

/** The constant ID used for the mixdown input. */
export const MIXDOWN_ID = "mixdown";
