import { create } from "zustand";
import { devtools } from "zustand/middleware";

// ----------------------------
// Types
// ----------------------------

/**
 * Event types that can be detected from MIR analysis.
 */
export type CandidateEventType = "onset" | "beat" | "flux";

/**
 * A single candidate event from a specific source.
 * Candidates are ephemeral and non-authoritative.
 */
export interface CandidateEvent {
  /** Unique identifier for this event. */
  id: string;
  /** Time in seconds. */
  time: number;
  /** Normalized strength (0-1). */
  strength: number;
  /** Source audio input ID (mixdown or stem ID). */
  sourceId: string;
  /** Human-readable source label. */
  sourceLabel: string;
  /** Type of event. */
  eventType: CandidateEventType;
}

/**
 * A stream of candidate events from a specific source and event type.
 */
export interface CandidateStream {
  /** Unique ID for this stream (e.g., "mixdown:onset"). */
  id: string;
  /** Source audio input ID. */
  sourceId: string;
  /** Human-readable source label. */
  sourceLabel: string;
  /** Type of events in this stream. */
  eventType: CandidateEventType;
  /** The candidate events. */
  events: CandidateEvent[];
  /** When this stream was generated. */
  generatedAt: string;
  /** Whether this stream is visible in the UI. */
  isVisible: boolean;
  /** Display color for this stream. */
  color: {
    stroke: string;
    fill: string;
  };
}

// ----------------------------
// Color Palette
// ----------------------------

/**
 * Colors for different sources, designed for candidate (ephemeral) display.
 * Uses lighter/more muted tones than confirmed events.
 */
const SOURCE_COLORS = [
  { stroke: "rgba(59, 130, 246, 0.6)", fill: "rgba(59, 130, 246, 0.3)" }, // Blue
  { stroke: "rgba(34, 197, 94, 0.6)", fill: "rgba(34, 197, 94, 0.3)" }, // Green
  { stroke: "rgba(249, 115, 22, 0.6)", fill: "rgba(249, 115, 22, 0.3)" }, // Orange
  { stroke: "rgba(168, 85, 247, 0.6)", fill: "rgba(168, 85, 247, 0.3)" }, // Purple
  { stroke: "rgba(236, 72, 153, 0.6)", fill: "rgba(236, 72, 153, 0.3)" }, // Pink
  { stroke: "rgba(20, 184, 166, 0.6)", fill: "rgba(20, 184, 166, 0.3)" }, // Teal
  { stroke: "rgba(234, 179, 8, 0.6)", fill: "rgba(234, 179, 8, 0.3)" }, // Yellow
  { stroke: "rgba(239, 68, 68, 0.6)", fill: "rgba(239, 68, 68, 0.3)" }, // Red
];

/**
 * Get a color for a source based on its index.
 */
export function getSourceColor(sourceIndex: number) {
  return SOURCE_COLORS[sourceIndex % SOURCE_COLORS.length]!;
}

/**
 * Create a stream ID from source and event type.
 */
export function makeStreamId(sourceId: string, eventType: CandidateEventType): string {
  return `${sourceId}:${eventType}`;
}

// ----------------------------
// Store State
// ----------------------------

interface CandidateEventState {
  /**
   * All candidate streams, keyed by stream ID.
   * Streams are ephemeral and never persisted.
   */
  streams: Map<string, CandidateStream>;

  /** Whether candidate generation is in progress. */
  isGenerating: boolean;

  /** Last error during generation, if any. */
  error: string | null;

  /** Currently inspected stream ID (for detail view). */
  inspectedStreamId: string | null;

  /** Event type filter (null = show all). */
  eventTypeFilter: CandidateEventType | null;

  /** Selected candidate event IDs (for promotion). */
  selectedCandidateIds: Set<string>;
}

// ----------------------------
// Store Actions
// ----------------------------

interface CandidateEventActions {
  /**
   * Set a stream (add or update).
   */
  setStream: (stream: CandidateStream) => void;

