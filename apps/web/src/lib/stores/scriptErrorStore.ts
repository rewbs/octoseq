import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ScriptDiagnostic } from "@/lib/scripting/scriptDiagnostics";

const MAX_ERROR_HISTORY = 100;

export interface HistoricalScriptError {
  id: string;
  timestamp: number;
  diagnostics: ScriptDiagnostic[];
}

interface ScriptErrorState {
  /** Current active diagnostics (from most recent script load/run) */
  currentDiagnostics: ScriptDiagnostic[];
  /** Historical errors (last 100, newest first) */
  errorHistory: HistoricalScriptError[];
  /** Whether the error history panel is open */
  isHistoryOpen: boolean;
}

interface ScriptErrorActions {
  /** Set current diagnostics (called on each script evaluation) */
  setCurrentDiagnostics: (diagnostics: ScriptDiagnostic[]) => void;
  /** Add diagnostics to history (only if there are errors) */
  addToHistory: (diagnostics: ScriptDiagnostic[]) => void;
  /** Clear all error history */
  clearHistory: () => void;
  /** Toggle history panel visibility */
  setHistoryOpen: (open: boolean) => void;
}

export type ScriptErrorStore = ScriptErrorState & ScriptErrorActions;

const initialState: ScriptErrorState = {
  currentDiagnostics: [],
  errorHistory: [],
  isHistoryOpen: false,
};

export const useScriptErrorStore = create<ScriptErrorStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setCurrentDiagnostics: (diagnostics) =>
        set({ currentDiagnostics: diagnostics }, false, "setCurrentDiagnostics"),

      addToHistory: (diagnostics) => {
        // Only add to history if there are actual errors (not just warnings)
        const errors = diagnostics.filter((d) => d.kind !== "warning");
        if (errors.length === 0) return;

        const entry: HistoricalScriptError = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          timestamp: Date.now(),
          diagnostics: errors,
        };

        set(
          (state) => ({
            errorHistory: [entry, ...state.errorHistory].slice(0, MAX_ERROR_HISTORY),
          }),
          false,
          "addToHistory"
        );
      },

      clearHistory: () => set({ errorHistory: [] }, false, "clearHistory"),

      setHistoryOpen: (open) => set({ isHistoryOpen: open }, false, "setHistoryOpen"),
    }),
    { name: "script-error-store" }
  )
);
