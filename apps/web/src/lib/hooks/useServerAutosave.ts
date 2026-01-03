'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useProjectStore } from '@/lib/stores/projectStore';
import { usePlaybackStore } from '@/lib/stores/playbackStore';
import { autosaveProjectWorkingState } from '@/lib/actions/project';
import type { ProjectSerialized } from '@/lib/stores/types/project';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ServerAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ServerAutosaveState {
  status: ServerAutosaveStatus;
  lastSavedAt: string | null;
  error: string | null;
}

interface UseServerAutosaveOptions {
  /** Backend project ID (from database, not local nanoid) */
  backendProjectId: string | null;
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
  debounceMs = 2000,
  onSaved,
  onError,
}: UseServerAutosaveOptions): UseServerAutosaveReturn {
  const { isSignedIn, userId } = useAuth();

  // Local state
  const statusRef = useRef<ServerAutosaveStatus>('idle');
  const lastSavedAtRef = useRef<string | null>(null);
  const errorRef = useRef<string | null>(null);
  const isOwnerRef = useRef<boolean>(true); // Assume owner until proven otherwise
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<boolean>(false);

  // Force re-render when state changes
  const forceUpdateRef = useRef(0);
  const forceUpdate = useCallback(() => {
    forceUpdateRef.current += 1;
  }, []);

  // Store selectors
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markClean = useProjectStore((s) => s.markClean);

  // Check if server autosave should be active
  const isEnabled = Boolean(isSignedIn && backendProjectId && isOwnerRef.current);

  // Build the working state JSON
  const buildWorkingJson = useCallback((): Record<string, unknown> | null => {
    if (!activeProject) return null;

    // Capture current playhead position without triggering a sync
    const currentPlayhead = usePlaybackStore.getState().playheadTimeSec;

    const serialized: ProjectSerialized = {
      version: 1,
      project: {
        ...activeProject,
        uiState: {
          ...activeProject.uiState,
          lastPlayheadPosition: currentPlayhead,
        },
        modifiedAt: new Date().toISOString(),
      },
    };

    return serialized as unknown as Record<string, unknown>;
  }, [activeProject]);

  // Perform the actual save
  const performSave = useCallback(async (): Promise<void> => {
    if (!backendProjectId || !isSignedIn) return;

    const workingJson = buildWorkingJson();
    if (!workingJson) return;

    statusRef.current = 'saving';
    errorRef.current = null;
    forceUpdate();

    try {
      const result = await autosaveProjectWorkingState({
        projectId: backendProjectId,
        workingJson,
      });

      if (result?.data) {
        const timestamp = result.data.updatedAt.toISOString();
        statusRef.current = 'saved';
        lastSavedAtRef.current = timestamp;
        isOwnerRef.current = true;
        markClean();
        onSaved?.(timestamp);
      } else if (result?.serverError) {
        // Check if it's a permission error
        if (result.serverError.includes('permission') || result.serverError.includes('owner')) {
          isOwnerRef.current = false;
        }
        statusRef.current = 'error';
        errorRef.current = result.serverError;
        onError?.(result.serverError);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save';
      statusRef.current = 'error';
      errorRef.current = errorMessage;
      onError?.(errorMessage);
    }

    forceUpdate();
  }, [backendProjectId, isSignedIn, buildWorkingJson, markClean, onSaved, onError, forceUpdate]);

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
        triggerSave();
      }
    });

    return () => {
      unsubscribe();
      // Clean up debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
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
    status: statusRef.current,
    lastSavedAt: lastSavedAtRef.current,
    error: errorRef.current,
    saveNow,
    isOwner: isOwnerRef.current,
    isEnabled,
  };
}
