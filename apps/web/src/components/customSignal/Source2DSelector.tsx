"use client";

import {
  SOURCE_2D_LABELS,
  SOURCE_2D_SHORT_LABELS,
  type Source2DFunctionId,
} from "@/lib/stores/types/customSignal";

interface Source2DSelectorProps {
  value: Source2DFunctionId;
  onChange: (value: Source2DFunctionId) => void;
  disabled?: boolean;
  /** Compact inline mode without label */
  compact?: boolean;
}

const SOURCE_OPTIONS: Source2DFunctionId[] = [
  "melSpectrogram",
  "hpssHarmonic",
  "hpssPercussive",
  "mfcc",
  "mfccDelta",
  "mfccDeltaDelta",
];

/**
 * Dropdown selector for 2D source function.
 */
export function Source2DSelector({
  value,
  onChange,
  disabled,
  compact = false,
}: Source2DSelectorProps) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Source2DFunctionId)}
        disabled={disabled}
        title="2D source function"
        className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
      >
        {SOURCE_OPTIONS.map((id) => (
          <option key={id} value={id}>
            {SOURCE_2D_SHORT_LABELS[id]}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">
        2D Source
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Source2DFunctionId)}
        disabled={disabled}
        className="w-full h-8 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
      >
        {SOURCE_OPTIONS.map((id) => (
          <option key={id} value={id}>
            {SOURCE_2D_LABELS[id]}
          </option>
        ))}
      </select>
    </div>
  );
}
