import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { TimeAlignedHeatmapData } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import type { SearchCandidateOverlayEvent } from "@/components/wavesurfer/ViewportOverlaySearchCandidates";

/**
 * Represents different kinds of MIR analysis results for UI display.
 */
export type UiMirResult =
  | { kind: "none" }
  | { kind: "1d"; fn: MirFunctionId; times: Float32Array; values: Float32Array }
  | { kind: "2d"; fn: MirFunctionId; raw: TimeAlignedHeatmapData }
  | { kind: "events"; fn: MirFunctionId; times: Float32Array; events: Array<{ time: number; strength: number; index: number }> };

/**
 * Search result from similarity search.
 */
export type SearchResult = {
  times: Float32Array;
  scores: Float32Array;
  curveKind: "similarity" | "confidence";
  model: {
    kind: "baseline" | "prototype" | "logistic";
    positives: number;
    negatives: number;
    weightL2?: {
      mel: number;
      melForeground: number;
      melContrast?: number;
      onset: number;
      onsetForeground: number;
      onsetContrast?: number;
      mfcc?: number;
      mfccForeground?: number;
      mfccContrast?: number;
    };
    training?: { iterations: number; finalLoss: number };
  };
  candidates: SearchCandidateOverlayEvent[];
  timings: { fingerprintMs: number; scanMs: number; modelMs?: number; totalMs: number };
  meta: { windowSec: number; hopSec: number; skippedWindows: number; scannedWindows: number };
};

/**
 * Timing information from MIR analysis runs.
 */
export type MirTimings = {
  workerTotalMs?: number;
  cpuMs?: number;
  gpuMs?: number;
  totalMs?: number;
  backend?: string;
  usedGpu?: boolean;
};
