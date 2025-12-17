"use client";

import { useMemo } from "react";

export type SearchPrecision = "coarse" | "medium" | "fine";

export type SearchControls = {
  threshold: number; // 0..1
  precision: SearchPrecision;

  // optional advanced weights
  melWeight: number;
  transientWeight: number;

  /** Optional: apply softmax to similarity curve for sharper contrast. */
  applySoftmax?: boolean;
};

export type SearchControlsPanelProps = {
  value: SearchControls;
  onChange: (next: SearchControls) => void;
  disabled?: boolean;
  selectionDurationSec?: number | null;

  /** Use human refinement labels (accepted/rejected/manual) for per-track discrimination. */
  useRefinement?: boolean;
  onUseRefinementChange?: (next: boolean) => void;
  refinementAvailable?: boolean;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function SearchControlsPanel({
  value,
  onChange,
  disabled,
  selectionDurationSec,
  useRefinement,
  onUseRefinementChange,
  refinementAvailable,
}: SearchControlsPanelProps) {
  const thresholdPct = Math.round(value.threshold * 100);
  const refinementOn = !!useRefinement && !!refinementAvailable;
  const thresholdLabel = refinementOn ? "Confidence threshold" : "Similarity threshold";

  const hopMs = useMemo(() => {
    // UI mapping only; worker uses a deterministic hopSec derived from precision + duration.
    const dur = selectionDurationSec ?? 0;
    const base = value.precision === "fine" ? 0.005 : value.precision === "medium" ? 0.020 : 0.05;
    // Keep a slightly larger hop for long regions to avoid huge scans.
    const scaled = dur > 2 ? base * 1.5 : base;
    return Math.round(scaled * 1000);
  }, [value.precision, selectionDurationSec]);

  return (
    <div className="flex items-center gap-4 text-xs">
      {/* Threshold & Precision */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap font-medium text-zinc-700 dark:text-zinc-300">
            {thresholdLabel}
          </span>
          <input
            type="range"
            min={60}
            max={95}
            step={1}
            value={thresholdPct}
            onChange={(e) => onChange({ ...value, threshold: clamp01(Number(e.target.value) / 100) })}
            disabled={disabled}
            className="w-24 accent-indigo-600"
          />
          <span className="w-8 tabular-nums text-zinc-600 dark:text-zinc-400">{thresholdPct}%</span>
        </label>

        <select
          value={value.precision}
          onChange={(e) => onChange({ ...value, precision: e.target.value as SearchPrecision })}
          disabled={disabled}
          className="h-7 rounded border border-zinc-200 bg-white px-2 py-0 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="coarse">Coarse</option>
          <option value="medium">Medium</option>
          <option value="fine">Fine</option>
        </select>
      </div>

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Checkboxes */}
      <div className="flex items-center gap-3">
        {onUseRefinementChange ? (
          <label className="flex items-center gap-1.5 select-none hover:text-zinc-900 dark:hover:text-zinc-100">
            <input
              type="checkbox"
              checked={!!useRefinement}
              onChange={(e) => onUseRefinementChange(e.target.checked)}
              disabled={disabled || !refinementAvailable}
              className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Refinement</span>
          </label>
        ) : null}

        <label className="flex items-center gap-1.5 select-none hover:text-zinc-900 dark:hover:text-zinc-100">
          <input
            type="checkbox"
            checked={!!value.applySoftmax}
            onChange={(e) => onChange({ ...value, applySoftmax: e.target.checked })}
            disabled={disabled || refinementOn}
            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>Softmax</span>
        </label>
      </div>

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Advanced (Weights) - Compact Details */}
      <details className="relative group">
        <summary className="cursor-pointer select-none text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1 h-7">
          Advanced ▾
        </summary>
        <div className="absolute top-full left-0 mt-1 w-48 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 z-20">
          <div className="space-y-2">
            <label className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span>Timbre (mel)</span>
                <span className="tabular-nums text-zinc-500">{value.melWeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(value.melWeight * 100)}
                onChange={(e) => onChange({ ...value, melWeight: Number(e.target.value) / 100 })}
                disabled={disabled}
                className="w-full h-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span>Transient (onset)</span>
                <span className="tabular-nums text-zinc-500">{value.transientWeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(value.transientWeight * 100)}
                onChange={(e) => onChange({ ...value, transientWeight: Number(e.target.value) / 100 })}
                disabled={disabled}
                className="w-full h-1"
              />
            </label>
            <div className="pt-1 text-[10px] text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
              ≈ {hopMs}ms hop
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
