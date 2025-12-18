import { useMemo } from "react";
import { useSearchStore } from "../searchStore";
import { useMirStore, mirTabDefinitions } from "../mirStore";
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
 * Get tab definitions with availability status.
 */
export function useTabDefs() {
  const mirResults = useMirStore((s) => s.mirResults);
  const hasSearchResult = useHasSearchResult();

  return useMemo(() => {
    const mirTabsWithAvailability = mirTabDefinitions.map((t) => ({
      ...t,
      hasData: !!mirResults[t.id],
    }));

    return [
      { id: "search" as const, label: "Similarity", hasData: hasSearchResult },
      ...mirTabsWithAvailability,
    ];
  }, [hasSearchResult, mirResults]);
}

/**
 * Get the current tab's MIR result.
 */
export function useTabResult() {
  const visualTab = useMirStore((s) => s.visualTab);
  const mirResults = useMirStore((s) => s.mirResults);
  return visualTab !== "search" ? mirResults[visualTab] : undefined;
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
