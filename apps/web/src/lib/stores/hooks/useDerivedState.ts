import { useMemo } from "react";
import { useSearchStore } from "../searchStore";
import { useMirStore, mirTabDefinitions } from "../mirStore";
import { useDebugSignalStore } from "../debugSignalStore";
import { useConfigStore } from "../configStore";
import { useAudioStore } from "../audioStore";
import { usePlaybackStore, getMirroredCursorTime } from "../playbackStore";
import { normaliseForWaveform } from "@octoseq/mir";
import { prepareHpssSpectrogramForHeatmap, prepareMfccForHeatmap } from "@/lib/mirDisplayTransforms";
import type { TimeAlignedHeatmapData } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import type { RefinementCandidate } from "@/lib/searchRefinement";

/**
 * Get candidates indexed by ID for quick lookup.
 */
export function useCandidatesById() {
  const candidates = useSearchStore((s) => s.refinement.candidates);
  return useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
}

/**
 * Get the currently active candidate.
 */
export function useActiveCandidate(): RefinementCandidate | null {
  const activeCandidateId = useSearchStore((s) => s.refinement.activeCandidateId);
  const candidatesById = useCandidatesById();
  return useMemo(() => {
    if (!activeCandidateId) return null;
    return candidatesById.get(activeCandidateId) ?? null;
  }, [candidatesById, activeCandidateId]);
}

/**
 * Get candidates filtered by the current filter.
 */
export function useFilteredCandidates(): RefinementCandidate[] {
  const candidates = useSearchStore((s) => s.refinement.candidates);
  const candidateFilter = useSearchStore((s) => s.candidateFilter);
  return useMemo(() => {
    if (candidateFilter === "all") return candidates;
    return candidates.filter((c) => c.status === candidateFilter);
  }, [candidateFilter, candidates]);
}

/**
 * Get the index of the active candidate within the filtered list.
 */
export function useActiveFilteredIndex(): number {
  const activeCandidateId = useSearchStore((s) => s.refinement.activeCandidateId);
  const filteredCandidates = useFilteredCandidates();
  return useMemo(() => {
    if (!activeCandidateId) return -1;
    return filteredCandidates.findIndex((c) => c.id === activeCandidateId);
  }, [filteredCandidates, activeCandidateId]);
}

/**
 * Get the group logit explanation for the active candidate.
 */
export function useActiveCandidateGroupLogit() {
  const activeCandidate = useActiveCandidate();
  const searchResult = useSearchStore((s) => s.searchResult);
  return useMemo(() => {
    if (!searchResult || !activeCandidate) return null;
    const startMs = Math.round(activeCandidate.startSec * 1000);
    const endMs = Math.round(activeCandidate.endSec * 1000);
    const match = searchResult.candidates.find(
      (c) => Math.round(c.windowStartSec * 1000) === startMs && Math.round(c.windowEndSec * 1000) === endMs
    );
    return match?.explain?.groupLogit ?? null;
  }, [activeCandidate, searchResult]);
}

/**
 * Get normalized search signal for display.
 */
export function useSearchSignal(): Float32Array | null {
  const searchResult = useSearchStore((s) => s.searchResult);
  return useMemo(() => {
    if (!searchResult) return null;
    return normaliseForWaveform(searchResult.scores, { min: 0, max: 1 });
  }, [searchResult]);
}

/**
 * Check if we have search results.
 */
export function useHasSearchResult(): boolean {
  const searchResult = useSearchStore((s) => s.searchResult);
  const searchSignal = useSearchSignal();
  return !!(searchResult && searchSignal);
}

/**
 * Check if refinement labels are available.
 */
export function useRefinementLabelsAvailable(): boolean {
  const stats = useSearchStore((s) => s.refinement.refinementStats);
  return stats.accepted + stats.rejected > 0;
}

/**
 * Check if we have debug signals.
 */
export function useHasDebugSignals(): boolean {
  const debugSignals = useDebugSignalStore((s) => s.debugSignals);
  return debugSignals.length > 0;
}

/**
 * Get debug signals.
 */
export function useDebugSignals() {
  return useDebugSignalStore((s) => s.debugSignals);
}

/**
 * Get tab definitions with availability status.
 * Uses displayContextInputId to check availability for the current audio source.
 */
