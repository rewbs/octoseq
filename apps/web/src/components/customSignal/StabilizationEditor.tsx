"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  STABILIZATION_MODE_LABELS,
  STABILIZATION_MODE_DESCRIPTIONS,
  ENVELOPE_MODE_LABELS,
  type StabilizationSettings,
  type StabilizationMode,
  type EnvelopeMode,
  type TimeUnit,
} from "@/lib/stores/types/customSignal";

interface StabilizationEditorProps {
  value: StabilizationSettings;
  onChange: (settings: StabilizationSettings) => void;
  disabled?: boolean;
  /** Start in expanded state */
  defaultExpanded?: boolean;
}

const STABILIZATION_MODES: StabilizationMode[] = ["none", "light", "medium", "heavy"];
const ENVELOPE_MODES: EnvelopeMode[] = ["raw", "attackRelease"];
const TIME_UNITS: TimeUnit[] = ["seconds", "beats"];

/**
 * Get a summary string of stabilization settings.
 */
function getStabilizationSummary(value: StabilizationSettings): string {
  const parts: string[] = [];

  // Noise reduction
  if (value.mode !== "none") {
    parts.push(STABILIZATION_MODE_LABELS[value.mode]);
  }

  // Envelope
  if (value.envelopeMode === "attackRelease") {
    const unit = value.timeUnit === "beats" ? "b" : "s";
    const atk = value.attackTime ?? 0.01;
    const rel = value.releaseTime ?? 0.1;
    parts.push(`A${atk}${unit}/R${rel}${unit}`);
  }

  if (parts.length === 0) {
    return "None";
  }

  return parts.join(" · ");
}

/**
 * Editor for analysis-stage stabilization settings.
 * Collapsible disclosure that shows a summary when collapsed.
 */
export function StabilizationEditor({
  value,
  onChange,
  disabled,
  defaultExpanded = false,
}: StabilizationEditorProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleModeChange = (mode: StabilizationMode) => {
    onChange({ ...value, mode });
  };

  const handleEnvelopeModeChange = (envelopeMode: EnvelopeMode) => {
    onChange({ ...value, envelopeMode });
  };

  const handleAttackChange = (attackTime: number) => {
    onChange({ ...value, attackTime });
  };

  const handleReleaseChange = (releaseTime: number) => {
    onChange({ ...value, releaseTime });
  };

  const handleTimeUnitChange = (timeUnit: TimeUnit) => {
    onChange({ ...value, timeUnit });
  };

  const summary = getStabilizationSummary(value);
  const hasStabilization = value.mode !== "none" || value.envelopeMode !== "raw";

  return (
    <div className="space-y-2">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 w-full text-left group"
        disabled={disabled}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-400" />
        )}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Stabilize:</span>
        <span className={`text-xs font-medium ${hasStabilization ? "text-cyan-600 dark:text-cyan-400" : "text-zinc-500 dark:text-zinc-400"}`}>
          {summary}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="pl-4 space-y-2 border-l border-zinc-200 dark:border-zinc-700">
          {/* Row 1: Noise Reduction + Envelope */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Noise:</span>
              <select
                value={value.mode}
                onChange={(e) => handleModeChange(e.target.value as StabilizationMode)}
                disabled={disabled}
                title={STABILIZATION_MODE_DESCRIPTIONS[value.mode]}
                className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              >
                {STABILIZATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {STABILIZATION_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Env:</span>
              <select
                value={value.envelopeMode}
                onChange={(e) => handleEnvelopeModeChange(e.target.value as EnvelopeMode)}
                disabled={disabled}
                className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              >
                {ENVELOPE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {ENVELOPE_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Attack/Release controls (conditional) */}
          {value.envelopeMode === "attackRelease" && (
            <div className="flex items-center gap-2">
              <select
                value={value.timeUnit ?? "seconds"}
                onChange={(e) => handleTimeUnitChange(e.target.value as TimeUnit)}
                disabled={disabled}
                className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              >
                {TIME_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit === "seconds" ? "sec" : "beats"}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-400">A:</span>
                <input
                  type="number"
                  value={value.attackTime ?? 0.01}
                  onChange={(e) => handleAttackChange(Number(e.target.value))}
                  disabled={disabled}
                  className="w-14 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
                  min={0}
                  max={value.timeUnit === "beats" ? 16 : 2}
                  step={value.timeUnit === "beats" ? 0.25 : 0.001}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-400">R:</span>
                <input
                  type="number"
                  value={value.releaseTime ?? 0.1}
                  onChange={(e) => handleReleaseChange(Number(e.target.value))}
                  disabled={disabled}
                  className="w-14 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
                  min={0}
                  max={value.timeUnit === "beats" ? 32 : 5}
                  step={value.timeUnit === "beats" ? 0.25 : 0.01}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
