"use client";

import { useAudioInputStore } from "@/lib/stores/audioInputStore";

interface AudioSourceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Compact inline mode without label */
  compact?: boolean;
}

/**
 * Dropdown selector for audio source (mixdown or stems).
 */
export function AudioSourceSelector({
  value,
  onChange,
  disabled,
  compact = false,
}: AudioSourceSelectorProps) {
  const collection = useAudioInputStore((s) => s.collection);

  const mixdownLabel = collection?.inputs.mixdown?.label ?? "Mixdown";
  const stems = collection?.stemOrder.map((id) => ({
    id,
    label: collection.inputs[id]?.label ?? id,
  })) ?? [];

  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Audio source"
        className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
      >
        <option value="mixdown">{mixdownLabel}</option>
        {stems.map((stem) => (
          <option key={stem.id} value={stem.id}>
            {stem.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">
        Audio Source
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-8 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
      >
        <option value="mixdown">{mixdownLabel}</option>
        {stems.map((stem) => (
          <option key={stem.id} value={stem.id}>
            {stem.label}
          </option>
        ))}
      </select>
    </div>
  );
}
