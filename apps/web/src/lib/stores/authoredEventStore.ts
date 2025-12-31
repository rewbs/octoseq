import { nanoid } from "nanoid";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type {
  AuthoredEvent,
  AuthoredEventOperation,
  AuthoredEventStream,
  AuthoredStreamSource,
  UndoEntry,
} from "./types/authoredEvent";

// ----------------------------
// Color Palette
// ----------------------------

/**
 * Colors for authored streams - solid, stronger than candidates.
 * Full opacity stroke to indicate authoritative status.
 */
const AUTHORED_COLORS = [
  { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.4)" }, // Blue
  { stroke: "rgb(34, 197, 94)", fill: "rgba(34, 197, 94, 0.4)" }, // Green
  { stroke: "rgb(249, 115, 22)", fill: "rgba(249, 115, 22, 0.4)" }, // Orange
  { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.4)" }, // Purple
  { stroke: "rgb(236, 72, 153)", fill: "rgba(236, 72, 153, 0.4)" }, // Pink
  { stroke: "rgb(20, 184, 166)", fill: "rgba(20, 184, 166, 0.4)" }, // Teal
  { stroke: "rgb(234, 179, 8)", fill: "rgba(234, 179, 8, 0.4)" }, // Yellow
  { stroke: "rgb(239, 68, 68)", fill: "rgba(239, 68, 68, 0.4)" }, // Red
];

/**
 * Get a color for a stream based on its index.
 */
export function getAuthoredColor(index: number) {
  return AUTHORED_COLORS[index % AUTHORED_COLORS.length]!;
}

// ----------------------------
// Store State
// ----------------------------

interface AuthoredEventState {
  /** All authored streams, keyed by stream ID. */
  streams: Map<string, AuthoredEventStream>;

  /** Currently inspected stream ID (for detail view). */
  inspectedStreamId: string | null;

  /** Currently selected event IDs within inspected stream. */
  selectedEventIds: Set<string>;

  /** Undo history stack. */
  undoStack: UndoEntry[];

  /** Redo history stack. */
  redoStack: UndoEntry[];

  /** Maximum undo history size. */
  maxUndoSize: number;

  /** Stream color index counter. */
  streamColorIndex: number;
}

// ----------------------------
// Store Actions
// ----------------------------

interface AuthoredEventActions {
  // Stream management
  addStream: (
    name: string,
    source: AuthoredStreamSource,
    options?: { color?: { stroke: string; fill: string } }
  ) => string;
  removeStream: (streamId: string) => void;
  renameStream: (streamId: string, name: string) => void;
  updateStreamVisibility: (streamId: string, visible: boolean) => void;
  toggleStreamVisibility: (streamId: string) => void;

  // Event management
  addEvent: (
    streamId: string,
    event: Omit<AuthoredEvent, "id" | "modifiedAt">
  ) => string | null;
  addEvents: (
    streamId: string,
    events: Omit<AuthoredEvent, "id" | "modifiedAt">[]
  ) => string[];
  removeEvent: (streamId: string, eventId: string) => void;
  removeEvents: (streamId: string, eventIds: string[]) => void;
  updateEvent: (
    streamId: string,
    eventId: string,
    updates: Partial<Omit<AuthoredEvent, "id" | "provenance">>
  ) => void;
  moveEvent: (streamId: string, eventId: string, newTime: number) => void;

  // Selection
  selectEvent: (eventId: string | null) => void;
  selectEvents: (eventIds: string[]) => void;
  toggleEventSelection: (eventId: string) => void;
  clearSelection: () => void;

  // Inspection
  inspectStream: (streamId: string | null) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Queries
  getStream: (streamId: string) => AuthoredEventStream | undefined;
  getAllStreams: () => AuthoredEventStream[];
  getVisibleStreams: () => AuthoredEventStream[];
  getStreamByName: (name: string) => AuthoredEventStream | undefined;
  getTotalEventCount: () => number;

  // Reset
  reset: () => void;
}

export type AuthoredEventStore = AuthoredEventState & AuthoredEventActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: AuthoredEventState = {
  streams: new Map(),
  inspectedStreamId: null,
  selectedEventIds: new Set(),
  undoStack: [],
  redoStack: [],
  maxUndoSize: 50,
  streamColorIndex: 0,
};

// ----------------------------
// Helper Functions
// ----------------------------

/**
 * Sort events by time (ascending).
 */
function sortEventsByTime(events: AuthoredEvent[]): AuthoredEvent[] {
  return [...events].sort((a, b) => a.time - b.time);
}

/**
 * Apply the inverse of an operation (for undo).
 */
