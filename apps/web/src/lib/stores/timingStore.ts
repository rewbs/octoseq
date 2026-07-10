import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  TempoHypothesis,
  TempoHypothesisEvidence,
  BeatGrid,
  BeatPosition,
  MusicalTimeSegment,
  MusicalTimeStructure,
  PhaseHypothesis,
  PhaseAlignmentConfig,
} from "@octoseq/mir";
import {
  computeBeatPositionFromStructure,
  createMusicalTimeStructure,
  createSegmentFromGrid,
  generateSegmentId,
  sortSegments,
  splitSegment as splitSegmentUtil,
  validateSegments,
} from "@octoseq/mir";

/**
 * Unified project timing store (Phase 1 stream-model migration).
 *
 * Merger of the three legacy timing stores:
 * 1. Beat grid — tempo hypothesis candidates/selection (was beatGridStore)
 * 2. Musical time — authoritative musical time structure (was musicalTimeStore)
 * 3. Manual tempo — manual hypotheses, tap tempo, beat marking (was manualTempoStore)
 *
 * Action names/semantics are unchanged except for the one collision:
 * beatGridStore.clear -> clearBeatGrid, manualTempoStore.clear -> clearManualTempo.
 */

// ============================================================
// Section 1: Beat grid (tempo hypothesis candidates/selection)
// ============================================================

/** Available sub-beat division options */
export type SubBeatDivision = 1 | 2 | 3 | 4 | 6 | 8 | 9 | 12 | 16;

/** Sub-beat division options with labels for dropdown */
export const SUB_BEAT_DIVISIONS: Array<{ value: SubBeatDivision; label: string }> = [
  { value: 1, label: "None" },
  { value: 2, label: "1/2" },
  { value: 3, label: "1/3" },
  { value: 4, label: "1/4" },
  { value: 6, label: "1/6" },
  { value: 8, label: "1/8" },
  { value: 9, label: "1/9" },
  { value: 12, label: "1/12" },
  { value: 16, label: "1/16" },
];

interface BeatGridState {
  /** Currently selected tempo hypothesis (null if none selected). */
  selectedHypothesis: TempoHypothesis | null;

  /** Computed phase hypotheses for the selected tempo. */
  phaseHypotheses: PhaseHypothesis[];

  /** Index of the active phase hypothesis (0 = best match). */
  activePhaseIndex: number;

  /** The active beat grid (derived from hypothesis + phase + nudge). */
  activeBeatGrid: BeatGrid | null;

  /** User nudge offset in seconds (applied on top of phase offset). */
  userNudge: number;

  /** Whether the beat grid is locked (prevents auto-updates on reanalysis). */
  isLocked: boolean;

  /** Whether beat grid overlay is visible. */
  isVisible: boolean;

  /** Whether metronome click is enabled during playback. */
  metronomeEnabled: boolean;

  /** Configuration for phase alignment algorithm. */
  config: Required<PhaseAlignmentConfig>;

  /** IDs of hypotheses to display as candidate grids (in addition to active). */
  visibleHypothesisIds: Set<string>;

  /** Sub-beat division (1 = no sub-beats, 2 = half beats, etc.). */
  subBeatDivision: SubBeatDivision;
}

interface BeatGridActions {
  /** Select a tempo hypothesis and reset phase state. */
  selectHypothesis: (hypothesis: TempoHypothesis | null) => void;

  /**
   * Update the BPM of the currently selected hypothesis in-place.
   * Preserves userNudge and isLocked state, but triggers phase recalculation.
   * This is used for editing manual/edited hypotheses without resetting state.
   */
  updateSelectedBpm: (hypothesis: TempoHypothesis) => void;

  /** Set the computed phase hypotheses (called after computation). */
  setPhaseHypotheses: (phases: PhaseHypothesis[]) => void;

  /** Cycle to the next/previous phase hypothesis. */
  cyclePhase: (direction: 1 | -1) => void;

  /** Set active phase by index. */
  setActivePhaseIndex: (index: number) => void;

  /** Nudge the phase offset (in seconds, relative adjustment). */
  nudgePhase: (deltaSec: number) => void;

  /** Set absolute nudge value. */
  setUserNudge: (nudge: number) => void;

  /** Reset nudge to zero. */
  resetNudge: () => void;

  /** Lock/unlock the beat grid. */
  setLocked: (locked: boolean) => void;

  /** Toggle beat grid visibility. */
  toggleVisibility: () => void;

  /** Set visibility explicitly. */
  setVisible: (visible: boolean) => void;

