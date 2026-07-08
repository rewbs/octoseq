/**
 * View Store — ephemeral multi-stream view state for the Phase 2 shell.
 *
 * Holds which streams are in the comparison set and which analysis the
 * comparison renders. Not persisted; display presets snapshot it into project
 * uiState separately. See docs/design/phase2-ui-shell.md.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AnalysisId, StreamId } from "./types";

/** Persisted snapshot of the view (see ProjectUIState.viewPresets). */
export interface ViewPreset {
  id: string;
  name: string;
  comparedStreamIds: StreamId[];
  comparisonAnalysisId: AnalysisId;
  streamManagerOpen: boolean;
  comparisonOpen: boolean;
}

interface ViewState {
  /** Streams currently shown in the comparison panel, in insertion order. */
  comparedStreamIds: Set<StreamId>;
  /** The analysis rendered across compared streams. */
  comparisonAnalysisId: AnalysisId;
  /** Panel visibility. */
  streamManagerOpen: boolean;
  comparisonOpen: boolean;
  /** Named presets (persisted via project uiState). */
  presets: ViewPreset[];
}

interface ViewActions {
  toggleCompared: (id: StreamId) => void;
  setCompared: (ids: StreamId[]) => void;
  /** Remove a stream from the comparison set (no-op if absent). */
  removeCompared: (id: StreamId) => void;
  clearCompared: () => void;
  setComparisonAnalysis: (id: AnalysisId) => void;
  setStreamManagerOpen: (open: boolean) => void;
  setComparisonOpen: (open: boolean) => void;
  /** Snapshot the current view as a named preset. Returns its id. */
  savePreset: (name: string) => string;
  /** Apply a preset to the current view. No-op for unknown ids. */
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  /** Replace all presets (project hydration). */
  setPresets: (presets: ViewPreset[]) => void;
  reset: () => void;
}

const initialState: ViewState = {
  comparedStreamIds: new Set(),
  comparisonAnalysisId: "onsetEnvelope",
  streamManagerOpen: true,
  comparisonOpen: true,
  presets: [],
};

export const useViewStore = create<ViewState & ViewActions>()(
  devtools(
    (set) => ({
      ...initialState,

      toggleCompared: (id) =>
        set(
          (state) => {
            const comparedStreamIds = new Set(state.comparedStreamIds);
            if (comparedStreamIds.has(id)) comparedStreamIds.delete(id);
            else comparedStreamIds.add(id);
            // Opening the panel on first add keeps the interaction discoverable.
            const comparisonOpen = comparedStreamIds.size > 0 ? true : state.comparisonOpen;
            return { comparedStreamIds, comparisonOpen };
          },
          false,
          "toggleCompared"
        ),

      setCompared: (ids) =>
        set({ comparedStreamIds: new Set(ids) }, false, "setCompared"),

      removeCompared: (id) =>
        set(
          (state) => {
            if (!state.comparedStreamIds.has(id)) return state;
            const comparedStreamIds = new Set(state.comparedStreamIds);
            comparedStreamIds.delete(id);
            return { comparedStreamIds };
          },
          false,
          "removeCompared"
        ),

      clearCompared: () => set({ comparedStreamIds: new Set() }, false, "clearCompared"),

      setComparisonAnalysis: (id) =>
        set({ comparisonAnalysisId: id }, false, "setComparisonAnalysis"),

      setStreamManagerOpen: (streamManagerOpen) =>
        set({ streamManagerOpen }, false, "setStreamManagerOpen"),

      setComparisonOpen: (comparisonOpen) =>
        set({ comparisonOpen }, false, "setComparisonOpen"),

      savePreset: (name) => {
        const id = nanoid();
        set(
          (state) => ({
            presets: [
              ...state.presets,
              {
                id,
                name,
                comparedStreamIds: [...state.comparedStreamIds],
                comparisonAnalysisId: state.comparisonAnalysisId,
                streamManagerOpen: state.streamManagerOpen,
                comparisonOpen: state.comparisonOpen,
              },
            ],
          }),
          false,
          "savePreset"
        );
        return id;
      },

      applyPreset: (id) =>
        set(
          (state) => {
            const preset = state.presets.find((p) => p.id === id);
            if (!preset) return state;
            return {
              comparedStreamIds: new Set(preset.comparedStreamIds),
              comparisonAnalysisId: preset.comparisonAnalysisId,
              streamManagerOpen: preset.streamManagerOpen,
              comparisonOpen: preset.comparisonOpen,
            };
          },
          false,
          "applyPreset"
        ),

      deletePreset: (id) =>
        set(
          (state) => ({ presets: state.presets.filter((p) => p.id !== id) }),
          false,
          "deletePreset"
        ),

      setPresets: (presets) => set({ presets }, false, "setPresets"),

      reset: () =>
        set({ ...initialState, comparedStreamIds: new Set(), presets: [] }, false, "reset"),
    }),
    { name: "ViewStore" }
  )
);
