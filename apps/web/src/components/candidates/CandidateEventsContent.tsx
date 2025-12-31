"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sparkles, Trash2, Info, Loader2, ChevronDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import {
  useCandidateEventStore,
  type CandidateEventType,
} from "@/lib/stores/candidateEventStore";
import { useCandidateEventActions } from "@/lib/stores/hooks/useCandidateEventActions";
import { CandidateStreamListItem } from "./CandidateStreamListItem";

export interface CandidateEventsContentProps {
  audioDuration: number;
}

const EVENT_TYPES: CandidateEventType[] = ["onset", "beat", "flux"];

const EVENT_TYPE_LABELS: Record<CandidateEventType, string> = {
  onset: "Onsets",
  beat: "Beats",
  flux: "Flux Peaks",
};

/**
 * Content panel for managing candidate events.
 * Rendered when the "Candidates" tree node is expanded.
 */
export function CandidateEventsContent({ audioDuration }: CandidateEventsContentProps) {
  const [filterExpanded, setFilterExpanded] = useState(false);

  const { streams, isGenerating, error, inspectedStreamId, eventTypeFilter } =
    useCandidateEventStore(
      useShallow((s) => ({
        streams: s.streams,
        isGenerating: s.isGenerating,
        error: s.error,
        inspectedStreamId: s.inspectedStreamId,
        eventTypeFilter: s.eventTypeFilter,
      }))
    );

  const audioCollection = useAudioInputStore((s) => s.collection);
  const hasAudio = audioDuration > 0;
  const hasInputs = audioCollection !== null;

  const {
    generateAll,
    generateAllSourcesForType,
    clearAll,
    toggleStreamVisibility,
    inspectStream,
    setEventTypeVisibility,
    hasAnalysisFor,
  } = useCandidateEventActions();

  const clearStream = useCandidateEventStore((s) => s.clearStream);
  const setEventTypeFilter = useCandidateEventStore((s) => s.setEventTypeFilter);

  // Convert streams Map to array and filter by event type
  const streamArray = Array.from(streams.values());
  const filteredStreams = eventTypeFilter
    ? streamArray.filter((s) => s.eventType === eventTypeFilter)
    : streamArray;

  // Group streams by event type for display
  const streamsByType: Record<CandidateEventType, typeof streamArray> = {
    onset: streamArray.filter((s) => s.eventType === "onset"),
    beat: streamArray.filter((s) => s.eventType === "beat"),
    flux: streamArray.filter((s) => s.eventType === "flux"),
  };

  // Check if any source has analysis available
  const hasAnyAnalysis = useCallback(() => {
    if (!audioCollection) return false;
    const mixdownId = "mixdown";
    return EVENT_TYPES.some((type) => hasAnalysisFor(mixdownId, type));
  }, [audioCollection, hasAnalysisFor]);

  const handleGenerateAll = useCallback(() => {
    if (!isGenerating) {
      generateAll();
    }
  }, [isGenerating, generateAll]);

  const handleClearAll = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleToggleEventTypeVisibility = useCallback(
    (eventType: CandidateEventType) => {
      // Check if all streams of this type are visible
      const streamsOfType = streamsByType[eventType];
      const allVisible = streamsOfType.every((s) => s.isVisible);
      setEventTypeVisibility(eventType, !allVisible);
    },
    [streamsByType, setEventTypeVisibility]
  );

  const handleEventTypeFilterClick = useCallback(
    (eventType: CandidateEventType) => {
      if (eventTypeFilter === eventType) {
        setEventTypeFilter(null); // Clear filter
      } else {
        setEventTypeFilter(eventType);
      }
    },
    [eventTypeFilter, setEventTypeFilter]
  );

  const totalEventCount = streamArray.reduce((sum, s) => sum + s.events.length, 0);

  return (
    <div className="flex flex-col">
      {/* Generate All Button */}
      <div className="p-2 space-y-2">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-full",
            "border-amber-300 dark:border-amber-700",
            "text-amber-600 dark:text-amber-400",
            "hover:bg-amber-50 dark:hover:bg-amber-900/20"
          )}
          onClick={handleGenerateAll}
          disabled={!hasAudio || !hasInputs || isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-1" />
              Generate Candidates
            </>
          )}
        </Button>

        {/* Quick actions row */}
        {streamArray.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {totalEventCount} events in {streamArray.length} streams
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-700"
              onClick={handleClearAll}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-2 pb-2">
          <div className="text-xs text-red-600 dark:text-red-400 px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded">
            {error}
          </div>
        </div>
      )}

      {/* Event Type Filter */}
      {streamArray.length > 0 && (
        <div className="px-2 pb-2">
          <button
            type="button"
            className="flex items-center justify-between w-full text-left px-1 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => setFilterExpanded(!filterExpanded)}
          >
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Filter by Type
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-zinc-400 transition-transform",
                !filterExpanded && "-rotate-90"
              )}
            />
          </button>

          {filterExpanded && (
            <div className="mt-1 flex flex-wrap gap-1">
              {EVENT_TYPES.map((eventType) => {
                const count = streamsByType[eventType].length;
                const isActive = eventTypeFilter === eventType;
                const allVisible = streamsByType[eventType].every((s) => s.isVisible);

                return (
                  <div key={eventType} className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-6 px-2 text-xs",
                        isActive && "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                      )}
                      onClick={() => handleEventTypeFilterClick(eventType)}
                    >
                      {EVENT_TYPE_LABELS[eventType]}
                      {count > 0 && (
                        <span className="ml-1 text-zinc-400">({count})</span>
                      )}
                    </Button>
                    {count > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleToggleEventTypeVisibility(eventType)}
                        title={allVisible ? "Hide all" : "Show all"}
                      >
                        {allVisible ? (
                          <Eye className="h-3 w-3" />
                        ) : (
                          <EyeOff className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stream List */}
      <div className="px-2 space-y-1">
        {streamArray.length === 0 ? (
          <div className="flex items-start gap-2 px-1 py-4 text-xs text-zinc-500 dark:text-zinc-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <p>No candidate events generated yet.</p>
              <p className="mt-1">
                Click &quot;Generate Candidates&quot; to detect events from your audio.
              </p>
              <p className="mt-2 text-amber-600 dark:text-amber-400 italic">
                Note: Candidates are suggestions, not confirmed events.
              </p>
            </div>
          </div>
        ) : filteredStreams.length === 0 ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-4">
            No streams match the current filter.
          </div>
        ) : (
          filteredStreams.map((stream) => (
            <CandidateStreamListItem
              key={stream.id}
              stream={stream}
              isInspected={stream.id === inspectedStreamId}
              onInspect={() =>
                inspectStream(stream.id === inspectedStreamId ? null : stream.id)
              }
              onToggleVisibility={() => toggleStreamVisibility(stream.id)}
              onClear={() => clearStream(stream.id)}
            />
          ))
        )}
      </div>

      {/* Guidance footer */}
      {streamArray.length > 0 && (
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 mt-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 italic text-center">
            Candidates are ephemeral suggestions.
            <br />
            They may change if analysis parameters change.
          </div>
        </div>
      )}
    </div>
  );
}
