/**
 * Stream Store — the single collection of analysable streams.
 *
 * Holds the mixdown, stems, and band streams in one Map with uniform CRUD.
 * Invariants enforced here:
 * - At most one mixdown, always with id MIXDOWN_STREAM_ID and sortOrder 0.
 * - A band's parentId must reference an existing AudioStream (no bands of bands).
 * - Removing an AudioStream cascades to its dependent bands.
 *
 * This store does NOT hold decoded PCM (see audioCache) and does NOT invalidate
 * analyses — coordinated mutations that touch multiple stores live in streamActions.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  FrequencyBandProvenance,
  FrequencyBandTimeScope,
  FrequencySegment,
} from "@octoseq/mir";
import {
  MIXDOWN_STREAM_ID,
  isAudioStream,
  isBandStream,
  type AudioReference,
  type AudioStream,
  type BandStream,
  type Stream,
  type StreamId,
} from "./types";

// ----------------------------
// State & actions
// ----------------------------

interface StreamState {
  streams: Map<StreamId, Stream>;
  /** Currently selected stream in the UI (context display, not playback authority). */
  selectedStreamId: StreamId | null;
}

export interface AddStemParams {
  label: string;
  audio: AudioReference;
}

export interface AddBandParams {
  parentId: StreamId;
  label: string;
  frequencyShape: FrequencySegment[];
  timeScope?: FrequencyBandTimeScope;
  provenance?: FrequencyBandProvenance;
  color?: string;
  enabled?: boolean;
}

export interface BandShapePatch {
  frequencyShape?: FrequencySegment[];
  timeScope?: FrequencyBandTimeScope;
}

interface StreamActions {
  /** Create the mixdown, or replace its audio/label if it already exists. */
  initializeMixdown: (params: { audio: AudioReference; label?: string }) => void;

  /** Add a stem. Returns its new StreamId. */
  addStem: (params: AddStemParams) => StreamId;

  /** Add a band stream under an AudioStream parent. Throws if the parent is invalid. */
  addBand: (params: AddBandParams) => StreamId;

  /** Rename any stream. Empty/whitespace labels are ignored (no-op). */
  renameStream: (id: StreamId, label: string) => void;

  setStreamEnabled: (id: StreamId, enabled: boolean) => void;

  setBandColor: (id: StreamId, color: string | undefined) => void;

  /** Update a band's frequency geometry. Throws if the stream is not a band. */
  updateBandShape: (id: StreamId, patch: BandShapePatch) => void;

  /** Replace an AudioStream's audio reference. Throws if the stream is a band. */
  updateAudio: (id: StreamId, audio: AudioReference) => void;

  /**
   * Reassign sortOrder by position for the given ids (a sibling group: stems, or
   * bands of one parent). Ids not in the collection are skipped.
   */
  reorderStreams: (orderedIds: StreamId[]) => void;

  /**
   * Remove a stream and (for AudioStreams) its dependent bands.
   * Returns the removed streams for undo. Removing the mixdown throws — use reset().
   */
  removeStream: (id: StreamId) => Stream[];

  /** Re-insert previously removed streams (undo support). */
  restoreStreams: (streams: Stream[]) => void;

  selectStream: (id: StreamId | null) => void;

  /** Clear everything. */
  reset: () => void;

  // Selectors
  getStream: (id: StreamId) => Stream | null;
  getMixdown: () => AudioStream | null;
  getStems: () => AudioStream[];
  /** Mixdown + stems, in display order (mixdown first). */
  getAudioStreams: () => AudioStream[];
  /** Bands, optionally filtered to one parent, in sortOrder. */
  getBands: (parentId?: StreamId) => BandStream[];
}

const initialState: StreamState = {
  streams: new Map(),
  selectedStreamId: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

function nextSortOrder(siblings: Stream[]): number {
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((s) => s.sortOrder)) + 1;
}

