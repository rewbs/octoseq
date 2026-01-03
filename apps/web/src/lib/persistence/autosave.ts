/**
 * Autosave Module
 *
 * Provides debounced autosave functionality for project persistence.
 * Saves to IndexedDB on project mutations with crash recovery support.
 */

import { getDB, isIndexedDBAvailable } from "./db";
import type { AutosaveRecord } from "./types";

// ----------------------------
// Constants
// ----------------------------

/** Autosave key in the database */
const AUTOSAVE_KEY = "current";

/** Debounce interval in milliseconds */
const AUTOSAVE_DEBOUNCE_MS = 500;

// ----------------------------
// Module State
// ----------------------------

/** Timer for debounced autosave */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Flag to prevent autosave during initial recovery */
let autosaveEnabled = true;

// ----------------------------
// Autosave Operations
// ----------------------------

/**
 * Save a project snapshot to IndexedDB.
 *
 * @param record - The autosave record to store
 * @returns Promise resolving when save completes
 */
export async function saveAutosave(record: AutosaveRecord): Promise<void> {
  if (!isIndexedDBAvailable()) {
    console.warn("[Autosave] IndexedDB not available, skipping save");
    return;
  }

  try {
    const db = await getDB();
    await db.put("autosave", record, AUTOSAVE_KEY);
  } catch (error) {
    console.error("[Autosave] Failed to save:", error);
    throw error;
  }
}

/**
 * Load the current autosave record from IndexedDB.
 *
 * @returns Promise resolving to the autosave record, or null if none exists
 */
export async function loadAutosave(): Promise<AutosaveRecord | null> {
  if (!isIndexedDBAvailable()) {
    console.warn("[Autosave] IndexedDB not available, skipping load");
    return null;
  }

  try {
    const db = await getDB();
    const record = await db.get("autosave", AUTOSAVE_KEY);
    return record ?? null;
  } catch (error) {
    console.error("[Autosave] Failed to load:", error);
    return null;
  }
}

/**
 * Clear the current autosave record.
 * Called after explicit save to avoid stale recovery prompts.
 *
 * @returns Promise resolving when clear completes
 */
export async function clearAutosave(): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const db = await getDB();
    await db.delete("autosave", AUTOSAVE_KEY);
  } catch (error) {
    console.error("[Autosave] Failed to clear:", error);
    throw error;
  }
}

/**
 * Check if an autosave record exists.
 *
 * @returns Promise resolving to true if autosave exists
 */
export async function hasAutosave(): Promise<boolean> {
  if (!isIndexedDBAvailable()) {
    return false;
  }

  try {
    const db = await getDB();
    const count = await db.count("autosave");
    return count > 0;
  } catch (error) {
    console.error("[Autosave] Failed to check:", error);
    return false;
  }
}

// ----------------------------
// Debounced Autosave
// ----------------------------

/**
 * Trigger a debounced autosave.
 * Cancels any pending autosave and schedules a new one.
 *
 * @param getRecord - Function that returns the autosave record to save
 * @param onSaveStart - Optional callback when save starts
 * @param onSaveComplete - Optional callback when save completes (with timestamp)
 * @param onSaveError - Optional callback when save fails
 */
export function triggerAutosave(
  getRecord: () => AutosaveRecord | null,
  onSaveStart?: () => void,
  onSaveComplete?: (timestamp: string) => void,
  onSaveError?: (error: Error) => void
): void {
  if (!autosaveEnabled) {
    return;
  }

  // Cancel any pending autosave
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  // Schedule new autosave
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = null;

    const record = getRecord();
    if (!record) {
      return;
    }

    onSaveStart?.();

    try {
      await saveAutosave(record);
      onSaveComplete?.(record.savedAt);
    } catch (error) {
      onSaveError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Cancel any pending autosave.
 */
export function cancelPendingAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

/**
 * Enable autosave.
 * Called after recovery is complete.
 */
export function enableAutosave(): void {
  autosaveEnabled = true;
}

/**
 * Disable autosave.
 * Called during recovery to prevent overwriting the autosave.
 */
export function disableAutosave(): void {
  autosaveEnabled = false;
  cancelPendingAutosave();
}

/**
 * Check if autosave is currently enabled.
 */
export function isAutosaveEnabled(): boolean {
  return autosaveEnabled;
}

// ----------------------------
// Recovery Helpers
// ----------------------------

/**
 * Get formatted timestamp for display.
 *
 * @param isoTimestamp - ISO timestamp string
 * @returns Human-readable timestamp
 */
export function formatAutosaveTimestamp(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoTimestamp;
  }
}

/**
 * Check if autosave is recent enough to warrant recovery.
 * Currently always returns true, but could implement staleness check.
 *
 * @param record - The autosave record to check
 * @returns true if the autosave should be offered for recovery
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isAutosaveRecoverable(record: AutosaveRecord): boolean {
  // Could implement staleness check here (e.g., older than 30 days)
  // For now, always offer recovery
  return true;
}
