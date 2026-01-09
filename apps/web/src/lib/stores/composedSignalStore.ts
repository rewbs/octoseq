import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  ComposedSignalDefinition,
  ComposedSignalNode,
  ComposedSignalStructure,
  InterpolationType,
} from "./types/composedSignal";
import {
  COMPOSED_SIGNAL_SCHEMA_VERSION,
  DEFAULT_INTERPOLATION,
  DEFAULT_VALUE_MIN,
  DEFAULT_VALUE_MAX,
} from "./types/composedSignal";
import type { SubBeatDivision } from "./beatGridStore";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create an empty composed signal structure.
 */
export function createEmptyComposedSignalStructure(): ComposedSignalStructure {
  const now = new Date().toISOString();
  return {
    version: COMPOSED_SIGNAL_SCHEMA_VERSION,
    signals: [],
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Create a default composed signal definition.
 */
export function createDefaultComposedSignal(
  name: string = "New Signal"
): Omit<ComposedSignalDefinition, "id" | "createdAt" | "modifiedAt" | "sortOrder"> {
  return {
    name,
    domain: "beats",
    nodes: [],
    enabled: true,
    valueMin: DEFAULT_VALUE_MIN,
    valueMax: DEFAULT_VALUE_MAX,
  };
}

/**
 * Create a default node.
 */
export function createDefaultNode(
  time_beats: number,
  value: number = 0.5,
  interp_to_next: InterpolationType = DEFAULT_INTERPOLATION
): Omit<ComposedSignalNode, "id"> {
  return {
    time_beats,
    value,
    interp_to_next,
  };
}

// ============================================================================
// STORE STATE
// ============================================================================

interface ComposedSignalState {
  /** The authoritative composed signal structure (null if none). */
  structure: ComposedSignalStructure | null;

  /** Currently selected signal for editing. */
  selectedSignalId: string | null;

  /** Currently selected node IDs (for multi-select). */
  selectedNodeIds: Set<string>;

  /** Node currently being edited (for inline editing). */
  editingNodeId: string | null;

  /** Hovered node ID (for visual feedback). */
  hoveredNodeId: string | null;

  /** Whether snap-to-grid is enabled. */
  snapEnabled: boolean;

  /** Beat subdivision for snapping. */
  snapSubdivision: SubBeatDivision;
}

// ============================================================================
// STORE ACTIONS
// ============================================================================

interface ComposedSignalActions {
  // CRUD operations - Signals
  /** Add a new signal. Returns the new signal ID. */
  addSignal: (
    partial?: Partial<Omit<ComposedSignalDefinition, "id" | "createdAt" | "modifiedAt">>
  ) => string;

  /** Update an existing signal. */
  updateSignal: (
    id: string,
    updates: Partial<Omit<ComposedSignalDefinition, "id" | "createdAt" | "modifiedAt">>
  ) => void;

  /** Remove a signal by ID. */
  removeSignal: (id: string) => void;

  /** Enable or disable a signal. */
  setSignalEnabled: (id: string, enabled: boolean) => void;

  /** Duplicate a signal. Returns the new signal ID. */
  duplicateSignal: (id: string) => string | null;

  // CRUD operations - Nodes
  /** Add a node to a signal. Returns the new node ID. */
  addNode: (
    signalId: string,
    node: Omit<ComposedSignalNode, "id">
  ) => string | null;

  /** Update a node in a signal. */
  updateNode: (
    signalId: string,
    nodeId: string,
    updates: Partial<Omit<ComposedSignalNode, "id">>
  ) => void;

  /** Remove a node from a signal. */
  removeNode: (signalId: string, nodeId: string) => void;

  /** Remove multiple nodes from a signal. */
  removeNodes: (signalId: string, nodeIds: Set<string>) => void;

  /** Add multiple nodes at once. Returns array of new node IDs. */
  addNodesAtBeats: (
    signalId: string,
    beats: number[],
    value: number,
    interp: InterpolationType
  ) => string[];

  // Selection - Signals
  /** Select a signal for editing. */
  selectSignal: (id: string | null) => void;

  // Selection - Nodes
  /** Select a single node (clears previous selection). */
  selectNode: (nodeId: string) => void;

  /** Select multiple nodes. */
  selectNodes: (nodeIds: Set<string>) => void;

  /** Toggle a node's selection. */
  toggleNodeSelection: (nodeId: string) => void;

  /** Add nodes to selection (for shift-click). */
  addToNodeSelection: (nodeIds: Set<string>) => void;

  /** Clear node selection. */
  clearNodeSelection: () => void;

  /** Set editing node. */
  setEditingNode: (nodeId: string | null) => void;

  /** Set hovered node. */
  setHoveredNode: (nodeId: string | null) => void;

  // Snapping
  /** Set snap-to-grid enabled. */
  setSnapEnabled: (enabled: boolean) => void;

  /** Set snap subdivision. */
  setSnapSubdivision: (subdivision: SubBeatDivision) => void;

  // Queries
  /** Get a signal by its ID. */
  getSignalById: (id: string) => ComposedSignalDefinition | null;

  /** Get all enabled signals. */
  getEnabledSignals: () => ComposedSignalDefinition[];

  /** Get all signals. */
  getAllSignals: () => ComposedSignalDefinition[];

  /** Get selected nodes from current signal. */
  getSelectedNodes: () => ComposedSignalNode[];

  // Batch operations
  /** Scale selected nodes' values by a factor. */
  scaleSelectedNodes: (signalId: string, factor: number) => void;

  /** Offset selected nodes' values by a delta. */
  offsetSelectedNodes: (signalId: string, delta: number) => void;

  /** Set interpolation for selected nodes. */
  setSelectedNodesInterpolation: (
    signalId: string,
    interp: InterpolationType
  ) => void;

  // Structure management
  /** Clear all signals. */
  clearStructure: () => void;

  /** Ensure a structure exists (creates empty if none). */
  ensureStructure: () => void;

  // Project integration
  /** Load structure from project data. */
  loadFromProject: (structure: ComposedSignalStructure | null) => void;

  /** Get the current structure for project serialization. */
  getStructureForProject: () => ComposedSignalStructure | null;

  // Reset
  /** Full reset (called on new project). */
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: ComposedSignalState = {
  structure: null,
  selectedSignalId: null,
  selectedNodeIds: new Set(),
  editingNodeId: null,
  hoveredNodeId: null,
  snapEnabled: true,
  snapSubdivision: 4,
};

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useComposedSignalStore = create<
  ComposedSignalState & ComposedSignalActions
>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // CRUD Operations - Signals
      // ----------------------------

      addSignal: (partial) => {
        const now = new Date().toISOString();
        const id = nanoid();

        const defaults = createDefaultComposedSignal(partial?.name);
        const signal: ComposedSignalDefinition = {
          id,
          name: partial?.name ?? defaults.name,
          domain: "beats",
          nodes: partial?.nodes ?? defaults.nodes,
          enabled: partial?.enabled ?? defaults.enabled,
          sortOrder: partial?.sortOrder ?? (get().structure?.signals.length ?? 0),
          valueMin: partial?.valueMin ?? defaults.valueMin,
          valueMax: partial?.valueMax ?? defaults.valueMax,
          createdAt: now,
          modifiedAt: now,
        };

        set(
          (state) => {
            // Ensure structure exists
            const structure = state.structure ?? createEmptyComposedSignalStructure();
            return {
              structure: {
                ...structure,
                signals: [...structure.signals, signal],
                modifiedAt: now,
              },
              selectedSignalId: id,
            };
          },
          false,
          "addSignal"
        );

        return id;
      },

      updateSignal: (id, updates) => {
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === id
            );
            if (signalIndex === -1) return state;

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...updatedSignals[signalIndex]!,
              ...updates,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "updateSignal"
        );
      },

      removeSignal: (id) => {
        set(
          (state) => {
            if (!state.structure) return state;

            const updatedSignals = state.structure.signals.filter(
              (s) => s.id !== id
            );

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: new Date().toISOString(),
              },
              selectedSignalId:
                state.selectedSignalId === id ? null : state.selectedSignalId,
              selectedNodeIds: new Set(),
            };
          },
          false,
          "removeSignal"
        );
      },

      setSignalEnabled: (id, enabled) => {
        get().updateSignal(id, { enabled });
      },

      duplicateSignal: (id) => {
        const original = get().getSignalById(id);
        if (!original) return null;

        return get().addSignal({
          name: `${original.name} (copy)`,
          domain: original.domain,
          nodes: original.nodes.map((n) => ({ ...n, id: nanoid() })),
          enabled: original.enabled,
          valueMin: original.valueMin,
          valueMax: original.valueMax,
        });
      },

      // ----------------------------
      // CRUD Operations - Nodes
      // ----------------------------

      addNode: (signalId, node) => {
        const nodeId = nanoid();
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const newNode: ComposedSignalNode = { ...node, id: nodeId };
            const updatedNodes = [...signal.nodes, newNode].sort(
              (a, b) => a.time_beats - b.time_beats
            );

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "addNode"
        );

        return nodeId;
      },

      updateNode: (signalId, nodeId, updates) => {
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const nodeIndex = signal.nodes.findIndex((n) => n.id === nodeId);
            if (nodeIndex === -1) return state;

            const updatedNodes = [...signal.nodes];
            updatedNodes[nodeIndex] = {
              ...updatedNodes[nodeIndex]!,
              ...updates,
            };

            // Re-sort if time changed
            if (updates.time_beats !== undefined) {
              updatedNodes.sort((a, b) => a.time_beats - b.time_beats);
            }

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "updateNode"
        );
      },

      removeNode: (signalId, nodeId) => {
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const updatedNodes = signal.nodes.filter((n) => n.id !== nodeId);

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            // Remove from selection
            const newSelection = new Set(state.selectedNodeIds);
            newSelection.delete(nodeId);

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
              selectedNodeIds: newSelection,
            };
          },
          false,
          "removeNode"
        );
      },

      removeNodes: (signalId, nodeIds) => {
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const updatedNodes = signal.nodes.filter(
              (n) => !nodeIds.has(n.id)
            );

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            // Remove from selection
            const newSelection = new Set(state.selectedNodeIds);
            for (const nodeId of nodeIds) {
              newSelection.delete(nodeId);
            }

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
              selectedNodeIds: newSelection,
            };
          },
          false,
          "removeNodes"
        );
      },

      addNodesAtBeats: (signalId, beats, value, interp) => {
        const nodeIds: string[] = [];
        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const newNodes: ComposedSignalNode[] = beats.map((beat) => {
              const id = nanoid();
              nodeIds.push(id);
              return {
                id,
                time_beats: beat,
                value,
                interp_to_next: interp,
              };
            });

            const updatedNodes = [...signal.nodes, ...newNodes].sort(
              (a, b) => a.time_beats - b.time_beats
            );

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "addNodesAtBeats"
        );

        return nodeIds;
      },

      // ----------------------------
      // Selection - Signals
      // ----------------------------

      selectSignal: (id) => {
        set(
          { selectedSignalId: id, selectedNodeIds: new Set() },
          false,
          "selectSignal"
        );
      },

      // ----------------------------
      // Selection - Nodes
      // ----------------------------

      selectNode: (nodeId) => {
        set({ selectedNodeIds: new Set([nodeId]) }, false, "selectNode");
      },

      selectNodes: (nodeIds) => {
        set({ selectedNodeIds: nodeIds }, false, "selectNodes");
      },

      toggleNodeSelection: (nodeId) => {
        set(
          (state) => {
            const newSelection = new Set(state.selectedNodeIds);
            if (newSelection.has(nodeId)) {
              newSelection.delete(nodeId);
            } else {
              newSelection.add(nodeId);
            }
            return { selectedNodeIds: newSelection };
          },
          false,
          "toggleNodeSelection"
        );
      },

      addToNodeSelection: (nodeIds) => {
        set(
          (state) => {
            const newSelection = new Set(state.selectedNodeIds);
            for (const nodeId of nodeIds) {
              newSelection.add(nodeId);
            }
            return { selectedNodeIds: newSelection };
          },
          false,
          "addToNodeSelection"
        );
      },

      clearNodeSelection: () => {
        set({ selectedNodeIds: new Set() }, false, "clearNodeSelection");
      },

      setEditingNode: (nodeId) => {
        set({ editingNodeId: nodeId }, false, "setEditingNode");
      },

      setHoveredNode: (nodeId) => {
        set({ hoveredNodeId: nodeId }, false, "setHoveredNode");
      },

      // ----------------------------
      // Snapping
      // ----------------------------

      setSnapEnabled: (enabled) => {
        set({ snapEnabled: enabled }, false, "setSnapEnabled");
      },

      setSnapSubdivision: (subdivision) => {
        set({ snapSubdivision: subdivision }, false, "setSnapSubdivision");
      },

      // ----------------------------
      // Queries
      // ----------------------------

      getSignalById: (id) => {
        const { structure } = get();
        if (!structure) return null;
        return structure.signals.find((s) => s.id === id) ?? null;
      },

      getEnabledSignals: () => {
        const { structure } = get();
        if (!structure) return [];
        return structure.signals.filter((s) => s.enabled);
      },

      getAllSignals: () => {
        const { structure } = get();
        if (!structure) return [];
        return structure.signals;
      },

      getSelectedNodes: () => {
        const { structure, selectedSignalId, selectedNodeIds } = get();
        if (!structure || !selectedSignalId) return [];

        const signal = structure.signals.find((s) => s.id === selectedSignalId);
        if (!signal) return [];

        return signal.nodes.filter((n) => selectedNodeIds.has(n.id));
      },

      // ----------------------------
      // Batch Operations
      // ----------------------------

      scaleSelectedNodes: (signalId, factor) => {
        const { selectedNodeIds } = get();
        if (selectedNodeIds.size === 0) return;

        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const updatedNodes = signal.nodes.map((node) => {
              if (!selectedNodeIds.has(node.id)) return node;
              return {
                ...node,
                value: Math.max(0, Math.min(1, node.value * factor)),
              };
            });

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "scaleSelectedNodes"
        );
      },

      offsetSelectedNodes: (signalId, delta) => {
        const { selectedNodeIds } = get();
        if (selectedNodeIds.size === 0) return;

        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const updatedNodes = signal.nodes.map((node) => {
              if (!selectedNodeIds.has(node.id)) return node;
              return {
                ...node,
                value: Math.max(0, Math.min(1, node.value + delta)),
              };
            });

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "offsetSelectedNodes"
        );
      },

      setSelectedNodesInterpolation: (signalId, interp) => {
        const { selectedNodeIds } = get();
        if (selectedNodeIds.size === 0) return;

        const now = new Date().toISOString();

        set(
          (state) => {
            if (!state.structure) return state;

            const signalIndex = state.structure.signals.findIndex(
              (s) => s.id === signalId
            );
            if (signalIndex === -1) return state;

            const signal = state.structure.signals[signalIndex]!;
            const updatedNodes = signal.nodes.map((node) => {
              if (!selectedNodeIds.has(node.id)) return node;
              return {
                ...node,
                interp_to_next: interp,
              };
            });

            const updatedSignals = [...state.structure.signals];
            updatedSignals[signalIndex] = {
              ...signal,
              nodes: updatedNodes,
              modifiedAt: now,
            };

            return {
              structure: {
                ...state.structure,
                signals: updatedSignals,
                modifiedAt: now,
              },
            };
          },
          false,
          "setSelectedNodesInterpolation"
        );
      },

      // ----------------------------
      // Structure Management
      // ----------------------------

      clearStructure: () => {
        set(
          {
            structure: null,
            selectedSignalId: null,
            selectedNodeIds: new Set(),
          },
          false,
          "clearStructure"
        );
      },

      ensureStructure: () => {
        set(
          (state) => {
            if (state.structure) return state;
            return { structure: createEmptyComposedSignalStructure() };
          },
          false,
          "ensureStructure"
        );
      },

      // ----------------------------
      // Project Integration
      // ----------------------------

      loadFromProject: (structure) => {
        set(
          {
            structure,
            selectedSignalId: null,
            selectedNodeIds: new Set(),
          },
          false,
          "loadFromProject"
        );
      },

      getStructureForProject: () => {
        return get().structure;
      },

      // ----------------------------
      // Reset
      // ----------------------------

      reset: () => {
        set(initialState, false, "reset");
      },
    }),
    { name: "composedSignal" }
  )
);
