"use client";

import { useMemo, useCallback } from "react";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useDerivedSignals } from "@/lib/stores/derivedSignalStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import type { BandMirFunctionId, BandCqtFunctionId } from "@octoseq/mir";
import {
  type Source1D,
  type Source1DGlobalFunctionId,
  type Signal1DRef,
  type DerivedSignalSource,
} from "@/lib/stores/types/derivedSignal";

// Band STFT function IDs
const BAND_STFT_FUNCTION_IDS: BandMirFunctionId[] = [
  "bandAmplitudeEnvelope",
  "bandOnsetStrength",
  "bandSpectralFlux",
  "bandSpectralCentroid",
];

// Band CQT function IDs
const BAND_CQT_FUNCTION_IDS: BandCqtFunctionId[] = [
  "bandCqtHarmonicEnergy",
  "bandCqtBassPitchMotion",
  "bandCqtTonalStability",
];

interface Source1DSelectorProps {
  source: Source1D;
  onChange: (source: DerivedSignalSource) => void;
}

// Labels for 1D global MIR functions
const GLOBAL_1D_LABELS: Record<Source1DGlobalFunctionId, string> = {
  amplitudeEnvelope: "Amplitude Envelope",
  spectralCentroid: "Spectral Centroid",
  spectralFlux: "Spectral Flux",
  onsetEnvelope: "Onset Envelope",
  cqtHarmonicEnergy: "CQT Harmonic Energy",
  cqtBassPitchMotion: "CQT Bass Motion",
  cqtTonalStability: "CQT Tonal Stability",
};

// Labels for band MIR functions
const BAND_MIR_LABELS: Record<BandMirFunctionId | BandCqtFunctionId, string> = {
  bandAmplitudeEnvelope: "Amplitude",
  bandSpectralCentroid: "Spectral Centroid",
  bandSpectralFlux: "Spectral Flux",
  bandOnsetStrength: "Onset Strength",
  bandCqtHarmonicEnergy: "Harmonic Energy",
  bandCqtBassPitchMotion: "Bass Motion",
  bandCqtTonalStability: "Tonal Stability",
};

/**
 * Source selector for 1D signals.
 */
