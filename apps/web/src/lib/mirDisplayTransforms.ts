import { clampDb, spectrogramToDb } from "@octoseq/mir";

export type Heatmap2D = Float32Array[]; // [frame][feature]

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Display-only: normalise a 2D array using a fixed (min,max) mapping.
 * Input is not mutated.
 */
export function normalise2dFixedRange(data2d: Heatmap2D, min: number, max: number): Heatmap2D {
    const out: Float32Array[] = new Array(data2d.length);
    const inv = max === min ? 0 : 1 / (max - min);

    for (let t = 0; t < data2d.length; t++) {
        const row = data2d[t] ?? new Float32Array(0);
        const n = row.length;
        const r = new Float32Array(n);
        for (let j = 0; j < n; j++) {
            const v = row[j] ?? 0;
            r[j] = clamp01((v - min) * inv);
        }
        out[t] = r;
    }

    return out;
}

/**
 * Display-only: hide (zero) the DC bin (bin 0).
 *
 * Why: DC energy often dominates magnitude spectrograms and compresses
 * visible structure into a few low bins once we log-scale.
 */
export function zeroDcBinForDisplay(magnitudes2d: Heatmap2D): Heatmap2D {
    const out: Float32Array[] = new Array(magnitudes2d.length);

    for (let t = 0; t < magnitudes2d.length; t++) {
        const row = magnitudes2d[t] ?? new Float32Array(0);
        const r = new Float32Array(row);
        if (r.length > 0) r[0] = 0;
        out[t] = r;
    }

    return out;
}

export type HpssDisplayOptions = {
    /** Apply dB conversion + clamping. On by default. */
    useDb?: boolean;
    /** Hide DC bin (bin 0) for display. On by default. */
    showDc?: boolean;
    /** Fixed clamp range for dB conversion. */
    minDb?: number;
    maxDb?: number;
};

/**
 * HPSS display pipeline:
 * linear magnitude -> (optional) dB -> clamp -> normalise to [0,1]
 *
 * Note: uses a *fixed* dB range so visuals are comparable across time windows and runs.
 */
export function prepareHpssSpectrogramForHeatmap(magnitudes2d: Heatmap2D, options: HpssDisplayOptions = {}): Heatmap2D {
    const useDb = options.useDb ?? true;
    const showDc = options.showDc ?? false;

    const minDb = options.minDb ?? -80;
    const maxDb = options.maxDb ?? 0;

    const mags = showDc ? magnitudes2d : zeroDcBinForDisplay(magnitudes2d);

    if (!useDb) {
        // Fallback: linear magnitude display. This is usually less legible than dB,
        // but can be useful for debugging.
        // We normalise to the visible fixed range of [0,1] using min=0 max=maxMag.
        let max = 0;
        for (let t = 0; t < mags.length; t++) {
            const row = mags[t];
            if (!row) continue;
            for (let j = 0; j < row.length; j++) max = Math.max(max, row[j] ?? 0);
        }
        return normalise2dFixedRange(mags, 0, max || 1);
    }

    const db = spectrogramToDb(mags);
    const clamped = clampDb(db, minDb, maxDb);

    // Map fixed dB range to [0,1]. (minDb -> 0, maxDb -> 1)
    return normalise2dFixedRange(clamped, minDb, maxDb);
}

export type MfccDisplayOptions = {
    /** Hide coefficient 0 (C0) in the heatmap. On by default. */
    showC0?: boolean;
};

/**
 * Display-only: per-coefficient normalisation for MFCC-like matrices.
 *
 * MFCC coefficients are DCT basis weights (not frequency bins), so we normalise
 * each coefficient independently across time to make temporal structure visible.
 */
export function prepareMfccForHeatmap(coeffs2d: Heatmap2D, options: MfccDisplayOptions = {}): Heatmap2D {
    const showC0 = options.showC0 ?? false;

    const nFrames = coeffs2d.length;
    const nCoeffs = coeffs2d[0]?.length ?? 0;

    // Min/max per coeff across all frames.
    // Note: this codebase enables `noUncheckedIndexedAccess`, so typed-array indexing is `number | undefined`.
    const min = new Float64Array(nCoeffs);
    const max = new Float64Array(nCoeffs);
    for (let c = 0; c < nCoeffs; c++) {
        min[c] = Infinity;
        max[c] = -Infinity;
    }

    for (let t = 0; t < nFrames; t++) {
        const row = coeffs2d[t];
        if (!row) continue;
        for (let c = 0; c < nCoeffs; c++) {
            const v = row[c] ?? 0;
            const curMin = min[c] ?? Infinity;
            const curMax = max[c] ?? -Infinity;
            if (v < curMin) min[c] = v;
            if (v > curMax) max[c] = v;
        }
    }

    const startCoeff = showC0 ? 0 : Math.min(1, nCoeffs);
    const outCoeffs = nCoeffs - startCoeff;
    const out: Float32Array[] = new Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const row = coeffs2d[t] ?? new Float32Array(nCoeffs);
        const r = new Float32Array(outCoeffs);

        for (let c = startCoeff; c < nCoeffs; c++) {
            const lo0 = min[c] ?? 0;
            const hi0 = max[c] ?? 1;
            const lo = Number.isFinite(lo0) ? lo0 : 0;
            const hi = Number.isFinite(hi0) ? hi0 : 1;
            const inv = hi === lo ? 0 : 1 / (hi - lo);
            r[c - startCoeff] = clamp01(((row[c] ?? 0) - lo) * inv);
        }

        out[t] = r;
    }

    return out;
}
