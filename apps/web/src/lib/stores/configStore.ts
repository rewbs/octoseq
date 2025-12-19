import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";

interface ConfigState {
  // Debug/runtime
  debug: boolean;
  useWorker: boolean;
  enableGpu: boolean;

  // FFT/Spectrogram
  fftSize: number;
  hopSize: number;

  // Mel
  melBands: number;
  melFMin: string; // Keep as string for optional input
  melFMax: string;

  // Onset
  onsetSmoothMs: number;
  onsetDiffMethod: "rectified" | "abs";
  onsetUseLog: boolean;

  // Peak picking
  peakMinIntervalMs: number;
  peakThreshold: string;
  peakAdaptiveFactor: string;

  // HPSS
  hpssTimeMedian: number;
  hpssFreqMedian: number;

  // MFCC
  mfccNCoeffs: number;

  // Display options
  showDcBin: boolean;
  showMfccC0: boolean;
  heatmapScheme: HeatmapColorScheme;
  isConfigOpen: boolean;
  isDebugOpen: boolean;
}

interface ConfigActions {
  // Debug/runtime setters
  setDebug: (v: boolean) => void;
  setUseWorker: (v: boolean) => void;
  setEnableGpu: (v: boolean) => void;

  // FFT/Spectrogram setters
  setFftSize: (v: number) => void;
  setHopSize: (v: number) => void;

  // Mel setters
  setMelBands: (v: number) => void;
  setMelFMin: (v: string) => void;
  setMelFMax: (v: string) => void;

  // Onset setters
  setOnsetSmoothMs: (v: number) => void;
  setOnsetDiffMethod: (v: "rectified" | "abs") => void;
  setOnsetUseLog: (v: boolean) => void;

  // Peak picking setters
  setPeakMinIntervalMs: (v: number) => void;
  setPeakThreshold: (v: string) => void;
  setPeakAdaptiveFactor: (v: string) => void;

  // HPSS setters
  setHpssTimeMedian: (v: number) => void;
  setHpssFreqMedian: (v: number) => void;

  // MFCC setters
  setMfccNCoeffs: (v: number) => void;

  // Display setters
  setShowDcBin: (v: boolean) => void;
  setShowMfccC0: (v: boolean) => void;
  setHeatmapScheme: (v: HeatmapColorScheme) => void;
  setIsConfigOpen: (v: boolean) => void;
  setIsDebugOpen: (v: boolean) => void;

  // Utility
  parseOptionalNumber: (v: string) => number | undefined;
  getSpectrogramConfig: () => { fftSize: number; hopSize: number; window: "hann" };
  getMelConfig: () => { nMels: number; fMin?: number; fMax?: number };
  getOnsetConfig: () => { smoothMs: number; diffMethod: "rectified" | "abs"; useLog: boolean };
  getPeakPickConfig: () => { minIntervalSec: number; threshold?: number; adaptiveFactor?: number };
  getHpssConfig: () => { timeMedian: number; freqMedian: number };
  getMfccConfig: () => { nCoeffs: number };
}

export type ConfigStore = ConfigState & ConfigActions;

const initialState: ConfigState = {
  // Debug/runtime
  debug: false,
  useWorker: true,
  enableGpu: true,

  // FFT/Spectrogram
  fftSize: 512,
  hopSize: 128,

  // Mel
  melBands: 64,
  melFMin: "",
  melFMax: "",

  // Onset
  onsetSmoothMs: 30,
  onsetDiffMethod: "rectified",
  onsetUseLog: false,

  // Peak picking
  peakMinIntervalMs: 120,
  peakThreshold: "",
  peakAdaptiveFactor: "",

  // HPSS
  hpssTimeMedian: 17,
  hpssFreqMedian: 17,

  // MFCC
  mfccNCoeffs: 13,

  // Display options
  showDcBin: false,
  showMfccC0: false,
  heatmapScheme: "grayscale",
  isConfigOpen: false,
  isDebugOpen: false,
};