function applyInverseOperation(
  state: AuthoredEventState,
  operation: AuthoredEventOperation
): Partial<AuthoredEventState> {
  switch (operation.kind) {
    case "add_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = stream.events.filter((e) => e.id !== operation.event.id);
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: newEvents,
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "remove_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = [...stream.events];
      newEvents.splice(operation.index, 0, operation.event);
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: sortEventsByTime(newEvents),
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "update_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = stream.events.map((e) =>
        e.id === operation.eventId
          ? { ...e, ...operation.before, modifiedAt: new Date().toISOString() }
          : e
      );
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: sortEventsByTime(newEvents),
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "add_stream": {
      const newStreams = new Map(state.streams);
      newStreams.delete(operation.stream.id);
      return { streams: newStreams };
    }

    case "remove_stream": {
      const newStreams = new Map(state.streams);
      newStreams.set(operation.stream.id, operation.stream);
      return { streams: newStreams };
    }

    case "rename_stream": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        name: operation.before,
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "batch": {
      let currentState = state;
      // Apply in reverse order
      for (let i = operation.operations.length - 1; i >= 0; i--) {
        const partialState = applyInverseOperation(
          currentState,
          operation.operations[i]!
        );
        currentState = { ...currentState, ...partialState };
      }
      return { streams: currentState.streams };
    }
  }
}

/**
 * Apply an operation (for redo).
 */
function applyOperation(
  state: AuthoredEventState,
  operation: AuthoredEventOperation
): Partial<AuthoredEventState> {
  switch (operation.kind) {
    case "add_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = sortEventsByTime([...stream.events, operation.event]);
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: newEvents,
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "remove_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = stream.events.filter((e) => e.id !== operation.event.id);
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: newEvents,
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "update_event": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newEvents = stream.events.map((e) =>
        e.id === operation.eventId
          ? { ...e, ...operation.after, modifiedAt: new Date().toISOString() }
          : e
      );
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        events: sortEventsByTime(newEvents),
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "add_stream": {
      const newStreams = new Map(state.streams);
      newStreams.set(operation.stream.id, operation.stream);
      return { streams: newStreams };
    }

    case "remove_stream": {
      const newStreams = new Map(state.streams);
      newStreams.delete(operation.stream.id);
      return { streams: newStreams };
    }

    case "rename_stream": {
      const stream = state.streams.get(operation.streamId);
      if (!stream) return {};
      const newStreams = new Map(state.streams);
      newStreams.set(operation.streamId, {
        ...stream,
        name: operation.after,
        modifiedAt: new Date().toISOString(),
      });
      return { streams: newStreams };
    }

    case "batch": {
      let currentState = state;
      for (const op of operation.operations) {
        const partialState = applyOperation(currentState, op);
        currentState = { ...currentState, ...partialState };
      }
      return { streams: currentState.streams };
    }
  }
}

// ----------------------------
// Store Implementation
// ----------------------------

