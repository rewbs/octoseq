/**
 * Audio Input Store
 *
 * Manages the collection of audio inputs (mixdown + stems) and the current
 * audio source for playback.
 *
 * ## Architecture: Single Source of Truth
 *
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - `currentAudioSource` is the single source of truth for what audio is playing.
 * - WaveSurfer loads audio by URL only - never pass decoded buffers to it.
 * - Decoding is for MIR analysis and mixdown generation, not playback.
 *
 * ## Audio Source Flow
 *
 * 1. User action triggers `setCurrentAudioSource` with a new AudioSource
 * 2. The `useAudioSourceResolver` hook watches currentAudioSource
 * 3. When status is 'pending', resolver fetches/creates the URL
 * 4. Resolver updates status to 'ready' with the URL
 * 5. WaveSurferPlayer's effect loads the URL when ready
 *
 * ## Key Types
 *
 * - `AudioInput`: Decoded audio data for MIR analysis (stored in collection)
 * - `AudioSource`: Playback intent (local file, remote asset, or generated)
 * - `currentAudioSource`: Points to what's currently playing
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AudioBufferLike } from "@octoseq/mir";
import type {
  AudioInput,
  AudioInputCollection,
  AudioInputMetadata,
  AudioInputOrigin,
  AudioSource,
  AudioSourceStatus,
} from "./types/audioInput";
import { MIXDOWN_ID } from "./types/audioInput";

// ----------------------------
// Store State
// ----------------------------

interface AudioInputState {
  /** The collection of audio inputs. Null until first audio is loaded. */
  collection: AudioInputCollection | null;

  /** Currently selected input in the tree UI (for context display, not "active"). */
  selectedInputId: string | null;

  /** ID of the audio source currently displayed in the waveform. Defaults to MIXDOWN_ID. */
  activeDisplayId: string;

  /** Callback to trigger the file input dialog. Set by page.tsx on mount. */
  triggerFileInput: (() => void) | null;

  // ==========================================================================
  // AudioSource: Single Source of Truth for Playback
  // ==========================================================================
  // DESIGN: WaveSurfer loads audio by URL only. currentAudioSource is the
  // single authority on what audio is playing. The resolver watches this
  // and updates the URL when ready.
  // ==========================================================================

  /**
   * The current audio source for playback.
   * This is the single source of truth for WaveSurfer.
   * Null when no audio is loaded.
   */
  currentAudioSource: AudioSource | null;

  /**
   * Pending file name for URL-based loads.
   * Set before loading starts, cleared after audio is decoded.
   */
  pendingFileName: string | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface AudioInputActions {
  /**
   * Initialize the collection with a mixdown input.
   * Called when audio is first loaded.
   */
  initializeWithMixdown: (params: {
    audioBuffer: AudioBufferLike;
    metadata: AudioInputMetadata;
    audioUrl: string | null;
    origin: AudioInputOrigin;
    label?: string;
  }) => void;

  /**
   * Update the mixdown input (e.g., when new audio is loaded).
   */
  updateMixdown: (params: {
    audioBuffer: AudioBufferLike;
    metadata: AudioInputMetadata;
    audioUrl: string | null;
    origin: AudioInputOrigin;
    label?: string;
  }) => void;

  /**
   * Get the mixdown input. Returns null if no collection exists.
   */
  getMixdown: () => AudioInput | null;

  /**
   * Get all stem inputs in order.
   */
  getStems: () => AudioInput[];

  /**
   * Check if any stems exist.
   */
  hasStems: () => boolean;

  /**
   * Get an input by its ID.
   */
  getInputById: (id: string) => AudioInput | null;

  /**
   * Select an input in the tree UI (for context display).
   */
  selectInput: (id: string | null) => void;

  /**
   * Clear the entire collection (called when audio is unloaded).
   */
  clearCollection: () => void;

  /**
   * Full reset.
   */
  reset: () => void;

  // ----------------------------
  // Stem CRUD Operations
  // ----------------------------

  /**
   * Add a new stem to the collection.
   * @returns The ID of the newly created stem.
   */
  addStem: (params: {
    audioBuffer: AudioBufferLike;
    metadata: AudioInputMetadata;
    audioUrl: string | null;
    origin: AudioInputOrigin;
    label: string;
  }) => string;

  /**
   * Rename an input (stem or mixdown).
   * Note: Mixdown can be renamed but not to empty string.
   */
  renameInput: (id: string, label: string) => void;

  /**
   * Reorder stems by providing the new order of stem IDs.
   * Does not affect mixdown position (always first).
   */
  reorderStems: (orderedIds: string[]) => void;

  /**
   * Remove a stem from the collection.
   * @returns The removed AudioInput for undo purposes, or null if not found.
   */
  removeStem: (id: string) => AudioInput | null;

  /**
   * Restore a previously removed stem.
   * Used for undo functionality.
   * @param stem The stem to restore
   * @param atIndex Optional index to insert at in stemOrder (defaults to end)
   */
  restoreStem: (stem: AudioInput, atIndex?: number) => void;

  /**
   * Get all inputs (mixdown + stems) in display order.
   */
  getAllInputsOrdered: () => AudioInput[];

  /**
   * Set the active display source for the waveform.
   */
  setActiveDisplay: (id: string) => void;

  /**
   * Get the audio buffer for the currently active display source.
   */
  getActiveDisplayBuffer: () => AudioBufferLike | null;

  /**
   * Get the audio URL for the currently active display source.
   */
  getActiveDisplayUrl: () => string | null;

  /**
   * Clear all stems, keeping only the mixdown.
   */
  clearStems: () => void;

  /**
   * Register the file input trigger callback.
   * Called by page.tsx on mount.
   */
  setTriggerFileInput: (callback: (() => void) | null) => void;

  /**
   * Replace a stem's audio content while keeping its ID and position.
   * Used when user wants to swap out the audio file for a stem.
   */
  replaceStem: (
    id: string,
    newData: {
      audioBuffer: AudioBufferLike;
      metadata: AudioInputMetadata;
      audioUrl: string | null;
    }
  ) => void;

  // ----------------------------
  // Cloud Asset Operations
  // ----------------------------

  /**
   * Set the cloud asset ID for an input after upload completes.
   */
  setCloudAssetId: (inputId: string, cloudAssetId: string) => void;

  /**
   * Set asset metadata (content hash, mime type, raw bytes) for an input.
   * Called when a file is loaded, before cloud upload.
   */
  setAssetMetadata: (
    inputId: string,
    metadata: {
      contentHash?: string;
      mimeType?: string;
      rawBuffer?: ArrayBuffer;
    }
  ) => void;

  /**
   * Clear the rawBuffer after upload completes to free memory.
   */
  clearRawBuffer: (inputId: string) => void;

  /**
   * Set the entire collection directly.
   * Used when hydrating from a loaded project.
   */
  setCollection: (collection: AudioInputCollection) => void;

  // ----------------------------
  // AudioSource Operations
  // ----------------------------
  // These actions manage the single source of truth for playback.
  // WaveSurfer should only load audio from currentAudioSource.url.

  /**
   * Set the current audio source for playback.
   * This is the single entry point for changing what audio is playing.
   * The resolver will watch for changes and update the URL.
   */
  setCurrentAudioSource: (source: AudioSource | null) => void;

  /**
   * Update the status and URL of the current audio source.
   * Called by the resolver when URL resolution completes or fails.
   */
  updateAudioSourceStatus: (
    status: AudioSourceStatus,
    url?: string,
    error?: string
  ) => void;

  /**
   * Get the current audio source.
   */
  getCurrentAudioSource: () => AudioSource | null;

  /**
   * Get the playback URL if the current source is ready.
   * Returns null if no source or source is not ready.
   */
  getCurrentAudioUrl: () => string | null;

  // ----------------------------
  // Convenience Selectors (Legacy audioStore Compatibility)
  // ----------------------------
  // These provide flat access to common mixdown properties.
  // Use these to migrate away from audioStore.

  /** Get the mixdown's decoded audio buffer (for MIR analysis). */
  getAudio: () => AudioBufferLike | null;

  /** Get the mixdown's sample rate. */
  getAudioSampleRate: () => number | null;

  /** Get the mixdown's duration in seconds. */
  getAudioDuration: () => number;

  /** Get the mixdown's total sample count. */
  getAudioTotalSamples: () => number | null;

  /** Get the mixdown's display name (label or origin fileName). */
  getAudioFileName: () => string | null;

  /** Get the sample rate of the currently active display (stem or mixdown). */
  getActiveDisplaySampleRate: () => number | null;

  /**
   * Set the pending file name for URL-based loads.
   * Used to track the intended file name before audio is decoded.
   */
  setPendingFileName: (fileName: string | null) => void;
}

