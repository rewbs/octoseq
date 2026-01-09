import type { MirGPU } from "../gpu/context";
import { gpuOnsetEnvelopeFromMelFlat } from "../gpu/onsetEnvelope";

import type { MelSpectrogram } from "./mel";
import type { Spectrogram } from "./spectrogram";
import type { SilenceGateConfig, BinGateConfig } from "./silenceGating";
import {
    computeFrameEnergyFromMel,
    computeFrameEnergyFromSpectrogram,
    computeSilenceGating,
    applySilenceGating,
    withSilenceGateDefaults,
    withBinGateDefaults,
    computeBinFloor,
} from "./silenceGating";

export type OnsetEnvelope = {
    times: Float32Array;
    values: Float32Array;
};

/**
 * Extended onset envelope result with optional debugging info.
 */
export type OnsetEnvelopeResult = OnsetEnvelope & {
    /**
     * Optional silence gating diagnostics.
     * Present when silenceGate.enabled is true and returnDiagnostics is true.
     */
    diagnostics?: OnsetDiagnostics;
};

/**
 * Diagnostics for inspecting onset detection behavior.
 */
export type OnsetDiagnostics = {
    /** Per-frame energy used for gating. */
    frameEnergy: Float32Array;
    /** Estimated noise floor. */
    noiseFloor: number;
    /** Threshold for entering active state. */
    enterThreshold: number;
    /** Threshold for exiting active state. */
    exitThreshold: number;
    /** Per-frame activity mask (1 = active, 0 = inactive). */
    activityMask: Uint8Array;
    /** Per-frame suppression mask (1 = suppressed, 0 = allowed). */
    suppressionMask: Uint8Array;
    /** Raw onset novelty before gating was applied. */
    rawNovelty: Float32Array;
};

