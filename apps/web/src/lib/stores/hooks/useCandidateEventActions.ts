import { useCallback } from "react";
import { nanoid } from "nanoid";
import { peakPick } from "@octoseq/mir";
import {
  analysisKey,
  isAudioStream,
  toDisplayEvents,
  toDisplaySignal,
  useAnalysisStore,
  useStreamStore,
} from "@/lib/streams";
import {
  useCandidateEventStore,
  type CandidateEvent,
  type CandidateEventType,
  type CandidateStream,
  getSourceColor,
  makeStreamId,
} from "../candidateEventStore";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

/**
 * Map from event type to the MIR function that generates it.
 */
const EVENT_TYPE_TO_MIR_FN: Record<CandidateEventType, MirFunctionId> = {
  onset: "onsetPeaks",
  beat: "beatCandidates",
  flux: "spectralFlux",
};

/**
 * Human-readable labels for event types.
 */
const EVENT_TYPE_LABELS: Record<CandidateEventType, string> = {
  onset: "Onsets",
  beat: "Beats",
  flux: "Flux Peaks",
};

/**
 * Hook that provides candidate event generation actions.
 */
export function useCandidateEventActions() {
  /**
   * Generate candidates for a specific source and event type.
   * Returns true if generation was successful.
   */
  const generateForSource = useCallback(
    (sourceId: string, eventType: CandidateEventType): boolean => {
      const streamStore = useStreamStore.getState();
      const candidateStore = useCandidateEventStore.getState();

      // Get source info
      const stream = streamStore.getStream(sourceId);
      if (!stream || !isAudioStream(stream)) {
        console.warn(`[CandidateEvents] Source not found: ${sourceId}`);
        return false;
      }

      // Determine source index for color assignment
      const allStreams = streamStore.getAudioStreams();
      const sourceIndex = allStreams.findIndex((s) => s.id === sourceId);

      // Get MIR result for this source and event type
      const mirFn = EVENT_TYPE_TO_MIR_FN[eventType];
      const mirResult = useAnalysisStore.getState().getResult(analysisKey(sourceId, mirFn));

      if (!mirResult) {
        console.warn(
          `[CandidateEvents] No MIR result for ${sourceId}:${mirFn}. Run analysis first.`
        );
        return false;
      }

      let events: CandidateEvent[] = [];

      const directEvents = toDisplayEvents(mirResult);
      if (directEvents) {
        // Direct event extraction (onsetPeaks, beatCandidates)
        events = directEvents.map((e) => ({
          id: nanoid(),
          time: e.time,
          strength: e.strength,
          sourceId,
          sourceLabel: stream.label,
          eventType,
        }));
      } else if (mirResult.kind === "1d" && eventType === "flux") {
        // For spectral flux, do peak picking on the display-normalized 1D signal
        const display = toDisplaySignal(mirResult, mirFn);
        if (!display) return false;
        const peaks = peakPick(display.times, display.values, {
          adaptive: { method: "meanStd", factor: 1.0 },
          minIntervalSec: 0.05, // 50ms minimum between peaks
          strict: true,
        });

        events = peaks.map((p) => ({
          id: nanoid(),
          time: p.time,
          strength: p.strength,
          sourceId,
          sourceLabel: stream.label,
          eventType,
        }));
      } else {
        console.warn(
          `[CandidateEvents] Unexpected MIR result kind for ${eventType}: ${mirResult.kind}`
        );
        return false;
      }

      // Create the stream
      const streamId = makeStreamId(sourceId, eventType);
      const candidateStream: CandidateStream = {
        id: streamId,
        sourceId,
        sourceLabel: stream.label,
        eventType,
        events,
        generatedAt: new Date().toISOString(),
        isVisible: true,
        color: getSourceColor(sourceIndex),
      };

      candidateStore.setStream(candidateStream);
      return true;
    },
    []
  );

  /**
   * Generate all event types for a specific source.
   */
  const generateAllTypesForSource = useCallback(
    (sourceId: string): void => {
      const eventTypes: CandidateEventType[] = ["onset", "beat", "flux"];
      for (const eventType of eventTypes) {
        generateForSource(sourceId, eventType);
      }
    },
    [generateForSource]
  );

  /**
   * Generate candidates for all sources and all event types.
   */
  const generateAll = useCallback((): void => {
    const candidateStore = useCandidateEventStore.getState();

    candidateStore.setGenerating(true);

    try {
      const allStreams = useStreamStore.getState().getAudioStreams();

      for (const stream of allStreams) {
        generateAllTypesForSource(stream.id);
      }

      candidateStore.setError(null);
    } catch (e) {
      console.error("[CandidateEvents] Generation failed:", e);
      candidateStore.setError(
        e instanceof Error ? e.message : "Unknown error during generation"
      );
    } finally {
      candidateStore.setGenerating(false);
    }
  }, [generateAllTypesForSource]);

  /**
   * Generate candidates for all sources for a specific event type.
   */
  const generateAllSourcesForType = useCallback(
    (eventType: CandidateEventType): void => {
      const candidateStore = useCandidateEventStore.getState();

      candidateStore.setGenerating(true);

      try {
        const allStreams = useStreamStore.getState().getAudioStreams();

        for (const stream of allStreams) {
          generateForSource(stream.id, eventType);
        }

        candidateStore.setError(null);
      } catch (e) {
        console.error("[CandidateEvents] Generation failed:", e);
        candidateStore.setError(
          e instanceof Error ? e.message : "Unknown error during generation"
        );
      } finally {
        candidateStore.setGenerating(false);
      }
    },
    [generateForSource]
  );

  /**
   * Clear all candidates.
   */
  const clearAll = useCallback((): void => {
    useCandidateEventStore.getState().clearAll();
  }, []);

  /**
   * Clear candidates for a specific source.
   */
  const clearForSource = useCallback((sourceId: string): void => {
    useCandidateEventStore.getState().clearForSource(sourceId);
  }, []);

  /**
   * Toggle visibility of a specific stream.
   */
  const toggleStreamVisibility = useCallback((streamId: string): void => {
    useCandidateEventStore.getState().toggleStreamVisibility(streamId);
  }, []);

  /**
   * Set visibility for all streams of an event type.
   */
  const setEventTypeVisibility = useCallback(
    (eventType: CandidateEventType, visible: boolean): void => {
      useCandidateEventStore.getState().setEventTypeVisibility(eventType, visible);
    },
    []
  );

  /**
   * Inspect a specific stream.
   */
  const inspectStream = useCallback((streamId: string | null): void => {
    useCandidateEventStore.getState().inspectStream(streamId);
  }, []);

  /**
   * Check if MIR analysis has been run for a source and event type.
   */
  const hasAnalysisFor = useCallback(
    (sourceId: string, eventType: CandidateEventType): boolean => {
      const mirFn = EVENT_TYPE_TO_MIR_FN[eventType];
      return useAnalysisStore.getState().getResult(analysisKey(sourceId, mirFn)) !== null;
    },
    []
  );

  /**
   * Get list of sources that have analysis available for all event types.
   */
  const getSourcesWithFullAnalysis = useCallback((): string[] => {
    const allStreams = useStreamStore.getState().getAudioStreams();
    const eventTypes: CandidateEventType[] = ["onset", "beat", "flux"];

    return allStreams
      .filter((stream) =>
        eventTypes.every((eventType) => hasAnalysisFor(stream.id, eventType))
      )
      .map((stream) => stream.id);
  }, [hasAnalysisFor]);

  /**
   * Get the display label for an event type.
   */
  const getEventTypeLabel = useCallback(
    (eventType: CandidateEventType): string => {
      return EVENT_TYPE_LABELS[eventType];
    },
    []
  );

  return {
    // Generation
    generateForSource,
    generateAllTypesForSource,
    generateAll,
    generateAllSourcesForType,

    // Clearing
    clearAll,
    clearForSource,

    // Visibility
    toggleStreamVisibility,
    setEventTypeVisibility,

    // Inspection
    inspectStream,

    // Queries
    hasAnalysisFor,
    getSourcesWithFullAnalysis,
    getEventTypeLabel,
  };
}
