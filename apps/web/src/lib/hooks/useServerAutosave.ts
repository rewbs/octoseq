"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useProjectStore } from "@/lib/stores/projectStore";
import { usePlaybackStore } from "@/lib/stores/playbackStore";
import { autosaveProjectWorkingState } from "@/lib/actions/project";
import type { ProjectSerialized } from "@/lib/stores/types/project";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ServerAutosaveStatus = "idle" | "saving" | "saved" | "error";

interface ServerAutosaveState {
  status: ServerAutosaveStatus;
  lastSavedAt: string | null;
  error: string | null;
}

interface UseServerAutosaveOptions {
  /** Backend project ID (from database, not local nanoid) */
  backendProjectId: string | null;
  /** Revision returned when an existing project was loaded. */
  initialRevision?: number;
  /** Whether the current user owns a loaded project. */
  initialIsOwner?: boolean;
  /** Debounce interval in ms. Default: 2000 */
  debounceMs?: number;
  /** Callback when save succeeds */
  onSaved?: (timestamp: string) => void;
  /** Callback when save fails */
  onError?: (error: string) => void;
}

interface UseServerAutosaveReturn extends ServerAutosaveState {
  /** Manually trigger a save */
  saveNow: () => Promise<void>;
  /** Whether the current user owns the project */
  isOwner: boolean;
  /** Whether server autosave is active */
  isEnabled: boolean;
}

// -----------------------------------------------------------------------------
// Hook Implementation
// -----------------------------------------------------------------------------

/**
 * Hook that manages server-side autosave of project working state.
 *
 * Only active when:
 * - User is authenticated
 * - A backendProjectId is provided
 * - User owns the project (determined by successful saves)
 *
 * Saves are debounced to avoid overwhelming the server.
 */