export type OnsetEnvelopeOptions = {
    /** If true, log-compress magnitudes/energies before differencing. */
    useLog?: boolean;
    /** Moving-average smoothing window length in milliseconds. 0 disables smoothing. */
    smoothMs?: number;
    /** How to convert temporal differences into novelty. */
    diffMethod?: "rectified" | "abs";

    /**
     * Silence-aware gating configuration.
     * Suppresses false onsets in silence or near-silence regions.
     * @default { enabled: true }
     */
    silenceGate?: SilenceGateConfig;

    /**
     * Bin-level gating configuration (CPU paths only).
     * Ignores bins with energy below a relative threshold.
     * @default { enabled: true }
     */
    binGate?: BinGateConfig;

    /**
     * If true, include diagnostics in the result for debugging.
     * @default false
     */
    returnDiagnostics?: boolean;
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

type ResolvedOnsetOptions = {
    useLog: boolean;
    smoothMs: number;
    diffMethod: "rectified" | "abs";
    silenceGate: Required<SilenceGateConfig>;
    binGate: Required<BinGateConfig>;
    returnDiagnostics: boolean;
};

function resolveOptions(opts?: OnsetEnvelopeOptions): ResolvedOnsetOptions {
    return {
        useLog: opts?.useLog ?? false,
        smoothMs: opts?.smoothMs ?? 30,
        diffMethod: opts?.diffMethod ?? "rectified",
        silenceGate: withSilenceGateDefaults(opts?.silenceGate),
        binGate: withBinGateDefaults(opts?.binGate),
        returnDiagnostics: opts?.returnDiagnostics ?? false,
    };
}

function logCompress(x: number): number {
    // Stable compression without -Inf.
    // We use ln(1+x) so it behaves well for both linear mags and log-mel (already log10).
    return Math.log1p(Math.max(0, x));
}

/**
 * Compute onset envelope from spectrogram with silence-aware gating.
 *
 * The pipeline:
 * 1. Compute per-frame spectral flux (novelty)
 * 2. Compute per-frame energy from magnitudes
 * 3. Build activity mask using adaptive noise floor + hysteresis
 * 4. Apply silence gating and post-silence suppression
 * 5. Apply optional smoothing
 */
export function onsetEnvelopeFromSpectrogram(
    spec: Spectrogram,
    options?: OnsetEnvelopeOptions
): OnsetEnvelopeResult {
    const opts = resolveOptions(options);

    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    // Step 1: Compute raw onset novelty with optional bin gating
    const out = new Float32Array(nFrames);
    out[0] = 0;

    // Compute frame energies for bin gating (linear scale mean magnitude)
    const frameEnergies = opts.binGate.enabled
        ? computeFrameEnergyFromSpectrogram(spec.magnitudes, false)
        : null;

    for (let t = 1; t < nFrames; t++) {
        const cur = spec.magnitudes[t];
        const prev = spec.magnitudes[t - 1];
        if (!cur || !prev) {
            out[t] = 0;
            continue;
        }

        // Compute bin floor for this frame if bin gating enabled
        const binFloor = frameEnergies && opts.binGate.enabled
            ? computeBinFloor(frameEnergies[t] ?? 0, opts.binGate.binFloorRel)
            : 0;

        let sum = 0;
        let validBins = 0;

        for (let k = 0; k < nBins; k++) {
            let a = cur[k] ?? 0;
            let b = prev[k] ?? 0;

            // Bin-level gating: skip bins below the relative floor
            if (opts.binGate.enabled && a < binFloor && b < binFloor) {
                continue;
            }

            if (opts.useLog) {
                a = logCompress(a);
                b = logCompress(b);
            }
            const d = a - b;
            sum += opts.diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
            validBins++;
        }

        // Average over valid bins (or all bins if none were valid)
        out[t] = validBins > 0 ? sum / validBins : 0;
    }

    // Step 2: Compute frame energy for silence gating
    // For spectrograms, convert linear magnitudes to log scale for gating
    // (more perceptually relevant threshold behavior)
    const linearEnergy = computeFrameEnergyFromSpectrogram(spec.magnitudes, false);
    const frameEnergy = new Float32Array(nFrames);
    const eps = 1e-12;
    for (let t = 0; t < nFrames; t++) {
        frameEnergy[t] = Math.log10(eps + (linearEnergy[t] ?? 0));
    }

    // Step 3: Build silence gating masks
    const frameDurationSec = nFrames >= 2
        ? (spec.times[1] ?? 0) - (spec.times[0] ?? 0)
        : 0.01; // Default if not enough frames

    const gating = computeSilenceGating(frameEnergy, frameDurationSec, opts.silenceGate);

    // Store raw novelty for diagnostics before gating
    const rawNovelty = opts.returnDiagnostics ? Float32Array.from(out) : undefined;

    // Step 4: Apply silence gating
    if (opts.silenceGate.enabled) {
        applySilenceGating(out, gating.activityMask, gating.suppressionMask);
    }

    // Step 5: Optional smoothing
    let values: Float32Array = out;
    const smoothMs = opts.smoothMs;
    if (smoothMs > 0 && nFrames >= 2) {
        const dt = frameDurationSec;
        const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
        const smoothed = movingAverage(out, windowFrames | 1);
        values = new Float32Array(smoothed);
    }

    const result: OnsetEnvelopeResult = { times: spec.times, values };

    if (opts.returnDiagnostics && rawNovelty) {
        result.diagnostics = {
            frameEnergy,
            noiseFloor: gating.noiseFloor,
            enterThreshold: gating.enterThreshold,
            exitThreshold: gating.exitThreshold,
            activityMask: gating.activityMask,
            suppressionMask: gating.suppressionMask,
            rawNovelty,
        };
    }

    return result;
}

/**
 * Compute onset envelope from mel spectrogram with silence-aware gating.
 *
 * The pipeline:
 * 1. Compute per-frame mel flux (novelty)
 * 2. Compute per-frame energy from mel bands (already log scale)
 * 3. Build activity mask using adaptive noise floor + hysteresis
 * 4. Apply silence gating and post-silence suppression
 * 5. Apply optional smoothing
 */
export function onsetEnvelopeFromMel(
    mel: MelSpectrogram,
    options?: OnsetEnvelopeOptions
): OnsetEnvelopeResult {
    const opts = resolveOptions(options);

    const nFrames = mel.times.length;
    const out = new Float32Array(nFrames);

    out[0] = 0;

    // Compute frame energies for bin gating
    // For mel, bands are already log10 scale, so we can use them directly
    const melFrameEnergies = opts.binGate.enabled
        ? computeFrameEnergyFromMel(mel.melBands)
        : null;

    for (let t = 1; t < nFrames; t++) {
        const cur = mel.melBands[t];
        const prev = mel.melBands[t - 1];
        if (!cur || !prev) {
            out[t] = 0;
            continue;
        }

        const nBands = cur.length;

        // For mel-based bin gating, use 10^(energy) to get linear scale for floor comparison
        // Since mel bands are log10 values, binFloorRel makes more sense in linear space
        const frameEnergyLinear = melFrameEnergies
            ? Math.pow(10, melFrameEnergies[t] ?? -100)
            : 0;
        const binFloorLinear = opts.binGate.enabled
            ? computeBinFloor(frameEnergyLinear, opts.binGate.binFloorRel)
            : 0;

        let sum = 0;
        let validBands = 0;

        for (let m = 0; m < nBands; m++) {
            let a = cur[m] ?? 0;
            let b = prev[m] ?? 0;

            // For mel, values are log10 scale. Convert to linear for bin gating comparison
            if (opts.binGate.enabled) {
                const aLinear = Math.pow(10, a);
                const bLinear = Math.pow(10, b);
                if (aLinear < binFloorLinear && bLinear < binFloorLinear) {
                    continue;
                }
            }

            // Note: melSpectrogram currently outputs log10(eps + energy).
            // If useLog is requested, we apply an additional stable compression.
            if (opts.useLog) {
                a = logCompress(a);
                b = logCompress(b);
            }

            const d = a - b;
            sum += opts.diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
            validBands++;
        }

        // Average over valid bands
        out[t] = validBands > 0 ? sum / validBands : 0;
    }

    // Step 2: Compute frame energy for silence gating
    // Mel bands are already log10 scale - perfect for gating thresholds
    const frameEnergy = computeFrameEnergyFromMel(mel.melBands);

    // Step 3: Build silence gating masks
    const frameDurationSec = nFrames >= 2
        ? (mel.times[1] ?? 0) - (mel.times[0] ?? 0)
        : 0.01;

    const gating = computeSilenceGating(frameEnergy, frameDurationSec, opts.silenceGate);

    // Store raw novelty for diagnostics
    const rawNovelty = opts.returnDiagnostics ? Float32Array.from(out) : undefined;

    // Step 4: Apply silence gating
    if (opts.silenceGate.enabled) {
        applySilenceGating(out, gating.activityMask, gating.suppressionMask);
    }

    // Step 5: Optional smoothing
    let values: Float32Array = out;
    const smoothMs = opts.smoothMs;
    if (smoothMs > 0 && nFrames >= 2) {
        const dt = frameDurationSec;
        const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
        const smoothed = movingAverage(out, windowFrames | 1);
        values = new Float32Array(smoothed);
    }

    const result: OnsetEnvelopeResult = { times: mel.times, values };

    if (opts.returnDiagnostics && rawNovelty) {
        result.diagnostics = {
            frameEnergy,
            noiseFloor: gating.noiseFloor,
            enterThreshold: gating.enterThreshold,
            exitThreshold: gating.exitThreshold,
            activityMask: gating.activityMask,
            suppressionMask: gating.suppressionMask,
            rawNovelty,
        };
    }

    return result;
}

export type OnsetEnvelopeGpuResult = {
    times: Float32Array;
    values: Float32Array;
    gpuTimings: { gpuSubmitToReadbackMs: number };
    /** Optional silence gating diagnostics. */
    diagnostics?: OnsetDiagnostics;
};

/**
 * GPU-accelerated onset envelope from mel spectrogram with silence-aware gating.
 *
 * Notes:
 * - GPU kernel handles diff+reduction only (keeps WGSL simple)
 * - Silence gating is applied on CPU after GPU readback
 * - CPU and GPU paths produce comparable results
 * - Callers should fall back to CPU on errors
 */
export async function onsetEnvelopeFromMelGpu(
    mel: MelSpectrogram,
    gpu: MirGPU,
    options?: Pick<OnsetEnvelopeOptions, "diffMethod" | "silenceGate" | "returnDiagnostics" | "smoothMs">
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
    const silenceGateConfig = withSilenceGateDefaults(options?.silenceGate);
    const returnDiagnostics = options?.returnDiagnostics ?? false;
    const smoothMs = options?.smoothMs ?? 30;

    // Run GPU kernel for diff + reduction
    const { value, timing } = await gpuOnsetEnvelopeFromMelFlat(gpu, {
        nFrames,
        nMels,
        melFlat,
        diffMethod,
    });

    // Copy GPU output to allow modification
    const out = Float32Array.from(value.out);

    // Store raw novelty for diagnostics before gating
    const rawNovelty = returnDiagnostics ? Float32Array.from(out) : undefined;

    // Apply silence gating on CPU
    const frameEnergy = computeFrameEnergyFromMel(mel.melBands);
    const frameDurationSec = nFrames >= 2
        ? (mel.times[1] ?? 0) - (mel.times[0] ?? 0)
        : 0.01;

    const gating = computeSilenceGating(frameEnergy, frameDurationSec, silenceGateConfig);

    if (silenceGateConfig.enabled) {
        applySilenceGating(out, gating.activityMask, gating.suppressionMask);
    }

    // Apply optional smoothing
    let values: Float32Array = out;
    if (smoothMs > 0 && nFrames >= 2) {
        const dt = frameDurationSec;
        const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
        const smoothed = movingAverage(out, windowFrames | 1);
        values = new Float32Array(smoothed);
    }

    const result: OnsetEnvelopeGpuResult = {
        times: mel.times,
        values,
        gpuTimings: { gpuSubmitToReadbackMs: timing.gpuSubmitToReadbackMs },
    };

    if (returnDiagnostics && rawNovelty) {
        result.diagnostics = {
            frameEnergy,
            noiseFloor: gating.noiseFloor,
            enterThreshold: gating.enterThreshold,
            exitThreshold: gating.exitThreshold,
            activityMask: gating.activityMask,
            suppressionMask: gating.suppressionMask,
            rawNovelty,
        };
    }

    return result;
}

// Re-export types for convenience
export type { SilenceGateConfig, BinGateConfig, SilenceGateResult } from "./silenceGating";
