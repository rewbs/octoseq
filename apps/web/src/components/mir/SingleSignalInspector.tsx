"use client";

import { useMemo } from "react";
import { AlertCircle, Play } from "lucide-react";
import { SignalViewer, createContinuousSignal, createSparseSignal } from "@/components/wavesurfer/SignalViewer";
import { Button } from "@/components/ui/button";
import { useMirStore, mirTabDefinitions } from "@/lib/stores/mirStore";
import { useMirActions } from "@/lib/stores/hooks/useMirActions";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
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
  const { runAnalysis } = useMirActions();
  const isRunning = useMirStore((s) => s.isRunning);
  const runningAnalysis = useMirStore((s) => s.runningAnalysis);
  const getInputMirResult = useMirStore((s) => s.getInputMirResult);

  // Get the input label for display
  const input = useAudioInputStore((s) => s.getInputById(inputId));
  const displayLabel = label ?? input?.label ?? (inputId === MIXDOWN_ID ? "Mixdown" : inputId);

  // Get the MIR result for this input and function
  const result = useMemo(() => {
    return getInputMirResult(inputId, functionId);
  }, [getInputMirResult, inputId, functionId]);

  // Get function metadata for display
  const functionDef = useMemo(
    () => mirTabDefinitions.find((t) => t.id === functionId),
    [functionId]
  );

  // Convert result to SignalData
  const signalData: SignalData | null = useMemo(() => {
    if (!result) return null;

    if (result.kind === "1d") {
      return createContinuousSignal(result.times, result.values);
    }

    if (result.kind === "events") {
      // Convert events to sparse signal
      const times = new Float32Array(result.events.length);
      const strengths = new Float32Array(result.events.length);
      for (let i = 0; i < result.events.length; i++) {
        const event = result.events[i];
        times[i] = event?.time ?? 0;
        strengths[i] = event?.strength ?? 1;
      }
      return createSparseSignal(times, strengths);
    }

    // 2D and tempoHypotheses not supported in single signal view
    return null;
  }, [result]);

  // Determine if this is currently running
  const isThisRunning = isRunning && runningAnalysis === functionId;

  // Handle run analysis for this input
  const handleRunAnalysis = () => {
    runAnalysis(functionId, inputId);
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
        mode={result?.kind === "events" ? "impulses" : "filled"}
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