  /**
   * Set multiple streams at once.
   */
  setStreams: (streams: CandidateStream[]) => void;

  /**
   * Toggle visibility of a stream.
   */
  toggleStreamVisibility: (streamId: string) => void;

  /**
   * Set all streams of an event type to visible/hidden.
   */
  setEventTypeVisibility: (eventType: CandidateEventType, visible: boolean) => void;

  /**
   * Clear a specific stream.
   */
  clearStream: (streamId: string) => void;

  /**
   * Clear all streams for a source.
   */
  clearForSource: (sourceId: string) => void;

  /**
   * Clear all streams.
   */
  clearAll: () => void;

  /**
   * Set the inspected stream.
   */
  inspectStream: (streamId: string | null) => void;

  /**
   * Set the event type filter.
   */
  setEventTypeFilter: (eventType: CandidateEventType | null) => void;

  /**
   * Set generating state.
   */
  setGenerating: (generating: boolean) => void;

  /**
   * Set error state.
   */
  setError: (error: string | null) => void;

  /**
   * Get a stream by ID.
   */
  getStream: (streamId: string) => CandidateStream | undefined;

  /**
   * Get all streams as an array.
   */
  getAllStreams: () => CandidateStream[];

  /**
   * Get visible streams, optionally filtered by event type.
   */
  getVisibleStreams: (eventType?: CandidateEventType) => CandidateStream[];

  /**
   * Get streams for a specific source.
   */
  getStreamsForSource: (sourceId: string) => CandidateStream[];

  /**
   * Get total event count across all visible streams.
   */
  getTotalVisibleEventCount: () => number;

  /**
   * Full reset (called on audio change).
   */
  reset: () => void;

  // ----------------------------
  // Selection (for promotion)
  // ----------------------------

  /**
   * Select a single candidate event.
   */
  selectCandidate: (eventId: string) => void;

  /**
   * Toggle selection of a candidate event.
   */
  toggleCandidateSelection: (eventId: string) => void;

  /**
   * Select multiple candidate events.
   */
  selectCandidates: (eventIds: string[]) => void;

  /**
   * Select all events in a time range within a stream.
   */
  selectCandidateRange: (streamId: string, startTime: number, endTime: number) => void;

  /**
   * Clear all candidate selections.
   */
  clearCandidateSelection: () => void;

  /**
   * Get selected candidate IDs.
   */
  getSelectedCandidateIds: () => Set<string>;
}

