import { useCallback, useRef } from "react";
import {
    spectrogram,
    runBandMirBatch,
    runBandCqtBatch,
    runBandEventsBatch,
    cqtSpectrogram,
    withCqtDefaults,
    peakPick,
    type Spectrogram,
    type CqtSpectrogram,
    type BandMirFunctionId,
    type BandCqtFunctionId,
    type BandEventFunctionId,
    type FrequencyBand,
} from "@octoseq/mir";
import { useAudioStore } from "../audioStore";
import { useFrequencyBandStore } from "../frequencyBandStore";
import { useBandMirStore, type BandEvent } from "../bandMirStore";
import { useConfigStore } from "../configStore";

const waitForNextPaint = () =>
    new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });

/**
 * Hook that provides band MIR analysis actions.
 *
 * Band MIR runs on the main thread for now (applying masks and reusing
 * existing spectrogram). Can be ported to worker if performance is an issue.
 */
export function useBandMirActions() {
    // Cache spectrogram to avoid recomputing
    const spectrogramCacheRef = useRef<{
        audioId: string | null;
        spec: Spectrogram;
    } | null>(null);

    // Cache CQT spectrogram separately
    const cqtCacheRef = useRef<{
        audioId: string | null;
        cqt: CqtSpectrogram;
    } | null>(null);

    const runBandAnalysis = useCallback(
        async (
            bandIds?: string[],
            functions: BandMirFunctionId[] = ["bandAmplitudeEnvelope", "bandOnsetStrength"]
        ) => {
            const { audio, audioFileName, audioDuration } = useAudioStore.getState();
            if (!audio) return;

            const structure = useFrequencyBandStore.getState().structure;
            if (!structure) return;

            const bandMirStore = useBandMirStore.getState();
            const configStore = useConfigStore.getState();

            // Get bands to process
            const bands = bandIds
                ? structure.bands.filter((b) => bandIds.includes(b.id) && b.enabled)
                : structure.bands.filter((b) => b.enabled);

            if (bands.length === 0) return;

            // Check cache - skip bands with valid cached results
            const bandsToCompute = bands.filter((band) => {
                return functions.some((fn) => !bandMirStore.getCached(band.id, fn));
            });

            if (bandsToCompute.length === 0) return;

            // Mark bands as pending
            bandsToCompute.forEach((b) => bandMirStore.setPending(b.id, true));
            await waitForNextPaint();

            try {
                const spectrogramConfig = configStore.getSpectrogramConfig();

                // Create a cache key that includes BOTH audio identity and spectrogram config.
                // This prevents stale reuse when FFT/hop settings change.
                const audioId = `${audioFileName ?? "unknown"}:${audioDuration}:${audio.sampleRate}`;
                const specKey = `${audioId}:fft=${spectrogramConfig.fftSize}:hop=${spectrogramConfig.hopSize}:win=${spectrogramConfig.window}`;

                // Get or compute spectrogram
                let spec: Spectrogram;
                if (
                    spectrogramCacheRef.current &&
                    spectrogramCacheRef.current.audioId === specKey
                ) {
                    spec = spectrogramCacheRef.current.spec;
                } else {
                    // Create AudioBufferLike from AudioBuffer
                    const ch0 = audio.getChannelData(0);
                    const mono = new Float32Array(ch0);
                    const audioLike = {
                        sampleRate: audio.sampleRate,
                        numberOfChannels: 1,
                        getChannelData: () => mono,
                    };

                    spec = await spectrogram(audioLike, spectrogramConfig);

                    spectrogramCacheRef.current = { audioId: specKey, spec };
                }

                // Run batch computation
                const { results } = await runBandMirBatch(spec, {
                    bands: bandsToCompute,
                    functions,
                    maxConcurrent: 4,
                });

                // Store results
                const allResults = Array.from(results.values()).flat();
                bandMirStore.setResults(allResults);
            } finally {
                // Clear pending state
                bandsToCompute.forEach((b) => bandMirStore.setPending(b.id, false));
            }
        },
        []
    );

    const runSingleBandAnalysis = useCallback(
        async (
            bandId: string,
            functions: BandMirFunctionId[] = ["bandAmplitudeEnvelope", "bandOnsetStrength"]
        ) => {
            return runBandAnalysis([bandId], functions);
        },
        [runBandAnalysis]
    );

    const runAllBandAnalysis = useCallback(
        async (
            functions: BandMirFunctionId[] = ["bandAmplitudeEnvelope", "bandOnsetStrength"]
        ) => {
            return runBandAnalysis(undefined, functions);
        },
        [runBandAnalysis]
    );

    const invalidateAndRecompute = useCallback(
        async (bandId: string) => {
            const bandMirStore = useBandMirStore.getState();
            bandMirStore.invalidateBand(bandId);
            bandMirStore.invalidateBandEvents(bandId);
            await runSingleBandAnalysis(bandId);
        },
        [runSingleBandAnalysis]
    );

    const clearSpectrogramCache = useCallback(() => {
        spectrogramCacheRef.current = null;
        cqtCacheRef.current = null;
    }, []);

    /**
     * Run CQT-based band analysis.
     *
     * CQT provides log-frequency resolution suitable for harmonic and tonal analysis.
     */
    const runBandCqtAnalysis = useCallback(
        async (
            bandIds?: string[],
            functions: BandCqtFunctionId[] = ["bandCqtHarmonicEnergy", "bandCqtTonalStability"]
        ) => {
            const { audio, audioFileName, audioDuration } = useAudioStore.getState();
            if (!audio) return;

            const structure = useFrequencyBandStore.getState().structure;
            if (!structure) return;

            const bandMirStore = useBandMirStore.getState();

            // Get bands to process
            const bands = bandIds
                ? structure.bands.filter((b) => bandIds.includes(b.id) && b.enabled)
                : structure.bands.filter((b) => b.enabled);

            if (bands.length === 0) return;

            // Check cache - skip bands with valid cached results
            const bandsToCompute = bands.filter((band) => {
                return functions.some((fn) => !bandMirStore.getCqtCached(band.id, fn));
            });

            if (bandsToCompute.length === 0) return;

            // Mark bands as pending
            bandsToCompute.forEach((b) => bandMirStore.setCqtPending(b.id, true));
            await waitForNextPaint();

            try {
                // Create audio ID for cache key
                const audioId = `${audioFileName ?? "unknown"}:${audioDuration}:${audio.sampleRate}`;

                // Get or compute CQT spectrogram
                let cqt: CqtSpectrogram;
                if (cqtCacheRef.current && cqtCacheRef.current.audioId === audioId) {
                    cqt = cqtCacheRef.current.cqt;
                } else {
                    // Create AudioBufferLike from AudioBuffer
                    const ch0 = audio.getChannelData(0);
                    const mono = new Float32Array(ch0);
                    const audioLike = {
                        sampleRate: audio.sampleRate,
                        numberOfChannels: 1,
                        getChannelData: () => mono,
                    };

                    cqt = await cqtSpectrogram(audioLike, withCqtDefaults({}));
                    cqtCacheRef.current = { audioId, cqt };
                }

                // Run batch computation
                const { results } = await runBandCqtBatch(cqt, {
                    bands: bandsToCompute,
                    functions,
                });

                // Store results
                const allResults = Array.from(results.values()).flat();
                bandMirStore.setCqtResults(allResults);
            } finally {
                // Clear pending state
                bandsToCompute.forEach((b) => bandMirStore.setCqtPending(b.id, false));
            }
        },
        []
    );

    /**
     * Run typed event extraction from band MIR signals.
     *
     * Uses the bandEvents module for consistent event extraction.
     */
    const runTypedEventExtraction = useCallback(
        async (
            bandIds?: string[],
            functions: BandEventFunctionId[] = ["bandOnsetPeaks"]
        ) => {
            const structure = useFrequencyBandStore.getState().structure;
            if (!structure) return;

            const bandMirStore = useBandMirStore.getState();

            // Get bands to process
            const bands = bandIds
                ? structure.bands.filter((b) => bandIds.includes(b.id) && b.enabled)
                : structure.bands.filter((b) => b.enabled);

            if (bands.length === 0) return;

            // Build band MIR results map for event extraction
            const bandMirResults = new Map<string, import("@octoseq/mir").BandMir1DResult[]>();
            const bandsWithResults: FrequencyBand[] = [];

            for (const band of bands) {
                const results = bandMirStore.getResultsByBand(band.id);
                if (results.length > 0) {
                    bandMirResults.set(band.id, results);
                    bandsWithResults.push(band);
                }
            }

            if (bandsWithResults.length === 0) return;

            // Mark bands as pending
            bandsWithResults.forEach((b) => bandMirStore.setTypedEventsPending(b.id, true));
            await waitForNextPaint();

            try {
                // Run batch extraction
                const { results } = await runBandEventsBatch({
                    bandMirResults,
                    functions,
                    sourceFunction: "bandOnsetStrength",
                });

                // Store results
                const allResults = Array.from(results.values()).flat();
                bandMirStore.setTypedEventResults(allResults);
            } finally {
                // Clear pending state
                bandsWithResults.forEach((b) => bandMirStore.setTypedEventsPending(b.id, false));
            }
        },
        []
    );

    /**
     * Extract events from band onset strength signals.
     *
     * Uses conservative defaults optimized for band-scoped extraction:
     * - Higher adaptive factor (0.8) to suppress weak bands
     * - Minimum interval based on tempo (0.125 beats at 120 BPM ≈ 62.5ms)
     *
     * Events are stored in bandMirStore and can be pushed to WASM for script access.
     */
    const extractBandEvents = useCallback(
        async (bandIds?: string[]) => {
            const structure = useFrequencyBandStore.getState().structure;
            if (!structure) return;

            const bandMirStore = useBandMirStore.getState();

            // Get bands to process
            const bands = bandIds
                ? structure.bands.filter((b) => bandIds.includes(b.id) && b.enabled)
                : structure.bands.filter((b) => b.enabled);

            if (bands.length === 0) return;

            // Filter bands that already have cached events
            const bandsToExtract = bands.filter(
                (band) => !bandMirStore.getEventsCached(band.id)
            );

            if (bandsToExtract.length === 0) return;

            // Mark as pending
            bandsToExtract.forEach((b) => bandMirStore.setEventsPending(b.id, true));
            await waitForNextPaint();

            try {
                // Conservative defaults for band-scoped event extraction
                const minIntervalSec = 0.0625; // ~0.125 beats at 120 BPM
                const adaptiveFactor = 0.8; // Higher = more aggressive filtering

                for (const band of bandsToExtract) {
                    // Get onset strength signal (preferred) or amplitude envelope (fallback)
                    let mirResult = bandMirStore.getCached(band.id, "bandOnsetStrength");
                    if (!mirResult) {
                        mirResult = bandMirStore.getCached(band.id, "bandAmplitudeEnvelope");
                    }

                    if (!mirResult) {
                        // No signal available, skip
                        continue;
                    }

                    // Extract peaks using conservative settings
                    const peaks = peakPick(mirResult.times, mirResult.values, {
                        minIntervalSec,
                        adaptive: {
                            method: "meanStd",
                            factor: adaptiveFactor,
                        },
                        strict: true,
                    });

                    // Convert to BandEvent format
                    // Normalize weights to 0-1 range
                    const maxStrength = peaks.reduce(
                        (max, p) => Math.max(max, p.strength),
                        0
                    );
                    const events: BandEvent[] = peaks.map((p) => ({
                        time: p.time,
                        weight: maxStrength > 0 ? p.strength / maxStrength : 1,
                    }));

                    // Store in cache
                    bandMirStore.setEventResult(band.id, band.label, events);
                }
            } finally {
                // Clear pending state
                bandsToExtract.forEach((b) => bandMirStore.setEventsPending(b.id, false));
            }
        },
        []
    );

    /**
     * Extract events for a single band.
     */
    const extractSingleBandEvents = useCallback(
        async (bandId: string) => {
            return extractBandEvents([bandId]);
        },
        [extractBandEvents]
    );

    /**
     * Extract events for all enabled bands.
     */
    const extractAllBandEvents = useCallback(async () => {
        return extractBandEvents(undefined);
    }, [extractBandEvents]);

    /**
     * Run full band analysis including event extraction.
     *
     * This is a convenience method that runs MIR analysis first,
     * then extracts events from the resulting signals.
     */
    const runBandAnalysisWithEvents = useCallback(
        async (
            bandIds?: string[],
            functions: BandMirFunctionId[] = ["bandAmplitudeEnvelope", "bandOnsetStrength"]
        ) => {
            // First run MIR analysis
            await runBandAnalysis(bandIds, functions);
            // Then extract events
            await extractBandEvents(bandIds);
        },
        [runBandAnalysis, extractBandEvents]
    );

    return {
        runBandAnalysis,
        runSingleBandAnalysis,
        runAllBandAnalysis,
        invalidateAndRecompute,
        clearSpectrogramCache,
        // CQT analysis
        runBandCqtAnalysis,
        // Typed event extraction
        runTypedEventExtraction,
        // Legacy event extraction
        extractBandEvents,
        extractSingleBandEvents,
        extractAllBandEvents,
        runBandAnalysisWithEvents,
    };
}
