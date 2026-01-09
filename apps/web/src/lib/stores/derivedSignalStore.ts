import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  DerivedSignalDefinition,
  DerivedSignalResult,
  DerivedSignalStructure,
  DerivedSignalSource,
  TransformChain,
  StabilizationSettings,
  DerivedSignalStatus,
} from "./types/derivedSignal";
import {
  createEmptyDerivedSignalStructure,
  getDefaultStabilizationSettings,
  createDefault2DSignal,
} from "./types/derivedSignal";

// ============================================================================
// DEPENDENCY GRAPH
// ============================================================================

/**
 * Dependency graph for tracking signal dependencies.
 * Used for cascade invalidation and cycle detection.
 */
class DependencyGraph {
  /** Map of signal ID -> IDs of signals this depends on */
  private dependsOn: Map<string, Set<string>> = new Map();
  /** Map of signal ID -> IDs of signals that depend on this */
  private dependedBy: Map<string, Set<string>> = new Map();

  /**
   * Add a signal to the graph, extracting its dependencies.
   */
  addSignal(def: DerivedSignalDefinition): void {
    const deps = this.extractDependencies(def.source);
    this.dependsOn.set(def.id, deps);

    // Update reverse dependencies
    for (const depId of deps) {
      if (!this.dependedBy.has(depId)) {
        this.dependedBy.set(depId, new Set());
      }
      this.dependedBy.get(depId)!.add(def.id);
    }
  }

  /**
   * Remove a signal from the graph.
   */
  removeSignal(id: string): void {
    // Remove from dependsOn
    const deps = this.dependsOn.get(id);
    if (deps) {
      for (const depId of deps) {
        this.dependedBy.get(depId)?.delete(id);
      }
    }
    this.dependsOn.delete(id);

    // Remove from dependedBy
    const dependents = this.dependedBy.get(id);
    if (dependents) {
      for (const depId of dependents) {
        this.dependsOn.get(depId)?.delete(id);
      }
    }
    this.dependedBy.delete(id);
  }

  /**
   * Update a signal's dependencies.
   */
  updateSignal(def: DerivedSignalDefinition): void {
    this.removeSignal(def.id);
    this.addSignal(def);
  }

  /**
   * Get all signals that depend on this signal (direct and transitive).
   * Used for cascade invalidation.
   */
  getInvalidationCascade(changedSignalId: string): string[] {
    const toInvalidate = new Set<string>();
    const queue = [changedSignalId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.dependedBy.get(current);
      if (dependents) {
        for (const depId of dependents) {
          if (!toInvalidate.has(depId)) {
            toInvalidate.add(depId);
            queue.push(depId);
          }
        }
      }
    }

    return Array.from(toInvalidate);
  }

  /**
   * Check if adding a dependency from newSignalId to sourceSignalId would create a cycle.
   */
  wouldCreateCycle(newSignalId: string, sourceSignalId: string): boolean {
    // If the source is not a derived signal, no cycle possible
    if (!this.dependsOn.has(sourceSignalId)) {
      return false;
    }

    // BFS from sourceSignalId to see if we can reach newSignalId
    const visited = new Set<string>();
    const queue = [sourceSignalId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === newSignalId) {
        return true; // Cycle detected
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const deps = this.dependsOn.get(current);
      if (deps) {
        for (const depId of deps) {
          queue.push(depId);
        }
      }
    }

    return false;
  }

  /**
   * Get the topological order for computing signals.
   * Returns null if there's a cycle (shouldn't happen if wouldCreateCycle is used).
   */
  getComputationOrder(): string[] | null {
    const inDegree = new Map<string, number>();
    const result: string[] = [];

    // Initialize in-degrees
    for (const id of this.dependsOn.keys()) {
      inDegree.set(id, this.dependsOn.get(id)?.size ?? 0);
    }

    // Find all nodes with no dependencies
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const dependents = this.dependedBy.get(current);
      if (dependents) {
        for (const depId of dependents) {
          const newDegree = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDegree);
          if (newDegree === 0) {
            queue.push(depId);
          }
        }
      }
    }

    // If result doesn't include all nodes, there's a cycle
    if (result.length !== this.dependsOn.size) {
      return null;
    }

    return result;
  }

  /**
   * Clear the graph.
   */
  clear(): void {
    this.dependsOn.clear();
    this.dependedBy.clear();
  }

  /**
   * Rebuild the graph from a list of definitions.
   */
  rebuild(definitions: DerivedSignalDefinition[]): void {
    this.clear();
    for (const def of definitions) {
      this.addSignal(def);
    }
  }

  /**
   * Extract dependency IDs from a source specification.
   */
  private extractDependencies(source: DerivedSignalSource): Set<string> {
    const deps = new Set<string>();

    if (source.kind === "1d" && source.signalRef.type === "derived") {
      deps.add(source.signalRef.signalId);
    }

    return deps;
  }
}

// ============================================================================
// STORE STATE
// ============================================================================

