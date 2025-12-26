// Stores
export { useAudioStore, type AudioStore } from "./audioStore";
export { usePlaybackStore, getMirroredCursorTime, type PlaybackStore } from "./playbackStore";
export { useConfigStore, type ConfigStore } from "./configStore";
export { useMirStore, mirTabDefinitions, type MirStore, type VisualTabId } from "./mirStore";
export { useSearchStore, type SearchStore } from "./searchStore";
export { useDebugSignalStore, type DebugSignalStore } from "./debugSignalStore";
export { useBeatGridStore, type BeatGridStore } from "./beatGridStore";
export { useMusicalTimeStore, type MusicalTimeStore, type AudioIdentity } from "./musicalTimeStore";
export { useManualTempoStore, type ManualTempoStore, type ExtendedTempoHypothesis, type TempoHypothesisSource, type BeatMark } from "./manualTempoStore";
export { useFrequencyBandStore, type FrequencyBandStore, type BandInvalidationEvent, type BandInvalidationCallback } from "./frequencyBandStore";
export { useBandMirStore, type BandMirStore } from "./bandMirStore";
export { useBandProposalStore, type BandProposalStore } from "./bandProposalStore";

// Types
export type { UiMirResult, SearchResult, MirTimings, DebugSignal, AnalysisResult, RawAnalysisResult } from "./types";

// Action hooks
export { useMirActions } from "./hooks/useMirActions";
export { useSearchActions } from "./hooks/useSearchActions";
export { useNavigationActions } from "./hooks/useNavigationActions";
export { useAudioActions } from "./hooks/useAudioActions";
export { useBandMirActions } from "./hooks/useBandMirActions";
export { useBandProposalActions } from "./hooks/useBandProposalActions";

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
