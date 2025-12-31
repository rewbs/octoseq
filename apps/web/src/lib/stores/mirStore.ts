import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { MirTimings, UiMirResult } from "./types";

/** Visual tab identifier - search, debug, or a MIR function */
export type VisualTabId = "search" | "debug" | MirFunctionId;

interface MirState {
  selected: MirFunctionId;
  runningAnalysis: MirFunctionId | null;
  mirResults: Partial<Record<MirFunctionId, UiMirResult>>;
  isRunning: boolean;
  visualTab: VisualTabId;
  lastTimings: MirTimings | null;
}

interface MirActions {
  setSelected: (id: MirFunctionId) => void;
  setRunningAnalysis: (id: MirFunctionId | null) => void;
  setMirResult: (id: MirFunctionId, result: UiMirResult) => void;
  clearMirResults: () => void;
  setIsRunning: (running: boolean) => void;
  setVisualTab: (tab: VisualTabId) => void;
  setLastTimings: (timings: MirTimings | null) => void;
}

export type MirStore = MirState & MirActions;

const initialState: MirState = {
  selected: "spectralCentroid",
  runningAnalysis: null,
  mirResults: {},
  isRunning: false,
  visualTab: "search",
  lastTimings: null,
};

export const useMirStore = create<MirStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelected: (id) => set({ selected: id }, false, "setSelected"),

      setRunningAnalysis: (id) => set({ runningAnalysis: id }, false, "setRunningAnalysis"),

      setMirResult: (id, result) =>
        set(
          (state) => ({
            mirResults: { ...state.mirResults, [id]: result },
          }),
          false,
          "setMirResult"
        ),

      clearMirResults: () => set({ mirResults: {} }, false, "clearMirResults"),

      setIsRunning: (running) => set({ isRunning: running }, false, "setIsRunning"),

      setVisualTab: (tab) => set({ visualTab: tab }, false, "setVisualTab"),

      setLastTimings: (timings) => set({ lastTimings: timings }, false, "setLastTimings"),
    }),
    { name: "mir-store" }
  )
);

/**
 * Get the list of available MIR tabs for the visualizer.
 */
export const mirTabDefinitions: Array<{ id: MirFunctionId; label: string; kind: "1d" | "events" | "2d" | "tempoHypotheses" }> = [
  { id: "spectralCentroid", label: "Spectral Centroid (1D)", kind: "1d" },
  { id: "spectralFlux", label: "Spectral Flux (1D)", kind: "1d" },
  { id: "onsetEnvelope", label: "Onset Envelope (1D)", kind: "1d" },
  { id: "onsetPeaks", label: "Onset Peaks (events)", kind: "events" },
  { id: "beatCandidates", label: "Beat Candidates (events)", kind: "events" },
  { id: "tempoHypotheses", label: "Tempo Hypotheses", kind: "tempoHypotheses" },
  { id: "melSpectrogram", label: "Mel Spectrogram (2D)", kind: "2d" },
  { id: "hpssHarmonic", label: "HPSS Harmonic (2D)", kind: "2d" },
  { id: "hpssPercussive", label: "HPSS Percussive (2D)", kind: "2d" },
  { id: "mfcc", label: "MFCC (2D)", kind: "2d" },
  { id: "mfccDelta", label: "MFCC Delta (2D)", kind: "2d" },
  { id: "mfccDeltaDelta", label: "MFCC Delta-Delta (2D)", kind: "2d" },
  { id: "cqtHarmonicEnergy", label: "CQT Harmonic Energy (1D)", kind: "1d" },
  { id: "cqtBassPitchMotion", label: "CQT Bass Pitch Motion (1D)", kind: "1d" },
  { id: "cqtTonalStability", label: "CQT Tonal Stability (1D)", kind: "1d" },
];
