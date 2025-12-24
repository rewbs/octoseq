import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
    TempoHypothesis,
    BeatGrid,
    PhaseHypothesis,
    PhaseAlignmentConfig,
} from "@octoseq/mir";

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

    /** Clear all beat grid state (on new audio load). */
    clear: () => void;

    // ----------------------------
    // Promotion helpers (B4)
    // ----------------------------

    /** Check if the current grid is ready for promotion (must be locked). */
    canPromote: () => boolean;

    /** Get the current grid for promotion. Returns null if not promotable. */
    getPromotableGrid: () => BeatGrid | null;
}

export type BeatGridStore = BeatGridState & BeatGridActions;

const initialState: BeatGridState = {
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
};

export const useBeatGridStore = create<BeatGridStore>()(
    devtools(
        (set, get) => ({
            ...initialState,

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
                    (activePhaseIndex + direction + phaseHypotheses.length) %
                    phaseHypotheses.length;
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
                set(
                    (state) => ({ config: { ...state.config, ...config } }),
                    false,
                    "setConfig"
                ),

            clear: () => set(initialState, false, "clear"),

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
        }),
        { name: "beat-grid-store" }
    )
);
