"use client";

import { useMemo } from "react";
import { useInspectionStore } from "@/lib/stores/inspectionStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { mirTabDefinitions } from "@/lib/stores/mirStore";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
import { InspectionViewModeSelector } from "./InspectionViewModeSelector";
import { SingleSignalInspector } from "./SingleSignalInspector";
import { ComparisonInspector } from "./ComparisonInspector";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

// ----------------------------
// Types
// ----------------------------

export interface MirInspectionPanelProps {
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
// Function Selector Component
// ----------------------------

function MirFunctionSelector() {
  const selectedFunction = useInspectionStore((s) => s.selectedFunction);
  const setSelectedFunction = useInspectionStore((s) => s.setSelectedFunction);

  // Filter to 1D and events functions (not 2D heatmaps)
  const availableFunctions = useMemo(
    () => mirTabDefinitions.filter((t) => t.kind === "1d" || t.kind === "events"),
    []
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">Signal:</span>
      <select
        value={selectedFunction}
        onChange={(e) => setSelectedFunction(e.target.value as MirFunctionId)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {availableFunctions.map((fn) => (
          <option key={fn.id} value={fn.id}>
            {fn.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ----------------------------
// Inspection Context Display
// ----------------------------

function InspectionContextBadge() {
  const viewMode = useInspectionStore((s) => s.viewMode);
  const selectedInputId = useAudioInputStore((s) => s.selectedInputId);
  const getInputById = useAudioInputStore((s) => s.getInputById);

  const contextLabel = useMemo(() => {
    switch (viewMode) {
      case "mixdown":
        return "Mixdown";
      case "selected-stem": {
        if (!selectedInputId) return "No stem selected";
        const input = getInputById(selectedInputId);
        return input?.label ?? selectedInputId;
      }
      case "compare-all":
        return "All Sources";
      default:
        return viewMode;
    }
  }, [viewMode, selectedInputId, getInputById]);

  return (
    <div className="text-xs text-zinc-500 dark:text-zinc-400">
      Inspecting: <span className="font-medium text-zinc-700 dark:text-zinc-300">{contextLabel}</span>
    </div>
  );
}

// ----------------------------
// Main Component
// ----------------------------

export function MirInspectionPanel({
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  showBeatGrid = false,
  audioDuration = 0,
}: MirInspectionPanelProps) {
  const viewMode = useInspectionStore((s) => s.viewMode);
  const selectedFunction = useInspectionStore((s) => s.selectedFunction);
  const selectedInputId = useAudioInputStore((s) => s.selectedInputId);

  // Determine which input ID to use based on view mode
  const effectiveInputId = useMemo(() => {
    switch (viewMode) {
      case "mixdown":
        return MIXDOWN_ID;
      case "selected-stem":
        return selectedInputId ?? MIXDOWN_ID;
      case "compare-all":
        return null; // Compare mode uses all sources
      default:
        return MIXDOWN_ID;
    }
  }, [viewMode, selectedInputId]);

  return (
    <div className="flex flex-col gap-3 p-3 bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <InspectionViewModeSelector />
          <MirFunctionSelector />
        </div>
        <InspectionContextBadge />
      </div>

      {/* Content */}
      <div className="min-h-25">
        {viewMode === "compare-all" ? (
          <ComparisonInspector
            functionId={selectedFunction}
            viewport={viewport}
            cursorTimeSec={cursorTimeSec}
            onCursorTimeChange={onCursorTimeChange}
            showBeatGrid={showBeatGrid}
            audioDuration={audioDuration}
          />
        ) : effectiveInputId ? (
          <SingleSignalInspector
            inputId={effectiveInputId}
            functionId={selectedFunction}
            viewport={viewport}
            cursorTimeSec={cursorTimeSec}
            onCursorTimeChange={onCursorTimeChange}
            showBeatGrid={showBeatGrid}
            audioDuration={audioDuration}
            showSourceLabel={false}
          />
        ) : (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
            Select an audio source to inspect
          </div>
        )}
      </div>
    </div>
  );
}