  /** Toggle metronome on/off. */
  toggleMetronome: () => void;

  /** Set metronome enabled explicitly. */
  setMetronomeEnabled: (enabled: boolean) => void;

  /** Update the active beat grid (called after phase/nudge changes). */
  updateActiveBeatGrid: () => void;

  /** Update configuration. */
  setConfig: (config: Partial<PhaseAlignmentConfig>) => void;

  /** Clear all beat grid state (on new audio load). Was beatGridStore.clear. */
  clearBeatGrid: () => void;

  // ----------------------------
  // Promotion helpers (B4)
  // ----------------------------

  /** Check if the current grid is ready for promotion (must be locked). */
  canPromote: () => boolean;

  /** Get the current grid for promotion. Returns null if not promotable. */
  getPromotableGrid: () => BeatGrid | null;

  // ----------------------------
  // Candidate visibility (multi-hypothesis display)
  // ----------------------------

  /** Toggle visibility of a hypothesis grid. */
  toggleHypothesisVisibility: (hypothesisId: string) => void;

  /** Set visibility of a hypothesis grid explicitly. */
  setHypothesisVisible: (hypothesisId: string, visible: boolean) => void;

  /** Check if a hypothesis grid is visible. */
  isHypothesisVisible: (hypothesisId: string) => boolean;

  /** Clear all visible hypothesis IDs. */
  clearVisibleHypotheses: () => void;

  /** Set sub-beat division. */
  setSubBeatDivision: (division: SubBeatDivision) => void;
}

const beatGridInitialState: BeatGridState = {
  selectedHypothesis: null,
  phaseHypotheses: [],
  activePhaseIndex: 0,
  activeBeatGrid: null,
  userNudge: 0,
  isLocked: false,
  isVisible: true,
  metronomeEnabled: false,
  config: {
    phaseResolution: 16,
    matchTolerance: 0.05,
    topK: 3,
    offsetPenaltyWeight: 0.2,
  },
  visibleHypothesisIds: new Set(),
  subBeatDivision: 1,
};

// ============================================================
// Section 2: Musical time (authoritative structure)
// ============================================================

interface MusicalTimeState {
  /** The authoritative musical time structure (null if not yet authored). */
  structure: MusicalTimeStructure | null;

  /** Currently selected segment for editing. */
  selectedSegmentId: string | null;

  /** Whether the user is actively editing musical time. */
  isEditing: boolean;

  /** Last known beat position (for "freeze" behavior when outside segments). */
  lastKnownBeatPosition: BeatPosition | null;
}

interface MusicalTimeActions {
  // Promotion workflow
  /** Promote a beat grid to a musical time segment. */
  promoteGrid: (grid: BeatGrid, startTime: number, endTime: number) => string;

  // Segment management
  /** Add a segment manually. Returns the new segment ID. */
  addSegment: (segment: Omit<MusicalTimeSegment, "id">) => string;

  /** Update an existing segment. */
  updateSegment: (id: string, updates: Partial<Omit<MusicalTimeSegment, "id">>) => void;

  /** Remove a segment by ID. */
  removeSegment: (id: string) => void;

  /** Split a segment at a given time. Returns IDs of the two new segments. */
  splitSegmentAt: (id: string, splitTime: number) => [string, string] | null;

  /** Update a boundary between two adjacent segments (sets endTime of segment and startTime of next). */
  updateBoundary: (segmentId: string, newEndTime: number) => void;

  // Selection
  /** Select a segment for editing. */
  selectSegment: (id: string | null) => void;

  /** Toggle editing mode. */
  setEditing: (editing: boolean) => void;

  // Queries
  /** Get the segment containing a given time. */
  getSegmentAtTime: (time: number) => MusicalTimeSegment | null;

  /** Get beat position at a given time. Updates lastKnownBeatPosition. */
  getBeatPositionAt: (time: number) => BeatPosition | null;

  // Structure management
  /** Clear all musical time (revert to unauthored state). */
  clearStructure: () => void;

  /** Initialize or create an empty structure if none exists. */
  ensureStructure: () => void;

  // Serialization
  /** Export structure to JSON string. */
  exportToJSON: () => string | null;

  /** Import structure from JSON string. */
  importFromJSON: (json: string) => boolean;

  /** Full reset of the musical time section (called on new audio load). */
  reset: () => void;
}

const musicalTimeInitialState: MusicalTimeState = {
  structure: null,
  selectedSegmentId: null,
  isEditing: false,
  lastKnownBeatPosition: null,
};

