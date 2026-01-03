import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";

interface ConfigState {
  // Debug/runtime
  debug: boolean;
  useWorker: boolean;
  enableGpu: boolean;
  bypassVisualiser: boolean;

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

  // Transient FFT (used by HPSS)
  transientFftSize: number;
  transientHopSize: number;

  // Timbre FFT (used by MFCC)
  timbreFftSize: number;
  timbreHopSize: number;

  // HPSS
  hpssTimeMedian: number;
  hpssFreqMedian: number;

  // MFCC
  mfccNCoeffs: number;

  // Tempo Hypotheses
  tempoMinBpm: number;
  tempoMaxBpm: number;
  tempoBinSize: number;
  tempoMaxHypotheses: number;
  tempoWeightByStrength: boolean;

  // Display options
  showDcBin: boolean;
  showMfccC0: boolean;
  heatmapScheme: HeatmapColorScheme;
  isConfigOpen: boolean;
  isDebugOpen: boolean;

  // Band MIR (F3)
  bandMirAutoCompute: boolean;

  // CQT
  cqtBinsPerOctave: number;
  cqtFMin: string; // Keep as string for optional input
  cqtFMax: string;
}

interface ConfigActions {
  // Debug/runtime setters
  setDebug: (v: boolean) => void;
  setUseWorker: (v: boolean) => void;
  setEnableGpu: (v: boolean) => void;
  setBypassVisualiser: (v: boolean) => void;

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

  // Transient FFT setters
  setTransientFftSize: (v: number) => void;
  setTransientHopSize: (v: number) => void;

  // Timbre FFT setters
  setTimbreFftSize: (v: number) => void;
  setTimbreHopSize: (v: number) => void;

  // HPSS setters
  setHpssTimeMedian: (v: number) => void;
  setHpssFreqMedian: (v: number) => void;

  // MFCC setters
  setMfccNCoeffs: (v: number) => void;

  // Tempo Hypotheses setters
  setTempoMinBpm: (v: number) => void;
  setTempoMaxBpm: (v: number) => void;
  setTempoBinSize: (v: number) => void;
  setTempoMaxHypotheses: (v: number) => void;
  setTempoWeightByStrength: (v: boolean) => void;

  // Display setters
  setShowDcBin: (v: boolean) => void;
  setShowMfccC0: (v: boolean) => void;
  setHeatmapScheme: (v: HeatmapColorScheme) => void;
  setIsConfigOpen: (v: boolean) => void;
  setIsDebugOpen: (v: boolean) => void;

  // Band MIR (F3) setters
  setBandMirAutoCompute: (v: boolean) => void;

  // CQT setters
  setCqtBinsPerOctave: (v: number) => void;
  setCqtFMin: (v: string) => void;
  setCqtFMax: (v: string) => void;

  // Utility
  parseOptionalNumber: (v: string) => number | undefined;
  getSpectrogramConfig: () => { fftSize: number; hopSize: number; window: "hann" };
  getMelConfig: () => { nMels: number; fMin?: number; fMax?: number };
  getOnsetConfig: () => { smoothMs: number; diffMethod: "rectified" | "abs"; useLog: boolean };
  getPeakPickConfig: () => { minIntervalSec: number; threshold?: number; adaptiveFactor?: number };
  getHpssConfig: () => { timeMedian: number; freqMedian: number; spectrogram: { fftSize: number; hopSize: number; window: "hann" } };
  getMfccConfig: () => { nCoeffs: number; spectrogram: { fftSize: number; hopSize: number; window: "hann" } };
  getTempoHypothesesConfig: () => { minBpm: number; maxBpm: number; binSizeBpm: number; maxHypotheses: number; weightByStrength: boolean };
  getCqtConfig: () => { binsPerOctave?: number; fMin?: number; fMax?: number };
}

export type ConfigStore = ConfigState & ConfigActions;

