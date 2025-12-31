import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

/**
 * View mode for MIR inspection panel.
 * - "mixdown": Inspect the main audio mixdown
 * - "selected-stem": Inspect the currently selected stem
 * - "compare-all": Compare signals across all sources (mixdown + stems)
 */
export type InspectionViewMode = "mixdown" | "selected-stem" | "compare-all";

interface InspectionState {
  /** Current view mode for the inspection panel */
  viewMode: InspectionViewMode;

  /** Selected MIR function for inspection */
  selectedFunction: MirFunctionId;
}

interface InspectionActions {
  /** Set the view mode */
  setViewMode: (mode: InspectionViewMode) => void;

  /** Set the selected MIR function */
  setSelectedFunction: (fn: MirFunctionId) => void;

  /** Reset to default state */
  reset: () => void;
}

export type InspectionStore = InspectionState & InspectionActions;

const initialState: InspectionState = {
  viewMode: "mixdown",
  selectedFunction: "spectralCentroid",
};

export const useInspectionStore = create<InspectionStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setViewMode: (mode) => set({ viewMode: mode }, false, "setViewMode"),

      setSelectedFunction: (fn) => set({ selectedFunction: fn }, false, "setSelectedFunction"),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "inspection-store" }
  )
);