export function useTabDefs() {
  const mirResults = useMirStore((s) => s.mirResults);
  const displayContextInputId = useMirStore((s) => s.displayContextInputId);
  const getInputMirResult = useMirStore((s) => s.getInputMirResult);
  const hasSearchResult = useHasSearchResult();
  const hasDebugSignals = useHasDebugSignals();

  return useMemo(() => {
    const mirTabsWithAvailability = mirTabDefinitions.map((t) => {
      // Check per-input cache first, then fall back to legacy mirResults
      const hasInputData = !!getInputMirResult(displayContextInputId, t.id);
      const hasLegacyData = !!mirResults[t.id];
      return {
        ...t,
        hasData: hasInputData || hasLegacyData,
      };
    });

    return [
      { id: "search" as const, label: "Similarity", hasData: hasSearchResult },
      { id: "debug" as const, label: "Debug Signals", hasData: hasDebugSignals },
      ...mirTabsWithAvailability,
    ];
  }, [hasSearchResult, hasDebugSignals, mirResults, displayContextInputId, getInputMirResult]);
}

/**
 * Get the current tab's MIR result.
 * Uses the displayContextInputId to get results for the currently selected audio source.
 */
export function useTabResult() {
  const visualTab = useMirStore((s) => s.visualTab);
  const displayContextInputId = useMirStore((s) => s.displayContextInputId);
  const getInputMirResult = useMirStore((s) => s.getInputMirResult);
  const mirResults = useMirStore((s) => s.mirResults);

  // Don't return MIR results for non-MIR tabs
  if (visualTab === "search" || visualTab === "debug") return undefined;

  // Try to get result from per-input cache first (for stems or mixdown)
  const inputResult = getInputMirResult(displayContextInputId, visualTab);
  if (inputResult) return inputResult;

  // Fall back to legacy mirResults for backward compatibility (mixdown only)
  return mirResults[visualTab];
}

/**
 * Get displayed heatmap data with display transforms applied.
 */
export function useDisplayedHeatmap(): TimeAlignedHeatmapData | null {
  const tabResult = useTabResult();
  const showDcBin = useConfigStore((s) => s.showDcBin);
  const showMfccC0 = useConfigStore((s) => s.showMfccC0);

  return useMemo(() => {
    if (!tabResult || tabResult.kind !== "2d") return null;
    const { raw, fn } = tabResult;

    const displayData =
      fn === "hpssHarmonic" || fn === "hpssPercussive"
        ? prepareHpssSpectrogramForHeatmap(raw.data, { showDc: showDcBin, useDb: true, minDb: -80, maxDb: 0 })
        : fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta"
          ? prepareMfccForHeatmap(raw.data, { showC0: showMfccC0 })
          : raw.data;

    return { data: displayData, times: raw.times };
  }, [tabResult, showDcBin, showMfccC0]);
}

/**
 * Get the value range for heatmap display.
 */
export function useHeatmapValueRange() {
  const tabResult = useTabResult();
  return useMemo(() => {
    if (!tabResult || tabResult.kind !== "2d") return undefined;
    const fn = tabResult.fn;

    // For HPSS + MFCC we pre-normalise to [0,1], so use a fixed colormap range.
    if (fn === "hpssHarmonic" || fn === "hpssPercussive" || fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") {
      return { min: 0, max: 1 };
    }

    return undefined;
  }, [tabResult]);
}

/**
 * Get the Y-axis label for heatmap display.
 */
export function useHeatmapYAxisLabel(): string {
  const tabResult = useTabResult();
  return useMemo(() => {
    if (!tabResult || tabResult.kind !== "2d") return "feature index";
    const fn = tabResult.fn;

    // MFCC coefficients are DCT basis weights (not frequency bins).
    if (fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") return "MFCC index";

    return "frequency bin";
  }, [tabResult]);
}

/**
 * Get the visible time range for visualizations.
 */
export function useVisibleRange() {
  const viewport = usePlaybackStore((s) => s.viewport);
  const audioDuration = useAudioStore((s) => s.audioDuration);

  return useMemo(() => {
    // If we don't have a viewport yet, fall back to the full audio duration.
    if (!viewport) {
      return { startTime: 0, endTime: audioDuration };
    }
    return { startTime: viewport.startTime, endTime: viewport.endTime };
  }, [viewport, audioDuration]);
}

/**
 * Get the mirrored cursor time (cursor if available, otherwise playhead).
 */
export function useMirroredCursorTime(): number {
  const cursorTimeSec = usePlaybackStore((s) => s.cursorTimeSec);
  const playheadTimeSec = usePlaybackStore((s) => s.playheadTimeSec);
  const audioDuration = useAudioStore((s) => s.audioDuration);

  return useMemo(
    () => getMirroredCursorTime(cursorTimeSec, playheadTimeSec, audioDuration),
    [cursorTimeSec, playheadTimeSec, audioDuration]
  );
}
