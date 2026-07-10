"use client";

/**
 * Cloud Asset Loader
 *
 * Loads cloud-hosted assets (audio, mesh) from R2 storage.
 *
 * DESIGN PRINCIPLES:
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - For audio: sets up RemoteAudioSource for playback, decodes for MIR
 * - currentAudioSource is the single source of truth for what audio is playing
 */

import { useCallback, useEffect } from "react";
import { getAssetDownloadUrls } from "@/lib/actions/asset";
import { useMeshAssetStore } from "@/lib/stores/meshAssetStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import {
  MIXDOWN_STREAM_ID,
  isAudioStream,
  loadMixdown,
  replaceStreamAudio,
  useAudioSourceStore,
  useStreamStore,
  type RemoteAudioSource,
} from "@/lib/streams";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AssetLoadResult {
  assetId: string;
  inputId?: string;
  success: boolean;
  error?: string;
}

interface CloudAssetLoaderReturn {
  /** Load all cloud assets for the current project */
  loadProjectAssets: () => Promise<AssetLoadResult[]>;
  /** Load a specific audio asset by ID */
  loadAudioAsset: (assetId: string, inputId: string) => Promise<boolean>;
  /** Load a specific mesh asset by ID */
  loadMeshAsset: (assetId: string, meshId: string) => Promise<boolean>;
}

const cloudAudioUrls = new Map<string, string>();

function replaceCloudAudioUrl(inputId: string, nextUrl: string): void {
  const previous = cloudAudioUrls.get(inputId);
  if (previous && previous !== nextUrl) URL.revokeObjectURL(previous);
  cloudAudioUrls.set(inputId, nextUrl);
}

function revokeAllCloudAudioUrls(): void {
  for (const url of cloudAudioUrls.values()) URL.revokeObjectURL(url);
  cloudAudioUrls.clear();
}

// -----------------------------------------------------------------------------
// Hook Implementation
// -----------------------------------------------------------------------------

/**
 * Hook for loading cloud assets from R2 storage.
 * Used when loading projects that reference cloud-stored assets.
 */
