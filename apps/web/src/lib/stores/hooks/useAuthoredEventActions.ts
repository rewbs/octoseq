import { useCallback } from "react";

import { useAuthoredEventStore, getAuthoredColor } from "../authoredEventStore";
import { useCandidateEventStore, type CandidateEvent } from "../candidateEventStore";
import type { AuthoredEventProvenance, AuthoredStreamSource } from "../types/authoredEvent";

/**
 * Hook that provides actions for managing authored event streams.
 */
export function useAuthoredEventActions() {
  /**
   * Promote selected candidate events to an authored stream.
   * Creates a new stream or adds to an existing one.
   *
   * @param candidateStreamId - ID of the source candidate stream
   * @param selectedEventIds - Set of event IDs to promote (if empty, promotes all)
   * @param options - Optional target stream ID and name
   * @returns The ID of the authored stream, or null if failed
   */
  const promoteSelectedEvents = useCallback(
    (
      candidateStreamId: string,
      selectedEventIds: Set<string>,
      options?: { targetStreamId?: string; name?: string }
    ): string | null => {
      const candidateStore = useCandidateEventStore.getState();
      const authoredStore = useAuthoredEventStore.getState();

      const candidateStream = candidateStore.getStream(candidateStreamId);
      if (!candidateStream) {
        console.warn(
          `[AuthoredEvents] Candidate stream not found: ${candidateStreamId}`
        );
        return null;
      }

      // Filter events to promote
      const eventsToPromote =
        selectedEventIds.size > 0
          ? candidateStream.events.filter((e) => selectedEventIds.has(e.id))
          : candidateStream.events;

      if (eventsToPromote.length === 0) {
        console.warn("[AuthoredEvents] No events to promote");
        return null;
      }

      // Convert candidate events to authored events
      const now = new Date().toISOString();
      const authoredEvents = eventsToPromote.map((ce: CandidateEvent) => ({
        time: ce.time,
        beatPosition: null as number | null,
        weight: ce.strength,
        duration: null as number | null,
        payload: null as Record<string, unknown> | null,
        provenance: {
          kind: "promoted" as const,
          sourceStreamId: candidateStreamId,
          sourceEventId: ce.id,
          promotedAt: now,
        } satisfies AuthoredEventProvenance,
      }));

      // If target stream specified, add to it
      if (options?.targetStreamId) {
        const targetStream = authoredStore.getStream(options.targetStreamId);
        if (!targetStream) {
          console.warn(
            `[AuthoredEvents] Target stream not found: ${options.targetStreamId}`
          );
          return null;
        }

        // Update source to "mixed" if adding from different source
        if (
          targetStream.source.kind === "promoted" &&
          targetStream.source.candidateStreamId !== candidateStreamId
        ) {
          // Would need to update source to mixed - for now just add events
        }

        authoredStore.addEvents(options.targetStreamId, authoredEvents);
        return options.targetStreamId;
      }

      // Create new stream
      const streamName =
        options?.name ??
        `${candidateStream.sourceLabel} ${getEventTypeLabel(candidateStream.eventType)}`;

      const source: AuthoredStreamSource = {
        kind: "promoted",
        candidateStreamId,
        eventType: candidateStream.eventType,
      };

      const streamId = authoredStore.addStream(streamName, source);
      authoredStore.addEvents(streamId, authoredEvents);

      return streamId;
    },
    []
  );

  /**
   * Promote candidate events within a time range.
   *
   * @param candidateStreamId - ID of the source candidate stream
   * @param startTime - Start of time range (seconds)
   * @param endTime - End of time range (seconds)
   * @param options - Optional target stream ID and name
   * @returns The ID of the authored stream, or null if failed
   */
  const promoteEventRange = useCallback(
    (
      candidateStreamId: string,
      startTime: number,
      endTime: number,
      options?: { targetStreamId?: string; name?: string }
    ): string | null => {
      const candidateStore = useCandidateEventStore.getState();

      const candidateStream = candidateStore.getStream(candidateStreamId);
      if (!candidateStream) {
        console.warn(
          `[AuthoredEvents] Candidate stream not found: ${candidateStreamId}`
        );
        return null;
      }

      // Find events in range
      const eventsInRange = candidateStream.events.filter(
        (e) => e.time >= startTime && e.time <= endTime
      );

      if (eventsInRange.length === 0) {
        console.warn("[AuthoredEvents] No events in specified time range");
        return null;
      }

      // Use the general promote function with selected IDs
      const selectedIds = new Set(eventsInRange.map((e) => e.id));
      return promoteSelectedEvents(candidateStreamId, selectedIds, options);
    },
    [promoteSelectedEvents]
  );

  /**
   * Promote an entire candidate stream.
   *
   * @param candidateStreamId - ID of the source candidate stream
   * @param name - Optional name for the new stream
   * @returns The ID of the authored stream, or null if failed
   */
  const promoteStream = useCallback(
    (candidateStreamId: string, name?: string): string | null => {
      return promoteSelectedEvents(candidateStreamId, new Set(), { name });
    },
    [promoteSelectedEvents]
  );

  /**
   * Create a new empty authored stream for manual authoring.
   *
   * @param name - Name for the new stream
   * @param description - Optional description
   * @returns The ID of the new stream
   */
  const createManualStream = useCallback(
    (name: string, description?: string): string => {
      const authoredStore = useAuthoredEventStore.getState();

      const source: AuthoredStreamSource = {
        kind: "manual",
        description,
      };

      return authoredStore.addStream(name, source);
    },
    []
  );

  /**
   * Add an event at a specific time to a stream.
   * Used for click-to-add on timeline.
   *
   * @param streamId - ID of the target stream
   * @param time - Time in seconds
   * @param options - Optional weight and duration
   * @returns The ID of the new event, or null if failed
   */
  const addEventAtTime = useCallback(
    (
      streamId: string,
      time: number,
      options?: { weight?: number; duration?: number | null }
    ): string | null => {
      const authoredStore = useAuthoredEventStore.getState();

      const stream = authoredStore.getStream(streamId);
      if (!stream) {
        console.warn(`[AuthoredEvents] Stream not found: ${streamId}`);
        return null;
      }

      const now = new Date().toISOString();
      const provenance: AuthoredEventProvenance = {
        kind: "manual",
        createdAt: now,
      };

      return authoredStore.addEvent(streamId, {
        time,
        beatPosition: null,
        weight: options?.weight ?? 1.0,
        duration: options?.duration ?? null,
        payload: null,
        provenance,
      });
    },
    []
  );

  /**
   * Delete selected events from a stream.
   *
   * @param streamId - ID of the stream
   * @param eventIds - Set of event IDs to delete
   */
  const deleteSelectedEvents = useCallback(
    (streamId: string, eventIds: Set<string>): void => {
      const authoredStore = useAuthoredEventStore.getState();
      authoredStore.removeEvents(streamId, Array.from(eventIds));
    },
    []
  );

  /**
   * Duplicate selected events with a time offset.
   *
   * @param streamId - ID of the stream
   * @param eventIds - Set of event IDs to duplicate
   * @param timeOffset - Time offset in seconds (positive = later)
   * @returns Array of new event IDs
   */
  const duplicateEvents = useCallback(
    (streamId: string, eventIds: Set<string>, timeOffset: number): string[] => {
      const authoredStore = useAuthoredEventStore.getState();

      const stream = authoredStore.getStream(streamId);
      if (!stream) {
        console.warn(`[AuthoredEvents] Stream not found: ${streamId}`);
        return [];
      }

      const eventsToDuplicate = stream.events.filter((e) => eventIds.has(e.id));
      if (eventsToDuplicate.length === 0) return [];

      const now = new Date().toISOString();
      const newEvents = eventsToDuplicate.map((e) => ({
        time: e.time + timeOffset,
        beatPosition: null as number | null,
        weight: e.weight,
        duration: e.duration,
        payload: e.payload ? { ...e.payload } : null,
        provenance: {
          kind: "manual" as const,
          createdAt: now,
        } satisfies AuthoredEventProvenance,
      }));

      return authoredStore.addEvents(streamId, newEvents);
    },
    []
  );

  /**
   * Move selected events by a time offset.
   *
   * @param streamId - ID of the stream
   * @param eventIds - Set of event IDs to move
   * @param timeOffset - Time offset in seconds (positive = later)
   */
  const moveSelectedEvents = useCallback(
    (streamId: string, eventIds: Set<string>, timeOffset: number): void => {
      const authoredStore = useAuthoredEventStore.getState();

      const stream = authoredStore.getStream(streamId);
      if (!stream) return;

      for (const eventId of eventIds) {
        const event = stream.events.find((e) => e.id === eventId);
        if (event) {
          const newTime = Math.max(0, event.time + timeOffset);
          authoredStore.moveEvent(streamId, eventId, newTime);
        }
      }
    },
    []
  );

  /**
   * Undo the last action.
   */
  const undo = useCallback((): void => {
    useAuthoredEventStore.getState().undo();
  }, []);

  /**
   * Redo the last undone action.
   */
  const redo = useCallback((): void => {
    useAuthoredEventStore.getState().redo();
  }, []);

  /**
   * Check if undo is available.
   */
  const canUndo = useCallback((): boolean => {
    return useAuthoredEventStore.getState().canUndo();
  }, []);

  /**
   * Check if redo is available.
   */
  const canRedo = useCallback((): boolean => {
    return useAuthoredEventStore.getState().canRedo();
  }, []);

  /**
   * Clear all authored streams.
   */
  const clearAll = useCallback((): void => {
    useAuthoredEventStore.getState().reset();
  }, []);

  /**
   * Delete a stream.
   */
  const deleteStream = useCallback((streamId: string): void => {
    useAuthoredEventStore.getState().removeStream(streamId);
  }, []);

  /**
   * Rename a stream.
   */
  const renameStream = useCallback((streamId: string, name: string): void => {
    useAuthoredEventStore.getState().renameStream(streamId, name);
  }, []);

  /**
   * Toggle stream visibility.
   */
  const toggleStreamVisibility = useCallback((streamId: string): void => {
    useAuthoredEventStore.getState().toggleStreamVisibility(streamId);
  }, []);

  /**
   * Inspect a stream (select for detail view).
   */
  const inspectStream = useCallback((streamId: string | null): void => {
    useAuthoredEventStore.getState().inspectStream(streamId);
  }, []);

  /**
   * Get next available color for a new stream.
   */
  const getNextColor = useCallback(() => {
    const colorIndex = useAuthoredEventStore.getState().streamColorIndex;
    return getAuthoredColor(colorIndex);
  }, []);

  return {
    // Promotion
    promoteSelectedEvents,
    promoteEventRange,
    promoteStream,

    // Creation
    createManualStream,
    addEventAtTime,

    // Editing
    deleteSelectedEvents,
    duplicateEvents,
    moveSelectedEvents,

    // Undo/Redo
    undo,
    redo,
    canUndo,
    canRedo,

    // Stream management
    clearAll,
    deleteStream,
    renameStream,
    toggleStreamVisibility,
    inspectStream,

    // Utilities
    getNextColor,
  };
}

/**
 * Get human-readable label for an event type.
 */
function getEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "onset":
      return "Onsets";
    case "beat":
      return "Beats";
    case "flux":
      return "Flux";
    default:
      return eventType;
  }
}
