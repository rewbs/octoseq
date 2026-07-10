"use client";

import { useMemo } from "react";
import { AlertCircle, Play } from "lucide-react";
import {
  SignalViewer,
  createContinuousSignal,
  createSparseSignal,
} from "@/components/wavesurfer/SignalViewer";
import { Button } from "@/components/ui/button";
import { mirTabDefinitions } from "@/lib/stores/mirStore";
import {
  useStreamStore,
  useAnalysisStore,
  runStreamAnalysis,
  analysisKey,
  toDisplaySignal,
  toDisplayEvents,
  MIXDOWN_STREAM_ID,
} from "@/lib/streams";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { SignalData } from "@octoseq/wavesurfer-signalviewer";

// ----------------------------
// Types
// ----------------------------

export interface SingleSignalInspectorProps {
  /** The audio input ID to inspect */
  inputId: string;
  /** The MIR function to display */
  functionId: MirFunctionId;
  /** Viewport from the main WaveSurfer instance */
  viewport: WaveSurferViewport | null;
  /** Shared mirrored cursor (hover or playhead) */
  cursorTimeSec?: number | null;
  /** Notify parent when this view is hovered */
  onCursorTimeChange?: (timeSec: number | null) => void;
  /** Whether to show beat grid overlay */
  showBeatGrid?: boolean;
  /** Audio duration in seconds */
  audioDuration?: number;
  /** Optional custom label (defaults to input label) */
  label?: string;
  /** Whether to show the source label badge */
  showSourceLabel?: boolean;
  /** Optional color override for the signal */
  color?: { stroke: string; fill: string };
}

// ----------------------------
// Component
// ----------------------------

export function SingleSignalInspector({
  inputId,
  functionId,
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  showBeatGrid = false,
  audioDuration = 0,
  label,
  showSourceLabel = true,
  color,
}: SingleSignalInspectorProps) {
  const isRunning = useAnalysisStore((s) => s.pending.size > 0);
  const isThisRunning = useAnalysisStore((s) => s.pending.has(analysisKey(inputId, functionId)));

  // Get the input label for display
  const stream = useStreamStore((s) => s.streams.get(inputId));
  const displayLabel =
    label ?? stream?.label ?? (inputId === MIXDOWN_STREAM_ID ? "Mixdown" : inputId);

  // Get the (raw) analysis result for this input and function
  const result = useAnalysisStore((s) => s.results.get(analysisKey(inputId, functionId)));

  // Get function metadata for display
  const functionDef = useMemo(
    () => mirTabDefinitions.find((t) => t.id === functionId),
    [functionId]
  );

  // Display-edge transforms (raw result -> normalized signal / uniform event list)
  const displaySignal = result ? toDisplaySignal(result, functionId) : null;
  const displayEvents = result ? toDisplayEvents(result) : null;

  // Convert result to SignalData
  const signalData: SignalData | null = useMemo(() => {
    if (displaySignal) {
      return createContinuousSignal(displaySignal.times, displaySignal.values);
    }

    if (displayEvents) {
      // Convert events to sparse signal
      const times = new Float32Array(displayEvents.length);
      const strengths = new Float32Array(displayEvents.length);
      for (let i = 0; i < displayEvents.length; i++) {
        const event = displayEvents[i];
        times[i] = event?.time ?? 0;
        strengths[i] = event?.strength ?? 1;
      }
      return createSparseSignal(times, strengths);
    }

    // 2D and tempoHypotheses not supported in single signal view
    return null;
  }, [displaySignal, displayEvents]);

  // Handle run analysis for this input
  const handleRunAnalysis = () => {
    runStreamAnalysis(inputId, functionId);
  };

  // Color configuration
  const colorConfig = color ?? {
    stroke: "rgb(59, 130, 246)",
    fill: "rgba(59, 130, 246, 0.3)",
  };

  // No result state
  if (!signalData) {
    return (
      <div className="relative bg-zinc-100 dark:bg-zinc-900 rounded p-4">
        {showSourceLabel && (
          <div className="absolute top-2 left-3 z-10">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-200/80 dark:bg-zinc-800/80 px-2 py-0.5 rounded">
              {displayLabel}
            </span>
          </div>
        )}
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <AlertCircle className="w-6 h-6 text-zinc-400" />
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            No {functionDef?.label ?? functionId} data for {displayLabel}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunAnalysis}
            disabled={isRunning}
            className="gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            {isThisRunning ? "Running..." : "Run Analysis"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {showSourceLabel && (
        <div className="absolute top-2 left-3 z-10">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-200/80 dark:bg-zinc-800/80 px-2 py-0.5 rounded backdrop-blur-sm">
            {displayLabel}
          </span>
        </div>
      )}
      <SignalViewer
        signal={signalData}
        viewport={viewport}
        cursorTimeSec={cursorTimeSec}
        onCursorTimeChange={onCursorTimeChange}
        mode={displayEvents ? "impulses" : "filled"}
        baseline="bottom"
        normalization="global"
        color={{
          ...colorConfig,
          strokeWidth: 1.5,
          opacity: 1,
        }}
        resizable
        showBeatGrid={showBeatGrid}
        audioDuration={audioDuration}
      />
    </div>
  );
}
