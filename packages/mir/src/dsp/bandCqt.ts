/**
 * Band-Scoped CQT utilities for F3.
 *
 * These functions compute CQT-derived features (harmonic energy, bass pitch motion,
 * tonal stability) for frequency bands by applying spectral masks to a CQT
 * spectrogram.
 *
 * CQT uses log-frequency bins, so band masking requires mapping Hz ranges
 * to CQT bin indices using hzToCqtBin().
 */

import type {
    FrequencyBand,
    CqtSpectrogram,
    CqtConfig,
    MirRunMeta,
    MirRunTimings,
    BandCqtFunctionId,
    BandMirDiagnostics,
    BandCqt1DResult,
} from "../types";
import { hzToCqtBin, cqtBinToHz } from "./cqt";

// Re-export types for convenience
export type { BandCqtFunctionId, BandCqt1DResult };

// ----------------------------
// Options
// ----------------------------

export type BandCqtOptions = {
    /** Soft edge width in bins for mask transitions. Default: 0 */
    edgeSmoothBins?: number;
    /** Optional cancellation hook */
    isCancelled?: () => boolean;
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
        warnings.push("Band contains very little CQT energy - check frequency range");
    }
    if (emptyCount > totalFrames * 0.5) {
        warnings.push("More than half of frames are empty in CQT - band may not be active");
    }

    return {
        meanEnergyRetained,
        weakFrameCount: weakCount,
        emptyFrameCount: emptyCount,
        totalFrames,
        warnings,
    };
}

/**
 * Get the frequency bounds at a specific time for a band.
 * Returns the bounds from the first matching segment, or the band's overall bounds.
 */
function getBandBoundsAtTime(
    band: FrequencyBand,
    timeSec: number
): { lowHz: number; highHz: number } {
    // Find the segment containing this time
    for (const seg of band.frequencyShape) {
        if (timeSec >= seg.startTime && timeSec < seg.endTime) {
            // Linear interpolation within segment
            const ratio = (timeSec - seg.startTime) / (seg.endTime - seg.startTime);
            const lowHz = seg.lowHzStart + ratio * (seg.lowHzEnd - seg.lowHzStart);
            const highHz = seg.highHzStart + ratio * (seg.highHzEnd - seg.highHzStart);
            return { lowHz, highHz };
        }
    }

    // Fallback to first segment bounds
    const first = band.frequencyShape[0];
    if (first) {
        return { lowHz: first.lowHzStart, highHz: first.highHzStart };
    }

    // Ultimate fallback
    return { lowHz: 20, highHz: 20000 };
}

// ----------------------------
// CQT Band Masking
// ----------------------------

export type MaskedCqtSpectrogram = {
    /** Original CQT times */
    times: Float32Array;
    /** Masked CQT magnitudes */
    magnitudes: Float32Array[];
    /** CQT config */
    config: CqtConfig;
    /** Energy retained per frame (0-1) */
    energyRetainedPerFrame: Float32Array;
    /** CQT bin frequencies */
    binFrequencies: Float32Array;
};

/**
 * Apply a frequency band mask to a CQT spectrogram.
 *
 * Maps the band's Hz range to CQT bin indices and masks accordingly.
 *
 * @param cqt - Source CQT spectrogram
 * @param band - Frequency band to apply
 * @param options - Masking options
 * @returns Masked CQT spectrogram with energy retention diagnostics
 */
