"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { GenericBeatGridOverlay } from "@/components/beatGrid/GenericBeatGridOverlay";
import {
  analysisKey,
  isBandStream,
  runStreamAnalysis,
  supportsAnalysis,
  toDisplayEvents,
  toDisplaySignal,
  useAnalysisStore,
  useStreamStore,
  type AnalysisId,
  type Stream,
} from "@/lib/streams";
import { ComparisonEventMarkers } from "./ComparisonEventMarkers";
import {
  ComparisonSignalCanvas,
  signalValueAtTime,
  type ViewportBounds,
} from "./ComparisonSignalCanvas";

/** Matches BandMirSignalViewer's BAND_ROW_HEIGHT. */
export const COMPARISON_ROW_HEIGHT = 60;

export type ComparisonRowProps = {
  stream: Stream;
  analysisId: AnalysisId;
  /** Human-readable analysis name (for placeholder messages). */
  analysisLabel: string;
  /** Row stroke color (hex). */
  color: string;
  viewport: WaveSurferViewport | null;
  cursorTimeSec?: number | null;
  onCursorTimeChange?: (timeSec: number | null) => void;
  showBeatGrid?: boolean;
  audioDuration?: number;
};

type HoverInfo = {
  value: number | null;
  time: number;
  x: number;
  /** Row width at hover time, for clamping the tooltip position. */
  containerWidth: number;
  viewportMin: number;
  viewportMax: number;
};

/**
 * One viewport-synced comparison row: any stream kind × one analysis.
 * 1d-shaped results render as a filled canvas line (like BandSignalRow),
 * events-shaped results as vertical markers (like BandEventOverlay); missing
 * results get a run affordance.
 */
