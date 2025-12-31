/**
 * Band-Scoped MIR utilities for F3.
 *
 * These functions compute MIR features (amplitude envelope, onset strength,
 * spectral flux) for frequency bands by applying spectral masks to an
 * existing spectrogram.
 */

import type { Spectrogram } from "./spectrogram";
import type {
    FrequencyBand,
    MirRunMeta,
    MirRunTimings,
    BandMirFunctionId,
    BandMirDiagnostics,
    BandMir1DResult,
} from "../types";
import {
    applyBandMaskToSpectrogram,
    computeFrameAmplitude,
    type BandMaskOptions,
} from "./bandMask";

// Re-export types for convenience
export type { BandMirFunctionId, BandMirDiagnostics, BandMir1DResult };

export type BandMirOptions = {
    /** Soft edge width in Hz for mask transitions. Default: 0 */
    edgeSmoothHz?: number;
    /** Options for onset strength computation */
    onset?: {
        /** If true, log-compress magnitudes before differencing. */
        useLog?: boolean;
        /** Moving-average smoothing window length in milliseconds. 0 disables smoothing. */
        smoothMs?: number;
        /** How to convert temporal differences into novelty. */
        diffMethod?: "rectified" | "abs";
    };
    /** Optional cancellation hook */
    isCancelled?: () => boolean;
};

// ----------------------------
// Internal Helpers
// ----------------------------

function computeDiagnostics(
    energyRetainedPerFrame: Float32Array
): BandMirDiagnostics {
    const totalFrames = energyRetainedPerFrame.length;
    let sum = 0;
    let weakCount = 0;
    let emptyCount = 0;

    for (let i = 0; i < totalFrames; i++) {
        const e = energyRetainedPerFrame[i] ?? 0;
        sum += e;
        if (e < 0.01) weakCount++;
        if (e === 0) emptyCount++;
    }

    const meanEnergyRetained = totalFrames > 0 ? sum / totalFrames : 0;
    const warnings: string[] = [];

    if (meanEnergyRetained < 0.01) {
        warnings.push("Band contains very little energy - check frequency range");
    }
    if (emptyCount > totalFrames * 0.5) {
        warnings.push("More than half of frames are empty - band may not be active for this audio");
    }

    return {
        meanEnergyRetained,
        weakFrameCount: weakCount,
        emptyFrameCount: emptyCount,
        totalFrames,
        warnings,
    };
}

function createMeta(startMs: number): MirRunMeta {
    const endMs = typeof performance !== "undefined" ? performance.now() : Date.now();
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

function movingAverage(values: Float32Array, windowFrames: number): Float32Array {
    if (windowFrames <= 1) return values;

    const n = values.length;
    const out = new Float32Array(n);

    // Centered window.
    const half = Math.floor(windowFrames / 2);

    // Prefix sums for stable, bug-free O(n) moving average.
    const prefix = new Float64Array(n + 1);
    prefix[0] = 0;
    for (let i = 0; i < n; i++) {
        prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
    }

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - half);
        const end = Math.min(n, i + half + 1);
        const sum = (prefix[end] ?? 0) - (prefix[start] ?? 0);
        const count = Math.max(1, end - start);
        out[i] = sum / count;
    }

    return out;
}

function logCompress(x: number): number {
    // Stable compression without -Inf.
    return Math.log1p(Math.max(0, x));
}

// ----------------------------
// Band MIR Functions
// ----------------------------

/**
 * Compute amplitude envelope for a frequency band.
 *
 * Returns the sum of magnitudes per frame within the band's frequency range.
 *
 * @param spec - Source spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band MIR result with amplitude envelope
 */
