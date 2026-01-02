"use client";

import { useMemo } from "react";
import { SignalViewer, createSparseSignal } from "@/components/wavesurfer/SignalViewer";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { CandidateStream } from "@/lib/stores/candidateEventStore";

export interface CandidateEventOverlayProps {
  /** Candidate streams to display */
  streams: CandidateStream[];
  /** Viewport from the main WaveSurfer instance */
  viewport: WaveSurferViewport | null;
  /** Shared mirrored cursor (hover or playhead) */
  cursorTimeSec?: number | null;
  /** Audio duration in seconds */
  audioDuration?: number;
  /** Height of the overlay in pixels */
  height?: number;
}

/**
 * Overlay component for displaying candidate events on a timeline.
 * Uses dashed lines and lighter colors to distinguish from confirmed events.
 */
export function CandidateEventOverlay({
  streams,
  viewport,
  cursorTimeSec,
  audioDuration = 0,
  height = 60,
}: CandidateEventOverlayProps) {
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
        <CandidateStreamRow
          key={stream.id}
          stream={stream}
          viewport={viewport}
          cursorTimeSec={cursorTimeSec}
          audioDuration={audioDuration}
          height={height}
          style={{ top: index * height }}
        />
      ))}
    </div>
  );
}

interface CandidateStreamRowProps {
  stream: CandidateStream;
  viewport: WaveSurferViewport | null;
  cursorTimeSec?: number | null;
  audioDuration: number;
  height: number;
  style?: React.CSSProperties;
}

function CandidateStreamRow({
  stream,
  viewport,
  cursorTimeSec,
  audioDuration,
  height,
  style,
}: CandidateStreamRowProps) {
  // Convert candidate events to sparse signal
  const signalData = useMemo(() => {
    if (stream.events.length === 0) return null;

    const times = new Float32Array(stream.events.length);
    const strengths = new Float32Array(stream.events.length);

    for (let i = 0; i < stream.events.length; i++) {
      const event = stream.events[i];
      times[i] = event?.time ?? 0;
      strengths[i] = event?.strength ?? 1;
    }

    return createSparseSignal(times, strengths);
  }, [stream.events]);

  if (!signalData) return null;

  return (
    <div className="absolute left-0 right-0" style={{ ...style, height }}>
      {/* Source label */}
      <div className="absolute top-1 left-2 z-10">
        <span
          className="text-tiny font-medium px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60 backdrop-blur-sm italic"
          style={{ color: stream.color.stroke }}
        >
          {stream.sourceLabel} - {getEventTypeLabel(stream.eventType)}
          <span className="ml-1 text-zinc-400">(Suggested)</span>
        </span>
      </div>

      {/* Signal viewer with dashed styling */}
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
          strokeWidth: 1,
          opacity: 0.6,
        }}
        audioDuration={audioDuration}
      />
    </div>
  );
}

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
