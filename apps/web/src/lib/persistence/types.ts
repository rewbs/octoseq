/**
 * Persistence Types
 *
 * Type definitions for IndexedDB-based persistence layer.
 * Includes autosave records, asset registry, and schema metadata.
 */

import type { ProjectSerialized } from "../stores/types/project";
import type { AudioInputOrigin } from "../stores/types/audioInput";

// ----------------------------
// Database Schema Version
// ----------------------------

/** Current IndexedDB schema version */
export const DB_SCHEMA_VERSION = 1;

/** Current asset registry schema version */
export const ASSET_SCHEMA_VERSION = 1;

// ----------------------------
// Autosave Types
// ----------------------------

/**
 * Autosave record stored in IndexedDB.
 * Contains a full project snapshot for crash recovery.
 */
export interface AutosaveRecord {
  /** The serialized project snapshot */
  project: ProjectSerialized;
  /** ISO timestamp of last save */
  savedAt: string;
  /** Whether this record was from a recovery (for UI indication) */
  wasRecovered?: boolean;
  /** Original file handle name if one existed (for re-saving) */
  lastFileName?: string;
}

// ----------------------------
// Asset Registry Types
// ----------------------------

/** Types of assets that can be stored in the registry */
export type AssetType = "audio:mixdown" | "audio:stem" | "audio:derived";

/**
 * Audio metadata stored with each asset.
 * Used for identification and re-linking.
 */
export interface AssetAudioMetadata {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels */
  channels: number;
  /** Duration in seconds */
  duration: number;
  /** Total number of samples */
  totalSamples: number;
}

/**
 * Asset record stored in IndexedDB.
 * Contains binary audio data with metadata for deduplication and recovery.
 */
export interface AssetRecord {
  /** Unique asset identifier (UUID) */
  id: string;
  /** SHA-256 hash of binary content for deduplication */
  contentHash: string;
  /** Asset type for categorization */
  type: AssetType;
  /** Audio metadata for identification */
  metadata: AssetAudioMetadata;
  /** Origin information (how it was created) */
  origin: AudioInputOrigin;
  /** Original filename if imported from file */
  fileName?: string;
  /** The binary audio data (stored as ArrayBuffer) */
  data: ArrayBuffer;
  /** ISO timestamp when registered */
  createdAt: string;
  /** Project ID this asset belongs to (for cleanup) */
  projectId: string;
}

/**
 * Lightweight asset reference without binary data.
 * Used for listing and querying assets.
 */
export type AssetRecordWithoutData = Omit<AssetRecord, "data">;

// ----------------------------
// Schema Metadata Types
// ----------------------------

/**
 * Schema metadata for migration tracking.
 * Stored in IndexedDB to track version history.
 */
export interface SchemaMetadata {
  /** IndexedDB schema version */
  dbVersion: number;
  /** Asset registry schema version */
  assetSchemaVersion: number;
  /** ISO timestamp of last migration */
  lastMigration: string;
}

// ----------------------------
// Autosave Status Types
// ----------------------------

/** Status of autosave operations */
export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Autosave state for UI display.
 */
export interface AutosaveState {
  /** Current autosave status */
  status: AutosaveStatus;
  /** ISO timestamp of last successful save */
  lastSavedAt: string | null;
  /** Error message if status is "error" */
  error: string | null;
}

// ----------------------------
// Asset Recovery Types
// ----------------------------

/** Status of an asset reference during project load */
export type AssetResolutionStatus = "resolved" | "missing" | "reattached";

/**
 * Information about an unresolved asset reference.
 * Used for recovery UX.
 */
export interface UnresolvedAssetInfo {
  /** The asset ID that was referenced */
  assetId: string;
  /** Expected metadata for matching */
  expectedMetadata: AssetAudioMetadata;
  /** Original filename hint */
  fileName?: string;
  /** Role in the project (mixdown or stem) */
  role: "mixdown" | "stem";
  /** Label from the audio input */
  label: string;
}