export function bandAmplitudeEnvelope(
    spec: Spectrogram,
    band: FrequencyBand,
    options?: BandMirOptions
): BandMir1DResult {
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Apply band mask
    const masked = applyBandMaskToSpectrogram(spec, band, {
        edgeSmoothHz: options?.edgeSmoothHz,
    });

    const nFrames = masked.times.length;
    const values = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const mags = masked.magnitudes[t];
        if (mags) {
            values[t] = computeFrameAmplitude(mags);
        }
    }

    return {
        kind: "bandMir1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandAmplitudeEnvelope",
        times: masked.times,
        values,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

/**
 * Compute onset strength for a frequency band.
 *
 * Uses temporal differences of band-masked magnitudes.
 * Adapted from onset.ts:onsetEnvelopeFromSpectrogram.
 *
 * @param spec - Source spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band MIR result with onset strength
 */
export function bandOnsetStrength(
    spec: Spectrogram,
    band: FrequencyBand,
    options?: BandMirOptions
): BandMir1DResult {
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Default onset options
    const useLog = options?.onset?.useLog ?? false;
    const smoothMs = options?.onset?.smoothMs ?? 30;
    const diffMethod = options?.onset?.diffMethod ?? "rectified";

    // Apply band mask
    const masked = applyBandMaskToSpectrogram(spec, band, {
        edgeSmoothHz: options?.edgeSmoothHz,
    });

    const nFrames = masked.times.length;
    const nBins = (masked.fftSize >>> 1) + 1;
    const out = new Float32Array(nFrames);

    // First frame has no previous frame
    out[0] = 0;

    for (let t = 1; t < nFrames; t++) {
        const cur = masked.magnitudes[t];
        const prev = masked.magnitudes[t - 1];

        if (!cur || !prev) {
            out[t] = 0;
            continue;
        }

        let sum = 0;
        let binsWithData = 0;

        for (let k = 0; k < nBins; k++) {
            let a = cur[k] ?? 0;
            let b = prev[k] ?? 0;

            // Only count bins that have some energy
            if (a > 0 || b > 0) {
                binsWithData++;

                if (useLog) {
                    a = logCompress(a);
                    b = logCompress(b);
                }

                const d = a - b;
                sum += diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
            }
        }

        // Normalize by number of active bins to avoid scale depending on band width
        out[t] = binsWithData > 0 ? sum / binsWithData : 0;
    }

    // Apply smoothing if requested
    const smoothMs_ = smoothMs;
    if (smoothMs_ > 0 && nFrames >= 2) {
        const dt = (masked.times[1] ?? 0) - (masked.times[0] ?? 0);
        const windowFrames = Math.max(1, Math.round((smoothMs_ / 1000) / Math.max(1e-9, dt)));
        return {
            kind: "bandMir1d",
            bandId: band.id,
            bandLabel: band.label,
            fn: "bandOnsetStrength",
            times: masked.times,
            values: movingAverage(out, windowFrames | 1),
            meta: createMeta(startMs),
            diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
        };
    }

    return {
        kind: "bandMir1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandOnsetStrength",
        times: masked.times,
        values: out,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

/**
 * Compute spectral flux for a frequency band.
 *
 * Uses L1 distance between consecutive normalized band-masked spectra.
 * Adapted from spectral.ts:spectralFlux.
 *
 * @param spec - Source spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band MIR result with spectral flux
 */
export function bandSpectralFlux(
    spec: Spectrogram,
    band: FrequencyBand,
    options?: BandMirOptions
): BandMir1DResult {
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Apply band mask
    const masked = applyBandMaskToSpectrogram(spec, band, {
        edgeSmoothHz: options?.edgeSmoothHz,
    });

    const nFrames = masked.times.length;
    const nBins = (masked.fftSize >>> 1) + 1;
    const out = new Float32Array(nFrames);

    let prev: Float32Array | null = null;

    for (let t = 0; t < nFrames; t++) {
        const mags = masked.magnitudes[t];

        if (!mags) {
            out[t] = 0;
            prev = null;
            continue;
        }

        // Normalize to reduce sensitivity to overall level
        let sum = 0;
        for (let k = 0; k < nBins; k++) sum += mags[k] ?? 0;

        if (sum <= 0) {
            out[t] = 0;
            prev = null;
            continue;
        }

        const cur = new Float32Array(nBins);
        const inv = 1 / sum;
        for (let k = 0; k < nBins; k++) cur[k] = (mags[k] ?? 0) * inv;

        if (!prev) {
            out[t] = 0;
            prev = cur;
            continue;
        }

        let flux = 0;
        for (let k = 0; k < nBins; k++) {
            const d = (cur[k] ?? 0) - (prev[k] ?? 0);
            flux += Math.abs(d);
        }

        out[t] = flux;
        prev = cur;
    }

    return {
        kind: "bandMir1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandSpectralFlux",
        times: masked.times,
        values: out,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

/**
 * Compute spectral centroid for a frequency band.
 *
 * Returns the weighted average of frequency bins within the band (center of mass).
 * Output is in Hz per frame.
 *
 * @param spec - Source spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band MIR result with spectral centroid in Hz
 */
export function bandSpectralCentroid(
    spec: Spectrogram,
    band: FrequencyBand,
    options?: BandMirOptions
): BandMir1DResult {
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Apply band mask
    const masked = applyBandMaskToSpectrogram(spec, band, {
        edgeSmoothHz: options?.edgeSmoothHz,
    });

    const nFrames = masked.times.length;
    const nBins = (masked.fftSize >>> 1) + 1;
    const binHz = masked.sampleRate / masked.fftSize;
    const out = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const mags = masked.magnitudes[t];

        if (!mags) {
            out[t] = 0;
            continue;
        }

        let num = 0;
        let den = 0;

        // Weighted average: centroid = Σ(f * m) / Σ(m)
        for (let k = 0; k < nBins; k++) {
            const m = mags[k] ?? 0;
            if (m > 0) {
                const f = k * binHz;
                num += f * m;
                den += m;
            }
        }

        out[t] = den > 0 ? num / den : 0;
    }

    return {
        kind: "bandMir1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandSpectralCentroid",
        times: masked.times,
        values: out,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

// ----------------------------
// Batch Runner
// ----------------------------

export type BandMirBatchRequest = {
    bands: FrequencyBand[];
    functions: BandMirFunctionId[];
    /** Maximum number of bands to process concurrently. Default: 4 */
    maxConcurrent?: number;
};

export type BandMirBatchResult = {
    /** Results keyed by bandId, each containing results for requested functions */
    results: Map<string, BandMir1DResult[]>;
    /** Total computation time in ms */
    totalTimingMs: number;
};

/**
 * Run band MIR analysis for multiple bands.
 *
 * Processes bands sequentially (web workers don't have real parallelism
 * within a single thread). The maxConcurrent option is reserved for
 * future multi-worker support.
 *
 * @param spec - Source spectrogram
 * @param request - Batch request specifying bands and functions
 * @param options - Computation options
 * @returns Map of results by band ID
 */
export async function runBandMirBatch(
    spec: Spectrogram,
    request: BandMirBatchRequest,
    options?: BandMirOptions
): Promise<BandMirBatchResult> {
    const startMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    const results = new Map<string, BandMir1DResult[]>();

    for (const band of request.bands) {
        if (options?.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        if (!band.enabled) continue;

        const bandResults: BandMir1DResult[] = [];

        for (const fn of request.functions) {
            if (options?.isCancelled?.()) {
                throw new Error("@octoseq/mir: cancelled");
            }

            let result: BandMir1DResult;

            switch (fn) {
                case "bandAmplitudeEnvelope":
                    result = bandAmplitudeEnvelope(spec, band, options);
                    break;
                case "bandOnsetStrength":
                    result = bandOnsetStrength(spec, band, options);
                    break;
                case "bandSpectralFlux":
                    result = bandSpectralFlux(spec, band, options);
                    break;
                case "bandSpectralCentroid":
                    result = bandSpectralCentroid(spec, band, options);
                    break;
                default:
                    // Exhaustive check
                    const _exhaustive: never = fn;
                    throw new Error(`Unknown band MIR function: ${_exhaustive}`);
            }

            bandResults.push(result);
        }

        results.set(band.id, bandResults);
    }

    const endMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    return {
        results,
        totalTimingMs: endMs - startMs,
    };
}

/**
 * Get a human-readable label for a band MIR function.
 *
 * @param fn - Band MIR function ID
 * @returns Human-readable label
 */
export function getBandMirFunctionLabel(fn: BandMirFunctionId): string {
    switch (fn) {
        case "bandAmplitudeEnvelope":
            return "Amplitude Envelope";
        case "bandOnsetStrength":
            return "Onset Strength";
        case "bandSpectralFlux":
            return "Spectral Flux";
        case "bandSpectralCentroid":
            return "Spectral Centroid";
        default:
            return fn;
    }
}
