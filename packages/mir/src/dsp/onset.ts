import type { MirGPU } from "../gpu/context";
import { gpuOnsetEnvelopeFromMelFlat } from "../gpu/onsetEnvelope";

import type { MelSpectrogram } from "./mel";
import type { Spectrogram } from "./spectrogram";

export type OnsetEnvelope = {
    times: Float32Array;
    values: Float32Array;
};

export type OnsetEnvelopeOptions = {
    /** If true, log-compress magnitudes/energies before differencing. */
    useLog?: boolean;
    /** Moving-average smoothing window length in milliseconds. 0 disables smoothing. */
    smoothMs?: number;
    /** How to convert temporal differences into novelty. */
    diffMethod?: "rectified" | "abs";
};

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

function defaultOptions(opts?: OnsetEnvelopeOptions): Required<OnsetEnvelopeOptions> {
    return {
        useLog: opts?.useLog ?? false,
        smoothMs: opts?.smoothMs ?? 30,
        diffMethod: opts?.diffMethod ?? "rectified",
    };
}

function logCompress(x: number): number {
    // Stable compression without -Inf.
    // We use ln(1+x) so it behaves well for both linear mags and log-mel (already log10).
    return Math.log1p(Math.max(0, x));
}

export function onsetEnvelopeFromSpectrogram(spec: Spectrogram, options?: OnsetEnvelopeOptions): OnsetEnvelope {
    const opts = defaultOptions(options);

    const nFrames = spec.times.length;
    const out = new Float32Array(nFrames);

    const nBins = (spec.fftSize >>> 1) + 1;

    // First frame has no previous frame.
    out[0] = 0;

    for (let t = 1; t < nFrames; t++) {
        const cur = spec.magnitudes[t];
        const prev = spec.magnitudes[t - 1];
        if (!cur || !prev) {
            out[t] = 0;
            continue;
        }

        let sum = 0;
        for (let k = 0; k < nBins; k++) {
            let a = cur[k] ?? 0;
            let b = prev[k] ?? 0;
            if (opts.useLog) {
                a = logCompress(a);
                b = logCompress(b);
            }
            const d = a - b;
            sum += opts.diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
        }

        // Use an average over frequency bins so the overall scale is not tied to FFT size.
        out[t] = nBins > 0 ? sum / nBins : 0;
    }

    // Optional smoothing based on average frame spacing.
    const smoothMs = opts.smoothMs;
    if (smoothMs > 0 && nFrames >= 2) {
        const dt = (spec.times[1] ?? 0) - (spec.times[0] ?? 0);
        const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
        return {
            times: spec.times,
            values: movingAverage(out, windowFrames | 1),
        };
    }

    return { times: spec.times, values: out };
}

export function onsetEnvelopeFromMel(mel: MelSpectrogram, options?: OnsetEnvelopeOptions): OnsetEnvelope {
    const opts = defaultOptions(options);

    const nFrames = mel.times.length;
    const out = new Float32Array(nFrames);

    out[0] = 0;

    for (let t = 1; t < nFrames; t++) {
        const cur = mel.melBands[t];
        const prev = mel.melBands[t - 1];
        if (!cur || !prev) {
            out[t] = 0;
            continue;
        }

        const nBands = cur.length;

        let sum = 0;
        for (let m = 0; m < nBands; m++) {
            let a = cur[m] ?? 0;
            let b = prev[m] ?? 0;

            // Note: melSpectrogram currently outputs log10(eps + energy).
            // If useLog is requested, we apply an additional stable compression.
            if (opts.useLog) {
                a = logCompress(a);
                b = logCompress(b);
            }

            const d = a - b;
            sum += opts.diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
        }

        // Use an average over bands so the overall scale is not tied to nMels.
        out[t] = nBands > 0 ? sum / nBands : 0;
    }

    const smoothMs = opts.smoothMs;
    if (smoothMs > 0 && nFrames >= 2) {
        const dt = (mel.times[1] ?? 0) - (mel.times[0] ?? 0);
        const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
        return {
            times: mel.times,
            values: movingAverage(out, windowFrames | 1),
        };
    }

    return { times: mel.times, values: out };
}

export type OnsetEnvelopeGpuResult = {
    times: Float32Array;
    values: Float32Array;
    gpuTimings: { gpuSubmitToReadbackMs: number };
};

/**
 * GPU-accelerated onset envelope from mel spectrogram.
 *
 * Notes:
 * - This bypasses JS loops for the diff+reduction step.
 * - Smoothing/log options are intentionally limited for v0.1 (keeps WGSL simple).
 * - Callers should fall back to CPU on errors.
 */
export async function onsetEnvelopeFromMelGpu(
    mel: MelSpectrogram,
    gpu: MirGPU,
    options?: Pick<OnsetEnvelopeOptions, "diffMethod">
): Promise<OnsetEnvelopeGpuResult> {
    const nFrames = mel.times.length;
    const nMels = mel.melBands[0]?.length ?? 0;

    const melFlat = new Float32Array(nFrames * nMels);
    for (let t = 0; t < nFrames; t++) {
        const row = mel.melBands[t];
        if (!row) continue;
        melFlat.set(row, t * nMels);
    }

    const diffMethod = options?.diffMethod ?? "rectified";

    const { value, timing } = await gpuOnsetEnvelopeFromMelFlat(gpu, {
        nFrames,
        nMels,
        melFlat,
        diffMethod,
    });

    return {
        times: mel.times,
        values: value.out,
        gpuTimings: { gpuSubmitToReadbackMs: timing.gpuSubmitToReadbackMs },
    };
}
