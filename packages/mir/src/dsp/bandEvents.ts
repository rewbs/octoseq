/**
 * Band Event Extraction for F3.
 *
 * These functions extract discrete events (onset peaks, beat candidates)
 * from band-scoped 1D signals.
 */

import type {
    BandMir1DResult,
    BandEventFunctionId,
    BandEventsResult,
    BandMirEvent,
    BandEventDiagnostics,
    MirRunMeta,
    MirRunTimings,
} from "../types";
import { peakPick, type PeakPickOptions } from "./peakPick";

// Re-export types for convenience
export type { BandEventFunctionId, BandEventsResult, BandMirEvent, BandEventDiagnostics };

// ----------------------------
// Options
// ----------------------------

export type BandOnsetPeaksOptions = {
    /** Minimum inter-peak interval in seconds. Default: 0.0625 (~0.125 beats at 120 BPM). */
    minIntervalSec?: number;
    /** Adaptive threshold factor. Default: 0.8 (conservative for bands). */
    adaptiveFactor?: number;
    /** Use strict peak detection (> neighbors). Default: true. */
    strict?: boolean;
};

export type BandBeatCandidatesOptions = {
    /** Minimum inter-candidate interval in seconds. Default: 0.1. */
    minIntervalSec?: number;
    /** Threshold factor for adaptive detection. Lower = more candidates. Default: 0.5. */
    thresholdFactor?: number;
};

// ----------------------------
// Internal Helpers
// ----------------------------

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createMeta(startMs: number): MirRunMeta {
    const endMs = nowMs();
    const timings: MirRunTimings = {
        totalMs: endMs - startMs,
        cpuMs: endMs - startMs,
        gpuMs: 0,
    };
    return {
        backend: "cpu",
        usedGpu: false,
        timings,
    };
}

function computeEventDiagnostics(
    events: BandMirEvent[],
    durationSec: number
): BandEventDiagnostics {
    const eventCount = events.length;
    const eventsPerSecond = durationSec > 0 ? eventCount / durationSec : 0;
    const warnings: string[] = [];

    // Check for sparse or dense event streams
    if (durationSec > 1 && eventCount === 0) {
        warnings.push("No events detected - signal may be too quiet or noisy");
    } else if (eventsPerSecond > 20) {
        warnings.push("Very high event density (>20/sec) - consider adjusting threshold");
    } else if (durationSec > 10 && eventsPerSecond < 0.1) {
        warnings.push("Very sparse events (<0.1/sec) - signal may not be active");
    }

    return {
        eventCount,
        eventsPerSecond,
        warnings,
    };
}

// ----------------------------
// Band Event Functions
// ----------------------------

/**
 * Extract onset peaks from a band MIR 1D signal.
 *
 * Uses peak picking with conservative defaults optimized for band-scoped
 * extraction. Typically applied to bandOnsetStrength or bandAmplitudeEnvelope.
 *
 * @param signal - The band MIR 1D result to extract peaks from
 * @param options - Peak picking options
 * @returns Band events result with onset peaks
 */
export function bandOnsetPeaks(
    signal: BandMir1DResult,
    options?: BandOnsetPeaksOptions
): BandEventsResult {
    const startMs = nowMs();

    const minIntervalSec = options?.minIntervalSec ?? 0.0625;
    const adaptiveFactor = options?.adaptiveFactor ?? 0.8;
    const strict = options?.strict ?? true;

    const { times, values } = signal;

    // Peak pick the signal
    const pickOptions: PeakPickOptions = {
        minIntervalSec,
        adaptive: {
            method: "meanStd",
            factor: adaptiveFactor,
        },
        strict,
    };

    const peaks = peakPick(times, values, pickOptions);

    // Normalize weights to 0-1 range
    const maxStrength = peaks.reduce((max, p) => Math.max(max, p.strength), 0);

    const events: BandMirEvent[] = peaks.map((p) => ({
        time: p.time,
        weight: maxStrength > 0 ? p.strength / maxStrength : 1,
    }));

    // Compute duration for diagnostics
    const duration = times.length >= 2
        ? (times[times.length - 1] ?? 0) - (times[0] ?? 0)
        : 0;

    return {
        kind: "bandEvents",
        bandId: signal.bandId,
        bandLabel: signal.bandLabel,
        fn: "bandOnsetPeaks",
        events,
        sourceSignal: {
            fn: signal.fn,
            times: signal.times,
            values: signal.values,
        },
        meta: createMeta(startMs),
        diagnostics: computeEventDiagnostics(events, duration),
    };
}

/**
 * Extract beat candidates from a band's onset peaks.
 *
 * Similar to full-track beat candidate detection but simplified for
 * single-band input. Uses the onset peaks to identify beat-like events.
 *
 * @param onsetPeaks - Band onset peaks result
 * @param options - Beat candidate options
 * @returns Band events result with beat candidates
 */
