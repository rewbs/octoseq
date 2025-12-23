"use client";

import { useEffect, useState } from "react";

interface AnalysisOverlayProps {
  /** Whether analysis is currently running */
  isAnalysing: boolean;
  /** Human-readable name of the current analysis (e.g., "Mel Spectrogram") */
  analysisName?: string;
  /** Duration of the last completed analysis in milliseconds */
  lastAnalysisMs?: number;
  /** Backend used (e.g., "cpu" or "gpu") */
  backend?: string;
}

/**
 * A softly pulsing overlay that displays when MIR analysis is running.
 * Shows the current analysis name and timing information.
 */
export function AnalysisOverlay({
  isAnalysing,
  analysisName,
  lastAnalysisMs,
  backend,
}: AnalysisOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  // Track elapsed time while analysing
  useEffect(() => {
    if (!isAnalysing) {
      setElapsedMs(0);
      return;
    }

    const startTime = performance.now();
    const interval = setInterval(() => {
      setElapsedMs(performance.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [isAnalysing]);

  if (!isAnalysing) return null;

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      {/* Backdrop with subtle blur */}
      <div className="absolute inset-0 bg-linear-to-br from-zinc-900/40 via-zinc-800/30 to-zinc-900/40 backdrop-blur-[2px]" />

      {/* Content container with pulse animation */}
      <div className="relative flex flex-col items-center gap-3 px-6 py-4 rounded-xl bg-zinc-950/60 border border-zinc-700/30 shadow-2xl animate-analysis-pulse">
        {/* Animated spinner ring */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-zinc-600/40" />
          <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-transparent border-t-emerald-400/80 animate-spin" />
          <div className="absolute inset-1 w-8 h-8 rounded-full border border-transparent border-t-emerald-500/50 animate-spin-reverse" />
        </div>

        {/* Main text */}
        <div className="text-center">
          <p className="text-base font-medium text-zinc-100 tracking-wide">
            Analysing...
          </p>
          {analysisName && (
            <p className="mt-1 text-sm text-emerald-400/90 font-mono">
              {analysisName}
            </p>
          )}
        </div>

        {/* Timing info */}
        <div className="flex flex-col items-center gap-1 text-xs text-zinc-400">
          <p className="tabular-nums">
            Elapsed: <span className="text-zinc-300">{formatMs(elapsedMs)}</span>
          </p>
          {lastAnalysisMs != null && lastAnalysisMs > 0 && (
            <p className="tabular-nums text-zinc-500">
              Previous: {formatMs(lastAnalysisMs)}
              {backend && <span className="ml-1 text-zinc-600">({backend})</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