export function useCloudAssetLoader(): CloudAssetLoaderReturn {
  useEffect(() => revokeAllCloudAudioUrls, []);

  /**
   * Load an audio asset from the cloud and hydrate the audio store.
   *
   * DESIGN: For the mixdown, we set currentAudioSource to establish playback.
   * The audio is also decoded and stored for MIR analysis.
   */
  const loadAudioAsset = useCallback(async (assetId: string, inputId: string): Promise<boolean> => {
    const audioSourceStore = useAudioSourceStore.getState();

    // =======================================================================
    // DESIGN: Set the playback source immediately for the mixdown.
    // This establishes the single source of truth for playback.
    // =======================================================================
    if (inputId === MIXDOWN_STREAM_ID) {
      const pendingSource: RemoteAudioSource = {
        type: "remote",
        id: inputId,
        cloudAssetId: assetId,
        status: "pending",
      };
      audioSourceStore.setCurrentSource(pendingSource);
      console.log("[CloudAssetLoader] Set pending RemoteAudioSource for mixdown");
    }

    try {
      // Get download URL from server
      const result = await getAssetDownloadUrls({ assetIds: [assetId] });

      if (!result?.data?.assets || result.data.assets.length === 0) {
        console.error("[CloudAssetLoader] Failed to get download URL for asset:", assetId);
        useProjectStore
          .getState()
          .setAudioLoadStatus(inputId, "failed", "Failed to get download URL");
        if (inputId === MIXDOWN_STREAM_ID) {
          audioSourceStore.updateSourceStatus("failed", undefined, "Failed to get download URL");
        }
        return false;
      }

      const assetInfo = result.data.assets[0];
      if (!assetInfo) {
        console.error("[CloudAssetLoader] No asset info returned for:", assetId);
        useProjectStore.getState().setAudioLoadStatus(inputId, "failed", "Asset not found");
        if (inputId === MIXDOWN_STREAM_ID) {
          audioSourceStore.updateSourceStatus("failed", undefined, "Asset not found");
        }
        return false;
      }

      // Fetch the audio file
      useProjectStore.getState().setAudioLoadStatus(inputId, "loading");
      if (inputId === MIXDOWN_STREAM_ID) {
        audioSourceStore.updateSourceStatus("resolving");
      }

      const response = await fetch(assetInfo.downloadUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get the raw audio data
      const arrayBuffer = await response.arrayBuffer();

      // Create a blob URL from the fetched data for playback
      // This is CORS-safe and works with Web Audio API (required for band auditioning)
      // Note: Pre-signed URLs don't have CORS headers, so they can't be used with
      // crossOrigin="anonymous" which is needed for MediaElementSource connections.
      // Important: Create blob BEFORE decoding since decodeAudioData neuters the ArrayBuffer
      const metadata = assetInfo.metadata as { contentType?: string } | null;
      const contentType =
        metadata?.contentType ?? response.headers.get("content-type") ?? "application/octet-stream";
      const blob = new Blob([arrayBuffer], { type: contentType });
      const audioUrl = URL.createObjectURL(blob);
      replaceCloudAudioUrl(inputId, audioUrl);

      // Decode the audio (needed for MIR analysis)
      // Note: We need to clone the buffer since we already used it for the blob
      const audioContext = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      } finally {
        await audioContext.close();
      }

      // Create a wrapper that matches AudioBufferLike interface
      const audioBufferLike = {
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        duration: audioBuffer.duration,
        getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
      };

      // Handle mixdown vs stems differently
      if (inputId === MIXDOWN_STREAM_ID) {
        // Get existing stream for origin/label, or use defaults
        const existing = useStreamStore.getState().getMixdown();

        // Initialize/replace the mixdown stream (caches PCM, invalidates analyses)
        loadMixdown({
          audio: {
            origin: existing?.audio.origin ?? {
              kind: "url",
              url: audioUrl,
              fileName: "Cloud Audio",
            },
            url: audioUrl,
            cloudAssetId: assetId,
            fileName: existing?.audio.fileName,
            durationSec: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
          },
          buffer: audioBufferLike,
          label: existing?.label,
        });

        // =================================================================
        // DESIGN: Update the playback source to ready with the blob URL.
        // WaveSurfer will load directly from this URL.
        // =================================================================
        audioSourceStore.updateSourceStatus("ready", audioUrl);
        console.log("[CloudAssetLoader] AudioSource ready with blob URL");
      } else {
        // For stems, the stream must exist first (created during project hydration)
        const stream = useStreamStore.getState().getStream(inputId);
        if (stream && isAudioStream(stream)) {
          replaceStreamAudio(
            inputId,
            {
              ...stream.audio,
              url: audioUrl,
              cloudAssetId: assetId,
              durationSec: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              channels: audioBuffer.numberOfChannels,
            },
            audioBufferLike
          );
        } else {
          console.warn("[CloudAssetLoader] Stem stream not found:", inputId);
        }
      }

      useProjectStore.getState().setAudioLoadStatus(inputId, "loaded");
      console.log("[CloudAssetLoader] Successfully loaded audio asset:", assetId);
      return true;
    } catch (error) {
      const failedUrl = cloudAudioUrls.get(inputId);
      if (failedUrl) {
        URL.revokeObjectURL(failedUrl);
        cloudAudioUrls.delete(inputId);
      }
      console.error("[CloudAssetLoader] Failed to load audio asset:", assetId, error);
      useProjectStore
        .getState()
        .setAudioLoadStatus(
          inputId,
          "failed",
          error instanceof Error ? error.message : "Unknown error"
        );
      if (inputId === MIXDOWN_STREAM_ID) {
        audioSourceStore.updateSourceStatus(
          "failed",
          undefined,
          error instanceof Error ? error.message : "Unknown error"
        );
      }
      return false;
    }
  }, []);

  /**
   * Load a mesh asset from the cloud and hydrate the mesh store.
   */
  const loadMeshAsset = useCallback(async (assetId: string, meshId: string): Promise<boolean> => {
    try {
      // Get download URL from server
      const result = await getAssetDownloadUrls({ assetIds: [assetId] });

      if (!result?.data?.assets || result.data.assets.length === 0) {
        console.error("[CloudAssetLoader] Failed to get download URL for mesh:", assetId);
        return false;
      }

      const assetInfo = result.data.assets[0];
      if (!assetInfo) {
        console.error("[CloudAssetLoader] No asset info returned for mesh:", assetId);
        return false;
      }

      // Fetch the mesh file
      const response = await fetch(assetInfo.downloadUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get the OBJ content as text
      const objContent = await response.text();

      // Get metadata
      const metadata = assetInfo.metadata as { fileName?: string } | null;
      const fileName = metadata?.fileName ?? "mesh.obj";

      // Update the mesh store
      const meshStore = useMeshAssetStore.getState();
      if (!meshStore.hydrateAssetContent(meshId, fileName, objContent, assetId)) {
        throw new Error(`Mesh reference ${meshId} was not found in the project`);
      }

      console.log("[CloudAssetLoader] Successfully loaded mesh asset:", assetId);
      return true;
    } catch (error) {
      console.error("[CloudAssetLoader] Failed to load mesh asset:", assetId, error);
      return false;
    }
  }, []);

  /**
   * Load all cloud assets referenced by the current project.
   */
  const loadProjectAssets = useCallback(async (): Promise<AssetLoadResult[]> => {
    console.log("[CloudAssetLoader] Loading cloud assets for current project...");
    const project = useProjectStore.getState().activeProject;
    if (!project) {
      return [];
    }
    console.log("[CloudAssetLoader] Project:", project);

    // Collect all asset IDs to load
    const audioAssets: Array<{ assetId: string; inputId: string }> = [];
    const meshAssets: Array<{ assetId: string; meshId: string }> = [];

    // Check audio streams (mixdown + stems)
    for (const stream of project.streams) {
      if (!isAudioStream(stream)) continue;
      const assetId = stream.audio.cloudAssetId ?? stream.audio.assetId;
      if (assetId) {
        audioAssets.push({ assetId, inputId: stream.id });
      }
    }

    // Check mesh assets
    if (project.meshAssets?.assets) {
      for (const mesh of project.meshAssets.assets) {
        if (mesh.cloudAssetId) {
          meshAssets.push({
            assetId: mesh.cloudAssetId,
            meshId: mesh.id,
          });
        }
      }
    }

    const audioLoads = audioAssets.map(async ({ assetId, inputId }) => {
      const success = await loadAudioAsset(assetId, inputId);
      return {
        assetId,
        inputId,
        success,
        error: success ? undefined : "Failed to load audio",
      } satisfies AssetLoadResult;
    });
    const meshLoads = meshAssets.map(async ({ assetId, meshId }) => {
      const success = await loadMeshAsset(assetId, meshId);
      return {
        assetId,
        success,
        error: success ? undefined : "Failed to load mesh",
      } satisfies AssetLoadResult;
    });

    return Promise.all([...audioLoads, ...meshLoads]);
  }, [loadAudioAsset, loadMeshAsset]);

  return {
    loadProjectAssets,
    loadAudioAsset,
    loadMeshAsset,
  };
}
