import type { MelSpectrogram } from "./mel";
import type { OnsetEnvelope } from "./onset";
import { onsetEnvelopeFromMel } from "./onset";
import type { Spectrogram } from "./spectrogram";
import { spectralFlux } from "./spectral";
import type { BeatCandidate, BeatCandidateSource } from "../types";

/**
 * Configuration for beat candidate detection.
 */
export type BeatCandidatesOptions = {
    /** Minimum inter-candidate interval in seconds. Default: 0.1 (100ms). */
    minIntervalSec?: number;
    /** Threshold factor for adaptive peak detection. Lower = more candidates. Default: 0.5. */
    thresholdFactor?: number;
    /** Smoothing window for salience signal in ms. Default: 50. */
    smoothMs?: number;
};

/**
 * Result of beat candidate detection.
 */
export type BeatCandidatesOutput = {
    candidates: BeatCandidate[];
    /** The computed salience signal (for debugging/visualization). */
    salience: {
        times: Float32Array;
        values: Float32Array;
    };
};

/**
 * Compute a beat-oriented salience signal from mel spectrogram.
 *
 * This combines:
 * - Onset envelope (captures transients/attacks)
 * - Spectral flux from the underlying spectrogram (captures spectral change)
 *
 * The signals are normalized and combined to produce a single salience curve
 * suitable for peak picking.
 *
 * Key design choices:
 * - Whole-track normalization (z-score) for consistent behavior
 * - Gentle smoothing to suppress micro-transients while preserving beat structure
 * - No BPM inference or grid assumptions
 */
export type BeatSalienceSignal = {
    times: Float32Array;
    values: Float32Array;
};

function movingAverage(values: Float32Array, windowFrames: number): Float32Array {
    if (windowFrames <= 1) return values;

    const n = values.length;
    const out = new Float32Array(n);

    const half = Math.floor(windowFrames / 2);

    // Prefix sums for O(n) moving average.
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

function meanStd(values: Float32Array): { mean: number; std: number } {
    const n = values.length;
    if (n <= 0) return { mean: 0, std: 0 };

    let mean = 0;
    for (let i = 0; i < n; i++) mean += values[i] ?? 0;
    mean /= n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
        const d = (values[i] ?? 0) - mean;
        varSum += d * d;
    }

    const std = Math.sqrt(varSum / n);
    return { mean, std };
}

/**
 * Z-score normalize a signal (whole-track normalization).
 * Result has mean ~0 and std ~1.
 */
function zScoreNormalize(values: Float32Array): Float32Array {
    const { mean, std } = meanStd(values);
    const n = values.length;
    const out = new Float32Array(n);

    if (std === 0 || !Number.isFinite(std)) {
        // Degenerate case: all values are the same
        out.fill(0);
        return out;
    }

    for (let i = 0; i < n; i++) {
        out[i] = ((values[i] ?? 0) - mean) / std;
    }

    return out;
}

/**
 * Min-max normalize to [0, 1] range.
 */
