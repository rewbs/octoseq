// Stores
export { usePlaybackStore, getMirroredCursorTime, type PlaybackStore } from "./playbackStore";
export { useConfigStore, type ConfigStore } from "./configStore";
export { useMirStore, mirTabDefinitions, type MirStore, type VisualTabId } from "./mirStore";
export { useSearchStore, type SearchStore } from "./searchStore";
export { useDebugSignalStore, type DebugSignalStore } from "./debugSignalStore";
export { useScriptErrorStore, type ScriptErrorStore, type HistoricalScriptError } from "./scriptErrorStore";
export { useBeatGridStore, type BeatGridStore } from "./beatGridStore";
export { useMusicalTimeStore, type MusicalTimeStore, type AudioIdentity } from "./musicalTimeStore";
export { useManualTempoStore, type ManualTempoStore, type ExtendedTempoHypothesis, type TempoHypothesisSource, type BeatMark } from "./manualTempoStore";
export { useFrequencyBandStore, type FrequencyBandStore, type BandInvalidationEvent, type BandInvalidationCallback } from "./frequencyBandStore";
export { useBandMirStore, setupBandMirInvalidation, type BandMirStore } from "./bandMirStore";
export { useBandProposalStore, type BandProposalStore } from "./bandProposalStore";
export { useProjectStore, type ProjectStore } from "./projectStore";
export { useAutosaveStore, type AutosaveStore } from "./autosaveStore";
export {
  useInspectionStore,
  type InspectionStore,
  type InspectionViewMode,
} from "./inspectionStore";
export { useInterpretationTreeStore } from "./interpretationTreeStore";
export { useAudioInputStore, type AudioInputStore } from "./audioInputStore";
export { makeInputMirCacheKey, type InputMirCacheKey } from "./mirStore";
export {
  useCandidateEventStore,
  type CandidateEventStore,
  type CandidateEvent,
  type CandidateStream,
  type CandidateEventType,
  getSourceColor,
  makeStreamId,
} from "./candidateEventStore";
export {
  useAuthoredEventStore,
  type AuthoredEventStore,
  getAuthoredColor,
} from "./authoredEventStore";

// Types
export type { UiMirResult, SearchResult, MirTimings, DebugSignal, AnalysisResult, RawAnalysisResult } from "./types";
export type {
  Project,
  ProjectSerialized,
  ProjectAudioReference,
  ProjectAudioCollection,
  ProjectScript,
  ProjectScripts,
  ProjectInterpretation,
  ProjectBeatGridState,
  ProjectUIState,
  AudioLoadStatus,
} from "./types/project";

// Action hooks
export { useMirActions } from "./hooks/useMirActions";
export { useSearchActions } from "./hooks/useSearchActions";
export { useNavigationActions } from "./hooks/useNavigationActions";
export { useAudioActions } from "./hooks/useAudioActions";
export { useBandMirActions } from "./hooks/useBandMirActions";
export { useBandProposalActions } from "./hooks/useBandProposalActions";
export { useCandidateEventActions } from "./hooks/useCandidateEventActions";
export { useAuthoredEventActions } from "./hooks/useAuthoredEventActions";
export { useProjectActions } from "./hooks/useProjectActions";

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
