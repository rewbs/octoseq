"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { mirTabDefinitions } from "@/lib/stores/mirStore";
import {
  useStreamStore,
  useViewStore,
  type AnalysisId,
  type Stream,
} from "@/lib/streams";
import { buildStreamColorMap, MIXDOWN_COLOR_HEX } from "./comparisonColors";
import { ComparisonRow } from "./ComparisonRow";

export type ComparisonPanelProps = {
  /** Viewport from the main WaveSurfer instance. */
  viewport: WaveSurferViewport | null;
  /** Shared mirrored cursor (hover or playhead) to display. */
  cursorTimeSec?: number | null;
  /** Notify parent when a row is hovered. */
  onCursorTimeChange?: (t: number | null) => void;
  /** Whether to show the beat grid overlay on rows (default: false). */
  showBeatGrid?: boolean;
  /** Audio duration in seconds (required if showBeatGrid is true). */
  audioDuration?: number;
};

/** Analyses offered by the picker: 1d + events kinds (2d/tempo excluded). */
const COMPARABLE_ANALYSES = mirTabDefinitions.filter(
  (t) => t.kind === "1d" || t.kind === "events"
);

/**
 * Comparison panel — stacked, viewport-synced signal rows for any set of
 * streams × one chosen analysis. See docs/design/phase2-ui-shell.md
 * ("Comparison Panel"). Selection lives in viewStore.comparedStreamIds
 * (populated from the Streams panel); rows resolve results from analysisStore.
 */
export function ComparisonPanel({
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  showBeatGrid = false,
  audioDuration = 0,
}: ComparisonPanelProps) {
  const open = useViewStore((s) => s.comparisonOpen);
  const setOpen = useViewStore((s) => s.setComparisonOpen);
  const analysisId = useViewStore((s) => s.comparisonAnalysisId);
  const setComparisonAnalysis = useViewStore((s) => s.setComparisonAnalysis);
  const comparedStreamIds = useViewStore((s) => s.comparedStreamIds);
  const removeCompared = useViewStore((s) => s.removeCompared);
  const clearCompared = useViewStore((s) => s.clearCompared);
  const streams = useStreamStore((s) => s.streams);

  // Insertion order of the compared set; ids of removed streams are skipped.
  const comparedStreams = useMemo(() => {
    const out: Stream[] = [];
    for (const id of comparedStreamIds) {
      const stream = streams.get(id);
      if (stream) out.push(stream);
    }
    return out;
  }, [comparedStreamIds, streams]);

  const colorById = useMemo(() => buildStreamColorMap(streams), [streams]);

  const analysisLabel =
    COMPARABLE_ANALYSES.find((t) => t.id === analysisId)?.label ?? analysisId;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div
        className={`flex flex-wrap items-center gap-2 px-3 py-2 ${
          open ? "border-b border-zinc-200 dark:border-zinc-700" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span>Compare</span>
        </button>

        <select
          value={analysisId}
          onChange={(e) => setComparisonAnalysis(e.target.value as AnalysisId)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          aria-label="Comparison analysis"
        >
          {COMPARABLE_ANALYSES.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>

        {/* Compared-stream chips */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {comparedStreams.map((stream) => {
            const color = colorById.get(stream.id) ?? MIXDOWN_COLOR_HEX;
            return (
              <span
                key={stream.id}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="max-w-28 truncate" title={stream.label}>
                  {stream.label}
                </span>
                <button
                  type="button"
                  onClick={() => removeCompared(stream.id)}
                  className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                  aria-label={`Remove ${stream.label} from comparison`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>

        <button
          type="button"
          onClick={clearCompared}
          disabled={comparedStreams.length === 0}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Clear
        </button>
      </div>

      {/* Body */}
      {open &&
        (comparedStreams.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Tick streams in the Streams panel to compare them here.
          </div>
        ) : (
          <div>
            {comparedStreams.map((stream) => (
              <ComparisonRow
                key={stream.id}
                stream={stream}
                analysisId={analysisId}
                analysisLabel={analysisLabel}
                color={colorById.get(stream.id) ?? MIXDOWN_COLOR_HEX}
                viewport={viewport}
                cursorTimeSec={cursorTimeSec}
                onCursorTimeChange={onCursorTimeChange}
                showBeatGrid={showBeatGrid}
                audioDuration={audioDuration}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