const initialState: ConfigState = {
  // Debug/runtime
  debug: false,
  useWorker: true,
  enableGpu: true,
  bypassVisualiser: false,

  // FFT/Spectrogram
  fftSize: 1024,
  hopSize: 128,

  // Mel
  melBands: 64,
  melFMin: "",
  melFMax: "",

  // Onset
  onsetSmoothMs: 20,
  onsetDiffMethod: "rectified",
  onsetUseLog: false,

  // Peak picking
  peakMinIntervalMs: 120,
  peakThreshold: "",
  peakAdaptiveFactor: "",

  // Transient FFT (used by HPSS)
  transientFftSize: 1024,
  transientHopSize: 128,

  // Timbre FFT (used by MFCC)
  timbreFftSize: 4096,
  timbreHopSize: 512,

  // HPSS
  hpssTimeMedian: 17,
  hpssFreqMedian: 17,

  // MFCC
  mfccNCoeffs: 13,

  // Tempo Hypotheses
  tempoMinBpm: 24,
  tempoMaxBpm: 200,
  tempoBinSize: 1.0,
  tempoMaxHypotheses: 5,
  tempoWeightByStrength: true,

  // Display options
  showDcBin: false,
  showMfccC0: false,
  heatmapScheme: "plasma",
  isConfigOpen: false,
  isDebugOpen: false,

  // Band MIR (F3)
  bandMirAutoCompute: false,

  // CQT (defaults match CQT_DEFAULTS in mir library)
  cqtBinsPerOctave: 24,
  cqtFMin: "", // empty = use library default (32.7 Hz, C1)
  cqtFMax: "", // empty = use library default (8372 Hz, C9)
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
        setBypassVisualiser: (v) => set({ bypassVisualiser: v }, false, "setBypassVisualiser"),

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

        // Transient FFT setters
        setTransientFftSize: (v) => set({ transientFftSize: v }, false, "setTransientFftSize"),
        setTransientHopSize: (v) => set({ transientHopSize: v }, false, "setTransientHopSize"),

        // Timbre FFT setters
        setTimbreFftSize: (v) => set({ timbreFftSize: v }, false, "setTimbreFftSize"),
        setTimbreHopSize: (v) => set({ timbreHopSize: v }, false, "setTimbreHopSize"),

        // HPSS setters
        setHpssTimeMedian: (v) => set({ hpssTimeMedian: v }, false, "setHpssTimeMedian"),
        setHpssFreqMedian: (v) => set({ hpssFreqMedian: v }, false, "setHpssFreqMedian"),

        // MFCC setters
        setMfccNCoeffs: (v) => set({ mfccNCoeffs: v }, false, "setMfccNCoeffs"),

        // Tempo Hypotheses setters
        setTempoMinBpm: (v) => set({ tempoMinBpm: v }, false, "setTempoMinBpm"),
        setTempoMaxBpm: (v) => set({ tempoMaxBpm: v }, false, "setTempoMaxBpm"),
        setTempoBinSize: (v) => set({ tempoBinSize: v }, false, "setTempoBinSize"),
        setTempoMaxHypotheses: (v) => set({ tempoMaxHypotheses: v }, false, "setTempoMaxHypotheses"),
        setTempoWeightByStrength: (v) => set({ tempoWeightByStrength: v }, false, "setTempoWeightByStrength"),

        // Display setters
        setShowDcBin: (v) => set({ showDcBin: v }, false, "setShowDcBin"),
        setShowMfccC0: (v) => set({ showMfccC0: v }, false, "setShowMfccC0"),
        setHeatmapScheme: (v) => set({ heatmapScheme: v }, false, "setHeatmapScheme"),
        setIsConfigOpen: (v) => set({ isConfigOpen: v }, false, "setIsConfigOpen"),
        setIsDebugOpen: (v) => set({ isDebugOpen: v }, false, "setIsDebugOpen"),

        // Band MIR (F3) setters
        setBandMirAutoCompute: (v) => set({ bandMirAutoCompute: v }, false, "setBandMirAutoCompute"),

        // CQT setters
        setCqtBinsPerOctave: (v) => set({ cqtBinsPerOctave: v }, false, "setCqtBinsPerOctave"),
        setCqtFMin: (v) => set({ cqtFMin: v }, false, "setCqtFMin"),
        setCqtFMax: (v) => set({ cqtFMax: v }, false, "setCqtFMax"),

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
            spectrogram: {
              fftSize: state.transientFftSize,
              hopSize: Math.min(state.transientHopSize, state.transientFftSize),
              window: "hann" as const,
            },
          };
        },

        getMfccConfig: () => {
          const state = get();
          return {
            nCoeffs: state.mfccNCoeffs,
            spectrogram: {
              fftSize: state.timbreFftSize,
              hopSize: Math.min(state.timbreHopSize, state.timbreFftSize),
              window: "hann" as const,
            },
          };
        },

        getTempoHypothesesConfig: () => {
          const state = get();
          return {
            minBpm: state.tempoMinBpm,
            maxBpm: state.tempoMaxBpm,
            binSizeBpm: state.tempoBinSize,
            maxHypotheses: state.tempoMaxHypotheses,
            weightByStrength: state.tempoWeightByStrength,
          };
        },

        getCqtConfig: () => {
          const state = get();
          const parseOptionalNumber = state.parseOptionalNumber;
          return {
            binsPerOctave: state.cqtBinsPerOctave,
            fMin: parseOptionalNumber(state.cqtFMin),
            fMax: parseOptionalNumber(state.cqtFMax),
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
          bypassVisualiser: state.bypassVisualiser,
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
          transientFftSize: state.transientFftSize,
          transientHopSize: state.transientHopSize,
          timbreFftSize: state.timbreFftSize,
          timbreHopSize: state.timbreHopSize,
          hpssTimeMedian: state.hpssTimeMedian,
          hpssFreqMedian: state.hpssFreqMedian,
          mfccNCoeffs: state.mfccNCoeffs,
          tempoMinBpm: state.tempoMinBpm,
          tempoMaxBpm: state.tempoMaxBpm,
          tempoBinSize: state.tempoBinSize,
          tempoMaxHypotheses: state.tempoMaxHypotheses,
          tempoWeightByStrength: state.tempoWeightByStrength,
          showDcBin: state.showDcBin,
          showMfccC0: state.showMfccC0,
          heatmapScheme: state.heatmapScheme,
          bandMirAutoCompute: state.bandMirAutoCompute,
          cqtBinsPerOctave: state.cqtBinsPerOctave,
          cqtFMin: state.cqtFMin,
          cqtFMax: state.cqtFMax,
        }),
      }
    ),
    { name: "config-store" }
  )
);
