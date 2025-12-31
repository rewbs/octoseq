"use client";

import { memo } from "react";
import { ChevronDown, ChevronRight, Activity, Loader2 } from "lucide-react";
import { useSignalExplorerStore } from "@/lib/stores/signalExplorerStore";
import { TransformStepCard } from "./TransformStepCard";

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
  } = useSignalExplorerStore();

  const hasValidData = lastValidAnalysis !== null;

  // Show cursor signal name or last valid
  const displaySignalName = currentCursor?.signalName ?? lastValidSignalName;

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
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-2">
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
        </div>
        <ChevronDown className="w-4 h-4" />
      </button>

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
