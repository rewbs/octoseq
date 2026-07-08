/**
 * Analysis Store — THE cache for analysis results, for every stream kind.
 *
 * Replaces mirStore.mirResults (legacy mixdown), mirStore.inputMirCache (per-input),
 * and bandMirStore's four caches with a single Map keyed by
 * `${streamId}::${analysisId}::${paramsHash}`.
 *
 * Invalidation is a prefix scan by stream id — no event bus, no listener registry.
 * Cross-store coordination (e.g. "band edit → invalidate band") lives in streamActions.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  streamKeyPrefix,
  type AnalysisKey,
  type AnalysisResult,
  type StreamId,
} from "./types";

/** Timing/backend info from the most recent completed analysis run. */
export interface LastRunInfo {
  key: AnalysisKey;
  totalMs?: number;
  cpuMs?: number;
  gpuMs?: number;
  backend?: string;
}

interface AnalysisState {
  results: Map<AnalysisKey, AnalysisResult>;
  pending: Set<AnalysisKey>;
  errors: Map<AnalysisKey, string>;
  /** Observability: last completed run's timings (null until a run completes). */
  lastRun: LastRunInfo | null;
}

interface AnalysisActions {
  /** Mark a computation in flight. Clears any previous error for the key. */
  setPending: (key: AnalysisKey) => void;

  /** Store a result. Clears pending and error states for the key. */
  setResult: (key: AnalysisKey, result: AnalysisResult) => void;

  /** Record a failure. Clears pending state for the key. */
  setError: (key: AnalysisKey, message: string) => void;

  /** Record timings of the most recent completed run. */
  setLastRun: (info: LastRunInfo | null) => void;

  getResult: (key: AnalysisKey) => AnalysisResult | null;
  isPending: (key: AnalysisKey) => boolean;
  getError: (key: AnalysisKey) => string | null;

  /** Drop a single cache entry (result, pending, and error states). */
  invalidateKey: (key: AnalysisKey) => void;

  /**
   * Drop every entry belonging to a stream.
   * Returns the number of results removed (pending/error entries not counted).
   */
  invalidateStream: (streamId: StreamId) => number;

  invalidateAll: () => void;

  reset: () => void;
}

const initialState: AnalysisState = {
  results: new Map(),
  pending: new Set(),
  errors: new Map(),
  lastRun: null,
};

function deleteByPrefix<V>(map: Map<string, V>, prefix: string): number {
  let removed = 0;
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

export const useAnalysisStore = create<AnalysisState & AnalysisActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setPending: (key) =>
        set(
          (state) => {
            const pending = new Set(state.pending);
            pending.add(key);
            const errors = new Map(state.errors);
            errors.delete(key);
            return { pending, errors };
          },
          false,
          "setPending"
        ),

      setResult: (key, result) =>
        set(
          (state) => {
            const results = new Map(state.results);
            results.set(key, result);
            const pending = new Set(state.pending);
            pending.delete(key);
            const errors = new Map(state.errors);
            errors.delete(key);
            return { results, pending, errors };
          },
          false,
          "setResult"
        ),

      setError: (key, message) =>
        set(
          (state) => {
            const errors = new Map(state.errors);
            errors.set(key, message);
            const pending = new Set(state.pending);
            pending.delete(key);
            return { errors, pending };
          },
          false,
          "setError"
        ),

      setLastRun: (info) => set({ lastRun: info }, false, "setLastRun"),

      getResult: (key) => get().results.get(key) ?? null,

      isPending: (key) => get().pending.has(key),

      getError: (key) => get().errors.get(key) ?? null,

      invalidateKey: (key) =>
        set(
          (state) => {
            const results = new Map(state.results);
            results.delete(key);
            const pending = new Set(state.pending);
            pending.delete(key);
            const errors = new Map(state.errors);
            errors.delete(key);
            return { results, pending, errors };
          },
          false,
          "invalidateKey"
        ),

      invalidateStream: (streamId) => {
        const prefix = streamKeyPrefix(streamId);
        let removedResults = 0;
        set(
          (state) => {
            const results = new Map(state.results);
            removedResults = deleteByPrefix(results, prefix);

            const pending = new Set(state.pending);
            for (const key of pending) {
              if (key.startsWith(prefix)) pending.delete(key);
            }

            const errors = new Map(state.errors);
            deleteByPrefix(errors, prefix);

            return { results, pending, errors };
          },
          false,
          "invalidateStream"
        );
        return removedResults;
      },

      invalidateAll: () =>
        set(
          { results: new Map(), pending: new Set(), errors: new Map() },
          false,
          "invalidateAll"
        ),

      reset: () =>
        set(
          { results: new Map(), pending: new Set(), errors: new Map() },
          false,
          "reset"
        ),
    }),
    { name: "AnalysisStore" }
  )
);
