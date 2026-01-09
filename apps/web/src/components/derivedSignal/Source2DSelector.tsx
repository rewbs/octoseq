"use client";

import { Input } from "@/components/ui/input";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import {
  SOURCE_2D_LABELS,
  REDUCER_2D_LABELS,
  REDUCER_2D_DESCRIPTIONS,
  source2DSupportsFrequencyRange,
  source2DUsesCoefficientRange,
  type Source2D,
  type Source2DFunctionId,
  type Reducer2DAlgorithmId,
  type RangeSpec2D,
  type DerivedSignalSource,
} from "@/lib/stores/types/derivedSignal";

interface Source2DSelectorProps {
  source: Source2D;
  onChange: (source: DerivedSignalSource) => void;
}

/**
 * Source selector for 2D spectral data.
 */
export function Source2DSelector({ source, onChange }: Source2DSelectorProps) {
  const audioCollection = useAudioInputStore((s) => s.collection);
  const stemOrder = audioCollection?.stemOrder ?? [];

  const handleAudioSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...source, audioSourceId: e.target.value });
  };

  const handleFunctionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const functionId = e.target.value as Source2DFunctionId;
    const newRange: RangeSpec2D = source2DSupportsFrequencyRange(functionId)
      ? source.range.kind === "coefficientRange"
        ? { kind: "fullSpectrum" }
        : source.range
      : source2DUsesCoefficientRange(functionId)
        ? source.range.kind === "frequencyRange"
          ? { kind: "coefficientRange", lowCoef: 0, highCoef: 13 }
          : source.range.kind === "coefficientRange"
            ? source.range
            : { kind: "fullSpectrum" }
        : source.range;

    onChange({ ...source, functionId, range: newRange });
  };

  const handleReducerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...source, reducer: e.target.value as Reducer2DAlgorithmId });
  };

  const handleRangeKindChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const kind = e.target.value as RangeSpec2D["kind"];
    let newRange: RangeSpec2D;
    switch (kind) {
      case "fullSpectrum":
        newRange = { kind: "fullSpectrum" };
        break;
      case "frequencyRange":
        newRange = { kind: "frequencyRange", lowHz: 20, highHz: 2000 };
        break;
      case "coefficientRange":
        newRange = { kind: "coefficientRange", lowCoef: 0, highCoef: 13 };
        break;
      case "bandReference":
        newRange = { kind: "bandReference", bandId: "" };
        break;
      default:
        newRange = { kind: "fullSpectrum" };
    }
    onChange({ ...source, range: newRange });
  };

  const handleFrequencyRangeChange = (field: "lowHz" | "highHz", value: number) => {
    if (source.range.kind !== "frequencyRange") return;
    onChange({
      ...source,
      range: { ...source.range, [field]: value },
    });
  };

  const handleCoefficientRangeChange = (field: "lowCoef" | "highCoef", value: number) => {
    if (source.range.kind !== "coefficientRange") return;
    onChange({
      ...source,
      range: { ...source.range, [field]: value },
    });
  };

  const supportsFreqRange = source2DSupportsFrequencyRange(source.functionId);
  const usesCoefRange = source2DUsesCoefficientRange(source.functionId);

  return (
    <div className="space-y-4">
      {/* Audio Source */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Audio Source</label>
        <select
          value={source.audioSourceId}
          onChange={handleAudioSourceChange}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="mixdown">Mixdown</option>
          {stemOrder.map((stemId) => {
            const stem = audioCollection?.inputs[stemId];
            return (
              <option key={stemId} value={stemId}>
                {stem?.label ?? stemId}
              </option>
            );
          })}
        </select>
      </div>

      {/* 2D Function */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Source Data</label>
        <select
          value={source.functionId}
          onChange={handleFunctionChange}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          {(Object.keys(SOURCE_2D_LABELS) as Source2DFunctionId[]).map((id) => (
            <option key={id} value={id}>
              {SOURCE_2D_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      {/* Frequency/Coefficient Range */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Range</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center space-x-2">
            <input
              type="radio"
              name="rangeKind"
              value="fullSpectrum"
              checked={source.range.kind === "fullSpectrum"}
              onChange={handleRangeKindChange}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Full</span>
          </label>
          {supportsFreqRange && (
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="rangeKind"
                value="frequencyRange"
                checked={source.range.kind === "frequencyRange"}
                onChange={handleRangeKindChange}
                className="h-4 w-4 border-zinc-300 text-blue-600"
              />
              <span className="text-sm">Hz Range</span>
            </label>
          )}
          {usesCoefRange && (
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="rangeKind"
                value="coefficientRange"
                checked={source.range.kind === "coefficientRange"}
                onChange={handleRangeKindChange}
                className="h-4 w-4 border-zinc-300 text-blue-600"
              />
              <span className="text-sm">Coef Range</span>
            </label>
          )}
        </div>

        {/* Frequency Range Inputs */}
        {source.range.kind === "frequencyRange" && (
          <div className="flex items-center gap-2 pt-2">
            <Input
              type="number"
              value={source.range.lowHz}
              onChange={(e) => handleFrequencyRangeChange("lowHz", Number(e.target.value))}
              className="w-24"
              min={0}
              max={22050}
            />
            <span className="text-sm text-zinc-500">–</span>
            <Input
              type="number"
              value={source.range.highHz}
              onChange={(e) => handleFrequencyRangeChange("highHz", Number(e.target.value))}
              className="w-24"
              min={0}
              max={22050}
            />
            <span className="text-sm text-zinc-500">Hz</span>
          </div>
        )}

        {/* Coefficient Range Inputs */}
        {source.range.kind === "coefficientRange" && (
          <div className="flex items-center gap-2 pt-2">
            <Input
              type="number"
              value={source.range.lowCoef}
              onChange={(e) => handleCoefficientRangeChange("lowCoef", Number(e.target.value))}
              className="w-20"
              min={0}
              max={40}
            />
            <span className="text-sm text-zinc-500">–</span>
            <Input
              type="number"
              value={source.range.highCoef}
              onChange={(e) => handleCoefficientRangeChange("highCoef", Number(e.target.value))}
              className="w-20"
              min={0}
              max={40}
            />
          </div>
        )}
      </div>

      {/* Reducer Algorithm */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Reduction Algorithm</label>
        <select
          value={source.reducer}
          onChange={handleReducerChange}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          {(Object.keys(REDUCER_2D_LABELS) as Reducer2DAlgorithmId[]).map((id) => (
            <option key={id} value={id}>
              {REDUCER_2D_LABELS[id]}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {REDUCER_2D_DESCRIPTIONS[source.reducer]}
        </p>
      </div>
    </div>
  );
}
