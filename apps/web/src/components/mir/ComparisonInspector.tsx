"use client";

import { useMemo } from "react";
import { Play, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SingleSignalInspector } from "./SingleSignalInspector";
import { useMirStore } from "@/lib/stores/mirStore";
import { useMirActions } from "@/lib/stores/hooks/useMirActions";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

// ----------------------------
// Color palette for different sources
// ----------------------------

const SOURCE_COLORS = [
  { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.3)" }, // blue
  { stroke: "rgb(16, 185, 129)", fill: "rgba(16, 185, 129, 0.3)" }, // emerald
  { stroke: "rgb(249, 115, 22)", fill: "rgba(249, 115, 22, 0.3)" }, // orange
  { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.3)" }, // purple
  { stroke: "rgb(236, 72, 153)", fill: "rgba(236, 72, 153, 0.3)" }, // pink
  { stroke: "rgb(234, 179, 8)", fill: "rgba(234, 179, 8, 0.3)" },   // yellow
  { stroke: "rgb(20, 184, 166)", fill: "rgba(20, 184, 166, 0.3)" }, // teal
  { stroke: "rgb(239, 68, 68)", fill: "rgba(239, 68, 68, 0.3)" },   // red
];

const DEFAULT_COLOR = { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.3)" };

function getColorForIndex(index: number): { stroke: string; fill: string } {
  return SOURCE_COLORS[index % SOURCE_COLORS.length] ?? DEFAULT_COLOR;
}

// ----------------------------
// Types
// ----------------------------

export interface ComparisonInspectorProps {
  /** The MIR function to compare across sources */
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
}

// ----------------------------
// Component
// ----------------------------

export function ComparisonInspector({
  functionId,
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  showBeatGrid = false,
  audioDuration = 0,
}: ComparisonInspectorProps) {
  const { runAnalysis } = useMirActions();
  const isRunning = useMirStore((s) => s.isRunning);
  const inputMirCache = useMirStore((s) => s.inputMirCache);

  // Get all audio sources (mixdown + stems)
  const stems = useAudioInputStore((s) => s.getStems());
  const mixdown = useAudioInputStore((s) => s.getMixdown());

  // Build list of all sources to compare
  const sources = useMemo(() => {
    const result: Array<{ id: string; label: string; color: typeof SOURCE_COLORS[0] }> = [];

    // Mixdown first
    if (mixdown) {
      result.push({
        id: MIXDOWN_ID,
        label: mixdown.label,
        color: getColorForIndex(0),
      });
    }

    // Then stems
    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i];
      if (stem) {
        result.push({
          id: stem.id,
          label: stem.label,
          color: getColorForIndex(i + 1),
        });
      }
    }

    return result;
  }, [mixdown, stems]);

  // Check which sources have data
  const sourcesWithData = useMemo(() => {
    return sources.filter((source) => {
      const cacheKey = `${source.id}:${functionId}`;
      return inputMirCache.has(cacheKey as `${string}:${MirFunctionId}`);
    });
  }, [sources, functionId, inputMirCache]);

  // Run analysis for all sources
  const handleRunAll = async () => {
    for (const source of sources) {
      await runAnalysis(functionId, source.id);
    }
  };

  // Run analysis for sources without data
  const handleRunMissing = async () => {
    const missing = sources.filter(
      (source) => !inputMirCache.has(`${source.id}:${functionId}` as `${string}:${MirFunctionId}`)
    );
    for (const source of missing) {
      await runAnalysis(functionId, source.id);
    }
  };

  if (sources.length === 0) {
    return (
      <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
        No audio sources available for comparison
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header with run buttons */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Comparing {sources.length} source{sources.length !== 1 ? "s" : ""}
          {sourcesWithData.length < sources.length && (
            <span className="ml-1 text-amber-500">
              ({sources.length - sourcesWithData.length} missing data)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sourcesWithData.length < sources.length && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunMissing}
              disabled={isRunning}
              className="gap-1.5 h-7 text-xs"
            >
              <Play className="w-3 h-3" />
              Run Missing
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunAll}
            disabled={isRunning}
            className="gap-1.5 h-7 text-xs"
          >
            <PlayCircle className="w-3 h-3" />
            {isRunning ? "Running..." : "Run All"}
          </Button>
        </div>
      </div>

      {/* Stacked signal viewers */}
      <div className="flex flex-col gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {sources.map((source) => (
          <SingleSignalInspector
            key={source.id}
            inputId={source.id}
            functionId={functionId}
            viewport={viewport}
            cursorTimeSec={cursorTimeSec}
            onCursorTimeChange={onCursorTimeChange}
            showBeatGrid={showBeatGrid}
            audioDuration={audioDuration}
            showSourceLabel
            color={source.color}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {sources.map((source) => (
          <div key={source.id} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: source.color.stroke }}
            />
            <span className="text-zinc-600 dark:text-zinc-400">{source.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
