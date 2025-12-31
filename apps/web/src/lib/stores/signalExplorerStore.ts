import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  CursorContext,
  ScriptSignalInfo,
  SignalChainAnalysis,
} from "../signalExplorer/types";

interface SignalExplorerState {
  // UI State
  isExpanded: boolean;

  // Cursor tracking
  currentCursor: CursorContext | null;

  // Analysis results
  lastValidAnalysis: SignalChainAnalysis | null;
  lastValidSignalName: string | null;

  // Script signals cache
  scriptSignals: ScriptSignalInfo[];

  // Error state
  lastError: string | null;

  // Playback awareness
  isPlaybackActive: boolean;

  // Loading state
  isAnalyzing: boolean;

  // Musical time info for beat display
  bpm: number | null;

  // Target FPS for frame display
  targetFps: number;

  // Zoom level: number of beats shown before/after center (default 2)
  windowBeats: number;
}

interface SignalExplorerActions {
  // UI
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;

  // Cursor tracking
  setCursor: (cursor: CursorContext | null) => void;

  // Analysis
  setAnalysis: (analysis: SignalChainAnalysis, signalName: string) => void;
  clearAnalysis: () => void;
  setAnalyzing: (analyzing: boolean) => void;

  // Script signals
  setScriptSignals: (signals: ScriptSignalInfo[]) => void;

  // Playback
  setPlaybackActive: (active: boolean) => void;

  // Error
  setError: (error: string | null) => void;

  // Musical time
  setBpm: (bpm: number | null) => void;

  // FPS
  setTargetFps: (fps: number) => void;

  // Zoom
  setWindowBeats: (beats: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // Reset
  reset: () => void;
}

export type SignalExplorerStore = SignalExplorerState & SignalExplorerActions;

const initialState: SignalExplorerState = {
  isExpanded: false,
  currentCursor: null,
  lastValidAnalysis: null,
  lastValidSignalName: null,
  scriptSignals: [],
  lastError: null,
  isPlaybackActive: false,
  isAnalyzing: false,
  bpm: null,
  targetFps: 30,
  windowBeats: 2,
};

export const useSignalExplorerStore = create<SignalExplorerStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setExpanded: (expanded) =>
        set({ isExpanded: expanded }, false, "setExpanded"),

      toggleExpanded: () =>
        set((s) => ({ isExpanded: !s.isExpanded }), false, "toggleExpanded"),

      setCursor: (cursor) =>
        set({ currentCursor: cursor }, false, "setCursor"),

      setAnalysis: (analysis, signalName) =>
        set(
          {
            lastValidAnalysis: analysis,
            lastValidSignalName: signalName,
            lastError: null,
            isAnalyzing: false,
          },
          false,
          "setAnalysis"
        ),

      clearAnalysis: () =>
        set(
          {
            lastValidAnalysis: null,
            lastValidSignalName: null,
          },
          false,
          "clearAnalysis"
        ),

      setAnalyzing: (analyzing) =>
        set({ isAnalyzing: analyzing }, false, "setAnalyzing"),

      setScriptSignals: (signals) =>
        set({ scriptSignals: signals }, false, "setScriptSignals"),

      setPlaybackActive: (active) =>
        set({ isPlaybackActive: active }, false, "setPlaybackActive"),

      setError: (error) =>
        set({ lastError: error, isAnalyzing: false }, false, "setError"),

      setBpm: (bpm) => set({ bpm }, false, "setBpm"),

      setTargetFps: (targetFps) => set({ targetFps }, false, "setTargetFps"),

      setWindowBeats: (windowBeats) =>
        set({ windowBeats: Math.max(0.5, Math.min(16, windowBeats)) }, false, "setWindowBeats"),

      zoomIn: () =>
        set(
          (s) => ({ windowBeats: Math.max(0.5, s.windowBeats / 2) }),
          false,
          "zoomIn"
        ),

      zoomOut: () =>
        set(
          (s) => ({ windowBeats: Math.min(16, s.windowBeats * 2) }),
          false,
          "zoomOut"
        ),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "signal-explorer-store" }
  )
);