export function applyBandMaskToCqt(
    cqt: CqtSpectrogram,
    band: FrequencyBand,
    options?: BandCqtOptions
): MaskedCqtSpectrogram {
    const edgeSmoothBins = options?.edgeSmoothBins ?? 0;

    const nFrames = cqt.times.length;
    const nBins = cqt.binFrequencies.length;

    const maskedMagnitudes: Float32Array[] = new Array(nFrames);
    const energyRetainedPerFrame = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const frame = cqt.magnitudes[t];
        if (!frame) {
            maskedMagnitudes[t] = new Float32Array(nBins);
            energyRetainedPerFrame[t] = 0;
            continue;
        }

        const timeSec = cqt.times[t] ?? 0;
        const { lowHz, highHz } = getBandBoundsAtTime(band, timeSec);

        // Map Hz to CQT bin indices
        const lowBin = Math.max(0, Math.floor(hzToCqtBin(lowHz, cqt.config)));
        const highBin = Math.min(nBins, Math.ceil(hzToCqtBin(highHz, cqt.config)));

        const maskedFrame = new Float32Array(nBins);
        let originalEnergy = 0;
        let retainedEnergy = 0;

        for (let k = 0; k < nBins; k++) {
            const mag = frame[k] ?? 0;
            originalEnergy += mag * mag;

            if (k >= lowBin && k < highBin) {
                // Apply soft edges if requested
                let weight = 1;
                if (edgeSmoothBins > 0) {
                    const distFromLow = k - lowBin;
                    const distFromHigh = highBin - 1 - k;
                    const minDist = Math.min(distFromLow, distFromHigh);
                    if (minDist < edgeSmoothBins) {
                        weight = (minDist + 1) / (edgeSmoothBins + 1);
                    }
                }
                maskedFrame[k] = mag * weight;
                retainedEnergy += (mag * weight) ** 2;
            }
        }

        maskedMagnitudes[t] = maskedFrame;
        energyRetainedPerFrame[t] = originalEnergy > 0
            ? Math.sqrt(retainedEnergy / originalEnergy)
            : 0;
    }

    return {
        times: cqt.times,
        magnitudes: maskedMagnitudes,
        config: cqt.config,
        energyRetainedPerFrame,
        binFrequencies: cqt.binFrequencies,
    };
}

// ----------------------------
// CQT Band Signal Functions
// ----------------------------

/**
 * Compute harmonic energy for a frequency band using CQT.
 *
 * Measures the ratio of energy at harmonic intervals within the band.
 * Adapted from cqtSignals.ts:harmonicEnergy.
 *
 * @param cqt - Source CQT spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band CQT result with harmonic energy
 */
