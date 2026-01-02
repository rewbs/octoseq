/**
 * IndexedDB Database
 *
 * Initializes and provides access to the Octoseq persistence database.
 * Uses the `idb` library for a promise-based API.
 */

import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { AutosaveRecord, AssetRecord, SchemaMetadata } from "./types";
import { DB_SCHEMA_VERSION, ASSET_SCHEMA_VERSION } from "./types";

// ----------------------------
// Database Name & Version
// ----------------------------

const DB_NAME = "octoseq-persistence";
const DB_VERSION = 1;

// ----------------------------
// Database Schema Definition
// ----------------------------

/**
 * Typed schema definition for the IndexedDB database.
 * Provides type safety for all store operations.
 */
interface OctoseqDBSchema extends DBSchema {
  /**
   * Autosave store - contains the latest project snapshot.
   * Single key "current" holds the active autosave.
   */
  autosave: {
    key: string;
    value: AutosaveRecord;
  };

  /**
   * Assets store - contains binary audio data.
   * Keyed by asset ID with indexes for content hash and project.
   */
  assets: {
    key: string;
    value: AssetRecord;
    indexes: {
      byContentHash: string;
      byProjectId: string;
    };
  };

  /**
   * Metadata store - tracks schema versions for migrations.
   */
  metadata: {
    key: string;
    value: SchemaMetadata;
  };
}

// ----------------------------
// Database Instance
// ----------------------------

/** Cached database connection promise */
let dbPromise: Promise<IDBPDatabase<OctoseqDBSchema>> | null = null;

/**
 * Get the IndexedDB database instance.
 * Creates and initializes the database on first access.
 *
 * @returns Promise resolving to the database instance
 */
export async function getDB(): Promise<IDBPDatabase<OctoseqDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OctoseqDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Initial database setup (version 0 -> 1)
        if (oldVersion < 1) {
          // Create autosave store
          db.createObjectStore("autosave");

          // Create assets store with indexes
          const assetStore = db.createObjectStore("assets", { keyPath: "id" });
          assetStore.createIndex("byContentHash", "contentHash", {
            unique: false,
          });
          assetStore.createIndex("byProjectId", "projectId", { unique: false });

          // Create metadata store
          db.createObjectStore("metadata");

          // Initialize schema metadata
          const metadataStore = transaction.objectStore("metadata");
          metadataStore.put(
            {
              dbVersion: DB_SCHEMA_VERSION,
              assetSchemaVersion: ASSET_SCHEMA_VERSION,
              lastMigration: new Date().toISOString(),
            },
            "schema"
          );
        }

        // Future migrations would go here:
        // if (oldVersion < 2) { ... }
      },
      blocked() {
        console.warn(
          "[Persistence] Database upgrade blocked by other open tabs"
        );
      },
      blocking() {
        console.warn(
          "[Persistence] This tab is blocking database upgrade in another tab"
        );
        // Close connection to allow other tab to upgrade
        dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        console.error("[Persistence] Database connection terminated");
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/**
 * Close the database connection.
 * Call this when cleaning up or before page unload.
 */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/**
 * Check if IndexedDB is available in the current environment.
 * Returns false in environments without IndexedDB (e.g., some test runners).
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Delete the entire database.
 * Use with caution - this removes all autosave data and assets.
 */
export async function deleteDatabase(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn("[Persistence] Database deletion blocked by other tabs");
    };
  });
}

// Export type for external use
export type { OctoseqDBSchema };
