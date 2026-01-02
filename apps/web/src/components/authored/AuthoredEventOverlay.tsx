"use client";

import { useMemo, useCallback } from "react";
import { SignalViewer, createSparseSignal } from "@/components/wavesurfer/SignalViewer";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { AuthoredEventStream } from "@/lib/stores/types/authoredEvent";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";

export interface AuthoredEventOverlayProps {
  /** Authored streams to display */
  streams: AuthoredEventStream[];
  /** Viewport from the main WaveSurfer instance */
  viewport: WaveSurferViewport | null;
  /** Shared mirrored cursor (hover or playhead) */
  cursorTimeSec?: number | null;
  /** Audio duration in seconds */
  audioDuration?: number;
  /** Height of the overlay in pixels */
  height?: number;
  /** Enable click-to-add events */
  interactive?: boolean;
}

/**
 * Overlay component for displaying authored events on a timeline.
 * Uses solid lines and stronger colors to distinguish from candidate suggestions.
 */
export function AuthoredEventOverlay({
  streams,
  viewport,
  cursorTimeSec,
  audioDuration = 0,
  height = 60,
  interactive = false,
}: AuthoredEventOverlayProps) {
  // Filter to visible streams only
  const visibleStreams = useMemo(
    () => streams.filter((s) => s.isVisible),
    [streams]
  );

  if (visibleStreams.length === 0) {
    return null;
  }

  return (
    <div className="relative" style={{ height: `${height * visibleStreams.length}px` }}>
      {visibleStreams.map((stream, index) => (
        <AuthoredStreamRow
          key={stream.id}
          stream={stream}
          viewport={viewport}
          cursorTimeSec={cursorTimeSec}
          audioDuration={audioDuration}
          height={height}
          style={{ top: index * height }}
          interactive={interactive}
        />
      ))}
    </div>
  );
}

interface AuthoredStreamRowProps {
  stream: AuthoredEventStream;
  viewport: WaveSurferViewport | null;
  cursorTimeSec?: number | null;
  audioDuration: number;
  height: number;
  style?: React.CSSProperties;
  interactive: boolean;
}

function AuthoredStreamRow({
  stream,
  viewport,
  cursorTimeSec,
  audioDuration,
  height,
  style,
  interactive,
}: AuthoredStreamRowProps) {
  const inspectedStreamId = useAuthoredEventStore((s) => s.inspectedStreamId);
  //const selectedEventIds = useAuthoredEventStore((s) => s.selectedEventIds);
  const { addEventAtTime, inspectStream } = useAuthoredEventActions();

  const isInspected = inspectedStreamId === stream.id;

  // Convert authored events to sparse signal
  const signalData = useMemo(() => {
    if (stream.events.length === 0) return null;

    const times = new Float32Array(stream.events.length);
    const strengths = new Float32Array(stream.events.length);

    for (let i = 0; i < stream.events.length; i++) {
      const event = stream.events[i];
      times[i] = event?.time ?? 0;
      strengths[i] = event?.weight ?? 1;
    }

    return createSparseSignal(times, strengths);
  }, [stream.events]);

  // Handle click to add event
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !viewport || audioDuration <= 0) return;

    // Get click position relative to element
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // Convert to time using viewport
    const visibleFraction = x / width;
    const visibleDuration = viewport.endTime - viewport.startTime;
    const clickTime = viewport.startTime + visibleFraction * visibleDuration;

    // Clamp to valid range
    const time = Math.max(0, Math.min(audioDuration, clickTime));

    // If clicking on the inspected stream, add an event
    if (isInspected) {
      addEventAtTime(stream.id, time);
    } else {
      // Otherwise, select this stream for inspection
      inspectStream(stream.id);
    }
  }, [interactive, viewport, audioDuration, isInspected, stream.id, addEventAtTime, inspectStream]);

  if (!signalData && !interactive) return null;

  return (
    <div
      className="absolute left-0 right-0"
      style={{ ...style, height }}
      onClick={handleClick}
    >
      {/* Source label */}
      <div className="absolute top-1 left-2 z-10">
        <span
          className="text-tiny font-medium px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60 backdrop-blur-sm"
          style={{ color: stream.color.stroke }}
        >
          {stream.name}
          <span className="ml-1 text-zinc-500">(Authored)</span>
        </span>
      </div>

      {/* Interactive hint when inspected */}
      {interactive && isInspected && (
        <div className="absolute top-1 right-2 z-10">
          <span className="text-tiny text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60 backdrop-blur-sm">
            Click to add event
          </span>
        </div>
      )}

      {/* Signal viewer with solid styling */}
      {signalData && (
        <SignalViewer
          signal={signalData}
          viewport={viewport}
          cursorTimeSec={cursorTimeSec}
          mode="impulses"
          baseline="bottom"
          normalization="global"
          color={{
            stroke: stream.color.stroke,
            fill: stream.color.fill,
            strokeWidth: 2,
            opacity: 1.0,
          }}
          audioDuration={audioDuration}
        />
      )}

      {/* Empty state placeholder when inspected but no events */}
      {!signalData && interactive && isInspected && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-zinc-400">
            Click to add first event
          </span>
        </div>
      )}

      {/* Selection highlight border when inspected */}
      {isInspected && (
        <div
          className="absolute inset-0 border-2 rounded pointer-events-none"
          style={{ borderColor: stream.color.stroke }}
        />
      )}
    </div>
  );
}
