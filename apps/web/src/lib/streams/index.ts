/**
 * Unified Stream Model — public entry point.
 * See docs/design/phase1-unified-streams.md
 */

export * from "./types";
export { useStreamStore } from "./streamStore";
export type { AddStemParams, AddBandParams, BandShapePatch } from "./streamStore";
export { useAnalysisStore } from "./analysisStore";
export { audioCache } from "./audioCache";
export {
  loadMixdown,
  addStemWithAudio,
  addBand,
  replaceStreamAudio,
  updateBandShape,
  removeStreamCascade,
  resetAllStreams,
  toFrequencyBand,
} from "./streamActions";
export {
  runStreamAnalysis,
  runStreamAnalyses,
  cancelAnalysis,
  cancelAllAnalyses,
  clearAnalysisMemos,
  type RunAnalysisOptions,
} from "./analysisRunner";
