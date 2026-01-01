"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import type { FrequencyRangeSpec } from "@/lib/stores/types/customSignal";

interface FrequencyRangeEditorProps {
  value: FrequencyRangeSpec;
  onChange: (value: FrequencyRangeSpec) => void;
  disabled?: boolean;
  /** Selection mode: "frequency" for mel/HPSS, "coefficient" for MFCC */
  mode: "frequency" | "coefficient";
  /** Number of coefficients available (for MFCC mode) */
  numCoefficients?: number;
  /** Compact inline mode without label */
  compact?: boolean;
}

/**
 * Editor for frequency range or coefficient selection.
 * For frequency mode: supports full spectrum, band reference, or custom Hz range.
 * For coefficient mode: supports all coefficients or custom coefficient range.
 */
export function FrequencyRangeEditor({
  value,
  onChange,
  disabled,
  mode,
  numCoefficients = 13,
  compact = false,
}: FrequencyRangeEditorProps) {
  const radioGroupId = useId();
  const structure = useFrequencyBandStore((s) => s.structure);
  const bands = structure?.bands ?? [];

  // Compact mode: inline display with summary
  if (compact) {
    if (mode === "coefficient") {
      // Coefficient mode compact: dropdown + optional inputs
      const isCoefRange = value.kind === "coefficientRange";
      return (
        <div className="flex items-center gap-1">
          <select
            value={value.kind === "coefficientRange" ? "coefficientRange" : "fullSpectrum"}
            onChange={(e) => {
              if (e.target.value === "fullSpectrum") {
                onChange({ kind: "fullSpectrum" });
              } else {
                onChange({ kind: "coefficientRange", lowCoef: 1, highCoef: numCoefficients });
              }
            }}
            disabled={disabled}
            title="Coefficient range"
            className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="fullSpectrum">All C</option>
            <option value="coefficientRange">Range</option>
          </select>
          {isCoefRange && (
            <>
              <input
                type="number"
                value={value.lowCoef}
                onChange={(e) => onChange({ ...value, lowCoef: Math.max(0, Math.min(Number(e.target.value), value.highCoef - 1)) })}
                disabled={disabled}
                className="w-10 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
                min={0}
                max={numCoefficients - 1}
                title="Low coefficient"
              />
              <span className="text-xs text-zinc-400">–</span>
              <input
                type="number"
                value={value.highCoef}
                onChange={(e) => onChange({ ...value, highCoef: Math.max(value.lowCoef + 1, Math.min(Number(e.target.value), numCoefficients)) })}
                disabled={disabled}
                className="w-10 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
                min={1}
                max={numCoefficients}
                title="High coefficient"
              />
            </>
          )}
        </div>
      );
    }

    // Frequency mode compact
    const isCustom = value.kind === "custom";
    const isBandRef = value.kind === "bandReference";
    return (
      <div className="flex items-center gap-1">
        <select
          value={value.kind}
          onChange={(e) => {
            const kind = e.target.value;
            if (kind === "fullSpectrum") {
              onChange({ kind: "fullSpectrum" });
            } else if (kind === "bandReference") {
              onChange({ kind: "bandReference", bandId: bands[0]?.id ?? "" });
            } else {
              onChange({ kind: "custom", lowHz: 20, highHz: 8000 });
            }
          }}
          disabled={disabled}
          title="Frequency range type"
          className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="fullSpectrum">Full</option>
          {bands.length > 0 && <option value="bandReference">Band</option>}
          <option value="custom">Hz</option>
        </select>
        {isBandRef && bands.length > 0 && (
          <select
            value={value.bandId}
            onChange={(e) => onChange({ ...value, bandId: e.target.value })}
            disabled={disabled}
            className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 max-w-20 truncate"
          >
            {bands.map((band) => (
              <option key={band.id} value={band.id}>
                {band.label}
              </option>
            ))}
          </select>
        )}
        {isCustom && (
          <>
            <input
              type="number"
              value={value.lowHz}
              onChange={(e) => onChange({ ...value, lowHz: Number(e.target.value) })}
              disabled={disabled}
              className="w-14 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              min={0}
              max={22050}
              title="Low Hz"
            />
            <span className="text-xs text-zinc-400">–</span>
            <input
              type="number"
              value={value.highHz}
              onChange={(e) => onChange({ ...value, highHz: Number(e.target.value) })}
              disabled={disabled}
              className="w-14 h-7 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              min={0}
              max={22050}
              title="High Hz"
            />
          </>
        )}
      </div>
    );
  }

  // Coefficient mode (MFCC)
  if (mode === "coefficient") {
    const handleCoefficientKindChange = (kind: string) => {
      if (kind === "fullSpectrum") {
        onChange({ kind: "fullSpectrum" });
      } else if (kind === "coefficientRange") {
        onChange({ kind: "coefficientRange", lowCoef: 1, highCoef: numCoefficients });
      }
    };

    const handleLowCoefChange = (lowCoef: number) => {
      if (value.kind === "coefficientRange") {
        onChange({ ...value, lowCoef: Math.max(0, Math.min(lowCoef, value.highCoef - 1)) });
      }
    };

    const handleHighCoefChange = (highCoef: number) => {
      if (value.kind === "coefficientRange") {
        onChange({ ...value, highCoef: Math.max(value.lowCoef + 1, Math.min(highCoef, numCoefficients)) });
      }
    };

    const isCoefRange = value.kind === "coefficientRange";

    return (
      <div className="space-y-2">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          Coefficient Selection
        </label>
        <div className="space-y-1">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name={`coefRange-${radioGroupId}`}
              value="fullSpectrum"
              checked={value.kind === "fullSpectrum"}
              onChange={() => handleCoefficientKindChange("fullSpectrum")}
              disabled={disabled}
              className="accent-blue-500"
            />
            <span className="text-sm">All Coefficients (0-{numCoefficients - 1})</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name={`coefRange-${radioGroupId}`}
              value="coefficientRange"
              checked={isCoefRange}
              onChange={() => handleCoefficientKindChange("coefficientRange")}
              disabled={disabled}
              className="accent-blue-500"
            />
            <span className="text-sm">Custom Range</span>
          </label>
        </div>

        {isCoefRange && (
          <div className="flex gap-2 pl-6">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-zinc-400">Low Index</label>
              <Input
                type="number"
                value={value.lowCoef}
                onChange={(e) => handleLowCoefChange(Number(e.target.value))}
                disabled={disabled}
                className="h-7 text-sm"
                min={0}
                max={numCoefficients - 1}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-zinc-400">High Index</label>
              <Input
                type="number"
                value={value.highCoef}
                onChange={(e) => handleHighCoefChange(Number(e.target.value))}
                disabled={disabled}
                className="h-7 text-sm"
                min={1}
                max={numCoefficients}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-zinc-400 dark:text-zinc-500 italic pl-6">
          C0 = energy, C1-C{numCoefficients - 1} = spectral shape
        </p>
      </div>
    );
  }

  // Frequency mode (mel spectrogram, HPSS)
  const handleKindChange = (kind: string) => {
    switch (kind) {
      case "fullSpectrum":
        onChange({ kind: "fullSpectrum" });
        break;
      case "custom":
        onChange({ kind: "custom", lowHz: 20, highHz: 8000 });
        break;
      case "bandReference": {
        // Default to first band if available
        const firstBandId = bands.length > 0 ? bands[0]?.id ?? "" : "";
        onChange({ kind: "bandReference", bandId: firstBandId });
        break;
      }
    }
  };

  const handleBandChange = (bandId: string) => {
    if (value.kind === "bandReference") {
      onChange({ ...value, bandId });
    }
  };

  const handleLowHzChange = (lowHz: number) => {
    if (value.kind === "custom") {
      onChange({ ...value, lowHz });
    }
  };

  const handleHighHzChange = (highHz: number) => {
    if (value.kind === "custom") {
      onChange({ ...value, highHz });
    }
  };

  // Get the selected band's Hz range for display
  const selectedBand =
    value.kind === "bandReference"
      ? bands.find((b) => b.id === value.bandId)
      : null;
  const selectedBandRange =
    selectedBand && selectedBand.frequencyShape.length > 0
      ? {
          lowHz: selectedBand.frequencyShape[0]?.lowHzStart ?? 0,
          highHz: selectedBand.frequencyShape[0]?.highHzStart ?? 22050,
        }
      : null;

  return (
    <div className="space-y-2">
      <label className="text-xs text-zinc-500 dark:text-zinc-400">
        Frequency Range
      </label>
      <div className="space-y-1">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="radio"
            name={`frequencyRange-${radioGroupId}`}
            value="fullSpectrum"
            checked={value.kind === "fullSpectrum"}
            onChange={() => handleKindChange("fullSpectrum")}
            disabled={disabled}
            className="accent-blue-500"
          />
          <span className="text-sm">Full Spectrum</span>
        </label>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="radio"
            name={`frequencyRange-${radioGroupId}`}
            value="bandReference"
            checked={value.kind === "bandReference"}
            onChange={() => handleKindChange("bandReference")}
            disabled={disabled || bands.length === 0}
            className="accent-blue-500"
          />
          <span className={`text-sm ${bands.length === 0 ? "text-zinc-400" : ""}`}>
            Use Band {bands.length === 0 && "(no bands defined)"}
          </span>
        </label>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="radio"
            name={`frequencyRange-${radioGroupId}`}
            value="custom"
            checked={value.kind === "custom"}
            onChange={() => handleKindChange("custom")}
            disabled={disabled}
            className="accent-blue-500"
          />
          <span className="text-sm">Custom Range</span>
        </label>
      </div>

      {value.kind === "bandReference" && bands.length > 0 && (
        <div className="pl-6 space-y-1">
          <select
            value={value.bandId}
            onChange={(e) => handleBandChange(e.target.value)}
            disabled={disabled}
            className="w-full h-7 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
          >
            {bands.map((band) => {
              const lowHz = band.frequencyShape[0]?.lowHzStart ?? 0;
              const highHz = band.frequencyShape[0]?.highHzStart ?? 22050;
              return (
                <option key={band.id} value={band.id}>
                  {band.label} ({Math.round(lowHz)} - {Math.round(highHz)} Hz)
                </option>
              );
            })}
          </select>
          {selectedBandRange && (
            <div className="text-xs text-zinc-400">
              {Math.round(selectedBandRange.lowHz)} - {Math.round(selectedBandRange.highHz)} Hz
            </div>
          )}
        </div>
      )}

      {value.kind === "custom" && (
        <div className="flex gap-2 pl-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-zinc-400">Low (Hz)</label>
            <Input
              type="number"
              value={value.lowHz}
              onChange={(e) => handleLowHzChange(Number(e.target.value))}
              disabled={disabled}
              className="h-7 text-sm"
              min={0}
              max={22050}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs text-zinc-400">High (Hz)</label>
            <Input
              type="number"
              value={value.highHz}
              onChange={(e) => handleHighHzChange(Number(e.target.value))}
              disabled={disabled}
              className="h-7 text-sm"
              min={0}
              max={22050}
            />
          </div>
        </div>
      )}
    </div>
  );
}
