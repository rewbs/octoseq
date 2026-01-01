"use client";

import { Input } from "@/components/ui/input";
import {
  REDUCTION_ALGORITHM_LABELS,
  REDUCTION_ALGORITHM_SHORT_LABELS,
  REDUCTION_ALGORITHM_DESCRIPTIONS,
  getDefaultAlgorithmParams,
  type ReductionAlgorithmId,
  type ReductionAlgorithmParams,
} from "@/lib/stores/types/customSignal";

interface ReductionAlgorithmSelectorProps {
  algorithm: ReductionAlgorithmId;
  params: ReductionAlgorithmParams;
  onAlgorithmChange: (algorithm: ReductionAlgorithmId) => void;
  onParamsChange: (params: ReductionAlgorithmParams) => void;
  disabled?: boolean;
  /** Compact inline mode without label */
  compact?: boolean;
}

const ALGORITHM_OPTIONS: ReductionAlgorithmId[] = [
  "mean",
  "max",
  "sum",
  "variance",
  "amplitude",
  "spectralFlux",
  "spectralCentroid",
  "onsetStrength",
];

/**
 * Selector for reduction algorithm with parameter editing.
 */
export function ReductionAlgorithmSelector({
  algorithm,
  params,
  onAlgorithmChange,
  onParamsChange,
  disabled,
  compact = false,
}: ReductionAlgorithmSelectorProps) {
  const handleAlgorithmChange = (newAlgorithm: ReductionAlgorithmId) => {
    onAlgorithmChange(newAlgorithm);
    // Reset params to defaults for the new algorithm
    onParamsChange(getDefaultAlgorithmParams(newAlgorithm));
  };

  if (compact) {
    return (
      <select
        value={algorithm}
        onChange={(e) => handleAlgorithmChange(e.target.value as ReductionAlgorithmId)}
        disabled={disabled}
        title={REDUCTION_ALGORITHM_DESCRIPTIONS[algorithm]}
        className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
      >
        {ALGORITHM_OPTIONS.map((id) => (
          <option key={id} value={id}>
            {REDUCTION_ALGORITHM_SHORT_LABELS[id]}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          Reduction Algorithm
        </label>
        <select
          value={algorithm}
          onChange={(e) => handleAlgorithmChange(e.target.value as ReductionAlgorithmId)}
          disabled={disabled}
          className="w-full h-8 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
        >
          {ALGORITHM_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {REDUCTION_ALGORITHM_LABELS[id]}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-400">
          {REDUCTION_ALGORITHM_DESCRIPTIONS[algorithm]}
        </p>
      </div>

      {/* Algorithm-specific parameters */}
      {algorithm === "onsetStrength" && (
        <div className="space-y-2 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Smoothing (ms)</label>
            <Input
              type="number"
              value={params.smoothMs ?? 10}
              onChange={(e) =>
                onParamsChange({ ...params, smoothMs: Number(e.target.value) })
              }
              disabled={disabled}
              className="h-7 text-sm"
              min={0}
              max={500}
            />
          </div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-zinc-400">Log Compress</span>
            <input
              type="checkbox"
              checked={params.useLog ?? true}
              onChange={(e) =>
                onParamsChange({ ...params, useLog: e.target.checked })
              }
              disabled={disabled}
              className="w-4 h-4 accent-blue-500"
            />
          </label>
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Difference Method</label>
            <select
              value={params.diffMethod ?? "rectified"}
              onChange={(e) =>
                onParamsChange({ ...params, diffMethod: e.target.value as "rectified" | "abs" })
              }
              disabled={disabled}
              className="w-full h-7 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="rectified">Rectified (positive only)</option>
              <option value="abs">Absolute</option>
            </select>
          </div>
        </div>
      )}

      {algorithm === "spectralFlux" && (
        <div className="space-y-2 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-zinc-400">Normalize Frames</span>
            <input
              type="checkbox"
              checked={params.normalized ?? true}
              onChange={(e) =>
                onParamsChange({ ...params, normalized: e.target.checked })
              }
              disabled={disabled}
              className="w-4 h-4 accent-blue-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}