export function bandBeatCandidates(
    onsetPeaks: BandEventsResult,
    options?: BandBeatCandidatesOptions
): BandEventsResult {
    const startMs = nowMs();

    const minIntervalSec = options?.minIntervalSec ?? 0.1;
    const thresholdFactor = options?.thresholdFactor ?? 0.5;

    // Filter onset peaks by strength threshold
    // Use adaptive threshold similar to full-track beat candidates
    const weights = onsetPeaks.events.map((e) => e.weight);
    const meanWeight = weights.length > 0
        ? weights.reduce((sum, w) => sum + w, 0) / weights.length
        : 0;

    // Simple std calculation
    const variance = weights.length > 0
        ? weights.reduce((sum, w) => sum + (w - meanWeight) ** 2, 0) / weights.length
        : 0;
    const stdWeight = Math.sqrt(variance);

    const threshold = meanWeight + thresholdFactor * stdWeight;

    // Filter by threshold and minimum interval
    const candidates: BandMirEvent[] = [];
    let lastTime = -Infinity;

    for (const event of onsetPeaks.events) {
        if (event.weight < threshold) continue;
        if (event.time - lastTime < minIntervalSec) {
            // Keep stronger event within interval
            const last = candidates[candidates.length - 1];
            if (last && event.weight > last.weight) {
                last.time = event.time;
                last.weight = event.weight;
                lastTime = event.time;
            }
            continue;
        }

        candidates.push({
            time: event.time,
            weight: event.weight,
            beatPosition: event.beatPosition,
            beatPhase: event.beatPhase,
        });
        lastTime = event.time;
    }

    // Compute duration from source signal if available
    const duration = onsetPeaks.sourceSignal?.times
        ? (onsetPeaks.sourceSignal.times.length >= 2
            ? (onsetPeaks.sourceSignal.times[onsetPeaks.sourceSignal.times.length - 1] ?? 0)
              - (onsetPeaks.sourceSignal.times[0] ?? 0)
            : 0)
        : 0;

    return {
        kind: "bandEvents",
        bandId: onsetPeaks.bandId,
        bandLabel: onsetPeaks.bandLabel,
        fn: "bandBeatCandidates",
        events: candidates,
        // Don't include source signal to save memory
        meta: createMeta(startMs),
        diagnostics: computeEventDiagnostics(candidates, duration),
    };
}

// ----------------------------
// Batch Runner
// ----------------------------

export type BandEventsBatchRequest = {
    /** Band MIR results to extract events from (keyed by bandId) */
    bandMirResults: Map<string, BandMir1DResult[]>;
    /** Event functions to run */
    functions: BandEventFunctionId[];
    /** Source signal function to use for onset peaks. Default: bandOnsetStrength */
    sourceFunction?: "bandOnsetStrength" | "bandAmplitudeEnvelope";
    /** Options for onset peaks extraction */
    onsetPeaksOptions?: BandOnsetPeaksOptions;
    /** Options for beat candidates extraction */
    beatCandidatesOptions?: BandBeatCandidatesOptions;
};

export type BandEventsBatchResult = {
    /** Results keyed by bandId, each containing results for requested functions */
    results: Map<string, BandEventsResult[]>;
    /** Total computation time in ms */
    totalTimingMs: number;
};

/**
 * Run band event extraction for multiple bands.
 *
 * @param request - Batch request specifying bands, functions, and options
 * @returns Map of results by band ID
 */
export async function runBandEventsBatch(
    request: BandEventsBatchRequest
): Promise<BandEventsBatchResult> {
    const startMs = nowMs();

    const results = new Map<string, BandEventsResult[]>();
    const sourceFunction = request.sourceFunction ?? "bandOnsetStrength";

    for (const [bandId, mirResults] of request.bandMirResults.entries()) {
        const bandEventResults: BandEventsResult[] = [];

        // Find the source signal for onset peaks
        const sourceSignal = mirResults.find((r) => r.fn === sourceFunction);
        if (!sourceSignal) {
            // Skip if source signal not available
            continue;
        }

        for (const fn of request.functions) {
            switch (fn) {
                case "bandOnsetPeaks": {
                    const result = bandOnsetPeaks(sourceSignal, request.onsetPeaksOptions);
                    bandEventResults.push(result);
                    break;
                }
                case "bandBeatCandidates": {
                    // Beat candidates require onset peaks first
                    let onsetPeaksResult = bandEventResults.find(
                        (r) => r.fn === "bandOnsetPeaks"
                    );
                    if (!onsetPeaksResult) {
                        // Compute onset peaks if not already done
                        onsetPeaksResult = bandOnsetPeaks(
                            sourceSignal,
                            request.onsetPeaksOptions
                        );
                        // Only add to results if explicitly requested
                        if (!request.functions.includes("bandOnsetPeaks")) {
                            // Don't add to results, just use for beat candidates
                        } else {
                            bandEventResults.push(onsetPeaksResult);
                        }
                    }
                    const result = bandBeatCandidates(
                        onsetPeaksResult,
                        request.beatCandidatesOptions
                    );
                    bandEventResults.push(result);
                    break;
                }
                default: {
                    // Exhaustive check
                    const _exhaustive: never = fn;
                    throw new Error(`Unknown band event function: ${_exhaustive}`);
                }
            }
        }

        if (bandEventResults.length > 0) {
            results.set(bandId, bandEventResults);
        }
    }

    const endMs = nowMs();

    return {
        results,
        totalTimingMs: endMs - startMs,
    };
}

/**
 * Get a human-readable label for a band event function.
 *
 * @param fn - Band event function ID
 * @returns Human-readable label
 */
export function getBandEventFunctionLabel(fn: BandEventFunctionId): string {
    switch (fn) {
        case "bandOnsetPeaks":
            return "Onset Peaks";
        case "bandBeatCandidates":
            return "Beat Candidates";
        default:
            return fn;
    }
}
