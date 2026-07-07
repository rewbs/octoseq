import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { MirTimings } from "./types";

/**
 * MIR UI Store — display/selection state only.
 *
 * Analysis RESULTS live in the unified analysis cache
 * (@/lib/streams analysisStore), keyed by (streamId, analysisId).
 * This store keeps what remains: which analysis is selected in the
 * control panel, which visual tab is shown, and which stream's results
 * the inspection panels are displaying.
 */

/** Visual tab identifier - search, debug, or a MIR function */
export type VisualTabId = "search" | "debug" | MirFunctionId;

interface MirState {
  selected: MirFunctionId;
  runningAnalysis: MirFunctionId | null;
  isRunning: boolean;
  visualTab: VisualTabId;
  lastTimings: MirTimings | null;
  /** Stream ID whose MIR results are currently displayed. Defaults to "mixdown". */
  displayContextInputId: string;
}

interface MirActions {
  setSelected: (id: MirFunctionId) => void;
  setRunningAnalysis: (id: MirFunctionId | null) => void;
  setIsRunning: (running: boolean) => void;
  setVisualTab: (tab: VisualTabId) => void;
  setLastTimings: (timings: MirTimings | null) => void;
  /** Set the stream ID whose MIR results should be displayed */
  setDisplayContextInputId: (inputId: string) => void;
}

export type MirStore = MirState & MirActions;

const initialState: MirState = {
  selected: "spectralCentroid",
  runningAnalysis: null,
  isRunning: false,
  visualTab: "melSpectrogram",
  lastTimings: null,
  displayContextInputId: "mixdown",
};

export const useMirStore = create<MirStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelected: (id) => set({ selected: id }, false, "setSelected"),
      setRunningAnalysis: (id) => set({ runningAnalysis: id }, false, "setRunningAnalysis"),
      setIsRunning: (running) => set({ isRunning: running }, false, "setIsRunning"),
      setVisualTab: (tab) => set({ visualTab: tab }, false, "setVisualTab"),
      setLastTimings: (timings) => set({ lastTimings: timings }, false, "setLastTimings"),
      setDisplayContextInputId: (inputId) =>
        set({ displayContextInputId: inputId }, false, "setDisplayContextInputId"),
    }),
    { name: "MirStore" }
  )
);

/**
 * Tab definitions for the MIR visual tabs, in display order.
 */
export const mirTabDefinitions: Array<{ id: MirFunctionId; label: string; kind: "1d" | "events" | "2d" | "tempoHypotheses" }> = [
  { id: "tempoHypotheses", label: "Tempo Hypotheses", kind: "tempoHypotheses" },
  { id: "amplitudeEnvelope", label: "Amplitude (1D)", kind: "1d" },
  { id: "spectralCentroid", label: "Spectral Centroid (1D)", kind: "1d" },
  { id: "spectralFlux", label: "Spectral Flux (1D)", kind: "1d" },
  { id: "cqtHarmonicEnergy", label: "CQT Harmonic Energy (1D)", kind: "1d" },
  { id: "cqtBassPitchMotion", label: "CQT Bass Pitch Motion (1D)", kind: "1d" },
  { id: "cqtTonalStability", label: "CQT Tonal Stability (1D)", kind: "1d" },
  // Pitch detection (P1)
  { id: "pitchF0", label: "Pitch F0 (1D)", kind: "1d" },
  { id: "pitchConfidence", label: "Pitch Confidence (1D)", kind: "1d" },
  // Activity detection
  { id: "activity", label: "Activity (1D)", kind: "1d" },
  { id: "onsetEnvelope", label: "Onset Envelope (1D)", kind: "1d" },
  { id: "onsetPeaks", label: "Onset Peaks (events)", kind: "events" },
  { id: "beatCandidates", label: "Beat Candidates (events)", kind: "events" },
  { id: "melSpectrogram", label: "Mel Spectrogram (2D)", kind: "2d" },
  { id: "hpssHarmonic", label: "HPSS Harmonic (2D)", kind: "2d" },
  { id: "hpssPercussive", label: "HPSS Percussive (2D)", kind: "2d" },
  { id: "mfcc", label: "MFCC (2D)", kind: "2d" },
  { id: "mfccDelta", label: "MFCC Delta (2D)", kind: "2d" },
  { id: "mfccDeltaDelta", label: "MFCC Delta-Delta (2D)", kind: "2d" },
];
