import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// ----------------------------
// Tree Node IDs (Constants)
// ----------------------------

/** Well-known node IDs for the interpretation tree structure. */
export const TREE_NODE_IDS = {
  // Root nodes
  AUDIO: "audio",
  EVENT_STREAMS: "event-streams",
  SCRIPTS: "scripts",
  TEXT: "text",

  // Audio children
  MIXDOWN: "audio:mixdown",
  FREQUENCY_BANDS: "audio:mixdown:frequency-bands",
  STEMS: "audio:stems",

  // Event Streams children
  AUTHORED_EVENTS: "event-streams:authored",
  CANDIDATE_EVENTS: "event-streams:candidates",

  // Scripts children
  MAIN_SCRIPT: "scripts:main",
} as const;

// ----------------------------
// Constants
// ----------------------------

/** Minimum sidebar width in pixels. */
export const SIDEBAR_MIN_WIDTH = 40;
/** Width threshold below which icons-only mode is used. */
export const SIDEBAR_ICON_ONLY_THRESHOLD = 80;
/** Default sidebar width in pixels. */
export const SIDEBAR_DEFAULT_WIDTH = 256;
/** Maximum sidebar width in pixels. */
export const SIDEBAR_MAX_WIDTH = 400;

// ----------------------------
// Store State
// ----------------------------

interface InterpretationTreeState {
  /** Set of node IDs that are currently expanded. */
  expandedNodes: Set<string>;

  /** Currently selected node ID (for context display). */
  selectedNodeId: string | null;

  /** Sidebar width in pixels. */
  sidebarWidth: number;
}

// ----------------------------
// Store Actions
// ----------------------------

interface InterpretationTreeActions {
  /** Toggle the expanded state of a node. */
  toggleExpanded: (nodeId: string) => void;

  /** Set the expanded state of a node. */
  setExpanded: (nodeId: string, expanded: boolean) => void;

  /** Select a node (for context display). */
  selectNode: (nodeId: string | null) => void;

  /** Expand all nodes. */
  expandAll: () => void;

  /** Collapse all nodes. */
  collapseAll: () => void;

  /** Set sidebar width in pixels. */
  setSidebarWidth: (width: number) => void;

  /** Toggle between collapsed (icon-only) and expanded states. */
  toggleSidebar: () => void;

  /** Check if a node is expanded. */
  isExpanded: (nodeId: string) => boolean;

  /** Reset to initial state. */
  reset: () => void;
}

export type InterpretationTreeStore = InterpretationTreeState & InterpretationTreeActions;

// ----------------------------
// Initial State
// ----------------------------

/** Default expanded nodes - Audio and Scripts sections. */
const DEFAULT_EXPANDED_NODES = new Set([
  TREE_NODE_IDS.AUDIO,
  TREE_NODE_IDS.MIXDOWN,
  TREE_NODE_IDS.SCRIPTS,
]);

const initialState: InterpretationTreeState = {
  expandedNodes: DEFAULT_EXPANDED_NODES,
  selectedNodeId: null,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useInterpretationTreeStore = create<InterpretationTreeStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ----------------------------
        // Expansion
        // ----------------------------

        toggleExpanded: (nodeId) => {
          const { expandedNodes } = get();
          const newExpanded = new Set(expandedNodes);

          if (newExpanded.has(nodeId)) {
            newExpanded.delete(nodeId);
          } else {
            newExpanded.add(nodeId);
          }

          set({ expandedNodes: newExpanded }, false, "toggleExpanded");
        },

        setExpanded: (nodeId, expanded) => {
          const { expandedNodes } = get();
          const newExpanded = new Set(expandedNodes);

          if (expanded) {
            newExpanded.add(nodeId);
          } else {
            newExpanded.delete(nodeId);
          }

          set({ expandedNodes: newExpanded }, false, "setExpanded");
        },

        expandAll: () => {
          // Expand all known node IDs
          const allNodes = new Set(Object.values(TREE_NODE_IDS));
          set({ expandedNodes: allNodes }, false, "expandAll");
        },

        collapseAll: () => {
          set({ expandedNodes: new Set() }, false, "collapseAll");
        },

        isExpanded: (nodeId) => {
          return get().expandedNodes.has(nodeId);
        },

        // ----------------------------
        // Selection
        // ----------------------------

        selectNode: (nodeId) => {
          set({ selectedNodeId: nodeId }, false, "selectNode");
        },

        // ----------------------------
        // Sidebar
        // ----------------------------

        setSidebarWidth: (width) => {
          const clampedWidth = Math.max(
            SIDEBAR_MIN_WIDTH,
            Math.min(SIDEBAR_MAX_WIDTH, width)
          );
          set({ sidebarWidth: clampedWidth }, false, "setSidebarWidth");
        },

        toggleSidebar: () => {
          const { sidebarWidth } = get();
          // If currently narrow, expand to default; if expanded, collapse to min
          const newWidth =
            sidebarWidth <= SIDEBAR_ICON_ONLY_THRESHOLD
              ? SIDEBAR_DEFAULT_WIDTH
              : SIDEBAR_MIN_WIDTH;
          set({ sidebarWidth: newWidth }, false, "toggleSidebar");
        },

        // ----------------------------
        // Reset
        // ----------------------------

        reset: () => {
          set(initialState, false, "reset");
        },
      }),
      {
        name: "octoseq-interpretation-tree",
        // Custom serialization for Set
        storage: {
          getItem: (name) => {
            const str = localStorage.getItem(name);
            if (!str) return null;

            try {
              const parsed = JSON.parse(str);
              // Convert expandedNodes array back to Set
              if (parsed.state?.expandedNodes) {
                parsed.state.expandedNodes = new Set(parsed.state.expandedNodes);
              }
              return parsed;
            } catch {
              return null;
            }
          },
          setItem: (name, value) => {
            // Convert Set to array for JSON serialization
            // Only persist state fields, not actions
            const stateToStore = {
              expandedNodes: Array.from(value.state.expandedNodes || []),
              selectedNodeId: value.state.selectedNodeId,
              sidebarWidth: value.state.sidebarWidth,
            };
            const toStore = {
              ...value,
              state: stateToStore,
            };
            localStorage.setItem(name, JSON.stringify(toStore));
          },
          removeItem: (name) => localStorage.removeItem(name),
        },
      }
    ),
    { name: "interpretation-tree-store" }
  )
);
