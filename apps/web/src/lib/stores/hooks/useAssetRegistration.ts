"use client";

import { useCallback } from "react";
import { useProjectStore } from "../projectStore";
import { registerAsset, getAsset } from "../../persistence/assetRegistry";
import { isIndexedDBAvailable } from "../../persistence/db";
import type { AssetType, AssetAudioMetadata } from "../../persistence/types";
import type { AudioInputMetadata, AudioInputOrigin } from "@/lib/persistence/types";
import {
  audioCache,
  isAudioStream,
  rawFileCache,
  useStreamStore,
  type AudioOrigin,
} from "@/lib/streams";

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
   * Register an audio stream with the asset registry.
   * Updates the stream's AudioReference with the assetId.
   *
   * @param inputId - The stream ID
   * @param rawBuffer - The raw ArrayBuffer of the audio file
   * @returns Promise resolving to the assetId, or null if registration failed
   */
  const registerAudioAsset = useCallback(
    async (inputId: string, rawBuffer: ArrayBuffer): Promise<string | null> => {
      if (!isIndexedDBAvailable()) {
        console.warn("[AssetRegistration] IndexedDB not available");
        return null;
      }

      const stream = useStreamStore.getState().getStream(inputId);
      if (!stream || !isAudioStream(stream)) {
        console.warn("[AssetRegistration] Stream not found or has no backing audio");
        return null;
      }

      const project = useProjectStore.getState().activeProject;
      if (!project) {
        console.warn("[AssetRegistration] No active project");
        return null;
      }

      try {
        const origin = stream.audio.origin;
        const assetType: AssetType =
          stream.kind === "mixdown"
            ? "audio:mixdown"
            : origin.kind === "separated"
              ? "audio:derived"
              : "audio:stem";

        const pcm = audioCache.get(inputId);
        const metadata: AssetAudioMetadata = {
          sampleRate: stream.audio.sampleRate,
          channels: pcm?.numberOfChannels ?? stream.audio.channels,
          duration: stream.audio.durationSec,
          totalSamples:
            pcm?.getChannelData(0).length ??
            Math.round(stream.audio.durationSec * stream.audio.sampleRate),
        };

        const fileName =
          origin.kind === "file"
            ? origin.fileName
            : origin.kind === "url"
              ? origin.fileName
              : undefined;

        const assetId = await registerAsset(
          rawBuffer,
          assetType,
          metadata,
          toLegacyOrigin(origin),
          project.id,
          fileName
        );

        // Update the stream's AudioReference with the assetId
        updateStreamAssetId(inputId, assetId);

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
   * Check if an audio stream has been registered with the asset registry.
   *
   * @param inputId - The stream ID
   * @returns true if the stream's AudioReference has an assetId
   */
  const isRegistered = useCallback((inputId: string): boolean => {
    const stream = useStreamStore.getState().getStream(inputId);
    return Boolean(stream && isAudioStream(stream) && stream.audio.assetId);
  }, []);

  return {
    registerAudioAsset,
    loadAudioFromAsset,
    isRegistered,
  };
}

/**
 * Update a stream's assetId in the stream store.
 * This is called after successful asset registration.
 */
function updateStreamAssetId(streamId: string, assetId: string): void {
  const streamStore = useStreamStore.getState();
  const stream = streamStore.getStream(streamId);
  if (!stream || !isAudioStream(stream)) return;

  // Update the AudioReference with the assetId and clear the raw bytes
  streamStore.updateAudio(streamId, { ...stream.audio, assetId });
  rawFileCache.delete(streamId); // Clear raw bytes after registration
}

/**
 * Map the unified AudioOrigin onto the legacy origin shape still used by the
 * persisted asset registry records.
 */
function toLegacyOrigin(origin: AudioOrigin): AudioInputOrigin {
  switch (origin.kind) {
    case "file":
    case "url":
      return origin;
    case "separated":
      return { kind: "stem", sourceId: origin.parentStreamId, method: origin.method };
    case "generated":
      return { kind: "synthetic", generatedFrom: origin.generatedFrom };
  }
}
