"use client";

import { useShallow } from "zustand/react/shallow";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import { useMirStore, mirTabDefinitions, makeInputMirCacheKey } from "@/lib/stores/mirStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

// ============================================================================
// Types
// ============================================================================

/**
 * Source category types for the levelled selection.
 */
export type SourceCategory = "derived" | "band" | "mir";

/**
 * Selected signal source - fully resolved reference.
 */
export type SignalSourceRef =
  | { category: "derived"; signalId: string }
  | { category: "band"; bandId: string; functionId: string }
  | { category: "mir"; inputId: string; functionId: string };

interface SignalSourceSelectorProps {
  value: SignalSourceRef | null;
  onChange: (ref: SignalSourceRef | null) => void;
}

// Band MIR function definitions
const BAND_STFT_FUNCTIONS = [
  { id: "bandAmplitudeEnvelope", label: "Amplitude" },
  { id: "bandOnsetStrength", label: "Onset Strength" },
  { id: "bandSpectralFlux", label: "Spectral Flux" },
  { id: "bandSpectralCentroid", label: "Spectral Centroid" },
] as const;

const BAND_CQT_FUNCTIONS = [
  { id: "bandCqtHarmonicEnergy", label: "Harmonic Energy" },
  { id: "bandCqtBassPitchMotion", label: "Bass Pitch Motion" },
  { id: "bandCqtTonalStability", label: "Tonal Stability" },
] as const;

const ALL_BAND_FUNCTIONS = [...BAND_STFT_FUNCTIONS, ...BAND_CQT_FUNCTIONS];

/**
 * Levelled signal source selector component.
 * First selects category (Derived, Band, MIR), then specific source within that category.
 */
