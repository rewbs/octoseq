"use client";

import { useMemo } from "react";
import { analysisKey, toDisplaySignal, useAnalysisStore, useStreamStore } from "@/lib/streams";
import { getBandColorHex } from "@/lib/bandColors";
import type { BandMir1DResult } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type BandAmplitudeSelectorProps = {
  /** Currently selected band ID (null = full mix) */
  selectedBandId: string | null;
  /** Called when selection changes */
  onSelectBand: (bandId: string | null) => void;
  /** Whether to show loading indicator */
  isLoading?: boolean;
};

// ----------------------------
// Component
// ----------------------------

export function BandAmplitudeSelector({
  selectedBandId,
  onSelectBand,
  isLoading,
}: BandAmplitudeSelectorProps) {
  const streams = useStreamStore((s) => s.streams);
  const results = useAnalysisStore((s) => s.results);

  // Get enabled bands with their amplitude envelope availability
  const bandOptions = useMemo(() => {
    const bands = [...streams.values()]
      .filter((s) => s.kind === "band" && s.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return bands.map((band, index) => ({
      id: band.id,
      label: band.label,
      color: getBandColorHex(index),
      hasData: results.has(analysisKey(band.id, "amplitudeEnvelope")),
    }));
  }, [streams, results]);

  if (bandOptions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">Band:</span>
      <select
        value={selectedBandId ?? ""}
        onChange={(e) => onSelectBand(e.target.value || null)}
        className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        disabled={isLoading}
      >
        <option value="">Full Mix</option>
        {bandOptions.map((band) => (
          <option key={band.id} value={band.id}>
            {band.label} {band.hasData ? "✓" : ""}
          </option>
        ))}
      </select>
      {isLoading && <span className="text-xs text-zinc-400 animate-pulse">...</span>}
    </div>
  );
}

// ----------------------------
// Hook for getting band amplitude data
// ----------------------------

export type NormalizedBandAmplitudeData = {
  bandId: string;
  bandLabel: string;
  times: Float32Array;
  values: Float32Array;
  diagnostics: BandMir1DResult["diagnostics"];
};

export function useBandAmplitudeData(bandId: string | null): NormalizedBandAmplitudeData | null {
  const result = useAnalysisStore((s) =>
    bandId ? s.results.get(analysisKey(bandId, "amplitudeEnvelope")) : undefined
  );

  return useMemo(() => {
    if (!result || result.kind !== "bandMir1d") return null;

    // Normalize values for waveform display
    const display = toDisplaySignal(result, "amplitudeEnvelope");
    if (!display) return null;

    return {
      bandId: result.bandId,
      bandLabel: result.bandLabel,
      times: display.times,
      values: display.values,
      diagnostics: result.diagnostics,
    };
  }, [result]);
}
