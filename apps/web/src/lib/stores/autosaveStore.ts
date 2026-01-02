/**
 * Autosave Store
 *
 * Tracks autosave status for UI display.
 * Provides status indicator state (saving, saved, error).
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AutosaveStatus, AutosaveState } from "../persistence/types";

// ----------------------------
// Store Interface
// ----------------------------

interface AutosaveStoreState extends AutosaveState {
  /** Whether project was recovered from autosave (for banner display) */
  wasRecovered: boolean;
  /** Project name from recovery (for display) */
  recoveredProjectName: string | null;
}

interface AutosaveStoreActions {
  /** Set the autosave status */
  setStatus: (status: AutosaveStatus) => void;
  /** Mark autosave as complete with timestamp */
  setSaved: (timestamp: string) => void;
  /** Set error state */
  setError: (error: string) => void;
  /** Mark as recovered from autosave */
  setRecovered: (projectName: string | null) => void;
  /** Clear recovery state (user dismissed banner) */
  clearRecovered: () => void;
  /** Reset all state */
  reset: () => void;
}

export type AutosaveStore = AutosaveStoreState & AutosaveStoreActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: AutosaveStoreState = {
  status: "idle",
  lastSavedAt: null,
  error: null,
  wasRecovered: false,
  recoveredProjectName: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useAutosaveStore = create<AutosaveStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setStatus: (status) =>
        set(
          { status, error: status !== "error" ? null : undefined },
          false,
          "setStatus"
        ),

      setSaved: (timestamp) =>
        set(
          { status: "saved", lastSavedAt: timestamp, error: null },
          false,
          "setSaved"
        ),

      setError: (error) =>
        set({ status: "error", error }, false, "setError"),

      setRecovered: (projectName) =>
        set(
          { wasRecovered: true, recoveredProjectName: projectName },
          false,
          "setRecovered"
        ),

      clearRecovered: () =>
        set(
          { wasRecovered: false, recoveredProjectName: null },
          false,
          "clearRecovered"
        ),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "autosave-store" }
  )
);