export const useStreamStore = create<StreamState & StreamActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      initializeMixdown: ({ audio, label }) =>
        set(
          (state) => {
            const existing = state.streams.get(MIXDOWN_STREAM_ID);
            const now = nowIso();
            const mixdown: AudioStream =
              existing && isAudioStream(existing)
                ? { ...existing, audio, label: label ?? existing.label, modifiedAt: now }
                : {
                    id: MIXDOWN_STREAM_ID,
                    kind: "mixdown",
                    label: label ?? "Mixdown",
                    enabled: true,
                    sortOrder: 0,
                    createdAt: now,
                    modifiedAt: now,
                    audio,
                  };
            const streams = new Map(state.streams);
            streams.set(MIXDOWN_STREAM_ID, mixdown);
            return { streams };
          },
          false,
          "initializeMixdown"
        ),

      addStem: ({ label, audio }) => {
        const id = nanoid();
        set(
          (state) => {
            const now = nowIso();
            const stems = [...state.streams.values()].filter((s) => s.kind === "stem");
            const stem: AudioStream = {
              id,
              kind: "stem",
              label,
              enabled: true,
              sortOrder: nextSortOrder(stems),
              createdAt: now,
              modifiedAt: now,
              audio,
            };
            const streams = new Map(state.streams);
            streams.set(id, stem);
            return { streams };
          },
          false,
          "addStem"
        );
        return id;
      },

      addBand: (params) => {
        const parent = get().streams.get(params.parentId);
        if (!parent) {
          throw new Error(`addBand: parent stream "${params.parentId}" does not exist`);
        }
        if (!isAudioStream(parent)) {
          throw new Error(
            `addBand: parent "${params.parentId}" is a band; bands of bands are not supported`
          );
        }
        const id = nanoid();
        set(
          (state) => {
            const now = nowIso();
            const siblings = [...state.streams.values()].filter(
              (s) => isBandStream(s) && s.parentId === params.parentId
            );
            const band: BandStream = {
              id,
              kind: "band",
              parentId: params.parentId,
              label: params.label,
              enabled: params.enabled ?? true,
              sortOrder: nextSortOrder(siblings),
              createdAt: now,
              modifiedAt: now,
              timeScope: params.timeScope ?? { kind: "global" },
              frequencyShape: params.frequencyShape,
              provenance: params.provenance ?? { source: "manual", createdAt: now },
              color: params.color,
            };
            const streams = new Map(state.streams);
            streams.set(id, band);
            return { streams };
          },
          false,
          "addBand"
        );
        return id;
      },

      renameStream: (id, label) => {
        const trimmed = label.trim();
        if (trimmed.length === 0) return;
        set(
          (state) => {
            const stream = state.streams.get(id);
            if (!stream) return state;
            const streams = new Map(state.streams);
            streams.set(id, { ...stream, label: trimmed, modifiedAt: nowIso() });
            return { streams };
          },
          false,
          "renameStream"
        );
      },

      setStreamEnabled: (id, enabled) =>
        set(
          (state) => {
            const stream = state.streams.get(id);
            if (!stream || stream.enabled === enabled) return state;
            const streams = new Map(state.streams);
            streams.set(id, { ...stream, enabled, modifiedAt: nowIso() });
            return { streams };
          },
          false,
          "setStreamEnabled"
        ),

      setBandColor: (id, color) =>
        set(
          (state) => {
            const stream = state.streams.get(id);
            if (!stream || !isBandStream(stream)) return state;
            const streams = new Map(state.streams);
            streams.set(id, { ...stream, color, modifiedAt: nowIso() });
            return { streams };
          },
          false,
          "setBandColor"
        ),

      updateBandShape: (id, patch) => {
        const stream = get().streams.get(id);
        if (!stream) throw new Error(`updateBandShape: stream "${id}" does not exist`);
        if (!isBandStream(stream)) {
          throw new Error(`updateBandShape: stream "${id}" is not a band`);
        }
        set(
          (state) => {
            const band = state.streams.get(id) as BandStream;
            const streams = new Map(state.streams);
            streams.set(id, {
              ...band,
              frequencyShape: patch.frequencyShape ?? band.frequencyShape,
              timeScope: patch.timeScope ?? band.timeScope,
              modifiedAt: nowIso(),
            });
            return { streams };
          },
          false,
          "updateBandShape"
        );
      },

      updateAudio: (id, audio) => {
        const stream = get().streams.get(id);
        if (!stream) throw new Error(`updateAudio: stream "${id}" does not exist`);
        if (!isAudioStream(stream)) {
          throw new Error(`updateAudio: stream "${id}" is a band and has no backing audio`);
        }
        set(
          (state) => {
            const target = state.streams.get(id) as AudioStream;
            const streams = new Map(state.streams);
            streams.set(id, { ...target, audio, modifiedAt: nowIso() });
            return { streams };
          },
          false,
          "updateAudio"
        );
      },

      reorderStreams: (orderedIds) =>
        set(
          (state) => {
            const streams = new Map(state.streams);
            orderedIds.forEach((id, index) => {
              const stream = streams.get(id);
              if (!stream) return;
              streams.set(id, { ...stream, sortOrder: index + 1, modifiedAt: nowIso() });
            });
            return { streams };
          },
          false,
          "reorderStreams"
        ),

      removeStream: (id) => {
        if (id === MIXDOWN_STREAM_ID) {
          throw new Error("removeStream: cannot remove the mixdown; use reset() to clear all");
        }
        const state = get();
        const target = state.streams.get(id);
        if (!target) return [];
        const dependents = [...state.streams.values()]
          .filter((s): s is BandStream => isBandStream(s) && s.parentId === id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const removed: Stream[] = [target, ...dependents];
        set(
          (current) => {
            const streams = new Map(current.streams);
            for (const stream of removed) streams.delete(stream.id);
            const selectedStreamId = removed.some((s) => s.id === current.selectedStreamId)
              ? null
              : current.selectedStreamId;
            return { streams, selectedStreamId };
          },
          false,
          "removeStream"
        );
        return removed;
      },

      restoreStreams: (toRestore) =>
        set(
          (state) => {
            const streams = new Map(state.streams);
            for (const stream of toRestore) streams.set(stream.id, stream);
            return { streams };
          },
          false,
          "restoreStreams"
        ),

      selectStream: (id) => set({ selectedStreamId: id }, false, "selectStream"),

      reset: () => set({ ...initialState, streams: new Map() }, false, "reset"),

      // ----------------------------
      // Selectors
      // ----------------------------

      getStream: (id) => get().streams.get(id) ?? null,

      getMixdown: () => {
        const mixdown = get().streams.get(MIXDOWN_STREAM_ID);
        return mixdown && isAudioStream(mixdown) ? mixdown : null;
      },

      getStems: () =>
        [...get().streams.values()]
          .filter((s): s is AudioStream => s.kind === "stem")
          .sort((a, b) => a.sortOrder - b.sortOrder),

      getAudioStreams: () => {
        const mixdown = get().getMixdown();
        const stems = get().getStems();
        return mixdown ? [mixdown, ...stems] : stems;
      },

      getBands: (parentId) =>
        [...get().streams.values()]
          .filter(
            (s): s is BandStream =>
              isBandStream(s) && (parentId === undefined || s.parentId === parentId)
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
    }),
    { name: "StreamStore" }
  )
);