function minMaxNormalize(values: Float32Array): Float32Array {
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

/**
 * Compute beat salience signal from mel spectrogram.
 *
 * This is an intermediate signal suitable for peak picking to extract
 * beat candidates. It combines onset envelope with additional smoothing
 * tuned for beat-like (rather than onset-like) detection.
 */
export function beatSalienceFromMel(
    mel: MelSpectrogram,
    spec: Spectrogram,
    options?: { smoothMs?: number }
): BeatSalienceSignal {
    const smoothMs = options?.smoothMs ?? 50;

    // Compute onset envelope with more smoothing than default onset detection.
    // We want to capture the "attack envelope" of beats, not individual onsets.
    const onset = onsetEnvelopeFromMel(mel, {
        smoothMs: smoothMs,
        diffMethod: "rectified",
        useLog: false,
    });

    // Compute spectral flux from the spectrogram.
    const flux = spectralFlux(spec);

    // Ensure times align (they should, but be defensive).
    const n = Math.min(onset.times.length, flux.length);

    // Z-score normalize both signals for equal contribution.
    const onsetNorm = zScoreNormalize(onset.values.subarray(0, n));
    const fluxNorm = zScoreNormalize(flux.subarray(0, n));

    // Combine: weighted sum favoring onset envelope (it's more beat-specific).
    const combined = new Float32Array(n);
    const onsetWeight = 0.7;
    const fluxWeight = 0.3;

    for (let i = 0; i < n; i++) {
        combined[i] = onsetWeight * (onsetNorm[i] ?? 0) + fluxWeight * (fluxNorm[i] ?? 0);
    }

    // Apply final smoothing to reduce micro-peaks.
    const dt = n >= 2 ? ((onset.times[1] ?? 0) - (onset.times[0] ?? 0)) : 0.01;
    const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / Math.max(1e-9, dt)));
    const smoothed = movingAverage(combined, windowFrames | 1);

    // Normalize to [0, 1] for consistent interpretation.
    const normalized = minMaxNormalize(smoothed);

    return {
        times: onset.times.subarray(0, n),
        values: normalized,
    };
}

/**
 * Pick peaks from the salience signal to extract beat candidates.
 *
 * Uses relaxed parameters to err on the side of too many candidates.
 * The goal is coverage, not precision.
 */
function pickBeatCandidates(
    salience: BeatSalienceSignal,
    options: BeatCandidatesOptions,
    source: BeatCandidateSource
): BeatCandidate[] {
    const minIntervalSec = options.minIntervalSec ?? 0.1;
    const thresholdFactor = options.thresholdFactor ?? 0.5;

    const { times, values } = salience;
    const n = values.length;

    if (n < 3) return [];

    // Compute adaptive threshold based on signal statistics.
    const { mean, std } = meanStd(values);
    // Low threshold to get dense candidates.
    // thresholdFactor of 0.5 means: mean + 0.5*std (quite low).
    const threshold = mean + thresholdFactor * std;

    const candidates: BeatCandidate[] = [];
    let lastPeakTime = -Infinity;

    for (let i = 1; i < n - 1; i++) {
        const v = values[i] ?? 0;

        // Must be above threshold.
        if (v < threshold) continue;

        // Must be a local maximum.
        const prev = values[i - 1] ?? 0;
        const next = values[i + 1] ?? 0;
        if (!(v > prev && v > next)) continue;

        const t = times[i] ?? 0;

        // Enforce minimum interval.
        if (t - lastPeakTime < minIntervalSec) {
            // If within interval, keep the stronger peak.
            const last = candidates[candidates.length - 1];
            if (last && v > last.strength) {
                last.time = t;
                last.strength = v;
            }
            continue;
        }

        candidates.push({
            time: t,
            strength: v,
            source,
        });
        lastPeakTime = t;
    }

    return candidates;
}

/**
 * Detect beat candidates from mel spectrogram and spectrogram.
 *
 * This is the main entry point for beat candidate detection.
 *
 * Design principles:
 * - Dense candidates (err on side of too many)
 * - No BPM inference
 * - No grid assumptions
 * - Whole-track normalization for consistency
 * - Deterministic (same input -> same output)
 */
export function detectBeatCandidates(
    mel: MelSpectrogram,
    spec: Spectrogram,
    options?: BeatCandidatesOptions
): BeatCandidatesOutput {
    const opts: BeatCandidatesOptions = {
        minIntervalSec: options?.minIntervalSec ?? 0.1,
        thresholdFactor: options?.thresholdFactor ?? 0.5,
        smoothMs: options?.smoothMs ?? 50,
    };

    // Compute beat salience signal.
    const salience = beatSalienceFromMel(mel, spec, { smoothMs: opts.smoothMs });

    // Pick peaks from salience.
    const candidates = pickBeatCandidates(salience, opts, "combined");

    return {
        candidates,
        salience,
    };
}
