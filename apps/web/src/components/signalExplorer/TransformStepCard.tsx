"use client";

import { memo } from "react";
import type {
  StepSamples,
  TransformStep,
  TransformType,
} from "@/lib/signalExplorer/types";
import { SignalSparkline } from "./SignalSparkline";

interface TransformStepCardProps {
  step: TransformStep;
  samples: StepSamples;
  isFirst: boolean;
  isLast: boolean;
  timeRange: [number, number];
  beatTimes?: number[];
  subBeatTimes?: number[];
}

/** Color classes for different transform types */
const transformTypeStyles: Record<TransformType, string> = {
  Source:
    "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
  Smooth:
    "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300",
  Normalise:
    "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300",
  Gate: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
  Arithmetic:
    "bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300",
  Math: "bg-pink-500/10 border-pink-500/30 text-pink-700 dark:text-pink-300",
  Trig: "bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300",
  ExpLog:
    "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300",
  Modular:
    "bg-teal-500/10 border-teal-500/30 text-teal-700 dark:text-teal-300",
  Mapping: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
  TimeShift:
    "bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300",
  RateChange:
    "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300",
  Debug: "bg-zinc-500/10 border-zinc-500/30 text-zinc-700 dark:text-zinc-300",
};

/** Format a number for display */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) < 0.001 && n !== 0) return n.toExponential(1);
  if (Math.abs(n) >= 1000) return n.toExponential(1);
  return n.toFixed(3);
}

export const TransformStepCard = memo(function TransformStepCard({
  step,
  samples,
  isFirst,
  isLast,
  timeRange,
  beatTimes = [],
  subBeatTimes = [],
}: TransformStepCardProps) {
  const colorClass =
    transformTypeStyles[step.transform_type] ?? transformTypeStyles.Debug;

  return (
    <div className={`relative rounded border ${colorClass} overflow-hidden`}>
      {/* Connection line from previous card */}
      {!isFirst && (
        <div className="absolute -top-1.5 left-4 w-px h-1.5 bg-zinc-300 dark:bg-zinc-600" />
      )}

      <div className="px-2 py-1.5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-medium uppercase opacity-60 shrink-0">
              {step.transform_type}
            </span>
            <span
              className="text-xs font-mono truncate"
              title={step.description}
            >
              {step.description}
            </span>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-2 text-[10px] font-mono opacity-70 shrink-0">
            <span title="Current value">
              {formatNumber(samples.stats.current_value)}
            </span>
            <span className="opacity-50">|</span>
            <span title="Range">
              {formatNumber(samples.stats.min)}..{formatNumber(samples.stats.max)}
            </span>
          </div>
        </div>

        {/* Sparkline */}
        <SignalSparkline
          times={samples.times}
          values={samples.values}
          timeRange={timeRange}
          height={32}
          transformType={step.transform_type}
          beatTimes={beatTimes}
          subBeatTimes={subBeatTimes}
        />
      </div>

      {/* Connection line to next card */}
      {!isLast && (
        <div className="absolute -bottom-1.5 left-4 w-px h-1.5 bg-zinc-300 dark:bg-zinc-600" />
      )}
    </div>
  );
});