export function bandCqtHarmonicEnergy(
    cqt: CqtSpectrogram,
    band: FrequencyBand,
    options?: BandCqtOptions
): BandCqt1DResult {
    const startMs = nowMs();

    // Apply band mask to CQT
    const masked = applyBandMaskToCqt(cqt, band, options);

    const nFrames = masked.times.length;
    const values = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        if (options?.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        const frame = masked.magnitudes[t];
        if (!frame) {
            values[t] = 0;
            continue;
        }

        // Find total energy
        let totalEnergy = 0;
        for (let k = 0; k < frame.length; k++) {
            const mag = frame[k] ?? 0;
            totalEnergy += mag * mag;
        }

        if (totalEnergy === 0) {
            values[t] = 0;
            continue;
        }

        // Find strongest bin as fundamental candidate
        let maxMag = 0;
        let fundamentalBin = 0;
        for (let k = 0; k < frame.length; k++) {
            const mag = frame[k] ?? 0;
            if (mag > maxMag) {
                maxMag = mag;
                fundamentalBin = k;
            }
        }

        const fundamentalFreq = cqtBinToHz(fundamentalBin, cqt.config);

        // Sum energy at harmonic positions
        let harmonicEnergy = 0;
        const numHarmonics = 6;

        for (let h = 1; h <= numHarmonics; h++) {
            const harmonicFreq = fundamentalFreq * h;
            const harmonicBin = Math.round(hzToCqtBin(harmonicFreq, cqt.config));

            if (harmonicBin >= 0 && harmonicBin < frame.length) {
                const mag = frame[harmonicBin] ?? 0;
                const weight = 1 / h;
                harmonicEnergy += mag * mag * weight;
            }
        }

        // Normalize by expected harmonic weight sum
        let weightSum = 0;
        for (let h = 1; h <= numHarmonics; h++) {
            weightSum += 1 / h;
        }
        harmonicEnergy /= weightSum;

        values[t] = Math.min(1, harmonicEnergy / totalEnergy);
    }

    // Normalize to [0, 1] using min-max
    const normalized = normalizeMinMax(values);

    return {
        kind: "bandCqt1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandCqtHarmonicEnergy",
        times: masked.times,
        values: normalized,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

/**
 * Compute bass pitch motion for a frequency band using CQT.
 *
 * Measures pitch movement in bass-range CQT bins within the band.
 * Most meaningful for bands overlapping the bass range (20-300 Hz).
 *
 * @param cqt - Source CQT spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band CQT result with bass pitch motion
 */
export function bandCqtBassPitchMotion(
    cqt: CqtSpectrogram,
    band: FrequencyBand,
    options?: BandCqtOptions
): BandCqt1DResult {
    const startMs = nowMs();

    // Apply band mask to CQT
    const masked = applyBandMaskToCqt(cqt, band, options);

    const nFrames = masked.times.length;

    // Bass range constants
    const BASS_MIN_HZ = 20;
    const BASS_MAX_HZ = 300;

    // Find bass bin range within band
    const bassStartBin = Math.max(0, Math.floor(hzToCqtBin(BASS_MIN_HZ, cqt.config)));
    const bassEndBin = Math.min(
        masked.binFrequencies.length,
        Math.ceil(hzToCqtBin(BASS_MAX_HZ, cqt.config))
    );
    const bassNumBins = bassEndBin - bassStartBin;

    if (bassNumBins <= 0) {
        // Band doesn't overlap bass range
        return {
            kind: "bandCqt1d",
            bandId: band.id,
            bandLabel: band.label,
            fn: "bandCqtBassPitchMotion",
            times: masked.times,
            values: new Float32Array(nFrames),
            meta: createMeta(startMs),
            diagnostics: {
                ...computeDiagnostics(masked.energyRetainedPerFrame),
                warnings: ["Band does not overlap bass frequency range (20-300 Hz)"],
            },
        };
    }

    // Compute bass centroid for each frame
    const centroids = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const frame = masked.magnitudes[t];
        if (!frame) continue;

        // Compute weighted centroid in bass range
        let num = 0;
        let den = 0;

        for (let k = bassStartBin; k < bassEndBin; k++) {
            const mag = frame[k] ?? 0;
            if (mag > 0) {
                num += k * mag;
                den += mag;
            }
        }

        centroids[t] = den > 0 ? num / den : bassStartBin + bassNumBins / 2;
    }

    // Compute motion as absolute difference between consecutive frames
    const motion = new Float32Array(nFrames);
    for (let t = 1; t < nFrames; t++) {
        motion[t] = Math.abs((centroids[t] ?? 0) - (centroids[t - 1] ?? 0));
    }
    if (nFrames > 1) {
        motion[0] = motion[1] ?? 0;
    }

    // Normalize to [0, 1]
    const normalized = normalizeMinMax(motion);

    return {
        kind: "bandCqt1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandCqtBassPitchMotion",
        times: masked.times,
        values: normalized,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

/**
 * Compute tonal stability for a frequency band using CQT.
 *
 * Measures consistency of chroma distribution over time within the band.
 * Adapted from cqtSignals.ts:tonalStability.
 *
 * @param cqt - Source CQT spectrogram
 * @param band - Frequency band to analyze
 * @param options - Computation options
 * @returns Band CQT result with tonal stability
 */
export function bandCqtTonalStability(
    cqt: CqtSpectrogram,
    band: FrequencyBand,
    options?: BandCqtOptions
): BandCqt1DResult {
    const startMs = nowMs();

    // Apply band mask to CQT
    const masked = applyBandMaskToCqt(cqt, band, options);

    const nFrames = masked.times.length;
    const CHROMA_BINS = 12;
    const WINDOW_FRAMES = 20; // ~500ms at typical hop sizes

    // Compute chroma for each frame
    const chromas: Float32Array[] = new Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const frame = masked.magnitudes[t];
        const chroma = new Float32Array(CHROMA_BINS);

        if (frame) {
            const binsPerSemitone = cqt.binsPerOctave / CHROMA_BINS;

            for (let k = 0; k < frame.length; k++) {
                const chromaBin = Math.floor((k % cqt.binsPerOctave) / binsPerSemitone) % CHROMA_BINS;
                const mag = frame[k] ?? 0;
                chroma[chromaBin] = (chroma[chromaBin] ?? 0) + mag * mag;
            }

            // Normalize
            let sum = 0;
            for (let c = 0; c < CHROMA_BINS; c++) {
                sum += chroma[c] ?? 0;
            }
            if (sum > 0) {
                for (let c = 0; c < CHROMA_BINS; c++) {
                    chroma[c] = (chroma[c] ?? 0) / sum;
                }
            }
        }

        chromas[t] = chroma;
    }

    // Compute stability over sliding window
    const halfWindow = Math.floor(WINDOW_FRAMES / 2);
    const instability = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const windowStart = Math.max(0, t - halfWindow);
        const windowEnd = Math.min(nFrames, t + halfWindow + 1);
        const windowSize = windowEnd - windowStart;

        // Average chroma over window
        const avgChroma = new Float32Array(CHROMA_BINS);
        for (let w = windowStart; w < windowEnd; w++) {
            const chroma = chromas[w];
            if (chroma) {
                for (let c = 0; c < CHROMA_BINS; c++) {
                    avgChroma[c] = (avgChroma[c] ?? 0) + (chroma[c] ?? 0);
                }
            }
        }
        for (let c = 0; c < CHROMA_BINS; c++) {
            avgChroma[c] = (avgChroma[c] ?? 0) / windowSize;
        }

        // Compute variance
        let totalVariance = 0;
        for (let w = windowStart; w < windowEnd; w++) {
            const chroma = chromas[w];
            if (chroma) {
                for (let c = 0; c < CHROMA_BINS; c++) {
                    const diff = (chroma[c] ?? 0) - (avgChroma[c] ?? 0);
                    totalVariance += diff * diff;
                }
            }
        }
        totalVariance /= windowSize * CHROMA_BINS;

        instability[t] = totalVariance;
    }

    // Normalize instability and invert to get stability
    const normalizedInstability = normalizeMinMax(instability);
    const stability = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
        stability[t] = 1 - (normalizedInstability[t] ?? 0);
    }

    return {
        kind: "bandCqt1d",
        bandId: band.id,
        bandLabel: band.label,
        fn: "bandCqtTonalStability",
        times: masked.times,
        values: stability,
        meta: createMeta(startMs),
        diagnostics: computeDiagnostics(masked.energyRetainedPerFrame),
    };
}