interface DerivedSignalState {
  /** The authoritative derived signal structure (null if none). */
  structure: DerivedSignalStructure | null;

  /** Currently selected signal for editing. */
  selectedSignalId: string | null;

  /** Computed results cache (definitionId -> result). */
  resultCache: Map<string, DerivedSignalResult>;

  /** Signal currently being computed. */
  computingSignalId: string | null;

  /** Dependency graph for signal chaining. */
  dependencyGraph: DependencyGraph;
}

// ============================================================================
// STORE ACTIONS
// ============================================================================

interface DerivedSignalActions {
  // CRUD operations
  /** Add a new signal. Returns the new signal ID, or null if would create cycle. */
  addSignal: (
    signal: Partial<Omit<DerivedSignalDefinition, "id" | "createdAt" | "modifiedAt">>
  ) => string | null;

  /** Update an existing signal. Returns false if would create cycle. */
  updateSignal: (
    id: string,
    updates: Partial<Omit<DerivedSignalDefinition, "id">>
  ) => boolean;

  /** Remove a signal by ID. */
  removeSignal: (id: string) => void;

  /** Enable or disable a signal. */
  setSignalEnabled: (id: string, enabled: boolean) => void;

  // Selection
  /** Select a signal for editing. */
  selectSignal: (id: string | null) => void;

  // Queries
  /** Get a signal by its ID. */
  getSignalById: (id: string) => DerivedSignalDefinition | null;

  /** Get all enabled signals. */
  getEnabledSignals: () => DerivedSignalDefinition[];

  /** Get all signals. */
  getAllSignals: () => DerivedSignalDefinition[];

  /** Get a cached result for a signal. */
  getSignalResult: (id: string) => DerivedSignalResult | null;

  /** Check if adding a dependency would create a cycle. */
  wouldCreateCycle: (signalId: string, sourceSignalId: string) => boolean;

  /** Get the computation order for signals (topological sort). */
  getComputationOrder: () => string[] | null;

  // Computation
  /** Set the signal currently being computed. */
  setComputingSignal: (id: string | null) => void;

  /** Store a computed result in the cache. */
  setCachedResult: (id: string, result: DerivedSignalResult) => void;

  /** Update result status without replacing the result. */
  setResultStatus: (id: string, status: DerivedSignalStatus) => void;

  /** Invalidate a cached result. */
  invalidateResult: (id: string) => void;

  /** Invalidate a result and all its dependents. */
  invalidateResultWithCascade: (id: string) => void;

  /** Invalidate all cached results. */
  invalidateAllResults: () => void;

  // Structure management
  /** Clear all signals. */
  clearStructure: () => void;

  /** Ensure a structure exists (creates empty if none). */
  ensureStructure: () => void;

  // Project integration
  /** Load structure from project data. */
  loadFromProject: (structure: DerivedSignalStructure | null) => void;

  /** Get the current structure for project serialization. */
  getStructureForProject: () => DerivedSignalStructure | null;

  // Reset
  /** Full reset (called on new project). */
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: DerivedSignalState = {
  structure: null,
  selectedSignalId: null,
  resultCache: new Map(),
  computingSignalId: null,
  dependencyGraph: new DependencyGraph(),
};

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useDerivedSignalStore = create<DerivedSignalState & DerivedSignalActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // CRUD Operations
      // ----------------------------