export function useServerAutosave({
  backendProjectId,
  initialRevision = 0,
  initialIsOwner = true,
  debounceMs = 2000,
  onSaved,
  onError,
}: UseServerAutosaveOptions): UseServerAutosaveReturn {
  const { isSignedIn } = useAuth();

  // Local state
  const [serverState, setServerState] = useState<ServerAutosaveState>({
    status: "idle",
    lastSavedAt: null,
    error: null,
  });
  const [isOwner, setIsOwner] = useState<boolean>(initialIsOwner);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<boolean>(false);
  const saveRequestedRef = useRef(false);
  const saveQueueRef = useRef<Promise<void> | null>(null);
  const revisionRef = useRef(initialRevision);
  const changeVersionRef = useRef(0);
  const projectEpochRef = useRef(0);
  const mountedRef = useRef(true);

  // Store selectors
  const activeProject = useProjectStore((s) => s.activeProject);
  const markClean = useProjectStore((s) => s.markClean);

  // Check if server autosave should be active
  const isEnabled = Boolean(isSignedIn && backendProjectId && isOwner);

  // Build the working state JSON
  const buildWorkingJson = useCallback((): Record<string, unknown> | null => {
    if (!activeProject) return null;

    // Capture current playhead position without triggering a sync
    const currentPlayhead = usePlaybackStore.getState().playheadTimeSec;

    const cloudMeshAssets = activeProject.meshAssets
      ? {
          ...activeProject.meshAssets,
          assets: activeProject.meshAssets.assets.map((asset) => ({
            ...asset,
            // Binary/text asset bodies live in R2. Keep only the stable reference
            // and descriptive metadata in server working state.
            objContent: "",
            rawBytes: undefined,
          })),
        }
      : null;

    const serialized: ProjectSerialized = {
      version: 2,
      project: {
        ...activeProject,
        meshAssets: cloudMeshAssets,
        uiState: {
          ...activeProject.uiState,
          lastPlayheadPosition: currentPlayhead,
        },
        modifiedAt: new Date().toISOString(),
      },
    };

    return serialized as unknown as Record<string, unknown>;
  }, [activeProject]);

  useEffect(() => {
    projectEpochRef.current += 1;
    revisionRef.current = initialRevision;
    saveRequestedRef.current = false;
    setIsOwner(initialIsOwner);
    setServerState({ status: "idle", lastSavedAt: null, error: null });
  }, [backendProjectId, initialRevision, initialIsOwner]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Queue saves so requests and revision updates can never complete out of order.
  const performSave = useCallback(async (): Promise<void> => {
    if (!backendProjectId || !isSignedIn) return;
    saveRequestedRef.current = true;
    if (saveQueueRef.current) return saveQueueRef.current;

    const epoch = projectEpochRef.current;
    const run = async () => {
      while (saveRequestedRef.current && epoch === projectEpochRef.current) {
        saveRequestedRef.current = false;
        const savedChangeVersion = changeVersionRef.current;
        const workingJson = buildWorkingJson();
        if (!workingJson) return;

        if (mountedRef.current) {
          setServerState((prev) => ({ ...prev, status: "saving", error: null }));
        }

        try {
          const result = await autosaveProjectWorkingState({
            projectId: backendProjectId,
            expectedRevision: revisionRef.current,
            workingJson,
          });

          if (epoch !== projectEpochRef.current) return;
          if (result?.data) {
            if (result.data.conflict) {
              const conflictMessage = "This project changed elsewhere. Reload before saving again.";
              if (mountedRef.current) {
                setServerState((prev) => ({
                  ...prev,
                  status: "error",
                  error: conflictMessage,
                }));
              }
              onError?.(conflictMessage);
              return;
            }
            revisionRef.current = result.data.revision;
            const timestamp = result.data.updatedAt?.toISOString();
            if (!timestamp) throw new Error("Save completed without a timestamp");
            if (mountedRef.current) {
              setServerState({ status: "saved", lastSavedAt: timestamp, error: null });
              setIsOwner(true);
            }
            if (changeVersionRef.current === savedChangeVersion) {
              markClean();
            } else {
              saveRequestedRef.current = true;
            }
            onSaved?.(timestamp);
          } else {
            const serverError = result?.serverError ?? "The server rejected the save";
            const errorLower = serverError.toLowerCase();
            if (
              mountedRef.current &&
              (errorLower.includes("permission") || errorLower.includes("owner"))
            ) {
              setIsOwner(false);
            }
            if (mountedRef.current) {
              setServerState((prev) => ({ ...prev, status: "error", error: serverError }));
            }
            onError?.(serverError);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Failed to save";
          if (mountedRef.current) {
            setServerState((prev) => ({ ...prev, status: "error", error: errorMessage }));
          }
          onError?.(errorMessage);
        }
      }
    };

    const queued = run().finally(() => {
      if (saveQueueRef.current === queued) saveQueueRef.current = null;
    });
    saveQueueRef.current = queued;
    return queued;
  }, [backendProjectId, isSignedIn, buildWorkingJson, markClean, onSaved, onError]);

  // Debounced save trigger
  const triggerSave = useCallback(() => {
    if (!isEnabled) return;

    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Mark that we have a pending save
    pendingSaveRef.current = true;

    // Set up debounced save
    debounceTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        void performSave();
      }
    }, debounceMs);
  }, [isEnabled, debounceMs, performSave]);

  // Manual save (bypasses debounce)
  const saveNow = useCallback(async (): Promise<void> => {
    if (!isEnabled) return;

    // Clear pending debounced save
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    pendingSaveRef.current = false;

    await performSave();
  }, [isEnabled, performSave]);

  // Subscribe to project changes
  useEffect(() => {
    if (!isEnabled) return;

    const unsubscribe = useProjectStore.subscribe((state, prevState) => {
      // Trigger save when project becomes dirty or changes
      if (state.isDirty && state.activeProject !== prevState.activeProject) {
        changeVersionRef.current += 1;
        triggerSave();
      }
    });

    return () => {
      unsubscribe();
      // Clean up debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, [isEnabled, triggerSave]);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current && isEnabled) {
        // Fire and forget final save
        void performSave();
      }
    };
  }, [isEnabled, performSave]);

  return {
    status: serverState.status,
    lastSavedAt: serverState.lastSavedAt,
    error: serverState.error,
    saveNow,
    isOwner,
    isEnabled,
  };
}