// ----------------------------
// Utility Functions
// ----------------------------

function normalizeMinMax(values: Float32Array): Float32Array {
    const n = values.length;
    if (n === 0) return new Float32Array(0);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
        const v = values[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
    }

    const out = new Float32Array(n);
    const range = max - min;

    if (range === 0 || !Number.isFinite(range)) {
        out.fill(0.5);
        return out;
    }

    for (let i = 0; i < n; i++) {
        out[i] = ((values[i] ?? 0) - min) / range;
    }

    return out;
}

// ----------------------------
// Batch Runner
// ----------------------------

export type BandCqtBatchRequest = {
    bands: FrequencyBand[];
    functions: BandCqtFunctionId[];
    /** Maximum number of bands to process concurrently. Default: 4 */
    maxConcurrent?: number;
};

export type BandCqtBatchResult = {
    /** Results keyed by bandId */
    results: Map<string, BandCqt1DResult[]>;
    /** Total computation time in ms */
    totalTimingMs: number;
};

/**
 * Run band CQT analysis for multiple bands.
 *
 * @param cqt - Source CQT spectrogram
 * @param request - Batch request specifying bands and functions
 * @param options - Computation options
 * @returns Map of results by band ID
 */
export async function runBandCqtBatch(
    cqt: CqtSpectrogram,
    request: BandCqtBatchRequest,
    options?: BandCqtOptions
): Promise<BandCqtBatchResult> {
    const startMs = nowMs();

    const results = new Map<string, BandCqt1DResult[]>();

    for (const band of request.bands) {
        if (options?.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        if (!band.enabled) continue;

        const bandResults: BandCqt1DResult[] = [];

        for (const fn of request.functions) {
            if (options?.isCancelled?.()) {
                throw new Error("@octoseq/mir: cancelled");
            }

            let result: BandCqt1DResult;

            switch (fn) {
                case "bandCqtHarmonicEnergy":
                    result = bandCqtHarmonicEnergy(cqt, band, options);
                    break;
                case "bandCqtBassPitchMotion":
                    result = bandCqtBassPitchMotion(cqt, band, options);
                    break;
                case "bandCqtTonalStability":
                    result = bandCqtTonalStability(cqt, band, options);
                    break;
                default:
                    // Exhaustive check
                    const _exhaustive: never = fn;
                    throw new Error(`Unknown band CQT function: ${_exhaustive}`);
            }

            bandResults.push(result);
        }

        results.set(band.id, bandResults);
    }

    const endMs = nowMs();

    return {
        results,
        totalTimingMs: endMs - startMs,
    };
}

/**
 * Get a human-readable label for a band CQT function.
 *
 * @param fn - Band CQT function ID
 * @returns Human-readable label
 */
export function getBandCqtFunctionLabel(fn: BandCqtFunctionId): string {
    switch (fn) {
        case "bandCqtHarmonicEnergy":
            return "Harmonic Energy (CQT)";
        case "bandCqtBassPitchMotion":
            return "Bass Pitch Motion (CQT)";
        case "bandCqtTonalStability":
            return "Tonal Stability (CQT)";
        default:
            return fn;
    }
}