// ============================================================
// Section 3: Manual tempo (manual hypotheses, taps, beat marks)
// ============================================================

/**
 * Beat mark for two-beat tempo marking.
 */
export type BeatMark = {
  timeSec: number;
};

/**
 * Source type for tempo hypotheses.
 * - algorithmic: Generated by MIR analysis (B2)
 * - manual: Created by user via direct BPM entry
 * - edited: Duplicated from another hypothesis and modified
 */
export type TempoHypothesisSource = "algorithmic" | "manual" | "edited";

/**
 * Extended tempo hypothesis with source tracking.
 * This type wraps the base TempoHypothesis with additional metadata
 * for manual tempo entry and editing.
 */
export type ExtendedTempoHypothesis = TempoHypothesis & {
  /** How this hypothesis was created. */
  source: TempoHypothesisSource;
  /** Original hypothesis ID if this was duplicated/edited. */
  sourceHypothesisId?: string;
  /** Timestamp when this hypothesis was created. */
  createdAt: string;
};

/**
 * Create default evidence for manual hypotheses.
 * Manual hypotheses have no algorithmic evidence, but we need
 * the structure for compatibility with the existing UI.
 */
function createManualEvidence(): TempoHypothesisEvidence {
  return {
    supportingIntervalCount: 0,
    weightedSupport: 0,
    peakHeight: 0,
    binRange: [0, 0],
  };
}

/**
 * Generate a deterministic family ID for a BPM value.
 * Uses the same logic as the algorithmic hypothesis generator.
 */
function generateFamilyId(bpm: number): string {
  return `fam-${Math.round(bpm)}`;
}

interface ManualTempoState {
  /** Manual and edited tempo hypotheses. */
  hypotheses: ExtendedTempoHypothesis[];
  /** Counter for generating unique IDs. */
  nextId: number;
  /** Tap tempo history for tap-to-nudge feature. */
  tapHistory: number[];
  /** Last tap timestamp for tap-to-nudge. */
  lastTapTime: number | null;
  // --- Beat Marking State ---
  /** Whether beat marking mode is active. */
  beatMarkingActive: boolean;
  /** First beat mark (null if not yet placed). */
  beatMark1: BeatMark | null;
  /** Second beat mark (null if not yet placed). */
  beatMark2: BeatMark | null;
}

interface ManualTempoActions {
  /**
   * Create a new manual tempo hypothesis from a BPM value.
   * @param bpm - The BPM value (will be rounded to 0.1 precision)
   * @returns The created hypothesis
   */
  createManualHypothesis: (bpm: number) => ExtendedTempoHypothesis;

  /**
   * Duplicate an existing hypothesis for editing.
   * Creates a new "edited" hypothesis with the same BPM.
   * @param source - The hypothesis to duplicate
   * @returns The new edited hypothesis
   */
  duplicateHypothesis: (source: TempoHypothesis) => ExtendedTempoHypothesis;

  /**
   * Update the BPM of an existing manual/edited hypothesis.
   * This creates a new hypothesis to preserve auditability.
   * @param hypothesisId - ID of the hypothesis to update
   * @param newBpm - New BPM value
   * @returns The updated hypothesis, or null if not found
   */
  updateHypothesisBpm: (hypothesisId: string, newBpm: number) => ExtendedTempoHypothesis | null;

  /**
   * Delete a manual/edited hypothesis.
   * @param hypothesisId - ID of the hypothesis to delete
   */
  deleteHypothesis: (hypothesisId: string) => void;

  /**
   * Record a tap for tap-to-nudge feature.
   * Returns the implied BPM adjustment, or null if not enough taps.
   * @param currentBpm - Current BPM to nudge from
   * @returns Suggested BPM adjustment, or null
   */
  recordTap: (currentBpm: number) => number | null;

  /**
   * Clear tap history.
   */
  clearTapHistory: () => void;

  /**
   * Clear all manual/edited hypotheses. Was manualTempoStore.clear.
   */
  clearManualTempo: () => void;

  // --- Beat Marking Actions ---

  /**
   * Start beat marking mode.
   */
  startBeatMarking: () => void;

  /**
   * Stop beat marking mode and clear marks.
   */
  stopBeatMarking: () => void;

  /**
   * Place a beat mark. If beat1 is null, places beat1. Otherwise places beat2.
   */
  placeBeatMark: (timeSec: number) => void;

  /**
   * Update a beat mark position (for dragging).
   */
  updateBeatMark: (beatIndex: 1 | 2, timeSec: number) => void;

