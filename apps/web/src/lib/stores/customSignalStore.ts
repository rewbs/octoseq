import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  CustomSignalDefinition,
  CustomSignalResult,
  CustomSignalStructure,
  ReductionAlgorithmId,
  Source2DFunctionId,
  FrequencyRangeSpec,
  ReductionAlgorithmParams,
  StabilizationSettings,
  PolarityMode,
} from "./types/customSignal";
import {
  createEmptyCustomSignalStructure,
  getDefaultAlgorithmParams,
  getDefaultStabilizationSettings,
} from "./types/customSignal";

// ----------------------------
// Store State
// ----------------------------

interface CustomSignalState {
  /** The authoritative custom signal structure (null if none). */
  structure: CustomSignalStructure | null;

  /** Currently selected signal for editing. */
  selectedSignalId: string | null;

  /** Computed results cache (definitionId -> result). */
  resultCache: Map<string, CustomSignalResult>;

  /** Signal currently being computed. */
  computingSignalId: string | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface CustomSignalActions {
  // CRUD operations
  /** Add a new signal. Returns the new signal ID. */
  addSignal: (
    signal: Partial<Omit<CustomSignalDefinition, "id" | "createdAt" | "modifiedAt">>
  ) => string;

  /** Update an existing signal. */
  updateSignal: (id: string, updates: Partial<Omit<CustomSignalDefinition, "id">>) => void;

  /** Remove a signal by ID. */
  removeSignal: (id: string) => void;

  /** Enable or disable a signal. */
  setSignalEnabled: (id: string, enabled: boolean) => void;

  // Selection
  /** Select a signal for editing. */
  selectSignal: (id: string | null) => void;

  // Queries
  /** Get a signal by its ID. */
  getSignalById: (id: string) => CustomSignalDefinition | null;

  /** Get all enabled signals. */
  getEnabledSignals: () => CustomSignalDefinition[];

  /** Get a cached result for a signal. */
  getSignalResult: (id: string) => CustomSignalResult | null;

  /** Get all signals for a specific audio source. */
  getSignalsForSource: (sourceId: string) => CustomSignalDefinition[];

  // Computation
  /** Set the signal currently being computed. */
  setComputingSignal: (id: string | null) => void;

  /** Store a computed result in the cache. */
  setCachedResult: (id: string, result: CustomSignalResult) => void;

  /** Invalidate a cached result. */
  invalidateResult: (id: string) => void;

  /** Invalidate all cached results. */
  invalidateAllResults: () => void;

  // Structure management
  /** Clear all signals. */
  clearStructure: () => void;

  /** Ensure a structure exists (creates empty if none). */
  ensureStructure: () => void;

  // Project integration
  /** Load structure from project data. */
  loadFromProject: (structure: CustomSignalStructure | null) => void;

  /** Get the current structure for project serialization. */
  getStructureForProject: () => CustomSignalStructure | null;

  // Reset
  /** Full reset (called on new project). */
  reset: () => void;
}

// ----------------------------
// Initial State
// ----------------------------

const initialState: CustomSignalState = {
  structure: null,
  selectedSignalId: null,
  resultCache: new Map(),
  computingSignalId: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useCustomSignalStore = create<CustomSignalState & CustomSignalActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // CRUD Operations
      // ----------------------------

      addSignal: (partial) => {
        const now = new Date().toISOString();
        const id = nanoid();

        const signal: CustomSignalDefinition = {
          id,
          name: partial.name ?? "New Signal",
          sourceAudioId: partial.sourceAudioId ?? "mixdown",
          source2DFunction: partial.source2DFunction ?? "melSpectrogram",
          frequencyRange: partial.frequencyRange ?? { kind: "fullSpectrum" },
          reductionAlgorithm: partial.reductionAlgorithm ?? "mean",
          algorithmParams: partial.algorithmParams ?? getDefaultAlgorithmParams(partial.reductionAlgorithm ?? "mean"),
          polarityMode: partial.polarityMode ?? "signed", // Default: preserve polarity
          stabilization: partial.stabilization ?? getDefaultStabilizationSettings(),
          autoRecompute: partial.autoRecompute ?? true,
          enabled: partial.enabled ?? true,
          sortOrder: partial.sortOrder ?? (get().structure?.signals.length ?? 0),
          createdAt: now,
          modifiedAt: now,
        };

        set((state) => {
          // Ensure structure exists
          const structure = state.structure ?? createEmptyCustomSignalStructure();

          return {
            structure: {
              ...structure,
              signals: [...structure.signals, signal],
              modifiedAt: now,
            },
          };
        });

        return id;
      },

      updateSignal: (id, updates) => {
        const now = new Date().toISOString();

        set((state) => {
          if (!state.structure) return state;

          const signals = state.structure.signals.map((s) =>
            s.id === id ? { ...s, ...updates, modifiedAt: now } : s
          );

          // Invalidate cached result when definition changes
          const newCache = new Map(state.resultCache);
          newCache.delete(id);

          return {
            structure: {
              ...state.structure,
              signals,
              modifiedAt: now,
            },
            resultCache: newCache,
          };
        });
      },

      removeSignal: (id) => {
        const now = new Date().toISOString();

        set((state) => {
          if (!state.structure) return state;

          const signals = state.structure.signals.filter((s) => s.id !== id);
          const newCache = new Map(state.resultCache);
          newCache.delete(id);

          return {
            structure: {
              ...state.structure,
              signals,
              modifiedAt: now,
            },
            resultCache: newCache,
            selectedSignalId: state.selectedSignalId === id ? null : state.selectedSignalId,
          };
        });
      },

      setSignalEnabled: (id, enabled) => {
        get().updateSignal(id, { enabled });
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectSignal: (id) => {
        set({ selectedSignalId: id });
      },

      // ----------------------------
      // Queries
      // ----------------------------

      getSignalById: (id) => {
        const structure = get().structure;
        if (!structure) return null;
        return structure.signals.find((s) => s.id === id) ?? null;
      },

      getEnabledSignals: () => {
        const structure = get().structure;
        if (!structure) return [];
        return structure.signals
          .filter((s) => s.enabled)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      getSignalResult: (id) => {
        return get().resultCache.get(id) ?? null;
      },

      getSignalsForSource: (sourceId) => {
        const structure = get().structure;
        if (!structure) return [];
        return structure.signals
          .filter((s) => s.sourceAudioId === sourceId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      // ----------------------------
      // Computation
      // ----------------------------

      setComputingSignal: (id) => {
        set({ computingSignalId: id });
      },

      setCachedResult: (id, result) => {
        set((state) => {
          const newCache = new Map(state.resultCache);
          newCache.set(id, result);
          return { resultCache: newCache };
        });
      },

      invalidateResult: (id) => {
        set((state) => {
          const newCache = new Map(state.resultCache);
          newCache.delete(id);
          return { resultCache: newCache };
        });
      },

      invalidateAllResults: () => {
        set({ resultCache: new Map() });
      },

      // ----------------------------
      // Structure Management
      // ----------------------------

      clearStructure: () => {
        set({
          structure: null,
          selectedSignalId: null,
          resultCache: new Map(),
        });
      },

      ensureStructure: () => {
        set((state) => {
          if (state.structure) return state;
          return { structure: createEmptyCustomSignalStructure() };
        });
      },

      // ----------------------------
      // Project Integration
      // ----------------------------

      loadFromProject: (structure) => {
        set({
          structure,
          selectedSignalId: null,
          resultCache: new Map(), // Clear cache - will need recomputation
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
    { name: "customSignalStore" }
  )
);

// ----------------------------
// Selectors
// ----------------------------

/**
 * Get the count of custom signals.
 */
export function useCustomSignalCount(): number {
  return useCustomSignalStore((state) => state.structure?.signals.length ?? 0);
}

/**
 * Get all custom signals.
 */
export function useCustomSignals(): CustomSignalDefinition[] {
  return useCustomSignalStore((state) => state.structure?.signals ?? []);
}

/**
 * Get the selected signal.
 */
export function useSelectedCustomSignal(): CustomSignalDefinition | null {
  const selectedId = useCustomSignalStore((state) => state.selectedSignalId);
  const getSignalById = useCustomSignalStore((state) => state.getSignalById);
  return selectedId ? getSignalById(selectedId) : null;
}
