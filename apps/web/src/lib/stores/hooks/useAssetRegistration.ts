"use client";

import { useCallback } from "react";
import { useProjectStore } from "../projectStore";
import { useAudioInputStore } from "../audioInputStore";
import { registerAsset, getAsset } from "../../persistence/assetRegistry";
import { isIndexedDBAvailable } from "../../persistence/db";
import type { AssetType, AssetAudioMetadata } from "../../persistence/types";
import type { AudioInput, AudioInputMetadata, AudioInputOrigin } from "../types/audioInput";

/**
 * Hook for registering audio assets with the local asset registry.
 *
 * Provides functions to:
 * - Register new audio when loaded
 * - Load audio from registered assets
 * - Check if audio has been registered
 */
export function useAssetRegistration() {
  /**
   * Register an audio input with the asset registry.
   * Updates the audioInputStore with the assetId.
   *
   * @param inputId - The audio input ID
   * @param rawBuffer - The raw ArrayBuffer of the audio file
   * @returns Promise resolving to the assetId, or null if registration failed
   */
  const registerAudioAsset = useCallback(
    async (
      inputId: string,
      rawBuffer: ArrayBuffer
    ): Promise<string | null> => {
      if (!isIndexedDBAvailable()) {
        console.warn("[AssetRegistration] IndexedDB not available");
        return null;
      }

      const input = useAudioInputStore.getState().getInputById(inputId);
      if (!input || !input.metadata) {
        console.warn("[AssetRegistration] Input not found or missing metadata");
        return null;
      }

      const project = useProjectStore.getState().activeProject;
      if (!project) {
        console.warn("[AssetRegistration] No active project");
        return null;
      }

      try {
        const assetType: AssetType =
          input.role === "mixdown"
            ? "audio:mixdown"
            : input.origin.kind === "stem"
              ? "audio:derived"
              : "audio:stem";

        const metadata: AssetAudioMetadata = {
          sampleRate: input.metadata.sampleRate,
          channels: input.audioBuffer?.numberOfChannels ?? 2,
          duration: input.metadata.duration,
          totalSamples: input.metadata.totalSamples,
        };

        const fileName =
          input.origin.kind === "file"
            ? input.origin.fileName
            : input.origin.kind === "url"
              ? input.origin.fileName
              : undefined;

        const assetId = await registerAsset(
          rawBuffer,
          assetType,
          metadata,
          input.origin,
          project.id,
          fileName
        );

        // Update the audioInputStore with the assetId
        updateInputAssetId(inputId, assetId);

        return assetId;
      } catch (error) {
        console.error("[AssetRegistration] Failed to register asset:", error);
        return null;
      }
    },
    []
  );

  /**
   * Load an audio input from the asset registry.
   *
   * @param assetId - The asset ID to load
   * @returns Promise resolving to the asset data, or null if not found
   */
  const loadAudioFromAsset = useCallback(
    async (
      assetId: string
    ): Promise<{
      buffer: ArrayBuffer;
      metadata: AudioInputMetadata;
      origin: AudioInputOrigin;
      fileName?: string;
    } | null> => {
      if (!isIndexedDBAvailable()) {
        return null;
      }

      try {
        const asset = await getAsset(assetId);
        if (!asset) {
          return null;
        }

        return {
          buffer: asset.data,
          metadata: {
            sampleRate: asset.metadata.sampleRate,
            totalSamples: asset.metadata.totalSamples,
            duration: asset.metadata.duration,
          },
          origin: asset.origin,
          fileName: asset.fileName,
        };
      } catch (error) {
        console.error("[AssetRegistration] Failed to load from asset:", error);
        return null;
      }
    },
    []
  );

  /**
   * Check if an audio input has been registered with the asset registry.
   *
   * @param inputId - The audio input ID
   * @returns true if the input has an assetId
   */
  const isRegistered = useCallback((inputId: string): boolean => {
    const input = useAudioInputStore.getState().getInputById(inputId);
    return Boolean(input?.assetId);
  }, []);

  return {
    registerAudioAsset,
    loadAudioFromAsset,
    isRegistered,
  };
}

/**
 * Update an audio input's assetId in the store.
 * This is called after successful asset registration.
 */
function updateInputAssetId(inputId: string, assetId: string): void {
  const store = useAudioInputStore.getState();
  const collection = store.collection;
  if (!collection) return;

  const input = collection.inputs[inputId];
  if (!input) return;

  // Update the input with the assetId and clear the rawBuffer
  const updatedInput: AudioInput = {
    ...input,
    assetId,
    rawBuffer: undefined, // Clear rawBuffer after registration
  };

  // Update the collection immutably
  useAudioInputStore.setState({
    collection: {
      ...collection,
      inputs: {
        ...collection.inputs,
        [inputId]: updatedInput,
      },
    },
  });
}