  /**
   * Reset beat marks but stay in marking mode.
   */
  resetBeatMarks: () => void;

  /**
   * Calculate BPM from current beat marks.
   * Returns null if not enough marks or invalid BPM.
   */
  getMarkedBpm: () => { bpm: number; phaseOffset: number } | null;
}

const TAP_TIMEOUT_MS = 2000; // Reset tap history after 2 seconds of inactivity
const MIN_TAPS_FOR_NUDGE = 3; // Need at least 3 taps to estimate tempo
const MAX_TAP_HISTORY = 8; // Keep last 8 taps

const manualTempoInitialState: ManualTempoState = {
  hypotheses: [],
  nextId: 0,
  tapHistory: [],
  lastTapTime: null,
  beatMarkingActive: false,
  beatMark1: null,
  beatMark2: null,
};

// ============================================================
// Combined store
// ============================================================

export type TimingStore = BeatGridState &
  BeatGridActions &
  MusicalTimeState &
  MusicalTimeActions &
  ManualTempoState &
  ManualTempoActions;

/** @deprecated Legacy alias for the merged store type (was beatGridStore). */
export type BeatGridStore = TimingStore;
/** @deprecated Legacy alias for the merged store type (was musicalTimeStore). */
export type MusicalTimeStore = TimingStore;
/** @deprecated Legacy alias for the merged store type (was manualTempoStore). */
export type ManualTempoStore = TimingStore;

