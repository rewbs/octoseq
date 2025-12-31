import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AudioBufferLike } from "@octoseq/mir";
import type {
  AudioInput,
  AudioInputCollection,
  AudioInputMetadata,
  AudioInputOrigin,
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
}

export type AudioInputStore = AudioInputState & AudioInputActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: AudioInputState = {
  collection: null,
  selectedInputId: null,
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
        const { collection } = get();

        if (!collection) {
          console.warn("Cannot add stem: no collection exists");
          return "";
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
    }),
    { name: "audio-input-store" }
  )
);
