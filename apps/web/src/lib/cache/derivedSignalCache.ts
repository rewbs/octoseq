/**
 * Derived Signal Cache
 *
 * IndexedDB-based caching for expensive derived signals.
 * Uses LRU eviction to maintain a maximum cache size.
 *
 * Key format: {projectId}:{signalId}:{definitionHash}:{sourceVersion}
 */

import type { DerivedSignalResult } from "../stores/types/derivedSignal";

// ============================================================================
// CONSTANTS
// ============================================================================

const DB_NAME = "octoseq-derived-signals";
const DB_VERSION = 1;
const STORE_NAME = "signals";
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MIN_COMPUTE_TIME_MS = 100; // Only cache if compute time > 100ms

// ============================================================================
// TYPES
// ============================================================================

interface CachedSignalEntry {
  /** Cache key. */
  key: string;
  /** Project ID. */
  projectId: string;
  /** Signal ID. */
  signalId: string;
  /** Hash of the signal definition. */
  definitionHash: string;
  /** Version of the source data. */
  sourceVersion: string;
  /** The cached result. */
  result: DerivedSignalResult;
  /** Approximate size in bytes. */
  sizeBytes: number;
  /** Last access timestamp. */
  lastAccessedAt: number;
  /** Creation timestamp. */
  createdAt: number;
}

interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Simple hash function for definition objects.
 */
function hashDefinition(definition: object): string {
  const str = JSON.stringify(definition);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Estimate size of a result in bytes.
 */
function estimateResultSize(result: DerivedSignalResult): number {
  let size = 0;

  // Float32Array values (4 bytes per element)
  size += result.values.length * 4;
  size += result.times.length * 4;

  // Raw values if present
  if (result.rawValues) {
    size += result.rawValues.length * 4;
  }

  // Overhead for metadata (rough estimate)
  size += 200;

  return size;
}

/**
 * Build cache key.
 */
function buildCacheKey(
  projectId: string,
  signalId: string,
  definitionHash: string,
  sourceVersion: string
): string {
  return `${projectId}:${signalId}:${definitionHash}:${sourceVersion}`;
}

// ============================================================================
// DATABASE ACCESS
// ============================================================================

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open or get the database connection.
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Failed to open derived signal cache DB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });

        // Create indexes for queries
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("signalId", "signalId", { unique: false });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };
  });

  return dbPromise;
}

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Check if caching is worth it based on compute time.
 */
export function shouldCache(computeTimeMs: number): boolean {
  return computeTimeMs >= MIN_COMPUTE_TIME_MS;
}

/**
 * Get a cached signal result.
 */
export async function getCachedResult(
  projectId: string,
  signalId: string,
  definitionHash: string,
  sourceVersion: string
): Promise<DerivedSignalResult | null> {
  try {
    const db = await getDB();
    const key = buildCacheKey(projectId, signalId, definitionHash, sourceVersion);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as CachedSignalEntry | undefined;

        if (!entry) {
          resolve(null);
          return;
        }

        // Update last accessed time
        entry.lastAccessedAt = Date.now();
        store.put(entry);

        // Reconstruct Float32Arrays from stored data
        const result: DerivedSignalResult = {
          ...entry.result,
          values: new Float32Array(entry.result.values),
          times: new Float32Array(entry.result.times),
          rawValues: entry.result.rawValues
            ? new Float32Array(entry.result.rawValues)
            : undefined,
        };

        resolve(result);
      };
    });
  } catch (error) {
    console.error("Failed to get cached result:", error);
    return null;
  }
}

/**
 * Store a signal result in the cache.
 */
export async function setCachedResult(
  projectId: string,
  signalId: string,
  definition: object,
  sourceVersion: string,
  result: DerivedSignalResult
): Promise<void> {
  try {
    const db = await getDB();
    const definitionHash = hashDefinition(definition);
    const key = buildCacheKey(projectId, signalId, definitionHash, sourceVersion);
    const sizeBytes = estimateResultSize(result);

    // Convert Float32Arrays to regular arrays for storage
    const storableResult = {
      ...result,
      values: Array.from(result.values),
      times: Array.from(result.times),
      rawValues: result.rawValues ? Array.from(result.rawValues) : undefined,
    };

    const entry: CachedSignalEntry = {
      key,
      projectId,
      signalId,
      definitionHash,
      sourceVersion,
      result: storableResult as unknown as DerivedSignalResult,
      sizeBytes,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
    };

    // Ensure we have space
    await evictIfNeeded(sizeBytes);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const request = store.put(entry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error("Failed to cache result:", error);
  }
}

/**
 * Invalidate cache entries for a specific signal.
 */
export async function invalidateSignal(
  projectId: string,
  signalId: string
): Promise<void> {
  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("signalId");

      const request = index.openCursor(IDBKeyRange.only(signalId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as CachedSignalEntry;
          if (entry.projectId === projectId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.error("Failed to invalidate signal cache:", error);
  }
}

/**
 * Invalidate all cache entries for a project.
 */
export async function invalidateProject(projectId: string): Promise<void> {
  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("projectId");

      const request = index.openCursor(IDBKeyRange.only(projectId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.error("Failed to invalidate project cache:", error);
  }
}

/**
 * Clear the entire cache.
 */
export async function clearCache(): Promise<void> {
  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error("Failed to clear cache:", error);
  }
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as CachedSignalEntry[];

        let totalSizeBytes = 0;
        let oldestEntry: number | null = null;
        let newestEntry: number | null = null;

        for (const entry of entries) {
          totalSizeBytes += entry.sizeBytes;

          if (oldestEntry === null || entry.lastAccessedAt < oldestEntry) {
            oldestEntry = entry.lastAccessedAt;
          }
          if (newestEntry === null || entry.lastAccessedAt > newestEntry) {
            newestEntry = entry.lastAccessedAt;
          }
        }

        resolve({
          totalEntries: entries.length,
          totalSizeBytes,
          oldestEntry,
          newestEntry,
        });
      };
    });
  } catch (error) {
    console.error("Failed to get cache stats:", error);
    return {
      totalEntries: 0,
      totalSizeBytes: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }
}

/**
 * Evict oldest entries if we need space.
 */
async function evictIfNeeded(neededBytes: number): Promise<void> {
  try {
    const db = await getDB();
    const stats = await getCacheStats();

    // Check if we need to evict
    if (stats.totalSizeBytes + neededBytes <= MAX_CACHE_SIZE_BYTES) {
      return;
    }

    const bytesToFree = stats.totalSizeBytes + neededBytes - MAX_CACHE_SIZE_BYTES;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("lastAccessedAt");

      let freedBytes = 0;
      const request = index.openCursor();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && freedBytes < bytesToFree) {
          const entry = cursor.value as CachedSignalEntry;
          freedBytes += entry.sizeBytes;
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.error("Failed to evict cache entries:", error);
  }
}

/**
 * Generate a definition hash for caching.
 */
export function getDefinitionHash(definition: object): string {
  return hashDefinition(definition);
}

/**
 * Check if a cache entry exists without loading it.
 */
export async function hasCachedResult(
  projectId: string,
  signalId: string,
  definitionHash: string,
  sourceVersion: string
): Promise<boolean> {
  try {
    const db = await getDB();
    const key = buildCacheKey(projectId, signalId, definitionHash, sourceVersion);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);

      const request = store.count(IDBKeyRange.only(key));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result > 0);
    });
  } catch (error) {
    console.error("Failed to check cache:", error);
    return false;
  }
}
