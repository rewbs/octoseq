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
   * Reference to asset in the cloud (R2).
   * Populated when the file is uploaded to cloud storage.
   */
  cloudAssetId?: string;
  /**
   * Content hash of the original file (for deduplication).
   */
  contentHash?: string;
  /**
   * MIME type of the original file (e.g., "audio/mpeg", "audio/wav").
   */
  mimeType?: string;
  /**
   * Original ArrayBuffer from file (for asset registration and cloud upload).
   * Kept temporarily during loading, then cleared after upload completes.
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

// =============================================================================
// AudioSource: Single Source of Truth for Playback
// =============================================================================
//
// DESIGN PRINCIPLES:
// - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
// - WaveSurfer loads audio by URL only - never pass decoded buffers to it.
// - Decoding is for analysis (MIR) and generation (mixdown), not playback.
// - currentAudioSource is the single source of truth for what audio is playing.
// =============================================================================

/**
 * Status of an AudioSource's URL resolution.
 * - pending: Source set but URL not yet requested
 * - resolving: URL fetch/creation in progress
 * - ready: URL available for playback
 * - failed: Resolution failed (see error field)
 */
export type AudioSourceStatus = "pending" | "resolving" | "ready" | "failed";

/**
 * Base properties shared by all AudioSource variants.
 */
interface AudioSourceBase {
  /** Matches AudioInput.id - links source to its input in the collection. */
  id: string;
  /** Resolution status. */
  status: AudioSourceStatus;
  /** Playback URL. Set when status is 'ready'. */
  url?: string;
  /** Error message. Set when status is 'failed'. */
  error?: string;
}

/**
 * Audio source from a local file (File API).
 * URL is created via URL.createObjectURL().
 */
export interface LocalAudioSource extends AudioSourceBase {
  type: "local";
  /** The File object from file picker. */
  file: File;
}

/**
 * Audio source from cloud storage (R2).
 * URL is obtained via pre-signed download URL.
 */
export interface RemoteAudioSource extends AudioSourceBase {
  type: "remote";
  /** Reference to asset in cloud storage. */
  cloudAssetId: string;
}

/**
 * Audio source from generated content (e.g., mixdown from stems).
 * URL is created from the generated audio buffer.
 */
export interface GeneratedAudioSource extends AudioSourceBase {
  type: "generated";
  /** IDs of source inputs used to generate this audio. */
  generatedFrom: string[];
}

/**
 * Discriminated union of all audio source types.
 * This is the single source of truth for what audio is currently playing.
 */
export type AudioSource =
  | LocalAudioSource
  | RemoteAudioSource
  | GeneratedAudioSource;