export type AudioInputStore = AudioInputState & AudioInputActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: AudioInputState = {
  collection: null,
  selectedInputId: null,
  activeDisplayId: MIXDOWN_ID,
  triggerFileInput: null,
  currentAudioSource: null,
  pendingFileName: null,
};

// ----------------------------
// Helper Functions
// ----------------------------

function createMixdownInput(params: {
  audioBuffer: AudioBufferLike;
  metadata: AudioInputMetadata;
  audioUrl: string | null;
  origin: AudioInputOrigin;
  label?: string;
}): AudioInput {
  return {
    id: MIXDOWN_ID,
    label: params.label ?? "Mixdown",
    role: "mixdown",
    audioBuffer: params.audioBuffer,
    metadata: params.metadata,
    audioUrl: params.audioUrl,
    origin: params.origin,
    createdAt: new Date().toISOString(),
  };
}

// ----------------------------
// Store Implementation
// ----------------------------

export const useAudioInputStore = create<AudioInputStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // Initialization
      // ----------------------------

      initializeWithMixdown: (params) => {
        const mixdown = createMixdownInput(params);

        const collection: AudioInputCollection = {
          version: 1,
          inputs: {
            [MIXDOWN_ID]: mixdown,
          },
          stemOrder: [],
        };

        set({ collection, selectedInputId: null }, false, "initializeWithMixdown");
      },

      updateMixdown: (params) => {
        const { collection } = get();

        if (!collection) {
          // No collection exists, initialize instead
          get().initializeWithMixdown(params);
          return;
        }

        const mixdown = createMixdownInput(params);

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [MIXDOWN_ID]: mixdown,
              },
            },
          },
          false,
          "updateMixdown"
        );
      },

      // ----------------------------
      // Queries
      // ----------------------------

      getMixdown: () => {
        const { collection } = get();
        return collection?.inputs[MIXDOWN_ID] ?? null;
      },

      getStems: () => {
        const { collection } = get();
        if (!collection) return [];

        return collection.stemOrder
          .map((id) => collection.inputs[id])
          .filter((input): input is AudioInput => input !== undefined);
      },

      hasStems: () => {
        const { collection } = get();
        return (collection?.stemOrder.length ?? 0) > 0;
      },

      getInputById: (id) => {
        const { collection } = get();
        return collection?.inputs[id] ?? null;
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectInput: (id) => {
        set({ selectedInputId: id }, false, "selectInput");
      },

      // ----------------------------
      // Management
      // ----------------------------

      clearCollection: () => {
        set({ collection: null, selectedInputId: null }, false, "clearCollection");
      },

      reset: () => {
        set(initialState, false, "reset");
      },

      // ----------------------------
      // Stem CRUD Operations
      // ----------------------------

      addStem: (params) => {
        let { collection } = get();

        // Initialize collection if it doesn't exist (stems can be loaded before mixdown)
        if (!collection) {
          collection = {
            version: 1,
            inputs: {},
            stemOrder: [],
          };
        }

        const stemId = nanoid();
        const newStem: AudioInput = {
          id: stemId,
          label: params.label,
          role: "stem",
          audioBuffer: params.audioBuffer,
          metadata: params.metadata,
          audioUrl: params.audioUrl,
          origin: params.origin,
          createdAt: new Date().toISOString(),
        };

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [stemId]: newStem,
              },
              stemOrder: [...collection.stemOrder, stemId],
            },
          },
          false,
          "addStem"
        );

        return stemId;
      },

      renameInput: (id, label) => {
        const { collection } = get();

        if (!collection) return;

        const input = collection.inputs[id];
        if (!input) return;

        // Don't allow empty labels
        const trimmedLabel = label.trim();
        if (!trimmedLabel) return;

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [id]: {
                  ...input,
                  label: trimmedLabel,
                },
              },
            },
          },
          false,
          "renameInput"
        );
      },

      reorderStems: (orderedIds) => {
        const { collection } = get();

        if (!collection) return;

        // Validate that all IDs exist and are stems
        const validIds = orderedIds.filter(
          (id) => collection.inputs[id]?.role === "stem"
        );

        set(
          {
            collection: {
              ...collection,
              stemOrder: validIds,
            },
          },
          false,
          "reorderStems"
        );
      },

      removeStem: (id) => {
        const { collection, selectedInputId } = get();

        if (!collection) return null;

        const stem = collection.inputs[id];
        if (!stem || stem.role !== "stem") return null;

        // Create new inputs without the removed stem
        const { [id]: removed, ...remainingInputs } = collection.inputs;

        set(
          {
            collection: {
              ...collection,
              inputs: remainingInputs,
              stemOrder: collection.stemOrder.filter((stemId) => stemId !== id),
            },
            // Clear selection if the removed stem was selected
            selectedInputId: selectedInputId === id ? null : selectedInputId,
          },
          false,
          "removeStem"
        );

        return stem;
      },

      restoreStem: (stem, atIndex) => {
        const { collection } = get();

        if (!collection) return;
        if (stem.role !== "stem") return;

        // Determine insertion index
        const insertIndex =
          atIndex !== undefined
            ? Math.min(atIndex, collection.stemOrder.length)
            : collection.stemOrder.length;

        const newStemOrder = [...collection.stemOrder];
        newStemOrder.splice(insertIndex, 0, stem.id);

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [stem.id]: stem,
              },
              stemOrder: newStemOrder,
            },
          },
          false,
          "restoreStem"
        );
      },

      getAllInputsOrdered: () => {
        const { collection } = get();
        if (!collection) return [];

        const result: AudioInput[] = [];

        // Mixdown first
        const mixdown = collection.inputs[MIXDOWN_ID];
        if (mixdown) {
          result.push(mixdown);
        }

        // Then stems in order
        for (const stemId of collection.stemOrder) {
          const stem = collection.inputs[stemId];
          if (stem) {
            result.push(stem);
          }
        }

        return result;
      },

      // ----------------------------
      // Active Display (Waveform Switching)
      // ----------------------------

      setActiveDisplay: (id) => {
        set({ activeDisplayId: id }, false, "setActiveDisplay");
      },

      getActiveDisplayBuffer: () => {
        const { collection, activeDisplayId } = get();
        if (!collection) return null;
        const input = collection.inputs[activeDisplayId];
        return input?.audioBuffer ?? null;
      },

      getActiveDisplayUrl: () => {
        const { collection, activeDisplayId } = get();
        if (!collection) return null;
        const input = collection.inputs[activeDisplayId];
        return input?.audioUrl ?? null;
      },

      clearStems: () => {
        const { collection, activeDisplayId } = get();
        if (!collection) return;

        // Keep only mixdown
        const mixdown = collection.inputs[MIXDOWN_ID];
        const newInputs: Record<string, AudioInput> = {};
        if (mixdown) {
          newInputs[MIXDOWN_ID] = mixdown;
        }

        set(
          {
            collection: {
              ...collection,
              inputs: newInputs,
              stemOrder: [],
            },
            // Reset active display to mixdown if current was a stem
            activeDisplayId: MIXDOWN_ID,
          },
          false,
          "clearStems"
        );
      },

      setTriggerFileInput: (callback) => {
        set({ triggerFileInput: callback }, false, "setTriggerFileInput");
      },

      replaceStem: (id, newData) => {
        const { collection } = get();
        if (!collection) return;

        const existingStem = collection.inputs[id];
        if (!existingStem || existingStem.role !== "stem") return;

        // Revoke old blob URL if it exists
        if (existingStem.audioUrl) {
          URL.revokeObjectURL(existingStem.audioUrl);
        }

        const updatedStem: AudioInput = {
          ...existingStem,
          audioBuffer: newData.audioBuffer,
          metadata: newData.metadata,
          audioUrl: newData.audioUrl,
          // Update origin to indicate replacement
          origin: { kind: "file", fileName: "(replaced)" },
        };

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [id]: updatedStem,
              },
            },
          },
          false,
          "replaceStem"
        );
      },

      // ----------------------------
      // Cloud Asset Operations
      // ----------------------------

      setCloudAssetId: (inputId, cloudAssetId) => {
        const { collection } = get();
        if (!collection) return;

        const input = collection.inputs[inputId];
        if (!input) return;

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [inputId]: {
                  ...input,
                  cloudAssetId,
                },
              },
            },
          },
          false,
          "setCloudAssetId"
        );
      },

      setAssetMetadata: (inputId, metadata) => {
        const { collection } = get();
        if (!collection) return;

        const input = collection.inputs[inputId];
        if (!input) return;

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [inputId]: {
                  ...input,
                  contentHash: metadata.contentHash ?? input.contentHash,
                  mimeType: metadata.mimeType ?? input.mimeType,
                  rawBuffer: metadata.rawBuffer ?? input.rawBuffer,
                },
              },
            },
          },
          false,
          "setAssetMetadata"
        );
      },

      clearRawBuffer: (inputId) => {
        const { collection } = get();
        if (!collection) return;

        const input = collection.inputs[inputId];
        if (!input) return;

        set(
          {
            collection: {
              ...collection,
              inputs: {
                ...collection.inputs,
                [inputId]: {
                  ...input,
                  rawBuffer: undefined,
                },
              },
            },
          },
          false,
          "clearRawBuffer"
        );
      },

      setCollection: (collection) => {
        set({ collection }, false, "setCollection");
      },

      // ----------------------------
      // AudioSource Operations
      // ----------------------------
      // Single source of truth for playback. WaveSurfer loads from here only.

      setCurrentAudioSource: (source) => {
        // Revoke previous blob URL if it was a local source
        const prev = get().currentAudioSource;
        if (prev?.type === "local" && prev.url) {
          URL.revokeObjectURL(prev.url);
        }

        set({ currentAudioSource: source }, false, "setCurrentAudioSource");
      },

      updateAudioSourceStatus: (status, url, error) => {
        const { currentAudioSource } = get();
        if (!currentAudioSource) return;

        set(
          {
            currentAudioSource: {
              ...currentAudioSource,
              status,
              url: url ?? currentAudioSource.url,
              error: error ?? currentAudioSource.error,
            },
          },
          false,
          "updateAudioSourceStatus"
        );
      },

      getCurrentAudioSource: () => {
        return get().currentAudioSource;
      },

      getCurrentAudioUrl: () => {
        const source = get().currentAudioSource;
        if (!source || source.status !== "ready") return null;
        return source.url ?? null;
      },

      // ----------------------------
      // Convenience Selectors (Legacy audioStore Compatibility)
      // ----------------------------

      getAudio: () => {
        const { collection } = get();
        return collection?.inputs[MIXDOWN_ID]?.audioBuffer ?? null;
      },

      getAudioSampleRate: () => {
        const { collection } = get();
        return collection?.inputs[MIXDOWN_ID]?.metadata?.sampleRate ?? null;
      },

      getAudioDuration: () => {
        const { collection } = get();
        return collection?.inputs[MIXDOWN_ID]?.metadata?.duration ?? 0;
      },

      getAudioTotalSamples: () => {
        const { collection } = get();
        return collection?.inputs[MIXDOWN_ID]?.metadata?.totalSamples ?? null;
      },

      getAudioFileName: () => {
        const { collection } = get();
        const mixdown = collection?.inputs[MIXDOWN_ID];
        if (!mixdown) return null;
        // Prefer label, fall back to origin fileName
        if (mixdown.label && mixdown.label !== "Mixdown") return mixdown.label;
        if (mixdown.origin.kind === "file") return mixdown.origin.fileName;
        if (mixdown.origin.kind === "url") return mixdown.origin.fileName ?? null;
        return mixdown.label;
      },

      getActiveDisplaySampleRate: () => {
        const { collection, activeDisplayId } = get();
        return collection?.inputs[activeDisplayId]?.metadata?.sampleRate ?? null;
      },

      setPendingFileName: (fileName: string | null) => {
        set({ pendingFileName: fileName }, false, "setPendingFileName");
      },
    }),
    { name: "audio-input-store" }
  )
);