export const useTimingStore = create<TimingStore>()(
  devtools(
    (set, get) => ({
      // ============================================================
      // Section 1: Beat grid
      // ============================================================

      ...beatGridInitialState,

      selectHypothesis: (hypothesis) =>
        set(
          {
            selectedHypothesis: hypothesis,
            phaseHypotheses: [],
            activePhaseIndex: 0,
            userNudge: 0,
            isLocked: false,
            activeBeatGrid: null,
          },
          false,
          "selectHypothesis"
        ),

      updateSelectedBpm: (hypothesis) => {
        const { selectedHypothesis } = get();
        // Only update if this is the currently selected hypothesis
        if (!selectedHypothesis || selectedHypothesis.id !== hypothesis.id) {
          // If not selected, just select it normally
          get().selectHypothesis(hypothesis);
          return;
        }
        // Update the hypothesis but preserve userNudge and isLocked
        // Clear phases to trigger recalculation
        set(
          {
            selectedHypothesis: hypothesis,
            phaseHypotheses: [],
            activePhaseIndex: 0,
            activeBeatGrid: null,
            // Keep these preserved:
            // userNudge: unchanged
            // isLocked: unchanged
            // metronomeEnabled: unchanged
          },
          false,
          "updateSelectedBpm"
        );
      },

      setPhaseHypotheses: (phases) => {
        set({ phaseHypotheses: phases }, false, "setPhaseHypotheses");
        get().updateActiveBeatGrid();
      },

      cyclePhase: (direction) => {
        const { phaseHypotheses, activePhaseIndex } = get();
        if (phaseHypotheses.length === 0) return;
        const newIndex =
          (activePhaseIndex + direction + phaseHypotheses.length) % phaseHypotheses.length;
        set({ activePhaseIndex: newIndex, userNudge: 0 }, false, "cyclePhase");
        get().updateActiveBeatGrid();
      },

      setActivePhaseIndex: (index) => {
        const { phaseHypotheses } = get();
        if (index < 0 || index >= phaseHypotheses.length) return;
        set({ activePhaseIndex: index, userNudge: 0 }, false, "setActivePhaseIndex");
        get().updateActiveBeatGrid();
      },

      nudgePhase: (deltaSec) => {
        const { userNudge, selectedHypothesis } = get();
        if (!selectedHypothesis) return;
        const period = 60 / selectedHypothesis.bpm;
        // Wrap nudge within one beat period
        let newNudge = userNudge + deltaSec;
        while (newNudge < -period / 2) newNudge += period;
        while (newNudge >= period / 2) newNudge -= period;
        set({ userNudge: newNudge }, false, "nudgePhase");
        get().updateActiveBeatGrid();
      },

      setUserNudge: (nudge) => {
        set({ userNudge: nudge }, false, "setUserNudge");
        get().updateActiveBeatGrid();
      },

      resetNudge: () => {
        set({ userNudge: 0 }, false, "resetNudge");
        get().updateActiveBeatGrid();
      },

      setLocked: (locked) => {
        set({ isLocked: locked }, false, "setLocked");
        get().updateActiveBeatGrid();
      },

      toggleVisibility: () =>
        set((state) => ({ isVisible: !state.isVisible }), false, "toggleVisibility"),

      setVisible: (visible) => set({ isVisible: visible }, false, "setVisible"),

      toggleMetronome: () =>
        set((state) => ({ metronomeEnabled: !state.metronomeEnabled }), false, "toggleMetronome"),

      setMetronomeEnabled: (enabled) =>
        set({ metronomeEnabled: enabled }, false, "setMetronomeEnabled"),

      updateActiveBeatGrid: () => {
        const { selectedHypothesis, phaseHypotheses, activePhaseIndex, userNudge, isLocked } =
          get();
        if (!selectedHypothesis || phaseHypotheses.length === 0) {
          set({ activeBeatGrid: null }, false, "updateActiveBeatGrid");
          return;
        }

        const activePhase = phaseHypotheses[activePhaseIndex];
        if (!activePhase) {
          set({ activeBeatGrid: null }, false, "updateActiveBeatGrid");
          return;
        }

        const grid: BeatGrid = {
          id: `grid-${selectedHypothesis.id}-phase${activePhase.index}`,
          bpm: selectedHypothesis.bpm,
          phaseOffset: activePhase.phaseOffset,
          confidence: activePhase.score,
          sourceHypothesisId: selectedHypothesis.id,
          isLocked,
          userNudge,
        };

        set({ activeBeatGrid: grid }, false, "updateActiveBeatGrid");
      },

      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } }), false, "setConfig"),

      clearBeatGrid: () => set(beatGridInitialState, false, "clearBeatGrid"),

      // ----------------------------
      // Promotion helpers (B4)
      // ----------------------------

      canPromote: () => {
        const { activeBeatGrid, isLocked } = get();
        // Grid must exist and be locked to be promotable
        return activeBeatGrid !== null && isLocked;
      },

      getPromotableGrid: () => {
        const { activeBeatGrid, isLocked } = get();
        if (!activeBeatGrid || !isLocked) {
          return null;
        }
        return activeBeatGrid;
      },

      // ----------------------------
      // Candidate visibility (multi-hypothesis display)
      // ----------------------------

      toggleHypothesisVisibility: (hypothesisId) => {
        set(
          (state) => {
            const newSet = new Set(state.visibleHypothesisIds);
            if (newSet.has(hypothesisId)) {
              newSet.delete(hypothesisId);
            } else {
              newSet.add(hypothesisId);
            }
            return { visibleHypothesisIds: newSet };
          },
          false,
          "toggleHypothesisVisibility"
        );
      },

      setHypothesisVisible: (hypothesisId, visible) => {
        set(
          (state) => {
            const newSet = new Set(state.visibleHypothesisIds);
            if (visible) {
              newSet.add(hypothesisId);
            } else {
              newSet.delete(hypothesisId);
            }
            return { visibleHypothesisIds: newSet };
          },
          false,
          "setHypothesisVisible"
        );
      },

      isHypothesisVisible: (hypothesisId) => {
        return get().visibleHypothesisIds.has(hypothesisId);
      },

      clearVisibleHypotheses: () => {
        set({ visibleHypothesisIds: new Set() }, false, "clearVisibleHypotheses");
      },

      setSubBeatDivision: (division) => {
        set({ subBeatDivision: division }, false, "setSubBeatDivision");
      },

      // ============================================================
      // Section 2: Musical time
      // ============================================================

      ...musicalTimeInitialState,

      // ----------------------------
      // Promotion Workflow
      // ----------------------------

      promoteGrid: (grid, startTime, endTime) => {
        const { structure } = get();

        // Create segment from grid
        const segment = createSegmentFromGrid(grid, startTime, endTime);

        // Create or update structure
        const now = new Date().toISOString();
        const newStructure: MusicalTimeStructure = structure
          ? {
              ...structure,
              segments: sortSegments([...structure.segments, segment]),
              modifiedAt: now,
            }
          : {
              version: 1,
              segments: [segment],
              createdAt: now,
              modifiedAt: now,
            };

        // Validate
        const errors = validateSegments(newStructure.segments);
        if (errors.length > 0) {
          console.error("Validation errors after promotion:", errors);
          // Still proceed - validation errors are warnings for now
        }

        set({ structure: newStructure }, false, "promoteGrid");

        return segment.id;
      },

      // ----------------------------
      // Segment Management
      // ----------------------------

      addSegment: (segmentData) => {
        const { structure } = get();
        const now = new Date().toISOString();

        const segment: MusicalTimeSegment = {
          ...segmentData,
          id: generateSegmentId(),
        };

        const newStructure: MusicalTimeStructure = structure
          ? {
              ...structure,
              segments: sortSegments([...structure.segments, segment]),
              modifiedAt: now,
            }
          : {
              version: 1,
              segments: [segment],
              createdAt: now,
              modifiedAt: now,
            };

        set({ structure: newStructure }, false, "addSegment");

        return segment.id;
      },

      updateSegment: (id, updates) => {
        const { structure } = get();
        if (!structure) return;

        const now = new Date().toISOString();
        const newSegments = structure.segments.map((seg) =>
          seg.id === id ? { ...seg, ...updates } : seg
        );

        set(
          {
            structure: {
              ...structure,
              segments: sortSegments(newSegments),
              modifiedAt: now,
            },
          },
          false,
          "updateSegment"
        );
      },

      removeSegment: (id) => {
        const { structure, selectedSegmentId } = get();
        if (!structure) return;

        const segmentIndex = structure.segments.findIndex((seg) => seg.id === id);
        if (segmentIndex === -1) return;

        const segment = structure.segments[segmentIndex];
        if (!segment) return;
        const now = new Date().toISOString();

        // If it's the only segment, just remove it
        if (structure.segments.length === 1) {
          set(
            {
              structure: {
                ...structure,
                segments: [],
                modifiedAt: now,
              },
              selectedSegmentId: null,
            },
            false,
            "removeSegment"
          );
          return;
        }

        // Expand adjacent segment to maintain coverage
        const newSegments = structure.segments
          .filter((seg) => seg.id !== id)
          .map((seg, idx, arr) => {
            // If we removed the first segment, extend the new first segment's start
            if (segmentIndex === 0 && idx === 0) {
              return { ...seg, startTime: segment.startTime };
            }
            // If we removed the last segment, extend the new last segment's end
            if (segmentIndex === structure.segments.length - 1 && idx === arr.length - 1) {
              return { ...seg, endTime: segment.endTime };
            }
            // If we removed a middle segment, extend the previous segment's end
            // (the segment at segmentIndex - 1 in the original array is now at segmentIndex - 1 in new array)
            if (idx === segmentIndex - 1) {
              return { ...seg, endTime: segment.endTime };
            }
            return seg;
          });

        set(
          {
            structure: {
              ...structure,
              segments: newSegments,
              modifiedAt: now,
            },
            selectedSegmentId: selectedSegmentId === id ? null : selectedSegmentId,
          },
          false,
          "removeSegment"
        );
      },

      splitSegmentAt: (id, splitTime) => {
        const { structure } = get();
        if (!structure) return null;

        const segment = structure.segments.find((seg) => seg.id === id);
        if (!segment) return null;

        try {
          const [before, after] = splitSegmentUtil(segment, splitTime);
          const now = new Date().toISOString();

          const newSegments = sortSegments([
            ...structure.segments.filter((seg) => seg.id !== id),
            before,
            after,
          ]);

          set(
            {
              structure: {
                ...structure,
                segments: newSegments,
                modifiedAt: now,
              },
            },
            false,
            "splitSegmentAt"
          );

          return [before.id, after.id];
        } catch (error) {
          console.error("Failed to split segment:", error);
          return null;
        }
      },

      updateBoundary: (segmentId, newEndTime) => {
        const { structure } = get();
        if (!structure) return;

        // Find the segment and its index
        const segmentIndex = structure.segments.findIndex((seg) => seg.id === segmentId);
        if (segmentIndex === -1) return;

        const segment = structure.segments[segmentIndex];
        const nextSegment = structure.segments[segmentIndex + 1];

        // Must have both segments
        if (!segment || !nextSegment) return;

        // Validate the new boundary time
        const minDuration = 0.1; // Minimum segment duration
        if (newEndTime <= segment.startTime + minDuration) return;
        if (newEndTime >= nextSegment.endTime - minDuration) return;

        const now = new Date().toISOString();

        // Update both segments
        const newSegments = structure.segments.map((seg, idx) => {
          if (idx === segmentIndex) {
            return { ...seg, endTime: newEndTime };
          }
          if (idx === segmentIndex + 1) {
            return { ...seg, startTime: newEndTime };
          }
          return seg;
        });

        set(
          {
            structure: {
              ...structure,
              segments: newSegments,
              modifiedAt: now,
            },
          },
          false,
          "updateBoundary"
        );
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectSegment: (id) => {
        set({ selectedSegmentId: id }, false, "selectSegment");
      },

      setEditing: (editing) => {
        set({ isEditing: editing }, false, "setEditing");
      },

      // ----------------------------
      // Queries
      // ----------------------------

      getSegmentAtTime: (time) => {
        const { structure } = get();
        if (!structure) return null;

        for (const segment of structure.segments) {
          if (time >= segment.startTime && time < segment.endTime) {
            return segment;
          }
        }
        return null;
      },

      getBeatPositionAt: (time) => {
        const { structure, lastKnownBeatPosition } = get();
        const beatPos = computeBeatPositionFromStructure(time, structure);

        if (beatPos) {
          // Update last known position
          set({ lastKnownBeatPosition: beatPos }, false, "updateLastKnownBeatPosition");
          return beatPos;
        }

        // Return last known position ("freeze" behavior)
        return lastKnownBeatPosition;
      },

      // ----------------------------
      // Structure Management
      // ----------------------------

      clearStructure: () => {
        set(
          {
            structure: null,
            selectedSegmentId: null,
            lastKnownBeatPosition: null,
          },
          false,
          "clearStructure"
        );
      },

      ensureStructure: () => {
        const { structure } = get();
        if (!structure) {
          set({ structure: createMusicalTimeStructure() }, false, "ensureStructure");
        }
      },

      // ----------------------------
      // Serialization
      // ----------------------------

      exportToJSON: () => {
        const { structure } = get();
        if (!structure) return null;
        return JSON.stringify(structure, null, 2);
      },

      importFromJSON: (json) => {
        try {
          const structure = JSON.parse(json) as MusicalTimeStructure;

          // Basic validation
          if (structure.version !== 1 || !Array.isArray(structure.segments)) {
            console.error("Invalid musical time structure");
            return false;
          }

          const errors = validateSegments(structure.segments);
          if (errors.length > 0) {
            console.warn("Validation warnings on import:", errors);
          }

          set(
            {
              structure,
              selectedSegmentId: null,
              lastKnownBeatPosition: null,
            },
            false,
            "importFromJSON"
          );

          return true;
        } catch (error) {
          console.error("Failed to import musical time:", error);
          return false;
        }
      },

      // ----------------------------
      // Reset (musical time section only)
      // ----------------------------

      reset: () => {
        set(musicalTimeInitialState, false, "reset");
      },

      // ============================================================
      // Section 3: Manual tempo
      // ============================================================

      ...manualTempoInitialState,

      createManualHypothesis: (bpm: number) => {
        const state = get();
        const roundedBpm = Math.round(bpm * 10) / 10;
        const id = `manual-${state.nextId}`;

        const hypothesis: ExtendedTempoHypothesis = {
          id,
          bpm: roundedBpm,
          confidence: 1.0, // Manual entries get full confidence
          evidence: createManualEvidence(),
          familyId: generateFamilyId(roundedBpm),
          harmonicRatio: 1.0,
          source: "manual",
          createdAt: new Date().toISOString(),
        };

        set(
          (state) => ({
            hypotheses: [...state.hypotheses, hypothesis],
            nextId: state.nextId + 1,
          }),
          false,
          "createManualHypothesis"
        );

        return hypothesis;
      },

      duplicateHypothesis: (source: TempoHypothesis) => {
        const state = get();
        const id = `edited-${state.nextId}`;

        const hypothesis: ExtendedTempoHypothesis = {
          id,
          bpm: source.bpm,
          confidence: 1.0, // Edited entries get full confidence
          evidence: { ...source.evidence }, // Copy evidence for reference
          familyId: source.familyId,
          harmonicRatio: source.harmonicRatio,
          source: "edited",
          sourceHypothesisId: source.id,
          createdAt: new Date().toISOString(),
        };

        set(
          (state) => ({
            hypotheses: [...state.hypotheses, hypothesis],
            nextId: state.nextId + 1,
          }),
          false,
          "duplicateHypothesis"
        );

        return hypothesis;
      },

      updateHypothesisBpm: (hypothesisId: string, newBpm: number) => {
        const state = get();
        const existing = state.hypotheses.find((h) => h.id === hypothesisId);

        if (!existing) {
          return null;
        }

        const roundedBpm = Math.round(newBpm * 10) / 10;

        // Update in place for manual/edited hypotheses
        const updated: ExtendedTempoHypothesis = {
          ...existing,
          bpm: roundedBpm,
          familyId: generateFamilyId(roundedBpm),
          // Reset harmonic ratio since BPM changed
          harmonicRatio: 1.0,
        };

        set(
          (state) => ({
            hypotheses: state.hypotheses.map((h) => (h.id === hypothesisId ? updated : h)),
          }),
          false,
          "updateHypothesisBpm"
        );

        return updated;
      },

      deleteHypothesis: (hypothesisId: string) => {
        set(
          (state) => ({
            hypotheses: state.hypotheses.filter((h) => h.id !== hypothesisId),
          }),
          false,
          "deleteHypothesis"
        );
      },

      recordTap: (currentBpm: number) => {
        const now = Date.now();
        const state = get();

        // Reset history if too much time has passed
        let newHistory = state.tapHistory;
        if (state.lastTapTime && now - state.lastTapTime > TAP_TIMEOUT_MS) {
          newHistory = [];
        }

        // Add new tap
        newHistory = [...newHistory, now].slice(-MAX_TAP_HISTORY);

        set(
          {
            tapHistory: newHistory,
            lastTapTime: now,
          },
          false,
          "recordTap"
        );

        // Need at least MIN_TAPS_FOR_NUDGE taps to calculate tempo
        if (newHistory.length < MIN_TAPS_FOR_NUDGE) {
          return null;
        }

        // Calculate average interval from tap history
        let totalInterval = 0;
        for (let i = 1; i < newHistory.length; i++) {
          totalInterval += newHistory[i]! - newHistory[i - 1]!;
        }
        const avgIntervalMs = totalInterval / (newHistory.length - 1);
        const tappedBpm = 60000 / avgIntervalMs;

        // Nudge toward tapped BPM - blend current with tapped
        // Use a weighted blend: 70% current, 30% tapped for gentle nudging
        const nudgeFactor = 0.3;
        const suggestedBpm = currentBpm * (1 - nudgeFactor) + tappedBpm * nudgeFactor;

        return suggestedBpm;
      },

      clearTapHistory: () => {
        set(
          {
            tapHistory: [],
            lastTapTime: null,
          },
          false,
          "clearTapHistory"
        );
      },

      clearManualTempo: () => set(manualTempoInitialState, false, "clearManualTempo"),

      // --- Beat Marking Actions ---

      startBeatMarking: () => {
        set(
          {
            beatMarkingActive: true,
            beatMark1: null,
            beatMark2: null,
          },
          false,
          "startBeatMarking"
        );
      },

      stopBeatMarking: () => {
        set(
          {
            beatMarkingActive: false,
            beatMark1: null,
            beatMark2: null,
          },
          false,
          "stopBeatMarking"
        );
      },

      placeBeatMark: (timeSec: number) => {
        const { beatMark1, beatMark2 } = get();

        if (!beatMark1) {
          // Place beat 1
          set({ beatMark1: { timeSec } }, false, "placeBeatMark1");
        } else if (!beatMark2) {
          // Place beat 2
          set({ beatMark2: { timeSec } }, false, "placeBeatMark2");
        } else {
          // Both marks exist - replace the one further from the click
          const dist1 = Math.abs(timeSec - beatMark1.timeSec);
          const dist2 = Math.abs(timeSec - beatMark2.timeSec);
          if (dist1 < dist2) {
            set({ beatMark1: { timeSec } }, false, "updateBeatMark1");
          } else {
            set({ beatMark2: { timeSec } }, false, "updateBeatMark2");
          }
        }
      },

      updateBeatMark: (beatIndex: 1 | 2, timeSec: number) => {
        if (beatIndex === 1) {
          set({ beatMark1: { timeSec } }, false, "updateBeatMark1");
        } else {
          set({ beatMark2: { timeSec } }, false, "updateBeatMark2");
        }
      },

      resetBeatMarks: () => {
        set(
          {
            beatMark1: null,
            beatMark2: null,
          },
          false,
          "resetBeatMarks"
        );
      },

      getMarkedBpm: () => {
        const { beatMark1, beatMark2 } = get();
        if (!beatMark1 || !beatMark2) return null;

        const interval = Math.abs(beatMark2.timeSec - beatMark1.timeSec);
        if (interval <= 0) return null;

        const bpm = 60 / interval;

        // Check for reasonable BPM range
        if (bpm < 20 || bpm > 400) return null;

        // Phase offset is the earlier beat
        const phaseOffset = Math.min(beatMark1.timeSec, beatMark2.timeSec);

        return { bpm, phaseOffset };
      },
    }),
    { name: "timing-store" }
  )
);
