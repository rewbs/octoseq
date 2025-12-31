/**
 * Authored Event Types
 *
 * Authored events represent human judgement, distinct from algorithmic suggestions.
 * They persist within a session and are accessible to scripts.
 */

/**
 * Provenance tracking for authored events - records how events were created/modified.
 */
export type AuthoredEventProvenance =
  | {
      kind: "promoted";
      /** ID of the source candidate stream. */
      sourceStreamId: string;
      /** ID of the original candidate event. */
      sourceEventId: string;
      /** ISO timestamp when promoted. */
      promotedAt: string;
    }
  | {
      kind: "manual";
      /** ISO timestamp when manually created. */
      createdAt: string;
    };

/**
 * A single authored event - the authoritative version after promotion/editing.
 */
export interface AuthoredEvent {
  /** Stable unique identifier (nanoid). */
  id: string;
  /** Time in seconds from track start. */
  time: number;
  /** Beat position (computed from musical time if available). */
  beatPosition: number | null;
  /** Weight/salience (0-1, copied from candidate strength or manually set). */
  weight: number;
  /** Optional duration in seconds (for sustained events). */
  duration: number | null;
  /** Optional arbitrary payload for custom metadata. */
  payload: Record<string, unknown> | null;
  /** How this event was created. */
  provenance: AuthoredEventProvenance;
  /** ISO timestamp of last modification. */
  modifiedAt: string;
}

/**
 * Source declaration for an authored stream - tracks where events originated.
 */
export type AuthoredStreamSource =
  | {
      kind: "promoted";
      /** ID of the source candidate stream. */
      candidateStreamId: string;
      /** Event type from the candidate stream. */
      eventType: string;
    }
  | {
      kind: "manual";
      /** Optional description of the stream's purpose. */
      description?: string;
    }
  | {
      kind: "mixed";
      /** Stream contains events from multiple sources. */
    };

/**
 * An authored event stream - distinct from candidates, persists within session.
 */
export interface AuthoredEventStream {
  /** Stable unique identifier (nanoid). */
  id: string;
  /** User-editable display name. */
  name: string;
  /** Source declaration. */
  source: AuthoredStreamSource;
  /** The authoritative events (always time-sorted). */
  events: AuthoredEvent[];
  /** ISO timestamp when stream was created. */
  createdAt: string;
  /** ISO timestamp of last modification. */
  modifiedAt: string;
  /** Whether visible in timeline overlay. */
  isVisible: boolean;
  /** Display color (solid, not dashed). */
  color: {
    stroke: string;
    fill: string;
  };
}

/**
 * Undoable operation types for authored events.
 */
export type AuthoredEventOperation =
  | { kind: "add_event"; streamId: string; event: AuthoredEvent }
  | { kind: "remove_event"; streamId: string; event: AuthoredEvent; index: number }
  | {
      kind: "update_event";
      streamId: string;
      eventId: string;
      before: Partial<AuthoredEvent>;
      after: Partial<AuthoredEvent>;
    }
  | { kind: "add_stream"; stream: AuthoredEventStream }
  | { kind: "remove_stream"; stream: AuthoredEventStream }
  | { kind: "rename_stream"; streamId: string; before: string; after: string }
  | { kind: "batch"; operations: AuthoredEventOperation[] };

/**
 * A single undo/redo history entry.
 */
export interface UndoEntry {
  operation: AuthoredEventOperation;
  timestamp: string;
}
