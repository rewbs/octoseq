"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFrequencyBandStore, useBandMirStore } from "@/lib/stores";
import { getBandColorHex } from "@/lib/bandColors";
import { normaliseForWaveform, type BandMir1DResult } from "@octoseq/mir";

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
    const { structure } = useFrequencyBandStore(
        useShallow((s) => ({
            structure: s.structure,
        }))
    );

    const cache = useBandMirStore((s) => s.cache);

    // Get enabled bands with their amplitude envelope availability
    const bandOptions = useMemo(() => {
        if (!structure) return [];

        return structure.bands
            .filter((b) => b.enabled)
            .map((band, index) => {
                const hasAmplitude = cache.has(`${band.id}:bandAmplitudeEnvelope`);
                return {
                    id: band.id,
                    label: band.label,
                    color: getBandColorHex(index),
                    hasData: hasAmplitude,
                };
            });
    }, [structure, cache]);

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
            {isLoading && (
                <span className="text-xs text-zinc-400 animate-pulse">...</span>
            )}
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
    const cache = useBandMirStore((s) => s.cache);

    return useMemo(() => {
        if (!bandId) return null;
        const result = cache.get(`${bandId}:bandAmplitudeEnvelope`);
        if (!result) return null;

        // Normalize values for waveform display
        const normalizedValues = normaliseForWaveform(result.values, { center: false });

        return {
            bandId: result.bandId,
            bandLabel: result.bandLabel,
            times: result.times,
            values: normalizedValues,
            diagnostics: result.diagnostics,
        };
    }, [bandId, cache]);
}
