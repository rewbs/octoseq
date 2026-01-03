'use client';

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

import { useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { getAssetDownloadUrls } from '@/lib/actions/asset';
import { useAudioInputStore } from '@/lib/stores/audioInputStore';
import { useMeshAssetStore } from '@/lib/stores/meshAssetStore';
import { useProjectStore } from '@/lib/stores/projectStore';
import { MIXDOWN_ID, type RemoteAudioSource } from '@/lib/stores/types/audioInput';

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
  /** Whether the user is signed in (required for cloud access) */
  isSignedIn: boolean;
}

// -----------------------------------------------------------------------------
// Hook Implementation
// -----------------------------------------------------------------------------

/**
 * Hook for loading cloud assets from R2 storage.
 * Used when loading projects that reference cloud-stored assets.
 */
export function useCloudAssetLoader(): CloudAssetLoaderReturn {
  const { isSignedIn } = useUser();

  /**
   * Load an audio asset from the cloud and hydrate the audio store.
   *
   * DESIGN: For the mixdown, we set currentAudioSource to establish playback.
   * The audio is also decoded and stored for MIR analysis.
   */
  const loadAudioAsset = useCallback(
    async (assetId: string, inputId: string): Promise<boolean> => {
      if (!isSignedIn) {
        console.warn('[CloudAssetLoader] Cannot load assets: not signed in');
        return false;
      }

      const audioInputStore = useAudioInputStore.getState();

      // =======================================================================
      // DESIGN: Set currentAudioSource immediately for the mixdown.
      // This establishes the single source of truth for playback.
      // =======================================================================
      if (inputId === MIXDOWN_ID) {
        const pendingSource: RemoteAudioSource = {
          type: 'remote',
          id: inputId,
          cloudAssetId: assetId,
          status: 'pending',
        };
        audioInputStore.setCurrentAudioSource(pendingSource);
        console.log('[CloudAssetLoader] Set pending RemoteAudioSource for mixdown');
      }

      try {
        // Get download URL from server
        const result = await getAssetDownloadUrls({ assetIds: [assetId] });

        if (!result?.data?.assets || result.data.assets.length === 0) {
          console.error('[CloudAssetLoader] Failed to get download URL for asset:', assetId);
          useProjectStore.getState().setAudioLoadStatus(inputId, 'failed', 'Failed to get download URL');
          if (inputId === MIXDOWN_ID) {
            audioInputStore.updateAudioSourceStatus('failed', undefined, 'Failed to get download URL');
          }
          return false;
        }

        const assetInfo = result.data.assets[0];
        if (!assetInfo) {
          console.error('[CloudAssetLoader] No asset info returned for:', assetId);
          useProjectStore.getState().setAudioLoadStatus(inputId, 'failed', 'Asset not found');
          if (inputId === MIXDOWN_ID) {
            audioInputStore.updateAudioSourceStatus('failed', undefined, 'Asset not found');
          }
          return false;
        }

        // Fetch the audio file
        useProjectStore.getState().setAudioLoadStatus(inputId, 'loading');
        if (inputId === MIXDOWN_ID) {
          audioInputStore.updateAudioSourceStatus('resolving');
        }

        const response = await fetch(assetInfo.downloadUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Decode the audio (needed for MIR analysis)
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Use the pre-signed download URL directly for playback
        // (Blob URLs were causing issues with empty blobs when re-fetched)
        const audioUrl = assetInfo.downloadUrl;

        // Create a wrapper that matches AudioBufferLike interface
        const audioBufferLike = {
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
          length: audioBuffer.length,
          duration: audioBuffer.duration,
          getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
        };

        // Handle mixdown vs stems differently
        if (inputId === MIXDOWN_ID) {
          // Get existing input for origin/label, or use defaults
          const existingInput = audioInputStore.collection?.inputs[inputId];

          // Update the audio input store with decoded buffer for MIR
          // Note: updateMixdown will create the collection if it doesn't exist
          audioInputStore.updateMixdown({
            audioBuffer: audioBufferLike,
            metadata: {
              sampleRate: audioBuffer.sampleRate,
              totalSamples: audioBuffer.length,
              duration: audioBuffer.duration,
            },
            audioUrl,
            origin: existingInput?.origin ?? { kind: 'url', url: audioUrl, fileName: 'Cloud Audio' },
            label: existingInput?.label ?? 'Mixdown',
          });

          // =================================================================
          // DESIGN: Update AudioSource to ready with the pre-signed URL.
          // WaveSurfer will load directly from this URL.
          // =================================================================
          audioInputStore.updateAudioSourceStatus('ready', audioUrl);
          console.log('[CloudAssetLoader] AudioSource ready with pre-signed URL');

          // Set the cloud asset ID
          audioInputStore.setCloudAssetId(inputId, assetId);
        } else {
          // For stems, we need the input to exist first
          const input = audioInputStore.collection?.inputs[inputId];
          if (input) {
            audioInputStore.replaceStem(inputId, {
              audioBuffer: audioBufferLike,
              metadata: {
                sampleRate: audioBuffer.sampleRate,
                totalSamples: audioBuffer.length,
                duration: audioBuffer.duration,
              },
              audioUrl,
            });
            // Set the cloud asset ID
            audioInputStore.setCloudAssetId(inputId, assetId);
          } else {
            console.warn('[CloudAssetLoader] Stem input not found:', inputId);
          }
        }

        useProjectStore.getState().setAudioLoadStatus(inputId, 'loaded');
        console.log('[CloudAssetLoader] Successfully loaded audio asset:', assetId);
        return true;
      } catch (error) {
        console.error('[CloudAssetLoader] Failed to load audio asset:', assetId, error);
        useProjectStore.getState().setAudioLoadStatus(
          inputId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
        if (inputId === MIXDOWN_ID) {
          audioInputStore.updateAudioSourceStatus('failed', undefined, error instanceof Error ? error.message : 'Unknown error');
        }
        return false;
      }
    },
    [isSignedIn]
  );

  /**
   * Load a mesh asset from the cloud and hydrate the mesh store.
   */
  const loadMeshAsset = useCallback(
    async (assetId: string, meshId: string): Promise<boolean> => {
      if (!isSignedIn) {
        console.warn('[CloudAssetLoader] Cannot load assets: not signed in');
        return false;
      }

      try {
        // Get download URL from server
        const result = await getAssetDownloadUrls({ assetIds: [assetId] });

        if (!result?.data?.assets || result.data.assets.length === 0) {
          console.error('[CloudAssetLoader] Failed to get download URL for mesh:', assetId);
          return false;
        }

        const assetInfo = result.data.assets[0];
        if (!assetInfo) {
          console.error('[CloudAssetLoader] No asset info returned for mesh:', assetId);
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
        const fileName = metadata?.fileName ?? 'mesh.obj';

        // Update the mesh store
        const meshStore = useMeshAssetStore.getState();
        const existingAsset = meshStore.structure?.assets.find((a) => a.id === meshId);

        if (existingAsset) {
          // Update the existing mesh with loaded content
          // Since we can't update objContent directly, we need to remove and re-add
          meshStore.removeAsset(meshId);
        }

        // Add the mesh with the loaded content
        meshStore.addAsset(fileName, objContent, {
          name: existingAsset?.name,
        });

        console.log('[CloudAssetLoader] Successfully loaded mesh asset:', assetId);
        return true;
      } catch (error) {
        console.error('[CloudAssetLoader] Failed to load mesh asset:', assetId, error);
        return false;
      }
    },
    [isSignedIn]
  );

  /**
   * Load all cloud assets referenced by the current project.
   */
  const loadProjectAssets = useCallback(async (): Promise<AssetLoadResult[]> => {
    console.log('[CloudAssetLoader] Loading cloud assets for current project...');
    if (!isSignedIn) {
      console.warn('[CloudAssetLoader] Cannot load assets: not signed in');
      return [];
    }

    const project = useProjectStore.getState().activeProject;
    if (!project) {
      return [];
    }
    console.log('[CloudAssetLoader] Project:', project);

    const results: AssetLoadResult[] = [];

    // Collect all asset IDs to load
    const audioAssets: Array<{ assetId: string; inputId: string }> = [];
    const meshAssets: Array<{ assetId: string; meshId: string }> = [];

    // Check mixdown
    if (project.audio.mixdown?.assetId) {
      audioAssets.push({
        assetId: project.audio.mixdown.assetId,
        inputId: project.audio.mixdown.id,
      });
    }

    // Check stems
    for (const stem of project.audio.stems) {
      if (stem.assetId) {
        audioAssets.push({
          assetId: stem.assetId,
          inputId: stem.id,
        });
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

    // Load audio assets
    for (const { assetId, inputId } of audioAssets) {
      const success = await loadAudioAsset(assetId, inputId);
      results.push({ assetId, inputId, success, error: success ? undefined : 'Failed to load audio' });
    }

    // Load mesh assets
    for (const { assetId, meshId } of meshAssets) {
      const success = await loadMeshAsset(assetId, meshId);
      results.push({ assetId, success, error: success ? undefined : 'Failed to load mesh' });
    }

    return results;
  }, [isSignedIn, loadAudioAsset, loadMeshAsset]);

  return {
    loadProjectAssets,
    loadAudioAsset,
    loadMeshAsset,
    isSignedIn: !!isSignedIn,
  };
}
