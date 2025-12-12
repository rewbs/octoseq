import type { Spectrogram } from "./spectrogram";

export type SpectrogramLike2D = {
    times: Float32Array;
    bins: number;
    frames: number;
    magnitudes: Float32Array[]; // [frame][bin]
};

export type HpssOptions = {
    /** Median filter kernel size along time axis (frames). Must be odd. */
    timeMedian?: number;
    /** Median filter kernel size along frequency axis (bins). Must be odd. */
    freqMedian?: number;
    /** If true, use soft masks; else hard mask. */
    softMask?: boolean;
    /** Cancellation hook for long loops. */
    isCancelled?: () => boolean;
};

function assertOddPositiveInt(name: string, v: number): void {
    if (!Number.isFinite(v) || v <= 0 || (v | 0) !== v) {
        throw new Error(`@octoseq/mir: ${name} must be a positive integer`);
    }
    if (v % 2 !== 1) {
        throw new Error(`@octoseq/mir: ${name} must be odd`);
    }
}

function medianOfWindow(values: Float32Array): number {
    // Small-kernel median: copy + sort. CPU-heavy but fine for v0.1.
    // Isolated here so a future GPU / histogram-based median can replace it.
    const arr = Array.from(values);
    arr.sort((a, b) => a - b);
    const mid = arr.length >>> 1;
    return arr[mid] ?? 0;
}

function medianFilterTime(spec: Spectrogram, kTime: number, options: HpssOptions): Float32Array[] {
    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    const half = kTime >>> 1;
    const out: Float32Array[] = new Array(nFrames);

    const window = new Float32Array(kTime);

    for (let t = 0; t < nFrames; t++) {
        if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

        const row = new Float32Array(nBins);
        for (let k = 0; k < nBins; k++) {
            // Build temporal window for bin k.
            for (let i = -half, wi = 0; i <= half; i++, wi++) {
                const tt = Math.max(0, Math.min(nFrames - 1, t + i));
                const mags = spec.magnitudes[tt];
                window[wi] = mags ? (mags[k] ?? 0) : 0;
            }
            row[k] = medianOfWindow(window);
        }
        out[t] = row;
    }

    return out;
}

function medianFilterFreq(spec: Spectrogram, kFreq: number, options: HpssOptions): Float32Array[] {
    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    const half = kFreq >>> 1;
    const out: Float32Array[] = new Array(nFrames);

    const window = new Float32Array(kFreq);

    for (let t = 0; t < nFrames; t++) {
        if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

        const mags = spec.magnitudes[t] ?? new Float32Array(nBins);
        const row = new Float32Array(nBins);

        for (let k = 0; k < nBins; k++) {
            for (let i = -half, wi = 0; i <= half; i++, wi++) {
                const kk = Math.max(0, Math.min(nBins - 1, k + i));
                window[wi] = mags[kk] ?? 0;
            }
            row[k] = medianOfWindow(window);
        }

        out[t] = row;
    }

    return out;
}

export function hpss(spec: Spectrogram, options: HpssOptions = {}): { harmonic: SpectrogramLike2D; percussive: SpectrogramLike2D } {
    const timeMedian = options.timeMedian ?? 17;
    const freqMedian = options.freqMedian ?? 17;
    assertOddPositiveInt("options.timeMedian", timeMedian);
    assertOddPositiveInt("options.freqMedian", freqMedian);

    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    // Median along time -> harmonic estimate
    const H = medianFilterTime(spec, timeMedian, options);
    // Median along freq -> percussive estimate
    const P = medianFilterFreq(spec, freqMedian, options);

    const harmonic: Float32Array[] = new Array(nFrames);
    const percussive: Float32Array[] = new Array(nFrames);

    const soft = options.softMask ?? true;
    const eps = 1e-12;

    for (let t = 0; t < nFrames; t++) {
        if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

        const mags = spec.magnitudes[t] ?? new Float32Array(nBins);
        const hRow = H[t] ?? new Float32Array(nBins);
        const pRow = P[t] ?? new Float32Array(nBins);

        const outH = new Float32Array(nBins);
        const outP = new Float32Array(nBins);

        for (let k = 0; k < nBins; k++) {
            const x = mags[k] ?? 0;
            const h = hRow[k] ?? 0;
            const p = pRow[k] ?? 0;

            if (soft) {
                const denom = Math.max(eps, h + p);
                const mh = h / denom;
                const mp = p / denom;
                outH[k] = x * mh;
                outP[k] = x * mp;
            } else {
                const isH = h >= p;
                outH[k] = isH ? x : 0;
                outP[k] = isH ? 0 : x;
            }
        }

        harmonic[t] = outH;
        percussive[t] = outP;
    }

    return {
        harmonic: { times: spec.times, bins: nBins, frames: nFrames, magnitudes: harmonic },
        percussive: { times: spec.times, bins: nBins, frames: nFrames, magnitudes: percussive },
    };
}
