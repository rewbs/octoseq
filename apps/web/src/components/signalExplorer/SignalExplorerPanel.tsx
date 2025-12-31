"use client";

import { memo, useMemo } from "react";
import { ChevronDown, ChevronRight, Activity, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useSignalExplorerStore } from "@/lib/stores/signalExplorerStore";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";
import { TransformStepCard } from "./TransformStepCard";
import { generateBeatTimes } from "@octoseq/mir";

/** Format time in multiple units */
function formatTimeMulti(
  seconds: number,
  bpm: number | null,
  fps: number
): { seconds: string; beats: string | null; frames: string } {
  const secondsStr = `${seconds.toFixed(2)}s`;
  const framesStr = `${Math.round(seconds * fps)}f`;
  const beatsStr = bpm ? `${(seconds * bpm / 60).toFixed(2)}b` : null;
  return { seconds: secondsStr, beats: beatsStr, frames: framesStr };
}

interface SignalExplorerPanelProps {
  className?: string;
}

export const SignalExplorerPanel = memo(function SignalExplorerPanel({
  className = "",
}: SignalExplorerPanelProps) {
  const {
    isExpanded,
    toggleExpanded,
    lastValidAnalysis,
    lastValidSignalName,
    currentCursor,
    lastError,
    isPlaybackActive,
    isAnalyzing,
    bpm,
    targetFps,
    windowBeats,
    zoomIn,
    zoomOut,
  } = useSignalExplorerStore();

  // Get beat grid data for overlay
  const activeBeatGrid = useBeatGridStore((s) => s.activeBeatGrid);
  const selectedHypothesis = useBeatGridStore((s) => s.selectedHypothesis);
  const phaseHypotheses = useBeatGridStore((s) => s.phaseHypotheses);
  const activePhaseIndex = useBeatGridStore((s) => s.activePhaseIndex);
  const userNudge = useBeatGridStore((s) => s.userNudge);
  const subBeatDivision = useBeatGridStore((s) => s.subBeatDivision);

  const hasValidData = lastValidAnalysis !== null;

  // Show cursor signal name or last valid
  const displaySignalName = currentCursor?.signalName ?? lastValidSignalName;

  // Compute beat times for the visible time range
  const { beatTimes, subBeatTimes } = useMemo(() => {
    if (!lastValidAnalysis) return { beatTimes: [], subBeatTimes: [] };

    const [startTime, endTime] = lastValidAnalysis.time_range;
    const duration = endTime - startTime;
    if (duration <= 0) return { beatTimes: [], subBeatTimes: [] };

    // Get beat grid parameters
    let gridBpm: number | null = null;
    let phaseOffset = 0;
    let nudge = 0;

    if (activeBeatGrid) {
      gridBpm = activeBeatGrid.bpm;
      phaseOffset = activeBeatGrid.phaseOffset;
      nudge = activeBeatGrid.userNudge;
    } else if (selectedHypothesis) {
      gridBpm = selectedHypothesis.bpm;
      const activePhase = phaseHypotheses[activePhaseIndex];
      if (activePhase) {
        phaseOffset = activePhase.phaseOffset;
      }
      nudge = userNudge;
    }

    if (!gridBpm) return { beatTimes: [], subBeatTimes: [] };

    // Generate beat times for the analysis range (with some margin)
    const allBeatTimes = generateBeatTimes(gridBpm, phaseOffset, nudge, endTime + 1);
    const visibleBeatTimes = allBeatTimes.filter((t) => t >= startTime && t <= endTime);

    // Generate sub-beat times if enabled
    const visibleSubBeatTimes: number[] = [];
    if (subBeatDivision > 1) {
      for (let i = 0; i < allBeatTimes.length - 1; i++) {
        const beatTime = allBeatTimes[i];
        const nextBeatTime = allBeatTimes[i + 1];
        if (beatTime === undefined || nextBeatTime === undefined) continue;
        const beatInterval = nextBeatTime - beatTime;
        const subBeatInterval = beatInterval / subBeatDivision;

        for (let j = 1; j < subBeatDivision; j++) {
          const subBeatTime = beatTime + j * subBeatInterval;
          if (subBeatTime >= startTime && subBeatTime <= endTime) {
            visibleSubBeatTimes.push(subBeatTime);
          }
        }
      }
    }

    return { beatTimes: visibleBeatTimes, subBeatTimes: visibleSubBeatTimes };
  }, [
    lastValidAnalysis,
    activeBeatGrid,
    selectedHypothesis,
    phaseHypotheses,
    activePhaseIndex,
    userNudge,
    subBeatDivision,
  ]);

  if (!isExpanded) {
    return (
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded transition-colors"
        title="Expand Signal Explorer"
      >
        <Activity className="w-3.5 h-3.5" />
        <ChevronRight className="w-3 h-3" />
        <span>Signal Explorer</span>
      </button>
    );
  }

  return (
    <div
      className={`border border-zinc-200 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-900 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={toggleExpanded}
          className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Signal Explorer</span>
          {displaySignalName && (
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              {displaySignalName}
            </span>
          )}
          {isAnalyzing && (
            <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />
          )}
          <ChevronDown className="w-4 h-4" />
        </button>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              zoomIn();
            }}
            className="p-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
            title="Zoom in (show fewer beats)"
            disabled={windowBeats <= 0.5}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span className="text-tiny text-zinc-500 dark:text-zinc-400 font-mono min-w-[3ch] text-center">
            {windowBeats}b
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              zoomOut();
            }}
            className="p-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
            title="Zoom out (show more beats)"
            disabled={windowBeats >= 16}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 pb-3 space-y-2">
        {lastError && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
            {lastError}
          </div>
        )}

        {!hasValidData && !isAnalyzing && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
            Hover over a signal variable in the script to explore its transform
            chain.
          </div>
        )}

        {hasValidData && lastValidAnalysis && (
          <>
            {/* Time range indicator */}
            {(() => {
              const startTime = lastValidAnalysis.time_range[0];
              const endTime = lastValidAnalysis.time_range[1];
              const centerTime = (startTime + endTime) / 2;
              const start = formatTimeMulti(startTime, bpm, targetFps);
              const center = formatTimeMulti(centerTime, bpm, targetFps);
              const end = formatTimeMulti(endTime, bpm, targetFps);

              return (
                <div className="flex items-center justify-between text-tiny text-zinc-500 dark:text-zinc-400 font-mono">
                  <div className="flex flex-col items-start">
                    <span>{start.seconds}</span>
                    {start.beats && <span className="text-blue-500">{start.beats}</span>}
                    <span className="text-zinc-400">{start.frames}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {center.seconds}
                      </span>
                      {isPlaybackActive && (
                        <span className="text-amber-500 animate-pulse">▶</span>
                      )}
                    </div>
                    {center.beats && (
                      <span className="text-blue-500 font-semibold">{center.beats}</span>
                    )}
                    <span className="text-zinc-400">{center.frames}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span>{end.seconds}</span>
                    {end.beats && <span className="text-blue-500">{end.beats}</span>}
                    <span className="text-zinc-400">{end.frames}</span>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-1.5">
              {lastValidAnalysis.steps.map((step, idx) => {
                const samples = lastValidAnalysis.samples[idx];
                if (!samples) return null;
                return (
                  <TransformStepCard
                    key={step.signal_id}
                    step={step}
                    samples={samples}
                    isFirst={idx === 0}
                    isLast={idx === lastValidAnalysis.steps.length - 1}
                    timeRange={lastValidAnalysis.time_range}
                    beatTimes={beatTimes}
                    subBeatTimes={subBeatTimes}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
