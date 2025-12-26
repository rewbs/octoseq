import type { MirGPU } from "../gpu/context";
import { gpuMelProjectFlat } from "../gpu/melProject";

import type { Spectrogram } from "./spectrogram";

export type MelConfig = {
    nMels: number;
    fMin?: number;
    fMax?: number;
};

export type MelSpectrogram = {
    times: Float32Array;
    melBands: Float32Array[]; // [frame][mel]
    /** Optional observability. Present when GPU path runs. */
    gpuTimings?: {
        gpuSubmitToReadbackMs: number;
    };
};

function assertPositiveInt(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0 || (value | 0) !== value) {
        throw new Error(`@octoseq/mir: ${name} must be a positive integer`);
    }
}

/**
 * Convert frequency in Hz to mel scale.
 * Uses Slaney-style (HTK-like) approximation.
 */
export function hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Convert mel scale value to frequency in Hz.
 * Inverse of hzToMel.
 */
export function melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Configuration for mel frequency conversions.
 */
export type MelConversionConfig = {
    nMels: number;
    fMin: number;
    fMax: number;
};

/**
 * Convert a frequency in Hz to a feature index (0 to nMels-1).
 * The mapping is linear in mel space.
 *
 * @param hz - Frequency in Hz
 * @param config - Mel configuration with nMels, fMin, fMax
 * @returns Feature index as a continuous value (may be fractional)
 */
export function hzToFeatureIndex(hz: number, config: MelConversionConfig): number {
    const melMin = hzToMel(config.fMin);
    const melMax = hzToMel(config.fMax);
    const melHz = hzToMel(hz);

    // Map mel value to 0..1 range, then to 0..(nMels-1)
    const normalized = (melHz - melMin) / (melMax - melMin);
    return normalized * (config.nMels - 1);
}

/**
 * Convert a feature index (0 to nMels-1) to frequency in Hz.
 * Inverse of hzToFeatureIndex.
 *
 * @param index - Feature index (can be fractional)
 * @param config - Mel configuration with nMels, fMin, fMax
 * @returns Frequency in Hz
 */
export function featureIndexToHz(index: number, config: MelConversionConfig): number {
    const melMin = hzToMel(config.fMin);
    const melMax = hzToMel(config.fMax);

    // Map index from 0..(nMels-1) to mel space
    const normalized = index / (config.nMels - 1);
    const mel = melMin + normalized * (melMax - melMin);

    return melToHz(mel);
}

function buildMelFilterBank(
    sampleRate: number,
    fftSize: number,
    nMels: number,
    fMin: number,
    fMax: number
): Float32Array[] {
    const nBins = (fftSize >>> 1) + 1;
    const nyquist = sampleRate / 2;

    const fMinClamped = Math.max(0, Math.min(fMin, nyquist));
    const fMaxClamped = Math.max(0, Math.min(fMax, nyquist));
    if (fMaxClamped <= fMinClamped) {
        throw new Error("@octoseq/mir: mel fMax must be > fMin");
    }

    // We create nMels triangular filters defined by nMels+2 mel points.
    const melMin = hzToMel(fMinClamped);
    const melMax = hzToMel(fMaxClamped);

    const melPoints = new Float32Array(nMels + 2);
    for (let i = 0; i < melPoints.length; i++) {
        melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
    }

    const hzPoints = new Float32Array(melPoints.length);
    for (let i = 0; i < hzPoints.length; i++) hzPoints[i] = melToHz(melPoints[i] ?? 0);

    const binHz = sampleRate / fftSize;
    const binPoints = new Int32Array(hzPoints.length);
    for (let i = 0; i < binPoints.length; i++) {
        binPoints[i] = Math.max(0, Math.min(nBins - 1, Math.round((hzPoints[i] ?? 0) / binHz)));
    }

    const filters: Float32Array[] = new Array(nMels);
    for (let m = 0; m < nMels; m++) {
        const left = binPoints[m] ?? 0;
        const center = binPoints[m + 1] ?? 0;
        const right = binPoints[m + 2] ?? 0;

        const w = new Float32Array(nBins);
        if (center === left || right === center) {
            filters[m] = w;
            continue;
        }

        for (let k = left; k < center; k++) {
            w[k] = (k - left) / (center - left);
        }
        for (let k = center; k < right; k++) {
            w[k] = (right - k) / (right - center);
        }

        filters[m] = w;
    }

    return filters;
}

