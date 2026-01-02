"use client";

import { useEffect, useRef, useCallback } from "react";
import { useProjectStore } from "../projectStore";
import { useAutosaveStore } from "../autosaveStore";
import { usePlaybackStore } from "../playbackStore";
import {
  triggerAutosave,
  loadAutosave,
  clearAutosave,
  enableAutosave,
  disableAutosave,
  formatAutosaveTimestamp,
  isAutosaveRecoverable,
} from "../../persistence/autosave";
import { isIndexedDBAvailable } from "../../persistence/db";
import type { AutosaveRecord } from "../../persistence/types";
import type { ProjectSerialized } from "../types/project";

// ----------------------------
// Types
// ----------------------------

interface UseAutosaveOptions {
  /** Callback when recovery is available */
  onRecoveryAvailable?: (record: AutosaveRecord) => void;
  /** Callback when recovery is complete */
  onRecoveryComplete?: () => void;
  /** Callback when autosave error occurs */
  onError?: (error: Error) => void;
}

interface UseAutosaveReturn {
  /** Whether an autosave recovery is pending */
  hasRecovery: boolean;
  /** Accept the pending recovery */
  acceptRecovery: () => Promise<boolean>;
  /** Dismiss the pending recovery */
  dismissRecovery: () => Promise<void>;
  /** Clear autosave (called on explicit save) */
  clearOnExplicitSave: () => Promise<void>;
  /** Format autosave timestamp for display */
  formatTimestamp: (timestamp: string) => string;
}

// ----------------------------
// Hook Implementation
// ----------------------------

/**
 * Hook that manages autosave functionality.
 *
 * Sets up:
 * - Subscription to project dirty state for triggering autosave
 * - Recovery check on mount
 * - Status updates for UI display
 */
export function useAutosave(options: UseAutosaveOptions = {}): UseAutosaveReturn {
  const { onRecoveryAvailable, onRecoveryComplete, onError } = options;

  // Recovery state
  const pendingRecovery = useRef<AutosaveRecord | null>(null);
  const recoveryChecked = useRef(false);

  // Store selectors
  const isDirty = useProjectStore((s) => s.isDirty);
  const activeProject = useProjectStore((s) => s.activeProject);
  const exportToJson = useProjectStore((s) => s.exportToJson);
  const importFromJson = useProjectStore((s) => s.importFromJson);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);

  const setStatus = useAutosaveStore((s) => s.setStatus);
  const setSaved = useAutosaveStore((s) => s.setSaved);
  const setError = useAutosaveStore((s) => s.setError);
  const setRecovered = useAutosaveStore((s) => s.setRecovered);

  // ----------------------------
  // Build Autosave Record
  // ----------------------------

  const buildAutosaveRecord = useCallback((): AutosaveRecord | null => {
    const project = useProjectStore.getState().activeProject;
    if (!project) return null;

    // Sync current playhead before saving
    const currentPlayhead = usePlaybackStore.getState().playheadTimeSec;
    useProjectStore.getState().syncUIState({ lastPlayheadPosition: currentPlayhead });

    const json = exportToJson();
    if (!json) return null;

    try {
      const parsed = JSON.parse(json) as ProjectSerialized;
      return {
        project: parsed,
        savedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }, [exportToJson]);

  // ----------------------------
  // Autosave Subscription
  // ----------------------------

  useEffect(() => {
    if (!isIndexedDBAvailable()) {
      console.warn("[Autosave] IndexedDB not available, autosave disabled");
      return;
    }

    // Subscribe to dirty state changes
    const unsubscribe = useProjectStore.subscribe(
      (state, prevState) => {
        // Trigger autosave when project becomes dirty
        if (state.isDirty && !prevState.isDirty) {
          triggerAutosave(
            buildAutosaveRecord,
            () => setStatus("saving"),
            (timestamp) => setSaved(timestamp),
            (error) => {
              setError(error.message);
              onError?.(error);
            }
          );
        }

        // Also trigger on any project mutation (even if already dirty)
        if (state.activeProject !== prevState.activeProject && state.isDirty) {
          triggerAutosave(
            buildAutosaveRecord,
            () => setStatus("saving"),
            (timestamp) => setSaved(timestamp),
            (error) => {
              setError(error.message);
              onError?.(error);
            }
          );
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [buildAutosaveRecord, setStatus, setSaved, setError, onError]);

  // ----------------------------
  // Recovery Check on Mount
  // ----------------------------

  useEffect(() => {
    if (recoveryChecked.current) return;
    recoveryChecked.current = true;

    async function checkRecovery() {
      if (!isIndexedDBAvailable()) return;

      // Disable autosave during recovery check to prevent overwriting
      disableAutosave();

      try {
        const record = await loadAutosave();
        if (record && isAutosaveRecoverable(record)) {
          pendingRecovery.current = record;
          onRecoveryAvailable?.(record);
        } else {
          // No recovery needed, enable autosave
          enableAutosave();
        }
      } catch (error) {
        console.error("[Autosave] Recovery check failed:", error);
        enableAutosave();
      }
    }

    checkRecovery();
  }, [onRecoveryAvailable]);

  // ----------------------------
  // Recovery Actions
  // ----------------------------

  const acceptRecovery = useCallback(async (): Promise<boolean> => {
    const record = pendingRecovery.current;
    if (!record) return false;

    try {
      // Import the recovered project
      const project = importFromJson(JSON.stringify(record.project));
      if (!project) {
        console.error("[Autosave] Failed to parse recovered project");
        enableAutosave();
        return false;
      }

      // Set as active and mark as recovered
      setActiveProject(project);
      setRecovered(project.name);

      // Mark the record as recovered (for UI indication)
      const updatedRecord: AutosaveRecord = {
        ...record,
        wasRecovered: true,
      };
      pendingRecovery.current = null;

      // Re-enable autosave
      enableAutosave();
      onRecoveryComplete?.();

      return true;
    } catch (error) {
      console.error("[Autosave] Recovery failed:", error);
      enableAutosave();
      return false;
    }
  }, [importFromJson, setActiveProject, setRecovered, onRecoveryComplete]);

  const dismissRecovery = useCallback(async (): Promise<void> => {
    pendingRecovery.current = null;

    try {
      // Clear the autosave since user dismissed it
      await clearAutosave();
    } catch (error) {
      console.error("[Autosave] Failed to clear dismissed autosave:", error);
    }

    // Re-enable autosave
    enableAutosave();
  }, []);

  const clearOnExplicitSave = useCallback(async (): Promise<void> => {
    try {
      await clearAutosave();
    } catch (error) {
      console.error("[Autosave] Failed to clear after explicit save:", error);
    }
  }, []);

  return {
    hasRecovery: pendingRecovery.current !== null,
    acceptRecovery,
    dismissRecovery,
    clearOnExplicitSave,
    formatTimestamp: formatAutosaveTimestamp,
  };
}
