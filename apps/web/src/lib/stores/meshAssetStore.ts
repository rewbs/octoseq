import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import type { MeshAsset, MeshAssetStructure } from "./types/meshAsset";
import { createEmptyMeshAssetStructure, parseObjMetadata } from "./types/meshAsset";

// ----------------------------
// Store State
// ----------------------------

interface MeshAssetState {
  /** The authoritative mesh asset structure (null if none). */
  structure: MeshAssetStructure | null;

  /** Currently selected asset ID for preview. */
  selectedAssetId: string | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface MeshAssetActions {
  // CRUD operations
  /** Add a new mesh asset from file content. Returns the new asset ID. */
  addAsset: (
    fileName: string,
    objContent: string,
    options?: {
      name?: string;
      rawBytes?: ArrayBuffer;
      mimeType?: string;
      contentHash?: string;
    }
  ) => string;

  /** Update the cloud asset ID for an asset after upload completes. */
  setCloudAssetId: (id: string, cloudAssetId: string) => void;

  /** Clear the rawBytes after upload completes to free memory. */
  clearRawBytes: (id: string) => void;

  /** Update an existing asset's name. */
  renameAsset: (id: string, name: string) => void;

  /** Remove an asset by ID. */
  removeAsset: (id: string) => void;

  // Selection
  /** Select an asset for preview. */
  selectAsset: (id: string | null) => void;

  // Queries
  /** Get an asset by its ID. */
  getAssetById: (id: string) => MeshAsset | null;

  /** Get all assets. */
  getAllAssets: () => MeshAsset[];

  // Structure management
  /** Clear all assets. */
  clearStructure: () => void;

  /** Ensure a structure exists (creates empty if none). */
  ensureStructure: () => void;

  // Project integration
  /** Load structure from project data. */
  loadFromProject: (structure: MeshAssetStructure | null) => void;

  /** Get the current structure for project serialization. */
  getStructureForProject: () => MeshAssetStructure | null;

  // Reset
  /** Full reset (called on new project). */
  reset: () => void;
}

// ----------------------------
// Initial State
// ----------------------------

const initialState: MeshAssetState = {
  structure: null,
  selectedAssetId: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useMeshAssetStore = create<MeshAssetState & MeshAssetActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // CRUD Operations
      // ----------------------------

      addAsset: (fileName, objContent, options) => {
        const now = new Date().toISOString();
        const id = nanoid();
        const metadata = parseObjMetadata(objContent);

        // Generate display name from file name if not provided
        const displayName = options?.name ?? fileName.replace(/\.obj$/i, "");

        const asset: MeshAsset = {
          id,
          name: displayName,
          fileName,
          objContent,
          vertexCount: metadata.vertexCount,
          faceCount: metadata.faceCount,
          createdAt: now,
          rawBytes: options?.rawBytes,
          mimeType: options?.mimeType,
          contentHash: options?.contentHash,
        };

        set((state) => {
          // Ensure structure exists
          const structure = state.structure ?? createEmptyMeshAssetStructure();

          return {
            structure: {
              ...structure,
              assets: [...structure.assets, asset],
              modifiedAt: now,
            },
            selectedAssetId: id, // Auto-select the newly added asset
          };
        });

        return id;
      },

      setCloudAssetId: (id, cloudAssetId) => {
        set((state) => {
          if (!state.structure) return state;

          const assets = state.structure.assets.map((a) =>
            a.id === id ? { ...a, cloudAssetId } : a
          );

          return {
            structure: {
              ...state.structure,
              assets,
            },
          };
        });
      },

      clearRawBytes: (id) => {
        set((state) => {
          if (!state.structure) return state;

          const assets = state.structure.assets.map((a) =>
            a.id === id ? { ...a, rawBytes: undefined } : a
          );

          return {
            structure: {
              ...state.structure,
              assets,
            },
          };
        });
      },

      renameAsset: (id, name) => {
        const now = new Date().toISOString();

        set((state) => {
          if (!state.structure) return state;

          const assets = state.structure.assets.map((a) =>
            a.id === id ? { ...a, name } : a
          );

          return {
            structure: {
              ...state.structure,
              assets,
              modifiedAt: now,
            },
          };
        });
      },

      removeAsset: (id) => {
        const now = new Date().toISOString();

        set((state) => {
          if (!state.structure) return state;

          const assets = state.structure.assets.filter((a) => a.id !== id);

          return {
            structure: {
              ...state.structure,
              assets,
              modifiedAt: now,
            },
            selectedAssetId: state.selectedAssetId === id ? null : state.selectedAssetId,
          };
        });
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectAsset: (id) => {
        set({ selectedAssetId: id });
      },

      // ----------------------------
      // Queries
      // ----------------------------

      getAssetById: (id) => {
        const structure = get().structure;
        if (!structure) return null;
        return structure.assets.find((a) => a.id === id) ?? null;
      },

      getAllAssets: () => {
        const structure = get().structure;
        if (!structure) return [];
        return structure.assets;
      },

      // ----------------------------
      // Structure Management
      // ----------------------------

      clearStructure: () => {
        set({
          structure: null,
          selectedAssetId: null,
        });
      },

      ensureStructure: () => {
        set((state) => {
          if (state.structure) return state;
          return { structure: createEmptyMeshAssetStructure() };
        });
      },

      // ----------------------------
      // Project Integration
      // ----------------------------

      loadFromProject: (structure) => {
        set({
          structure,
          selectedAssetId: null,
        });
      },

      getStructureForProject: () => {
        return get().structure;
      },

      // ----------------------------
      // Reset
      // ----------------------------

      reset: () => {
        set(initialState);
      },
    }),
    { name: "meshAssetStore" }
  )
);

// ----------------------------
// Selectors
// ----------------------------

/**
 * Get the count of mesh assets.
 */
export function useMeshAssetCount(): number {
  return useMeshAssetStore((state) => state.structure?.assets.length ?? 0);
}

/**
 * Get all mesh assets.
 */
export function useMeshAssets(): MeshAsset[] {
  return useMeshAssetStore(useShallow((state) => state.structure?.assets ?? []))
}

/**
 * Get the selected mesh asset.
 */
export function useSelectedMeshAsset(): MeshAsset | null {
  return useMeshAssetStore((state) => {
    if (!state.selectedAssetId || !state.structure) return null;
    return state.structure.assets.find((a) => a.id === state.selectedAssetId) ?? null;
  });
}
