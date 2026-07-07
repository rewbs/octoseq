/**
 * Unified Stream Model — public entry point.
 * See docs/design/phase1-unified-streams.md
 */

export * from "./types";
export { useStreamStore } from "./streamStore";
export type { AddStemParams, AddBandParams, BandShapePatch } from "./streamStore";
export { useAnalysisStore } from "./analysisStore";
export { audioCache, rawFileCache } from "./audioCache";
export { useAudioSourceStore } from "./audioSourceStore";
export type {
  AudioSource,
  AudioSourceStatus,
  LocalAudioSource,
  RemoteAudioSource,
  GeneratedAudioSource,
} from "./audioSourceStore";
export { toDisplaySignal, toDisplayEvents, toUiResult } from "./display";
export type { DisplaySignal, DisplayEvent, UiDisplayResult } from "./display";
export { useBandEditingStore } from "./bandEditingStore";
export type { BandSnapMode, BandDragState } from "./bandEditingStore";
export { useViewStore } from "./viewStore";
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