export const useConfigStore = create<ConfigStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // Debug/runtime setters
        setDebug: (v) => set({ debug: v }, false, "setDebug"),
        setUseWorker: (v) => set({ useWorker: v }, false, "setUseWorker"),
        setEnableGpu: (v) => set({ enableGpu: v }, false, "setEnableGpu"),

        // FFT/Spectrogram setters
        setFftSize: (v) => set({ fftSize: v }, false, "setFftSize"),
        setHopSize: (v) => set({ hopSize: v }, false, "setHopSize"),

        // Mel setters
        setMelBands: (v) => set({ melBands: v }, false, "setMelBands"),
        setMelFMin: (v) => set({ melFMin: v }, false, "setMelFMin"),
        setMelFMax: (v) => set({ melFMax: v }, false, "setMelFMax"),

        // Onset setters
        setOnsetSmoothMs: (v) => set({ onsetSmoothMs: v }, false, "setOnsetSmoothMs"),
        setOnsetDiffMethod: (v) => set({ onsetDiffMethod: v }, false, "setOnsetDiffMethod"),
        setOnsetUseLog: (v) => set({ onsetUseLog: v }, false, "setOnsetUseLog"),

        // Peak picking setters
        setPeakMinIntervalMs: (v) => set({ peakMinIntervalMs: v }, false, "setPeakMinIntervalMs"),
        setPeakThreshold: (v) => set({ peakThreshold: v }, false, "setPeakThreshold"),
        setPeakAdaptiveFactor: (v) => set({ peakAdaptiveFactor: v }, false, "setPeakAdaptiveFactor"),

        // HPSS setters
        setHpssTimeMedian: (v) => set({ hpssTimeMedian: v }, false, "setHpssTimeMedian"),
        setHpssFreqMedian: (v) => set({ hpssFreqMedian: v }, false, "setHpssFreqMedian"),

        // MFCC setters
        setMfccNCoeffs: (v) => set({ mfccNCoeffs: v }, false, "setMfccNCoeffs"),

        // Display setters
        setShowDcBin: (v) => set({ showDcBin: v }, false, "setShowDcBin"),
        setShowMfccC0: (v) => set({ showMfccC0: v }, false, "setShowMfccC0"),
        setHeatmapScheme: (v) => set({ heatmapScheme: v }, false, "setHeatmapScheme"),
        setIsConfigOpen: (v) => set({ isConfigOpen: v }, false, "setIsConfigOpen"),
        setIsDebugOpen: (v) => set({ isDebugOpen: v }, false, "setIsDebugOpen"),

        // Utility
        parseOptionalNumber: (v: string): number | undefined => {
          if (v.trim() === "") return undefined;
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        },

        getSpectrogramConfig: () => {
          const state = get();
          return {
            fftSize: state.fftSize,
            hopSize: Math.min(state.hopSize, state.fftSize),
            window: "hann" as const,
          };
        },

        getMelConfig: () => {
          const state = get();
          const parseOptionalNumber = state.parseOptionalNumber;
          return {
            nMels: state.melBands,
            fMin: parseOptionalNumber(state.melFMin),
            fMax: parseOptionalNumber(state.melFMax),
          };
        },

        getOnsetConfig: () => {
          const state = get();
          return {
            smoothMs: state.onsetSmoothMs,
            diffMethod: state.onsetDiffMethod,
            useLog: state.onsetUseLog,
          };
        },

        getPeakPickConfig: () => {
          const state = get();
          const parseOptionalNumber = state.parseOptionalNumber;
          return {
            minIntervalSec: state.peakMinIntervalMs / 1000,
            threshold: parseOptionalNumber(state.peakThreshold),
            adaptiveFactor: parseOptionalNumber(state.peakAdaptiveFactor),
          };
        },

        getHpssConfig: () => {
          const state = get();
          return {
            timeMedian: state.hpssTimeMedian,
            freqMedian: state.hpssFreqMedian,
          };
        },

        getMfccConfig: () => {
          const state = get();
          return {
            nCoeffs: state.mfccNCoeffs,
          };
        },
      }),
      {
        name: "octoseq-config",
        // Only persist certain fields, not UI state like isConfigOpen
        partialize: (state) => ({
          debug: state.debug,
          useWorker: state.useWorker,
          enableGpu: state.enableGpu,
          fftSize: state.fftSize,
          hopSize: state.hopSize,
          melBands: state.melBands,
          melFMin: state.melFMin,
          melFMax: state.melFMax,
          onsetSmoothMs: state.onsetSmoothMs,
          onsetDiffMethod: state.onsetDiffMethod,
          onsetUseLog: state.onsetUseLog,
          peakMinIntervalMs: state.peakMinIntervalMs,
          peakThreshold: state.peakThreshold,
          peakAdaptiveFactor: state.peakAdaptiveFactor,
          hpssTimeMedian: state.hpssTimeMedian,
          hpssFreqMedian: state.hpssFreqMedian,
          mfccNCoeffs: state.mfccNCoeffs,
          showDcBin: state.showDcBin,
          showMfccC0: state.showMfccC0,
          heatmapScheme: state.heatmapScheme,
        }),
      }
    ),
    { name: "config-store" }
  )
);
