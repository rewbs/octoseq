import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DebugSignal } from "./types";

interface DebugSignalState {
  /** Debug signals extracted from script analysis */
  debugSignals: DebugSignal[];
  /** Whether an analysis is currently running */
  isRunning: boolean;
  /** Last error from analysis (if any) */
  lastError: string | null;
  /** Duration of the last analysis run */
  lastRunDuration: number | null;
  /** Number of steps in the last analysis run */
  lastStepCount: number | null;
}

interface DebugSignalActions {
  setDebugSignals: (signals: DebugSignal[]) => void;
  clearDebugSignals: () => void;
  setIsRunning: (running: boolean) => void;
  setLastError: (error: string | null) => void;
  setLastRunDuration: (duration: number | null) => void;
  setLastStepCount: (count: number | null) => void;
}

export type DebugSignalStore = DebugSignalState & DebugSignalActions;

const initialState: DebugSignalState = {
  debugSignals: [],
  isRunning: false,
  lastError: null,
  lastRunDuration: null,
  lastStepCount: null,
};

export const useDebugSignalStore = create<DebugSignalStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setDebugSignals: (signals) =>
        set({ debugSignals: signals, lastError: null }, false, "setDebugSignals"),

      clearDebugSignals: () =>
        set({ debugSignals: [], lastError: null }, false, "clearDebugSignals"),

      setIsRunning: (running) => set({ isRunning: running }, false, "setIsRunning"),

      setLastError: (error) => set({ lastError: error }, false, "setLastError"),

      setLastRunDuration: (duration) =>
        set({ lastRunDuration: duration }, false, "setLastRunDuration"),

      setLastStepCount: (count) =>
        set({ lastStepCount: count }, false, "setLastStepCount"),
    }),
    { name: "debug-signal-store" }
  )
);