function cpuMelProject(
    spec: Spectrogram,
    filters: Float32Array[]
): MelSpectrogram {
    const nFrames = spec.times.length;
    const nMels = filters.length;
    const out: Float32Array[] = new Array(nFrames);

    const eps = 1e-12;

    for (let t = 0; t < nFrames; t++) {
        const mags = spec.magnitudes[t];
        if (!mags) {
            out[t] = new Float32Array(nMels);
            continue;
        }

        const bands = new Float32Array(nMels);
        for (let m = 0; m < nMels; m++) {
            const w = filters[m];
            if (!w) continue;

            let sum = 0;
            // Project linear magnitudes onto mel filters.
            for (let k = 0; k < mags.length; k++) {
                sum += (mags[k] ?? 0) * (w[k] ?? 0);
            }

            // Log scaling for visualisation / downstream features.
            bands[m] = Math.log10(eps + sum);
        }
        out[t] = bands;
    }

    return {
        times: spec.times,
        melBands: out
    };
}

async function gpuMelProject(
    spec: Spectrogram,
    filters: Float32Array[],
    gpu: MirGPU
): Promise<MelSpectrogram> {
    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;
    const nMels = filters.length;

    const magsFlat = new Float32Array(nFrames * nBins);
    for (let t = 0; t < nFrames; t++) {
        const mags = spec.magnitudes[t];
        if (!mags) continue;
        magsFlat.set(mags, t * nBins);
    }

    const filterFlat = new Float32Array(nMels * nBins);
    for (let m = 0; m < nMels; m++) {
        filterFlat.set(filters[m] ?? new Float32Array(nBins), m * nBins);
    }

    // GPU stage timing (submission -> readback) is surfaced for validation/debug.
    const { value, timing } = await gpuMelProjectFlat(gpu, {
        nFrames,
        nBins,
        nMels,
        magsFlat,
        filterFlat,
    });

    const outFlat = value.outFlat;

    const melBands: Float32Array[] = new Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
        // Keep zero-copy views into the single flat buffer.
        melBands[t] = outFlat.subarray(t * nMels, (t + 1) * nMels);
    }

    return {
        times: spec.times,
        melBands,
        gpuTimings: {
            gpuSubmitToReadbackMs: timing.gpuSubmitToReadbackMs,
        },
    };
}

/**
 * Compute a (log) mel spectrogram by projecting an existing spectrogram.
 *
 * Design rule compliance:
 * - The caller provides the spectrogram (we do not hide STFT internally).
 * - Output is aligned to `spec.times`.
 */
export async function melSpectrogram(
    spec: Spectrogram,
    config: MelConfig,
    gpu?: MirGPU
): Promise<MelSpectrogram> {
    assertPositiveInt("config.nMels", config.nMels);

    const fMin = config.fMin ?? 0;
    const fMax = config.fMax ?? spec.sampleRate / 2;

    const filters = buildMelFilterBank(
        spec.sampleRate,
        spec.fftSize,
        config.nMels,
        fMin,
        fMax
    );

    if (gpu) {
        // Try GPU; if anything goes wrong, fall back to CPU.
        try {
            return await gpuMelProject(spec, filters, gpu);
        } catch {
            // GPU can fail due to missing features, adapter resets, etc.
            // v0.1 prioritises correctness: we silently fall back.
            return cpuMelProject(spec, filters);
        }
    }

    return cpuMelProject(spec, filters);
}
