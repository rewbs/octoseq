"use client";

import { useMemo } from "react";
import { streamKeyPrefix, useAnalysisStore, type StreamId } from "@/lib/streams";

/**
 * Per-stream analysis status: a pulsing dot while any analysis for the stream is
 * in flight, otherwise the count of cached results, otherwise an em dash.
 */
export function AnalysisStatusChip({ streamId }: { streamId: StreamId }) {
  const results = useAnalysisStore((s) => s.results);
  const pending = useAnalysisStore((s) => s.pending);

  const status = useMemo(() => {
    const prefix = streamKeyPrefix(streamId);
    let isPending = false;
    for (const key of pending) {
      if (key.startsWith(prefix)) {
        isPending = true;
        break;
      }
    }
    let count = 0;
    for (const key of results.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return { isPending, count };
  }, [results, pending, streamId]);

  if (status.isPending) {
    return (
      <span className="flex w-7 shrink-0 items-center justify-center" title="Analysis running">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
      </span>
    );
  }

  if (status.count > 0) {
    return (
      <span
        className="w-7 shrink-0 rounded-full bg-zinc-100 px-1 text-center text-[10px] leading-4 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        title={`${status.count} cached ${status.count === 1 ? "analysis" : "analyses"}`}
      >
        {status.count}
      </span>
    );
  }

  return (
    <span
      className="w-7 shrink-0 text-center text-xs text-zinc-400 dark:text-zinc-600"
      title="No analyses yet"
    >
      —
    </span>
  );
}
