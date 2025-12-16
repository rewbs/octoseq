import type { MelSpectrogram } from "../dsp/mel";
import type { Features2D } from "../dsp/mfcc";
import { peakPick } from "../dsp/peakPick";

export type MirFingerprintV1 = {
    version: "v1";

    /** Query window time bounds (seconds) – informational/debug only. */
    t0: number;
    t1: number;

    // A) Mel-spectrogram statistics
    mel: {
        /** Mean mel vector across frames (unit-normalised to reduce loudness dependence). */
        mean: Float32Array;
        /** Variance mel vector across frames (after the same normalisation). */
        variance: Float32Array;
    };

    // B) Transient/activity statistics
    onset: {
        mean: number;
        max: number;
        /** Peaks per second, computed using peakPick() on the onset envelope. */
        peakDensityHz: number;
    };

    // Optional: MFCC statistics (coeffs 1–12, exclude C0)
    mfcc?: {
        mean: Float32Array;
        variance: Float32Array;
    };
};

export type FingerprintFrameWindow = {
    startFrame: number;
    endFrameExclusive: number;
};

function l2Norm(v: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
        const x = v[i] ?? 0;
        sum += x * x;
    }
    return Math.sqrt(sum);
}

function normaliseL2(v: Float32Array, eps = 1e-12): Float32Array {
    const n = l2Norm(v);
    const out = new Float32Array(v.length);
    const d = n > eps ? n : 1;
    for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / d;
    return out;
}

function meanVariance(
    frames: Float32Array[],
    start: number,
    endExclusive: number,
    dimHint = 0
): { mean: Float32Array; variance: Float32Array } {
    const nFrames = Math.max(0, endExclusive - start);

    // Handle empty window deterministically.
    const first = frames[start];
    const dim = first ? first.length : dimHint;

    const mean = new Float32Array(dim);
    const variance = new Float32Array(dim);

    if (nFrames <= 0 || dim <= 0) return { mean, variance };

    // Mean
    for (let t = start; t < endExclusive; t++) {
        const f = frames[t];
        if (!f) continue;
        for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) + (f[i] ?? 0);
    }
    for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) / nFrames;

    // Variance
    for (let t = start; t < endExclusive; t++) {
        const f = frames[t];
        if (!f) continue;
        for (let i = 0; i < dim; i++) {
            const d = (f[i] ?? 0) - (mean[i] ?? 0);
            variance[i] = (variance[i] ?? 0) + d * d;
        }
    }
    for (let i = 0; i < dim; i++) variance[i] = (variance[i] ?? 0) / nFrames;

    return { mean, variance };
}

function findFrameWindow(times: Float32Array, t0: number, t1: number): FingerprintFrameWindow {
    // times are frame-center times; we include frames where t is within [t0,t1].
    // Deterministic linear scan (arrays are typically not huge).
    let start = 0;
    while (start < times.length && (times[start] ?? 0) < t0) start++;

    let end = start;
    while (end < times.length && (times[end] ?? 0) <= t1) end++;

    return { startFrame: start, endFrameExclusive: Math.max(start, end) };
}

/**
 * Compute a deterministic v1 fingerprint for a time region [t0, t1].
 *
 * Loudness independence:
 * - Mel frames are L2-normalised per-frame before statistics.
 * - MFCC frames are L2-normalised per-frame before statistics.
 *
 * This is intentionally simple + deterministic (no ML, no DTW).
 */
export function fingerprintV1(params: {
    t0: number;
    t1: number;
    mel: MelSpectrogram;
    onsetEnvelope: { times: Float32Array; values: Float32Array };
    mfcc?: Features2D; // { times, values: Float32Array[] }
    peakPick?: {
        minIntervalSec?: number;
        threshold?: number;
        adaptiveFactor?: number;
    };
}): MirFingerprintV1 {
    const { t0, t1, mel, onsetEnvelope, mfcc } = params;

    const tt0 = Math.min(t0, t1);
    const tt1 = Math.max(t0, t1);
    const dur = Math.max(1e-6, tt1 - tt0);

    const melDimHint = mel.melBands.find((f) => f?.length)?.length ?? 0;

    // --- Mel stats
    const melWindow = findFrameWindow(mel.times, tt0, tt1);
    const melFramesNorm: Float32Array[] = [];
    for (let i = melWindow.startFrame; i < melWindow.endFrameExclusive; i++) {
        const f = mel.melBands[i] ?? new Float32Array(0);
        melFramesNorm.push(normaliseL2(f));
    }
    const melStats = meanVariance(melFramesNorm, 0, melFramesNorm.length, melDimHint);

    // --- Onset stats (1D)
    // NOTE: onsetEnvelope times should align with mel.times (as computed today), but
    // we don't assume perfect equality; we window by time.
    let onsetSum = 0;
    let onsetMax = -Infinity;
    let onsetN = 0;
    for (let i = 0; i < onsetEnvelope.times.length; i++) {
        const t = onsetEnvelope.times[i] ?? 0;
        if (t < tt0 || t > tt1) continue;
        const v = onsetEnvelope.values[i] ?? 0;
        onsetSum += v;
        onsetN++;
        if (v > onsetMax) onsetMax = v;
    }
    const onsetMean = onsetN > 0 ? onsetSum / onsetN : 0;
    const onsetMaxSafe = Number.isFinite(onsetMax) ? onsetMax : 0;

    // Peaks per second
    const peaks = peakPick(onsetEnvelope.times, onsetEnvelope.values, {
        minIntervalSec: params.peakPick?.minIntervalSec,
        threshold: params.peakPick?.threshold,
        adaptive: params.peakPick?.adaptiveFactor
            ? { method: "meanStd", factor: params.peakPick.adaptiveFactor }
            : undefined,
        strict: true,
    });
    const peaksInWindow = peaks.filter((p) => p.time >= tt0 && p.time <= tt1);
    const peakDensityHz = peaksInWindow.length / dur;

    // --- Optional MFCC (coeffs 1..12)
    let mfccStats: MirFingerprintV1["mfcc"] | undefined;
    const mfccDimHint = mfcc?.values.find((f) => f?.length)?.length ?? 0;

    if (mfcc) {
        const mfccWindow = findFrameWindow(mfcc.times, tt0, tt1);

        // Exclude C0 and clamp to 1..12 inclusive.
        const mfccFramesNorm: Float32Array[] = [];
        for (let i = mfccWindow.startFrame; i < mfccWindow.endFrameExclusive; i++) {
            const full = mfcc.values[i] ?? new Float32Array(0);
            const start = Math.min(1, full.length);
            const end = Math.min(13, full.length); // up to coeff 12 => index 12 => slice end 13
            const slice = full.subarray(start, end);
            mfccFramesNorm.push(normaliseL2(slice));
        }
        const s = meanVariance(mfccFramesNorm, 0, mfccFramesNorm.length, mfccDimHint ? Math.max(0, mfccDimHint - 1) : 0);
        mfccStats = { mean: s.mean, variance: s.variance };
    }

    return {
        version: "v1",
        t0: tt0,
        t1: tt1,
        mel: {
            mean: melStats.mean,
            variance: melStats.variance,
        },
        onset: {
            mean: onsetMean,
            max: onsetMaxSafe,
            peakDensityHz,
        },
        ...(mfccStats ? { mfcc: mfccStats } : {}),
    };
}
