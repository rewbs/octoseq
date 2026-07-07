"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "../projectStore";
import {
  hasAsset,
  findByContentHash,
  validateAssetReferences,
} from "../../persistence/assetRegistry";
import { computeContentHash } from "../../persistence/assetHashing";
import { isIndexedDBAvailable } from "../../persistence/db";
import type { UnresolvedAssetInfo } from "../../persistence/types";
import { isAudioStream, type AudioStream } from "@/lib/streams";

/**
 * Hook for detecting and recovering missing audio assets.
 *
 * Provides:
 * - Detection of unresolved asset references on project load
 * - Auto-matching by content hash when user provides replacement file
 * - Status tracking for recovery progress
 */
export function useAssetRecovery() {
  const activeProject = useProjectStore((s) => s.activeProject);

  // Unresolved assets that need recovery
  const [unresolvedAssets, setUnresolvedAssets] = useState<UnresolvedAssetInfo[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  /**
   * Validate all asset references in the current project.
   * Called after loading a project to detect missing assets.
   */
  const validateProjectAssets = useCallback(async (): Promise<{
    valid: string[];
    missing: UnresolvedAssetInfo[];
  }> => {
    if (!activeProject || !isIndexedDBAvailable()) {
      return { valid: [], missing: [] };
    }

    setIsValidating(true);

    try {
      // Collect all asset IDs from the project's audio streams
      const assetIds: string[] = [];
      const assetRefMap = new Map<string, AudioStream>();

      for (const stream of activeProject.streams) {
        if (!isAudioStream(stream)) continue;
        const assetId = stream.audio.cloudAssetId ?? stream.audio.assetId;
        if (assetId) {
          assetIds.push(assetId);
          assetRefMap.set(assetId, stream);
        }
      }

      // Validate assets
      const { valid, missing: missingIds } = await validateAssetReferences(assetIds);

      // Build unresolved info for missing assets
      const missing: UnresolvedAssetInfo[] = missingIds.map((assetId) => {
        const ref = assetRefMap.get(assetId)!;
        return {
          assetId,
          expectedMetadata: {
            sampleRate: ref.audio.sampleRate,
            channels: ref.audio.channels,
            duration: ref.audio.durationSec,
            totalSamples: Math.round(ref.audio.durationSec * ref.audio.sampleRate),
          },
          fileName:
            ref.audio.origin.kind === "file"
              ? ref.audio.origin.fileName
              : ref.audio.origin.kind === "url"
                ? ref.audio.origin.fileName
                : undefined,
          role: ref.kind,
          label: ref.label,
        };
      });

      setUnresolvedAssets(missing);
      return { valid, missing };
    } finally {
      setIsValidating(false);
    }
  }, [activeProject]);

  /**
   * Try to auto-match a file by content hash.
   * Returns the matching asset ID if found.
   *
   * @param fileBuffer - The ArrayBuffer of the replacement file
   * @returns Promise resolving to matching asset ID, or null if no match
   */
  const tryAutoMatch = useCallback(
    async (fileBuffer: ArrayBuffer): Promise<string | null> => {
      if (!isIndexedDBAvailable()) {
        return null;
      }

      try {
        const contentHash = await computeContentHash(fileBuffer);
        const matchingAsset = await findByContentHash(contentHash);
        return matchingAsset?.id ?? null;
      } catch (error) {
        console.error("[AssetRecovery] Auto-match failed:", error);
        return null;
      }
    },
    []
  );

  /**
   * Check if a specific asset is resolved (exists in registry).
   *
   * @param assetId - The asset ID to check
   * @returns Promise resolving to true if resolved
   */
  const isAssetResolved = useCallback(async (assetId: string): Promise<boolean> => {
    if (!isIndexedDBAvailable()) {
      return false;
    }
    return hasAsset(assetId);
  }, []);

  /**
   * Mark an asset as resolved (remove from unresolved list).
   *
   * @param assetId - The asset ID that was resolved
   */
  const markAssetResolved = useCallback((assetId: string) => {
    setUnresolvedAssets((prev) =>
      prev.filter((info) => info.assetId !== assetId)
    );
  }, []);

  /**
   * Clear all unresolved assets (e.g., when loading a new project).
   */
  const clearUnresolvedAssets = useCallback(() => {
    setUnresolvedAssets([]);
  }, []);

  // Validate assets when project changes
  useEffect(() => {
    if (activeProject) {
      // Only validate if project has asset references
      const hasAssetRefs = activeProject.streams.some(
        (s) => isAudioStream(s) && (s.audio.cloudAssetId ?? s.audio.assetId)
      );

      if (hasAssetRefs) {
        validateProjectAssets();
      }
    }
  }, [activeProject?.id]); // Only re-validate when project ID changes

  return {
    unresolvedAssets,
    isValidating,
    validateProjectAssets,
    tryAutoMatch,
    isAssetResolved,
    markAssetResolved,
    clearUnresolvedAssets,
    hasUnresolvedAssets: unresolvedAssets.length > 0,
  };
}
