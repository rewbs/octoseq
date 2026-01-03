"use client";

/**
 * Audio Source Resolver Hook
 *
 * Watches the currentAudioSource in the store and automatically resolves URLs.
 *
 * DESIGN PRINCIPLES:
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - This hook is the bridge between AudioSource and WaveSurfer.
 * - Resolution is automatic, cancelable, and resilient to rapid source switching.
 *
 * Mount this hook at the app level (e.g., page.tsx) to enable automatic resolution.
 */

import { useEffect, useRef } from "react";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { resolveAudioSource } from "@/lib/audio/audioSourceResolver";

/**
 * Hook that watches currentAudioSource and automatically resolves URLs.
 *
 * When a new source is set with status 'pending':
 * 1. Cancels any in-progress resolution
 * 2. Starts resolving the new source
 * 3. Updates the store with the resolved URL (or error)
 *
 * This hook should be mounted once at the app level.
 */
export function useAudioSourceResolver(): void {
  const currentAudioSource = useAudioInputStore((s) => s.currentAudioSource);
  const updateAudioSourceStatus = useAudioInputStore(
    (s) => s.updateAudioSourceStatus
  );

  // Track the current source ID to detect changes
  const currentSourceIdRef = useRef<string | null>(null);

  // Track cleanup function for blob URLs
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // No source - nothing to resolve
    if (!currentAudioSource) {
      currentSourceIdRef.current = null;
      return;
    }

    // Source already ready or failed - no resolution needed
    if (
      currentAudioSource.status === "ready" ||
      currentAudioSource.status === "failed"
    ) {
      currentSourceIdRef.current = currentAudioSource.id;
      return;
    }

    // Source is resolving - wait for it
    if (currentAudioSource.status === "resolving") {
      return;
    }

    // Only resolve if status is 'pending'
    if (currentAudioSource.status !== "pending") {
      return;
    }

    // Same source ID - don't re-resolve
    if (currentSourceIdRef.current === currentAudioSource.id) {
      return;
    }

    // New source to resolve
    currentSourceIdRef.current = currentAudioSource.id;

    // Cleanup previous blob URL if any
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Create abort controller for this resolution
    const abortController = new AbortController();

    // Capture source ID to check for staleness
    const sourceId = currentAudioSource.id;

    async function resolve() {
      try {
        const result = await resolveAudioSource(currentAudioSource!, {
          signal: abortController.signal,
          onStatusChange: (status) => {
            // Only update if we're still resolving the same source
            if (currentSourceIdRef.current === sourceId) {
              if (status === "resolving") {
                updateAudioSourceStatus("resolving");
              }
            }
          },
        });

        // Check if we're still resolving the same source
        if (currentSourceIdRef.current !== sourceId) {
          // Source changed during resolution - cleanup and bail
          result.cleanup?.();
          return;
        }

        // Store cleanup function
        if (result.cleanup) {
          cleanupRef.current = result.cleanup;
        }

        // Update store with resolved URL
        updateAudioSourceStatus("ready", result.url);
      } catch (err) {
        // Ignore abort errors
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        // Check if we're still resolving the same source
        if (currentSourceIdRef.current !== sourceId) {
          return;
        }

        // Update store with error
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        console.error("[AudioSourceResolver] Resolution failed:", errorMessage);
        updateAudioSourceStatus("failed", undefined, errorMessage);
      }
    }

    void resolve();

    // Cleanup on unmount or source change
    return () => {
      abortController.abort();
    };
  }, [currentAudioSource, updateAudioSourceStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);
}