export type CandidateEventStore = CandidateEventState & CandidateEventActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: CandidateEventState = {
  streams: new Map(),
  isGenerating: false,
  error: null,
  inspectedStreamId: null,
  eventTypeFilter: null,
  selectedCandidateIds: new Set(),
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useCandidateEventStore = create<CandidateEventStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setStream: (stream) => {
        set(
          (state) => {
            const newStreams = new Map(state.streams);
            newStreams.set(stream.id, stream);
            return { streams: newStreams, error: null };
          },
          false,
          "setStream"
        );
      },

      setStreams: (streams) => {
        set(
          (state) => {
            const newStreams = new Map(state.streams);
            for (const stream of streams) {
              newStreams.set(stream.id, stream);
            }
            return { streams: newStreams, error: null };
          },
          false,
          "setStreams"
        );
      },

      toggleStreamVisibility: (streamId) => {
        set(
          (state) => {
            const stream = state.streams.get(streamId);
            if (!stream) return state;

            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...stream,
              isVisible: !stream.isVisible,
            });
            return { streams: newStreams };
          },
          false,
          "toggleStreamVisibility"
        );
      },

      setEventTypeVisibility: (eventType, visible) => {
        set(
          (state) => {
            const newStreams = new Map(state.streams);
            for (const [id, stream] of newStreams) {
              if (stream.eventType === eventType) {
                newStreams.set(id, { ...stream, isVisible: visible });
              }
            }
            return { streams: newStreams };
          },
          false,
          "setEventTypeVisibility"
        );
      },

      clearStream: (streamId) => {
        set(
          (state) => {
            const newStreams = new Map(state.streams);
            newStreams.delete(streamId);
            return {
              streams: newStreams,
              inspectedStreamId:
                state.inspectedStreamId === streamId ? null : state.inspectedStreamId,
            };
          },
          false,
          "clearStream"
        );
      },

      clearForSource: (sourceId) => {
        set(
          (state) => {
            const newStreams = new Map(state.streams);
            for (const [id, stream] of newStreams) {
              if (stream.sourceId === sourceId) {
                newStreams.delete(id);
              }
            }
            // Clear inspection if the inspected stream was from this source
            let newInspectedId = state.inspectedStreamId;
            if (newInspectedId) {
              const inspected = state.streams.get(newInspectedId);
              if (inspected?.sourceId === sourceId) {
                newInspectedId = null;
              }
            }
            return { streams: newStreams, inspectedStreamId: newInspectedId };
          },
          false,
          "clearForSource"
        );
      },

      clearAll: () => {
        set(
          {
            streams: new Map(),
            inspectedStreamId: null,
            error: null,
          },
          false,
          "clearAll"
        );
      },

      inspectStream: (streamId) => {
        set({ inspectedStreamId: streamId }, false, "inspectStream");
      },

      setEventTypeFilter: (eventType) => {
        set({ eventTypeFilter: eventType }, false, "setEventTypeFilter");
      },

      setGenerating: (generating) => {
        set({ isGenerating: generating }, false, "setGenerating");
      },

      setError: (error) => {
        set({ error, isGenerating: false }, false, "setError");
      },

      getStream: (streamId) => {
        return get().streams.get(streamId);
      },

      getAllStreams: () => {
        return Array.from(get().streams.values());
      },

      getVisibleStreams: (eventType) => {
        const { streams, eventTypeFilter } = get();
        const filter = eventType ?? eventTypeFilter;

        return Array.from(streams.values()).filter((stream) => {
          if (!stream.isVisible) return false;
          if (filter && stream.eventType !== filter) return false;
          return true;
        });
      },

      getStreamsForSource: (sourceId) => {
        return Array.from(get().streams.values()).filter(
          (stream) => stream.sourceId === sourceId
        );
      },

      getTotalVisibleEventCount: () => {
        const visibleStreams = get().getVisibleStreams();
        return visibleStreams.reduce((count, stream) => count + stream.events.length, 0);
      },

      reset: () => {
        set(initialState, false, "reset");
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectCandidate: (eventId) => {
        set({ selectedCandidateIds: new Set([eventId]) }, false, "selectCandidate");
      },

      toggleCandidateSelection: (eventId) => {
        set(
          (state) => {
            const newSelected = new Set(state.selectedCandidateIds);
            if (newSelected.has(eventId)) {
              newSelected.delete(eventId);
            } else {
              newSelected.add(eventId);
            }
            return { selectedCandidateIds: newSelected };
          },
          false,
          "toggleCandidateSelection"
        );
      },

      selectCandidates: (eventIds) => {
        set({ selectedCandidateIds: new Set(eventIds) }, false, "selectCandidates");
      },

      selectCandidateRange: (streamId, startTime, endTime) => {
        const stream = get().streams.get(streamId);
        if (!stream) return;

        const eventsInRange = stream.events.filter(
          (e) => e.time >= startTime && e.time <= endTime
        );
        const eventIds = eventsInRange.map((e) => e.id);

        set(
          (state) => ({
            selectedCandidateIds: new Set([
              ...state.selectedCandidateIds,
              ...eventIds,
            ]),
          }),
          false,
          "selectCandidateRange"
        );
      },

      clearCandidateSelection: () => {
        set({ selectedCandidateIds: new Set() }, false, "clearCandidateSelection");
      },

      getSelectedCandidateIds: () => {
        return get().selectedCandidateIds;
      },
    }),
    { name: "candidate-event-store" }
  )
);
