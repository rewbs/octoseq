import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { MirTimings, UiMirResult } from "./types";

/** Visual tab identifier - search, debug, or a MIR function */
export type VisualTabId = "search" | "debug" | MirFunctionId;

/** Cache key for per-input MIR results: `${inputId}:${functionId}` */
export type InputMirCacheKey = `${string}:${MirFunctionId}`;

/** Helper to create a cache key from input ID and function ID */
export function makeInputMirCacheKey(inputId: string, functionId: MirFunctionId): InputMirCacheKey {
  return `${inputId}:${functionId}`;
}

interface MirState {
  selected: MirFunctionId;
  runningAnalysis: MirFunctionId | null;
  /** MIR results for the mixdown (backward compatible) */
  mirResults: Partial<Record<MirFunctionId, UiMirResult>>;
  /** Per-input MIR results cache (inputId:functionId -> result) */
  inputMirCache: Map<InputMirCacheKey, UiMirResult>;
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
  /** Set MIR result for a specific input (stem or mixdown) */
  setInputMirResult: (inputId: string, functionId: MirFunctionId, result: UiMirResult) => void;
  /** Get MIR result for a specific input, or null if not cached */
  getInputMirResult: (inputId: string, functionId: MirFunctionId) => UiMirResult | null;
  /** Invalidate all cached MIR results for a specific input */
  invalidateInputMir: (inputId: string) => void;
  /** Get all cached MIR results for an input */
  getAllInputMirResults: (inputId: string) => Map<MirFunctionId, UiMirResult>;
}

export type MirStore = MirState & MirActions;

const initialState: MirState = {
  selected: "spectralCentroid",
  runningAnalysis: null,
  mirResults: {},
  inputMirCache: new Map(),
  isRunning: false,
  visualTab: "search",
  lastTimings: null,
};

export const useMirStore = create<MirStore>()(
  devtools(
    (set, get) => ({
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

      clearMirResults: () => set({ mirResults: {}, inputMirCache: new Map() }, false, "clearMirResults"),

      setIsRunning: (running) => set({ isRunning: running }, false, "setIsRunning"),

      setVisualTab: (tab) => set({ visualTab: tab }, false, "setVisualTab"),

      setLastTimings: (timings) => set({ lastTimings: timings }, false, "setLastTimings"),

      setInputMirResult: (inputId, functionId, result) =>
        set(
          (state) => {
            const newCache = new Map(state.inputMirCache);
            newCache.set(makeInputMirCacheKey(inputId, functionId), result);
            return { inputMirCache: newCache };
          },
          false,
          "setInputMirResult"
        ),

      getInputMirResult: (inputId, functionId) => {
        const state = get();
        return state.inputMirCache.get(makeInputMirCacheKey(inputId, functionId)) ?? null;
      },

      invalidateInputMir: (inputId) =>
        set(
          (state) => {
            const newCache = new Map(state.inputMirCache);
            // Remove all entries for this input
            for (const key of newCache.keys()) {
              if (key.startsWith(`${inputId}:`)) {
                newCache.delete(key);
              }
            }
            return { inputMirCache: newCache };
          },
          false,
          "invalidateInputMir"
        ),

      getAllInputMirResults: (inputId) => {
        const state = get();
        const results = new Map<MirFunctionId, UiMirResult>();
        const prefix = `${inputId}:`;
        for (const [key, value] of state.inputMirCache) {
          if (key.startsWith(prefix)) {
            const functionId = key.slice(prefix.length) as MirFunctionId;
            results.set(functionId, value);
          }
        }
        return results;
      },
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