      addSignal: (partial) => {
        const now = new Date().toISOString();
        const id = nanoid();

        // Build the signal definition
        const defaults = createDefault2DSignal();
        const signal: DerivedSignalDefinition = {
          id,
          name: partial.name ?? defaults.name,
          source: partial.source ?? defaults.source,
          transforms: partial.transforms ?? defaults.transforms,
          stabilization: partial.stabilization ?? defaults.stabilization,
          autoRecompute: partial.autoRecompute ?? defaults.autoRecompute,
          enabled: partial.enabled ?? defaults.enabled,
          sortOrder: partial.sortOrder ?? (get().structure?.signals.length ?? 0),
          createdAt: now,
          modifiedAt: now,
        };

        // Check for cycles if this references another derived signal
        if (
          signal.source.kind === "1d" &&
          signal.source.signalRef.type === "derived"
        ) {
          const sourceId = signal.source.signalRef.signalId;
          if (get().dependencyGraph.wouldCreateCycle(id, sourceId)) {
            console.warn(
              `Cannot add signal "${signal.name}": would create circular dependency with "${sourceId}"`
            );
            return null;
          }
        }

        set((state) => {
          // Ensure structure exists
          const structure = state.structure ?? createEmptyDerivedSignalStructure();

          // Add to dependency graph
          state.dependencyGraph.addSignal(signal);

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
        const state = get();
        const existingSignal = state.getSignalById(id);

        if (!existingSignal) {
          return false;
        }

        // Build updated signal
        const updatedSignal: DerivedSignalDefinition = {
          ...existingSignal,
          ...updates,
          id, // Ensure ID is preserved
          modifiedAt: now,
        };

        // Check for cycles if source changed to reference another derived signal
        if (
          updatedSignal.source.kind === "1d" &&
          updatedSignal.source.signalRef.type === "derived"
        ) {
          const sourceId = updatedSignal.source.signalRef.signalId;
          // Temporarily remove this signal from graph to check
          state.dependencyGraph.removeSignal(id);
          const wouldCycle = state.dependencyGraph.wouldCreateCycle(id, sourceId);
          // Re-add the original signal
          state.dependencyGraph.addSignal(existingSignal);

          if (wouldCycle) {
            console.warn(
              `Cannot update signal "${updatedSignal.name}": would create circular dependency with "${sourceId}"`
            );
            return false;
          }
        }

        set((state) => {
          if (!state.structure) return state;

          const signals = state.structure.signals.map((s) =>
            s.id === id ? updatedSignal : s
          );

          // Update dependency graph
          state.dependencyGraph.updateSignal(updatedSignal);

          // Invalidate this result and all dependents
          const toInvalidate = [id, ...state.dependencyGraph.getInvalidationCascade(id)];
          const newCache = new Map(state.resultCache);
          for (const invalidId of toInvalidate) {
            newCache.delete(invalidId);
          }

          return {
            structure: {
              ...state.structure,
              signals,
              modifiedAt: now,
            },
            resultCache: newCache,
          };
        });

        return true;
      },

      removeSignal: (id) => {
        const now = new Date().toISOString();

        set((state) => {
          if (!state.structure) return state;

          // Get signals that depend on this one (they'll become invalid)
          const dependents = state.dependencyGraph.getInvalidationCascade(id);

          // Remove from graph
          state.dependencyGraph.removeSignal(id);

          const signals = state.structure.signals.filter((s) => s.id !== id);
          const newCache = new Map(state.resultCache);
          newCache.delete(id);

          // Also invalidate dependents
          for (const depId of dependents) {
            newCache.delete(depId);
          }

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

      getAllSignals: () => {
        const structure = get().structure;
        if (!structure) return [];
        return structure.signals.sort((a, b) => a.sortOrder - b.sortOrder);
      },

      getSignalResult: (id) => {
        return get().resultCache.get(id) ?? null;
      },

      wouldCreateCycle: (signalId, sourceSignalId) => {
        return get().dependencyGraph.wouldCreateCycle(signalId, sourceSignalId);
      },

      getComputationOrder: () => {
        return get().dependencyGraph.getComputationOrder();
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

      setResultStatus: (id, status) => {
        set((state) => {
          const existing = state.resultCache.get(id);
          if (!existing) return state;

          const newCache = new Map(state.resultCache);
          newCache.set(id, { ...existing, status });
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

      invalidateResultWithCascade: (id) => {
        set((state) => {
          const toInvalidate = [id, ...state.dependencyGraph.getInvalidationCascade(id)];
          const newCache = new Map(state.resultCache);
          for (const invalidId of toInvalidate) {
            newCache.delete(invalidId);
          }
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
        get().dependencyGraph.clear();
        set({
          structure: null,
          selectedSignalId: null,
          resultCache: new Map(),
        });
      },

      ensureStructure: () => {
        set((state) => {
          if (state.structure) return state;
          return { structure: createEmptyDerivedSignalStructure() };
        });
      },

      // ----------------------------
      // Project Integration
      // ----------------------------

      loadFromProject: (structure) => {
        const graph = get().dependencyGraph;
        graph.clear();

        if (structure) {
          graph.rebuild(structure.signals);
        }

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
        get().dependencyGraph.clear();
        set({
          ...initialState,
          dependencyGraph: new DependencyGraph(),
        });
      },
    }),
    { name: "derivedSignalStore" }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

// Stable empty array to avoid re-render loops when structure is null
const EMPTY_SIGNALS: DerivedSignalDefinition[] = [];

/**
 * Get the count of derived signals.
 */
export function useDerivedSignalCount(): number {
  return useDerivedSignalStore((state) => state.structure?.signals.length ?? 0);
}

/**
 * Get all derived signals.
 */
export function useDerivedSignals(): DerivedSignalDefinition[] {
  return useDerivedSignalStore((state) => state.structure?.signals ?? EMPTY_SIGNALS);
}

/**
 * Get the selected signal.
 */
export function useSelectedDerivedSignal(): DerivedSignalDefinition | null {
  const selectedId = useDerivedSignalStore((state) => state.selectedSignalId);
  const getSignalById = useDerivedSignalStore((state) => state.getSignalById);
  return selectedId ? getSignalById(selectedId) : null;
}

/**
 * Get the result cache for a specific signal.
 */
export function useDerivedSignalResult(id: string): DerivedSignalResult | null {
  return useDerivedSignalStore((state) => state.resultCache.get(id) ?? null);
}

/**
 * Get whether a specific signal is currently being computed.
 */
export function useIsComputingSignal(id: string): boolean {
  return useDerivedSignalStore((state) => state.computingSignalId === id);
}