export const useAuthoredEventStore = create<AuthoredEventStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // Stream Management
      // ----------------------------

      addStream: (name, source, options) => {
        const id = nanoid();
        const now = new Date().toISOString();
        const colorIndex = get().streamColorIndex;
        const color = options?.color ?? getAuthoredColor(colorIndex);

        const stream: AuthoredEventStream = {
          id,
          name,
          source,
          events: [],
          createdAt: now,
          modifiedAt: now,
          isVisible: true,
          color,
        };

        const operation: AuthoredEventOperation = {
          kind: "add_stream",
          stream,
        };

        set(
          (state) => ({
            streams: new Map(state.streams).set(id, stream),
            streamColorIndex: state.streamColorIndex + 1,
            undoStack: [
              ...state.undoStack,
              { operation, timestamp: now },
            ].slice(-state.maxUndoSize),
            redoStack: [],
          }),
          false,
          "addStream"
        );

        return id;
      },

      removeStream: (streamId) => {
        const stream = get().streams.get(streamId);
        if (!stream) return;

        const operation: AuthoredEventOperation = {
          kind: "remove_stream",
          stream,
        };

        set(
          (state) => {
            const newStreams = new Map(state.streams);
            newStreams.delete(streamId);
            return {
              streams: newStreams,
              inspectedStreamId:
                state.inspectedStreamId === streamId
                  ? null
                  : state.inspectedStreamId,
              selectedEventIds: new Set(),
              undoStack: [
                ...state.undoStack,
                { operation, timestamp: new Date().toISOString() },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "removeStream"
        );
      },

      renameStream: (streamId, name) => {
        const stream = get().streams.get(streamId);
        if (!stream || stream.name === name) return;

        const operation: AuthoredEventOperation = {
          kind: "rename_stream",
          streamId,
          before: stream.name,
          after: name,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              name,
              modifiedAt: new Date().toISOString(),
            });
            return {
              streams: newStreams,
              undoStack: [
                ...state.undoStack,
                { operation, timestamp: new Date().toISOString() },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "renameStream"
        );
      },

      updateStreamVisibility: (streamId, visible) => {
        set(
          (state) => {
            const stream = state.streams.get(streamId);
            if (!stream) return state;

            const newStreams = new Map(state.streams);
            newStreams.set(streamId, { ...stream, isVisible: visible });
            return { streams: newStreams };
          },
          false,
          "updateStreamVisibility"
        );
      },

      toggleStreamVisibility: (streamId) => {
        set(
          (state) => {
            const stream = state.streams.get(streamId);
            if (!stream) return state;

            const newStreams = new Map(state.streams);
            newStreams.set(streamId, { ...stream, isVisible: !stream.isVisible });
            return { streams: newStreams };
          },
          false,
          "toggleStreamVisibility"
        );
      },

      // ----------------------------
      // Event Management
      // ----------------------------

      addEvent: (streamId, eventData) => {
        const stream = get().streams.get(streamId);
        if (!stream) return null;

        const id = nanoid();
        const now = new Date().toISOString();

        const event: AuthoredEvent = {
          ...eventData,
          id,
          modifiedAt: now,
        };

        const operation: AuthoredEventOperation = {
          kind: "add_event",
          streamId,
          event,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const newEvents = sortEventsByTime([...existingStream.events, event]);
            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              events: newEvents,
              modifiedAt: now,
            });
            return {
              streams: newStreams,
              undoStack: [
                ...state.undoStack,
                { operation, timestamp: now },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "addEvent"
        );

        return id;
      },

      addEvents: (streamId, eventsData) => {
        const stream = get().streams.get(streamId);
        if (!stream) return [];

        const now = new Date().toISOString();
        const ids: string[] = [];
        const events: AuthoredEvent[] = [];

        for (const eventData of eventsData) {
          const id = nanoid();
          ids.push(id);
          events.push({
            ...eventData,
            id,
            modifiedAt: now,
          });
        }

        const operations: AuthoredEventOperation[] = events.map((event) => ({
          kind: "add_event" as const,
          streamId,
          event,
        }));

        const batchOperation: AuthoredEventOperation = {
          kind: "batch",
          operations,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const newEvents = sortEventsByTime([
              ...existingStream.events,
              ...events,
            ]);
            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              events: newEvents,
              modifiedAt: now,
            });
            return {
              streams: newStreams,
              undoStack: [
                ...state.undoStack,
                { operation: batchOperation, timestamp: now },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "addEvents"
        );

        return ids;
      },

      removeEvent: (streamId, eventId) => {
        const stream = get().streams.get(streamId);
        if (!stream) return;

        const eventIndex = stream.events.findIndex((e) => e.id === eventId);
        if (eventIndex === -1) return;

        const event = stream.events[eventIndex]!;
        const operation: AuthoredEventOperation = {
          kind: "remove_event",
          streamId,
          event,
          index: eventIndex,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const newEvents = existingStream.events.filter(
              (e) => e.id !== eventId
            );
            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              events: newEvents,
              modifiedAt: new Date().toISOString(),
            });

            // Remove from selection if selected
            const newSelectedIds = new Set(state.selectedEventIds);
            newSelectedIds.delete(eventId);

            return {
              streams: newStreams,
              selectedEventIds: newSelectedIds,
              undoStack: [
                ...state.undoStack,
                { operation, timestamp: new Date().toISOString() },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "removeEvent"
        );
      },

      removeEvents: (streamId, eventIds) => {
        const stream = get().streams.get(streamId);
        if (!stream) return;

        const now = new Date().toISOString();
        const operations: AuthoredEventOperation[] = [];

        for (const eventId of eventIds) {
          const eventIndex = stream.events.findIndex((e) => e.id === eventId);
          if (eventIndex !== -1) {
            operations.push({
              kind: "remove_event",
              streamId,
              event: stream.events[eventIndex]!,
              index: eventIndex,
            });
          }
        }

        if (operations.length === 0) return;

        const batchOperation: AuthoredEventOperation = {
          kind: "batch",
          operations,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const eventIdSet = new Set(eventIds);
            const newEvents = existingStream.events.filter(
              (e) => !eventIdSet.has(e.id)
            );
            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              events: newEvents,
              modifiedAt: now,
            });

            // Remove from selection
            const newSelectedIds = new Set(state.selectedEventIds);
            for (const id of eventIds) {
              newSelectedIds.delete(id);
            }

            return {
              streams: newStreams,
              selectedEventIds: newSelectedIds,
              undoStack: [
                ...state.undoStack,
                { operation: batchOperation, timestamp: now },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "removeEvents"
        );
      },

      updateEvent: (streamId, eventId, updates) => {
        const stream = get().streams.get(streamId);
        if (!stream) return;

        const event = stream.events.find((e) => e.id === eventId);
        if (!event) return;

        // Build before/after for undo
        const before: Partial<AuthoredEvent> = {};
        const after: Partial<AuthoredEvent> = {};

        for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
          // Type already guarantees no "id" or "provenance" keys
          before[key] = event[key] as never;
          after[key] = updates[key] as never;
        }

        const operation: AuthoredEventOperation = {
          kind: "update_event",
          streamId,
          eventId,
          before,
          after,
        };

        set(
          (state) => {
            const existingStream = state.streams.get(streamId);
            if (!existingStream) return state;

            const now = new Date().toISOString();
            const newEvents = existingStream.events.map((e) =>
              e.id === eventId ? { ...e, ...updates, modifiedAt: now } : e
            );
            const newStreams = new Map(state.streams);
            newStreams.set(streamId, {
              ...existingStream,
              events: sortEventsByTime(newEvents),
              modifiedAt: now,
            });
            return {
              streams: newStreams,
              undoStack: [
                ...state.undoStack,
                { operation, timestamp: now },
              ].slice(-state.maxUndoSize),
              redoStack: [],
            };
          },
          false,
          "updateEvent"
        );
      },

      moveEvent: (streamId, eventId, newTime) => {
        get().updateEvent(streamId, eventId, { time: newTime });
      },

      // ----------------------------
      // Selection
      // ----------------------------

      selectEvent: (eventId) => {
        set(
          {
            selectedEventIds: eventId ? new Set([eventId]) : new Set(),
          },
          false,
          "selectEvent"
        );
      },

      selectEvents: (eventIds) => {
        set({ selectedEventIds: new Set(eventIds) }, false, "selectEvents");
      },

      toggleEventSelection: (eventId) => {
        set(
          (state) => {
            const newSelected = new Set(state.selectedEventIds);
            if (newSelected.has(eventId)) {
              newSelected.delete(eventId);
            } else {
              newSelected.add(eventId);
            }
            return { selectedEventIds: newSelected };
          },
          false,
          "toggleEventSelection"
        );
      },

      clearSelection: () => {
        set({ selectedEventIds: new Set() }, false, "clearSelection");
      },

      // ----------------------------
      // Inspection
      // ----------------------------

      inspectStream: (streamId) => {
        set(
          {
            inspectedStreamId: streamId,
            selectedEventIds: new Set(), // Clear selection when switching streams
          },
          false,
          "inspectStream"
        );
      },

      // ----------------------------
      // Undo/Redo
      // ----------------------------

      undo: () => {
        const { undoStack, redoStack } = get();
        if (undoStack.length === 0) return;

        const entry = undoStack[undoStack.length - 1]!;
        const partialState = applyInverseOperation(get(), entry.operation);

        set(
          (state) => ({
            ...partialState,
            undoStack: state.undoStack.slice(0, -1),
            redoStack: [...state.redoStack, entry],
          }),
          false,
          "undo"
        );
      },

      redo: () => {
        const { redoStack } = get();
        if (redoStack.length === 0) return;

        const entry = redoStack[redoStack.length - 1]!;
        const partialState = applyOperation(get(), entry.operation);

        set(
          (state) => ({
            ...partialState,
            redoStack: state.redoStack.slice(0, -1),
            undoStack: [...state.undoStack, entry],
          }),
          false,
          "redo"
        );
      },

      canUndo: () => get().undoStack.length > 0,

      canRedo: () => get().redoStack.length > 0,

      // ----------------------------
      // Queries
      // ----------------------------

      getStream: (streamId) => get().streams.get(streamId),

      getAllStreams: () => Array.from(get().streams.values()),

      getVisibleStreams: () =>
        Array.from(get().streams.values()).filter((s) => s.isVisible),

      getStreamByName: (name) =>
        Array.from(get().streams.values()).find((s) => s.name === name),

      getTotalEventCount: () => {
        let count = 0;
        for (const stream of get().streams.values()) {
          count += stream.events.length;
        }
        return count;
      },

      // ----------------------------
      // Reset
      // ----------------------------

      reset: () => {
        set(initialState, false, "reset");
      },
    }),
    { name: "authored-event-store" }
  )
);