export function Source1DSelector({ source, onChange }: Source1DSelectorProps) {
  const audioCollection = useAudioInputStore((s) => s.collection);
  const stemOrder = audioCollection?.stemOrder ?? [];
  const derivedSignals = useDerivedSignals();
  const bandStructure = useFrequencyBandStore((s) => s.structure);
  const bands = bandStructure?.bands ?? [];

  // Get band MIR caches for filtering
  const bandMirCache = useBandMirStore((s) => s.cache);
  const bandCqtCache = useBandMirStore((s) => s.cqtCache);

  // Get available functions for a band (only those with cached data)
  const getAvailableBandFunctions = useCallback(
    (bandId: string): (BandMirFunctionId | BandCqtFunctionId)[] => {
      const available: (BandMirFunctionId | BandCqtFunctionId)[] = [];
      for (const fn of BAND_STFT_FUNCTION_IDS) {
        const key = `${bandId}:${fn}` as `${string}:${typeof fn}`;
        if (bandMirCache.has(key)) {
          available.push(fn);
        }
      }
      for (const fn of BAND_CQT_FUNCTION_IDS) {
        const key = `${bandId}:${fn}` as `${string}:${typeof fn}`;
        if (bandCqtCache.has(key)) {
          available.push(fn);
        }
      }
      return available;
    },
    [bandMirCache, bandCqtCache]
  );

  // Filter bands to only those with available data
  const bandsWithData = useMemo(
    () => bands.filter((band) => getAvailableBandFunctions(band.id).length > 0),
    [bands, getAvailableBandFunctions]
  );

  // Get available functions for currently selected band
  const currentBandFunctions = useMemo(() => {
    if (source.signalRef.type !== "band" || !source.signalRef.bandId) {
      return [];
    }
    return getAvailableBandFunctions(source.signalRef.bandId);
  }, [source.signalRef, getAvailableBandFunctions]);

  const handleRefTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.value as Signal1DRef["type"];
    let newRef: Signal1DRef;
    switch (type) {
      case "mir":
        newRef = {
          type: "mir",
          audioSourceId: "mixdown",
          functionId: "amplitudeEnvelope",
        };
        break;
      case "band":
        // Find first band with available data
        const firstBandWithData = bandsWithData[0];
        const firstFn = firstBandWithData
          ? getAvailableBandFunctions(firstBandWithData.id)[0]
          : "bandAmplitudeEnvelope";
        newRef = {
          type: "band",
          bandId: firstBandWithData?.id ?? "",
          functionId: firstFn ?? "bandAmplitudeEnvelope",
        };
        break;
      case "derived":
        const otherSignals = derivedSignals.filter((s) => s.source.kind !== "1d" || s.source.signalRef.type !== "derived");
        newRef = {
          type: "derived",
          signalId: otherSignals[0]?.id ?? "",
        };
        break;
    }
    onChange({ ...source, signalRef: newRef });
  };

  const handleMirAudioSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "mir") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, audioSourceId: e.target.value },
    });
  };

  const handleMirFunctionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "mir") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, functionId: e.target.value as Source1DGlobalFunctionId },
    });
  };

  const handleBandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "band") return;
    const newBandId = e.target.value;
    // When band changes, also update to first available function for that band
    const availableFns = getAvailableBandFunctions(newBandId);
    const newFunctionId = availableFns[0] ?? "bandAmplitudeEnvelope";
    onChange({
      ...source,
      signalRef: { ...source.signalRef, bandId: newBandId, functionId: newFunctionId },
    });
  };

  const handleBandFunctionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "band") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, functionId: e.target.value as BandMirFunctionId | BandCqtFunctionId },
    });
  };

  const handleDerivedSignalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "derived") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, signalId: e.target.value },
    });
  };

  const availableDerivedSignals = derivedSignals;

  return (
    <div className="space-y-4">
      {/* Reference Type */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Source Type</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center space-x-2">
            <input
              type="radio"
              name="refType"
              value="mir"
              checked={source.signalRef.type === "mir"}
              onChange={handleRefTypeChange}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Global MIR</span>
          </label>
          <label className={`flex items-center space-x-2 ${bandsWithData.length === 0 ? "opacity-50" : ""}`}>
            <input
              type="radio"
              name="refType"
              value="band"
              checked={source.signalRef.type === "band"}
              onChange={handleRefTypeChange}
              disabled={bandsWithData.length === 0}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Band Signal</span>
          </label>
          <label className={`flex items-center space-x-2 ${availableDerivedSignals.length === 0 ? "opacity-50" : ""}`}>
            <input
              type="radio"
              name="refType"
              value="derived"
              checked={source.signalRef.type === "derived"}
              onChange={handleRefTypeChange}
              disabled={availableDerivedSignals.length === 0}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Derived Signal</span>
          </label>
        </div>
      </div>

      {/* MIR-specific options */}
      {source.signalRef.type === "mir" && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Audio Source</label>
            <select
              value={source.signalRef.audioSourceId}
              onChange={handleMirAudioSourceChange}
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Signal</label>
            <select
              value={source.signalRef.functionId}
              onChange={handleMirFunctionChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {(Object.keys(GLOBAL_1D_LABELS) as Source1DGlobalFunctionId[]).map((id) => (
                <option key={id} value={id}>
                  {GLOBAL_1D_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Band-specific options */}
      {source.signalRef.type === "band" && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Band</label>
            <select
              value={source.signalRef.bandId}
              onChange={handleBandChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              <option value="">Select band...</option>
              {bandsWithData.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Signal</label>
            <select
              value={source.signalRef.functionId}
              onChange={handleBandFunctionChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {currentBandFunctions.map((fn) => (
                <option key={fn} value={fn}>
                  {BAND_MIR_LABELS[fn]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Derived signal reference */}
      {source.signalRef.type === "derived" && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Source Signal</label>
          <select
            value={source.signalRef.signalId}
            onChange={handleDerivedSignalChange}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Select signal...</option>
            {availableDerivedSignals.map((signal) => (
              <option key={signal.id} value={signal.id}>
                {signal.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Chain signals to build complex derivations. Cycles are not allowed.
          </p>
        </div>
      )}
    </div>
  );
}
