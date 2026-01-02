/**
 * Asset Registry Module
 *
 * Provides CRUD operations for managing audio assets in IndexedDB.
 * Assets are content-addressable via SHA-256 hashing for deduplication.
 */

import { getDB, isIndexedDBAvailable } from "./db";
import { computeContentHash } from "./assetHashing";
import type {
  AssetRecord,
  AssetRecordWithoutData,
  AssetType,
  AssetAudioMetadata,
} from "./types";
import type { AudioInputOrigin } from "../stores/types/audioInput";

// ----------------------------
// Asset Registration
// ----------------------------

/**
 * Register a new asset in the registry.
 * If an asset with the same content hash already exists, returns the existing ID.
 *
 * @param data - The binary audio data
 * @param type - The asset type
 * @param metadata - Audio metadata
 * @param origin - How the asset was created
 * @param projectId - The project this asset belongs to
 * @param fileName - Optional original filename
 * @returns Promise resolving to the asset ID (new or existing)
 */
export async function registerAsset(
  data: ArrayBuffer,
  type: AssetType,
  metadata: AssetAudioMetadata,
  origin: AudioInputOrigin,
  projectId: string,
  fileName?: string
): Promise<string> {
  if (!isIndexedDBAvailable()) {
    throw new Error("IndexedDB not available");
  }

  // Compute content hash for deduplication
  const contentHash = await computeContentHash(data);
  const db = await getDB();

  // Check for existing asset with same hash
  const existing = await db.getFromIndex("assets", "byContentHash", contentHash);
  if (existing) {
    console.log(`[AssetRegistry] Found existing asset with hash ${contentHash.slice(0, 8)}...`);
    return existing.id;
  }

  // Create new asset
  const id = crypto.randomUUID();
  const record: AssetRecord = {
    id,
    contentHash,
    type,
    metadata,
    origin,
    fileName,
    data,
    createdAt: new Date().toISOString(),
    projectId,
  };

  await db.put("assets", record);
  console.log(`[AssetRegistry] Registered new asset ${id} (${contentHash.slice(0, 8)}...)`);

  return id;
}

// ----------------------------
// Asset Retrieval
// ----------------------------

/**
 * Get an asset by ID.
 *
 * @param assetId - The asset ID to retrieve
 * @returns Promise resolving to the asset record, or null if not found
 */
export async function getAsset(assetId: string): Promise<AssetRecord | null> {
  if (!isIndexedDBAvailable()) {
    return null;
  }

  try {
    const db = await getDB();
    const record = await db.get("assets", assetId);
    return record ?? null;
  } catch (error) {
    console.error("[AssetRegistry] Failed to get asset:", error);
    return null;
  }
}

/**
 * Check if an asset exists by ID.
 *
 * @param assetId - The asset ID to check
 * @returns Promise resolving to true if the asset exists
 */
export async function hasAsset(assetId: string): Promise<boolean> {
  if (!isIndexedDBAvailable()) {
    return false;
  }

  try {
    const db = await getDB();
    const count = await db.count("assets", assetId);
    return count > 0;
  } catch (error) {
    console.error("[AssetRegistry] Failed to check asset:", error);
    return false;
  }
}

/**
 * Find an asset by content hash.
 * Useful for auto-matching when reattaching missing assets.
 *
 * @param contentHash - The SHA-256 hash to search for
 * @returns Promise resolving to the asset record, or null if not found
 */
export async function findByContentHash(
  contentHash: string
): Promise<AssetRecord | null> {
  if (!isIndexedDBAvailable()) {
    return null;
  }

  try {
    const db = await getDB();
    const record = await db.getFromIndex("assets", "byContentHash", contentHash);
    return record ?? null;
  } catch (error) {
    console.error("[AssetRegistry] Failed to find by hash:", error);
    return null;
  }
}

/**
 * Get all assets for a project (without binary data for efficiency).
 *
 * @param projectId - The project ID
 * @returns Promise resolving to array of asset records without data
 */
export async function getProjectAssets(
  projectId: string
): Promise<AssetRecordWithoutData[]> {
  if (!isIndexedDBAvailable()) {
    return [];
  }

  try {
    const db = await getDB();
    const tx = db.transaction("assets", "readonly");
    const index = tx.store.index("byProjectId");

    const results: AssetRecordWithoutData[] = [];
    let cursor = await index.openCursor(projectId);

    while (cursor) {
      const { data: _data, ...withoutData } = cursor.value;
      results.push(withoutData);
      cursor = await cursor.continue();
    }

    return results;
  } catch (error) {
    console.error("[AssetRegistry] Failed to get project assets:", error);
    return [];
  }
}

// ----------------------------
// Asset Deletion
// ----------------------------

/**
 * Delete an asset by ID.
 *
 * @param assetId - The asset ID to delete
 * @returns Promise resolving when deletion is complete
 */
export async function deleteAsset(assetId: string): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const db = await getDB();
    await db.delete("assets", assetId);
    console.log(`[AssetRegistry] Deleted asset ${assetId}`);
  } catch (error) {
    console.error("[AssetRegistry] Failed to delete asset:", error);
    throw error;
  }
}

/**
 * Delete all assets for a project.
 *
 * @param projectId - The project ID
 * @returns Promise resolving to the number of assets deleted
 */
export async function deleteProjectAssets(projectId: string): Promise<number> {
  if (!isIndexedDBAvailable()) {
    return 0;
  }

  try {
    const db = await getDB();
    const tx = db.transaction("assets", "readwrite");
    const index = tx.store.index("byProjectId");

    let deleted = 0;
    let cursor = await index.openCursor(projectId);

    while (cursor) {
      await cursor.delete();
      deleted++;
      cursor = await cursor.continue();
    }

    console.log(`[AssetRegistry] Deleted ${deleted} assets for project ${projectId}`);
    return deleted;
  } catch (error) {
    console.error("[AssetRegistry] Failed to delete project assets:", error);
    throw error;
  }
}

// ----------------------------
// Validation
// ----------------------------

/**
 * Validate asset references for a project.
 * Returns lists of valid and missing asset IDs.
 *
 * @param assetIds - Array of asset IDs to validate
 * @returns Promise resolving to { valid: string[], missing: string[] }
 */
export async function validateAssetReferences(
  assetIds: string[]
): Promise<{ valid: string[]; missing: string[] }> {
  const valid: string[] = [];
  const missing: string[] = [];

  for (const assetId of assetIds) {
    if (await hasAsset(assetId)) {
      valid.push(assetId);
    } else {
      missing.push(assetId);
    }
  }

  return { valid, missing };
}

// ----------------------------
// Utility
// ----------------------------

/**
 * Get total size of assets for a project.
 *
 * @param projectId - The project ID
 * @returns Promise resolving to total size in bytes
 */
export async function getProjectAssetsSize(projectId: string): Promise<number> {
  if (!isIndexedDBAvailable()) {
    return 0;
  }

  try {
    const db = await getDB();
    const tx = db.transaction("assets", "readonly");
    const index = tx.store.index("byProjectId");

    let totalSize = 0;
    let cursor = await index.openCursor(projectId);

    while (cursor) {
      totalSize += cursor.value.data.byteLength;
      cursor = await cursor.continue();
    }

    return totalSize;
  } catch (error) {
    console.error("[AssetRegistry] Failed to get project assets size:", error);
    return 0;
  }
}

/**
 * Format bytes for human-readable display.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
