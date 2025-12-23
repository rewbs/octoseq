// Stores
export { useAudioStore, type AudioStore } from "./audioStore";
export { usePlaybackStore, getMirroredCursorTime, type PlaybackStore } from "./playbackStore";
export { useConfigStore, type ConfigStore } from "./configStore";
export { useMirStore, mirTabDefinitions, type MirStore, type VisualTabId } from "./mirStore";
export { useSearchStore, type SearchStore } from "./searchStore";
export { useDebugSignalStore, type DebugSignalStore } from "./debugSignalStore";

// Types
export type { UiMirResult, SearchResult, MirTimings, DebugSignal, AnalysisResult, RawAnalysisResult } from "./types";

// Action hooks
export { useMirActions } from "./hooks/useMirActions";
export { useSearchActions } from "./hooks/useSearchActions";
export { useNavigationActions } from "./hooks/useNavigationActions";
export { useAudioActions } from "./hooks/useAudioActions";

// Derived state hooks
export {
  useCandidatesById,
  useActiveCandidate,
  useFilteredCandidates,
  useActiveFilteredIndex,
  useActiveCandidateGroupLogit,
  useSearchSignal,
  useHasSearchResult,
  useRefinementLabelsAvailable,
  useHasDebugSignals,
  useDebugSignals,
  useTabDefs,
  useTabResult,
  useDisplayedHeatmap,
  useHeatmapValueRange,
  useHeatmapYAxisLabel,
  useVisibleRange,
  useMirroredCursorTime,
} from "./hooks/useDerivedState";
