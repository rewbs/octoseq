/**
 * Persistence Layer
 *
 * Public API for the IndexedDB-based persistence system.
 * Provides autosave, asset registry, and recovery functionality.
 */

// Types
export type {
  AutosaveRecord,
  AssetType,
  AssetAudioMetadata,
  AssetRecord,
  AssetRecordWithoutData,
  SchemaMetadata,
  AutosaveStatus,
  AutosaveState,
  AssetResolutionStatus,
  UnresolvedAssetInfo,
} from "./types";

export { DB_SCHEMA_VERSION, ASSET_SCHEMA_VERSION } from "./types";

// Database
export { getDB, closeDB, isIndexedDBAvailable, deleteDatabase } from "./db";

// Autosave
export {
  saveAutosave,
  loadAutosave,
  clearAutosave,
  hasAutosave,
  triggerAutosave,
  cancelPendingAutosave,
  enableAutosave,
  disableAutosave,
  isAutosaveEnabled,
  formatAutosaveTimestamp,
  isAutosaveRecoverable,
} from "./autosave";

// Asset Registry
export {
  registerAsset,
  getAsset,
  hasAsset,
  findByContentHash,
  getProjectAssets,
  deleteAsset,
  deleteProjectAssets,
  validateAssetReferences,
  getProjectAssetsSize,
  formatBytes,
} from "./assetRegistry";

// Asset Hashing
export {
  computeContentHash,
  hashFile,
  hashesEqual,
  truncateHash,
} from "./assetHashing";