export function ComparisonRow({
  stream,
  analysisId,
  analysisLabel,
  color,
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  showBeatGrid = false,
  audioDuration = 0,
}: ComparisonRowProps) {
  const viewportBoundsRef = useRef<ViewportBounds | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const key = analysisKey(stream.id, analysisId);
  const result = useAnalysisStore((s) => s.results.get(key));
  const isPending = useAnalysisStore((s) => s.pending.has(key));
  const error = useAnalysisStore((s) => s.errors.get(key));
  const parentLabel = useStreamStore((s) =>
    isBandStream(stream) ? (s.streams.get(stream.parentId)?.label ?? null) : null
  );

  // Bands show their parent for context: "Drums · Kick".
  const fullLabel =
    isBandStream(stream) && parentLabel ? `${parentLabel} · ${stream.label}` : stream.label;

  const displaySignal = useMemo(
    () => (result ? toDisplaySignal(result, analysisId) : null),
    [result, analysisId]
  );
  const displayEvents = useMemo(
    () => (result && !displaySignal ? toDisplayEvents(result) : null),
    [result, displaySignal]
  );

  const handleRun = useCallback(() => {
    // Failures are surfaced through analysisStore.errors; swallow the rejection.
    void runStreamAnalysis(stream.id, analysisId).catch(() => undefined);
  }, [stream.id, analysisId]);

  const handleMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
    if (!viewport) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const visibleDuration = viewport.endTime - viewport.startTime;
    if (visibleDuration <= 0 || rect.width <= 0) return;
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = viewport.startTime + (x / rect.width) * visibleDuration;

    onCursorTimeChange?.(Math.max(0, t));

    if (displaySignal) {
      const value = signalValueAtTime(displaySignal.times, displaySignal.values, t);
      const vpBounds = viewportBoundsRef.current;
      setHoverInfo({
        value,
        time: t,
        x,
        containerWidth: rect.width,
        viewportMin: vpBounds?.min ?? 0,
        viewportMax: vpBounds?.max ?? 0,
      });
    }
  };

  const handleMouseLeave = () => {
    onCursorTimeChange?.(null);
    setHoverInfo(null);
  };

  // DOM cursor line for event rows (1d rows draw theirs on the canvas).
  const eventCursorPct = useMemo(() => {
    if (cursorTimeSec == null || !viewport) return null;
    const { startTime, endTime } = viewport;
    const duration = endTime - startTime;
    if (duration <= 0 || cursorTimeSec < startTime || cursorTimeSec > endTime) return null;
    return ((cursorTimeSec - startTime) / duration) * 100;
  }, [cursorTimeSec, viewport]);

  // Placeholder state, in priority order.
  const unsupportedForBand = isBandStream(stream) && !supportsAnalysis(stream, analysisId);
  let placeholder: { pending: boolean; message: string; onRun?: () => void } | null = null;
  if (!displaySignal && !displayEvents) {
    if (unsupportedForBand) {
      placeholder = { pending: false, message: "Not available for bands" };
    } else if (isPending) {
      placeholder = { pending: true, message: "Running…" };
    } else if (error) {
      placeholder = { pending: false, message: `Failed: ${error}`, onRun: handleRun };
    } else if (result) {
      placeholder = { pending: false, message: `${analysisLabel} has no comparable view` };
    } else {
      placeholder = {
        pending: false,
        message: `No ${analysisLabel} for ${fullLabel}`,
        onRun: handleRun,
      };
    }
  }

  return (
    <div className="relative border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
      <div
        className="relative w-full bg-zinc-50 dark:bg-zinc-900"
        style={{ height: COMPARISON_ROW_HEIGHT }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {displaySignal && (
          <ComparisonSignalCanvas
            times={displaySignal.times}
            values={displaySignal.values}
            color={color}
            viewport={viewport}
            cursorTimeSec={cursorTimeSec}
            height={COMPARISON_ROW_HEIGHT}
            viewportBoundsRef={viewportBoundsRef}
          />
        )}
        {displayEvents && (
          <>
            <ComparisonEventMarkers
              events={displayEvents}
              color={color}
              viewport={viewport}
              height={COMPARISON_ROW_HEIGHT}
            />
            {eventCursorPct !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px"
                style={{ left: `${eventCursorPct}%`, backgroundColor: "rgba(239, 68, 68, 0.8)" }}
              />
            )}
          </>
        )}
        {placeholder && (
          <RowPlaceholder
            pending={placeholder.pending}
            message={placeholder.message}
            onRun={placeholder.onRun}
          />
        )}
        {showBeatGrid && audioDuration > 0 && (
          <GenericBeatGridOverlay
            viewport={viewport}
            audioDuration={audioDuration}
            height={COMPARISON_ROW_HEIGHT}
          />
        )}
      </div>

      {/* Stream label — floating overlay */}
      <div
        className="pointer-events-none absolute left-1 top-1 z-10 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium backdrop-blur-sm"
        style={{ backgroundColor: `${color}20`, color }}
      >
        <span className="max-w-40 truncate" title={fullLabel}>
          {fullLabel}
        </span>
        <span className="text-[10px] uppercase tracking-wide opacity-70">{stream.kind}</span>
        {displayEvents && displayEvents.length > 0 && (
          <span
            className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: `${color}20`, color }}
            title={`${displayEvents.length} events`}
          >
            {displayEvents.length}
          </span>
        )}
      </div>

      {/* Floating value display on hover (1d rows only) */}
      {hoverInfo && hoverInfo.value !== null && displaySignal && (
        <div
          className="pointer-events-none absolute top-1 z-20"
          style={{
            left: `${Math.min(
              Math.max(hoverInfo.x, 50),
              Math.max(hoverInfo.containerWidth - 50, 50)
            )}px`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="whitespace-nowrap rounded bg-zinc-800/90 px-1.5 py-0.5 text-xs text-zinc-100 shadow-lg backdrop-blur-sm dark:bg-zinc-200/90 dark:text-zinc-900">
            <span className="font-mono font-medium">{hoverInfo.value.toFixed(3)}</span>
            <span className="ml-1.5 text-[10px] opacity-70">
              vp: {hoverInfo.viewportMin.toFixed(2)}–{hoverInfo.viewportMax.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RowPlaceholder({
  pending,
  message,
  onRun,
}: {
  pending: boolean;
  message: string;
  onRun?: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 px-3 text-xs text-zinc-500 dark:text-zinc-400">
      {pending ? (
        <span className="flex animate-pulse items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span>Running…</span>
        </span>
      ) : (
        <>
          <span className="max-w-[70%] truncate" title={message}>
            {message}
          </span>
          {onRun && (
            <button
              type="button"
              onClick={onRun}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Run
            </button>
          )}
        </>
      )}
    </div>
  );
}