export function SignalSourceSelector({ value, onChange }: SignalSourceSelectorProps) {
  // Get available data from stores - these subscriptions ensure fresh data on renames
  const derivedSignals = useDerivedSignalStore(
    useShallow((s) => s.structure?.signals ?? [])
  );
  const derivedSignalResults = useDerivedSignalStore((s) => s.resultCache);

  const bands = useFrequencyBandStore(
    useShallow((s) => s.structure?.bands ?? [])
  );
  const bandMirCache = useBandMirStore((s) => s.cache);
  const bandCqtCache = useBandMirStore((s) => s.cqtCache);

  const mirResults = useMirStore((s) => s.mirResults);
  const inputMirCache = useMirStore((s) => s.inputMirCache);

  const audioCollection = useAudioInputStore((s) => s.collection);
  const stemOrder = audioCollection?.stemOrder ?? [];

  // Computed availability checks
  const hasAvailableDerivedSignals = derivedSignals.some((s) =>
    derivedSignalResults.has(s.id)
  );

  const getAvailableBandFunctions = (bandId: string) => {
    const available: typeof ALL_BAND_FUNCTIONS[number][] = [];
    for (const fn of BAND_STFT_FUNCTIONS) {
      const key = `${bandId}:${fn.id}` as `${string}:${typeof fn.id}`;
      if (bandMirCache.has(key)) {
        available.push(fn);
      }
    }
    for (const fn of BAND_CQT_FUNCTIONS) {
      const key = `${bandId}:${fn.id}` as `${string}:${typeof fn.id}`;
      if (bandCqtCache.has(key)) {
        available.push(fn);
      }
    }
    return available;
  };

  const hasAnyBandSignals = bands.some(
    (band) => getAvailableBandFunctions(band.id).length > 0
  );

  const mir1dFunctions = mirTabDefinitions.filter((t) => t.kind === "1d");

  const getAvailableMirInputs = () => {
    const inputs: { id: string; label: string }[] = [];
    // Check mixdown
    const hasMixdown = mir1dFunctions.some((fn) => {
      const result = mirResults[fn.id];
      return result && result.kind === "1d";
    });
    if (hasMixdown) {
      inputs.push({ id: "mixdown", label: "Mixdown" });
    }
    // Check stems
    for (const stemId of stemOrder) {
      const hasAny = mir1dFunctions.some((fn) => {
        const key = makeInputMirCacheKey(stemId, fn.id as MirFunctionId);
        const result = inputMirCache.get(key);
        return result && result.kind === "1d";
      });
      if (hasAny) {
        const stem = audioCollection?.inputs[stemId];
        inputs.push({ id: stemId, label: stem?.label ?? stemId });
      }
    }
    return inputs;
  };

  const getAvailableMirFunctions = (inputId: string) => {
    const available: { id: string; label: string }[] = [];
    for (const fn of mir1dFunctions) {
      if (inputId === "mixdown") {
        const result = mirResults[fn.id];
        if (result && result.kind === "1d") {
          available.push({ id: fn.id, label: fn.label.replace(" (1D)", "") });
        }
      } else {
        const key = makeInputMirCacheKey(inputId, fn.id as MirFunctionId);
        const result = inputMirCache.get(key);
        if (result && result.kind === "1d") {
          available.push({ id: fn.id, label: fn.label.replace(" (1D)", "") });
        }
      }
    }
    return available;
  };

  const availableMirInputs = getAvailableMirInputs();
  const hasAnyMirSignals = availableMirInputs.length > 0;

  // Determine current category from value
  const currentCategory: SourceCategory | null = value?.category ?? null;

  // Handlers
  const handleCategoryChange = (category: SourceCategory) => {
    // When category changes, try to select first available item
    switch (category) {
      case "derived": {
        const firstAvailable = derivedSignals.find((s) =>
          derivedSignalResults.has(s.id)
        );
        if (firstAvailable) {
          onChange({ category: "derived", signalId: firstAvailable.id });
        } else {
          onChange(null);
        }
        break;
      }
      case "band": {
        // Find first band with available functions
        for (const band of bands) {
          const fns = getAvailableBandFunctions(band.id);
          if (fns.length > 0) {
            onChange({
              category: "band",
              bandId: band.id,
              functionId: fns[0]!.id,
            });
            return;
          }
        }
        onChange(null);
        break;
      }
      case "mir": {
        if (availableMirInputs.length > 0) {
          const firstInput = availableMirInputs[0]!;
          const fns = getAvailableMirFunctions(firstInput.id);
          if (fns.length > 0) {
            onChange({
              category: "mir",
              inputId: firstInput.id,
              functionId: fns[0]!.id,
            });
            return;
          }
        }
        onChange(null);
        break;
      }
    }
  };

  const handleDerivedSignalChange = (signalId: string) => {
    if (signalId) {
      onChange({ category: "derived", signalId });
    }
  };

  const handleBandChange = (bandId: string) => {
    if (!bandId) return;
    const fns = getAvailableBandFunctions(bandId);
    if (fns.length > 0) {
      onChange({ category: "band", bandId, functionId: fns[0]!.id });
    }
  };

  const handleBandFunctionChange = (functionId: string) => {
    if (value?.category === "band" && functionId) {
      onChange({ ...value, functionId });
    }
  };

  const handleMirInputChange = (inputId: string) => {
    if (!inputId) return;
    const fns = getAvailableMirFunctions(inputId);
    if (fns.length > 0) {
      onChange({ category: "mir", inputId, functionId: fns[0]!.id });
    }
  };

  const handleMirFunctionChange = (functionId: string) => {
    if (value?.category === "mir" && functionId) {
      onChange({ ...value, functionId });
    }
  };

  // Get current sub-selections for rendering
  const currentBandFunctions =
    value?.category === "band" ? getAvailableBandFunctions(value.bandId) : [];
  const currentMirFunctions =
    value?.category === "mir" ? getAvailableMirFunctions(value.inputId) : [];

  // Check if any sources available
  const hasAnySources = hasAvailableDerivedSignals || hasAnyBandSignals || hasAnyMirSignals;

  if (!hasAnySources) {
    return (
      <div className="text-xs text-zinc-500 italic py-1">
        No signals available. Run MIR analysis or create derived signals first.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Category selection - radio buttons */}
      <div className="flex items-center gap-3">
        <label
          className={`flex items-center gap-1.5 cursor-pointer ${!hasAvailableDerivedSignals ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <input
            type="radio"
            name="signalCategory"
            value="derived"
            checked={currentCategory === "derived"}
            onChange={() => handleCategoryChange("derived")}
            disabled={!hasAvailableDerivedSignals}
            className="h-3 w-3 border-zinc-300 text-amber-600 dark:text-amber-500"
          />
          <span className="text-xs">Derived</span>
        </label>
        <label
          className={`flex items-center gap-1.5 cursor-pointer ${!hasAnyBandSignals ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <input
            type="radio"
            name="signalCategory"
            value="band"
            checked={currentCategory === "band"}
            onChange={() => handleCategoryChange("band")}
            disabled={!hasAnyBandSignals}
            className="h-3 w-3 border-zinc-300 text-amber-600 dark:text-amber-500"
          />
          <span className="text-xs">Band</span>
        </label>
        <label
          className={`flex items-center gap-1.5 cursor-pointer ${!hasAnyMirSignals ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <input
            type="radio"
            name="signalCategory"
            value="mir"
            checked={currentCategory === "mir"}
            onChange={() => handleCategoryChange("mir")}
            disabled={!hasAnyMirSignals}
            className="h-3 w-3 border-zinc-300 text-amber-600 dark:text-amber-500"
          />
          <span className="text-xs">MIR</span>
        </label>
      </div>

      {/* Derived signal selector */}
      {currentCategory === "derived" && (
        <select
          value={value?.category === "derived" ? value.signalId : ""}
          onChange={(e) => handleDerivedSignalChange(e.target.value)}
          className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 min-w-32"
        >
          <option value="">Select signal...</option>
          {derivedSignals
            .filter((s) => derivedSignalResults.has(s.id))
            .map((signal) => (
              <option key={signal.id} value={signal.id}>
                {signal.name}
              </option>
            ))}
        </select>
      )}

      {/* Band signal selectors */}
      {currentCategory === "band" && (
        <>
          <select
            value={value?.category === "band" ? value.bandId : ""}
            onChange={(e) => handleBandChange(e.target.value)}
            className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 min-w-24"
          >
            <option value="">Band...</option>
            {bands
              .filter((band) => getAvailableBandFunctions(band.id).length > 0)
              .map((band) => (
                <option key={band.id} value={band.id}>
                  {band.label}
                </option>
              ))}
          </select>
          {value?.category === "band" && value.bandId && (
            <select
              value={value.functionId}
              onChange={(e) => handleBandFunctionChange(e.target.value)}
              className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 min-w-28"
            >
              {currentBandFunctions.map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fn.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {/* MIR signal selectors */}
      {currentCategory === "mir" && (
        <>
          <select
            value={value?.category === "mir" ? value.inputId : ""}
            onChange={(e) => handleMirInputChange(e.target.value)}
            className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 min-w-24"
          >
            <option value="">Source...</option>
            {availableMirInputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.label}
              </option>
            ))}
          </select>
          {value?.category === "mir" && value.inputId && (
            <select
              value={value.functionId}
              onChange={(e) => handleMirFunctionChange(e.target.value)}
              className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 min-w-32"
            >
              {currentMirFunctions.map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fn.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Helper to get a display name for a signal source ref.
 */
export function getSignalSourceName(
  ref: SignalSourceRef,
  derivedSignals: { id: string; name: string }[],
  bands: { id: string; label: string }[]
): string {
  switch (ref.category) {
    case "derived": {
      const signal = derivedSignals.find((s) => s.id === ref.signalId);
      return signal?.name ?? "Unknown Signal";
    }
    case "band": {
      const band = bands.find((b) => b.id === ref.bandId);
      const fn = ALL_BAND_FUNCTIONS.find((f) => f.id === ref.functionId);
      return `${band?.label ?? "Unknown"} ${fn?.label ?? ref.functionId}`;
    }
    case "mir": {
      const inputLabel = ref.inputId === "mixdown" ? "Mixdown" : ref.inputId;
      const fnDef = mirTabDefinitions.find((t) => t.id === ref.functionId);
      return `${inputLabel} ${fnDef?.label.replace(" (1D)", "") ?? ref.functionId}`;
    }
  }
}
