/**
 * CQT-Derived 1D Signals for F5.
 *
 * These signals extract musically meaningful 1D features from the CQT representation:
 * - harmonicEnergy: Measures tonal presence vs noise
 * - bassPitchMotion: Measures bassline activity and low-end groove
 * - tonalStability: Measures harmonic stability vs modulation
 *
 * All signals are:
 * - 1D (one value per frame)
 * - Time-aligned with the CQT frames
 * - Deterministic
 * - Normalized to [0, 1] range
 */

import type { CqtSignalId, CqtSignalResult, CqtSpectrogram, MirRunMeta } from "../types";
import { cqtBinToHz, hzToCqtBin } from "./cqt";

// ----------------------------
// Configuration Constants
// ----------------------------

/** Bass frequency range for bassPitchMotion */
const BASS_MIN_HZ = 20;
const BASS_MAX_HZ = 300;

/** Window size for tonal stability analysis (in frames) */
const TONAL_STABILITY_WINDOW_FRAMES = 20; // ~500ms at typical hop sizes

/** Number of chroma bins (one per semitone) */
const CHROMA_BINS = 12;

// ----------------------------
// Utility Functions
// ----------------------------

/**
 * Normalize an array to [0, 1] range using min-max scaling.
 */
function normalizeMinMax(values: Float32Array): Float32Array {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < values.length; i++) {
        const v = values[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
    }

    const range = max - min;
    const result = new Float32Array(values.length);

    if (range > 0) {
        for (let i = 0; i < values.length; i++) {
            result[i] = ((values[i] ?? 0) - min) / range;
        }
    } else {
        // All values are the same - return 0.5
        result.fill(0.5);
    }

    return result;
}

/**
 * Compute the weighted centroid of an array.
 */
function weightedCentroid(values: Float32Array, startIndex: number = 0): number {
    let sumWeighted = 0;
    let sumWeights = 0;

    for (let i = 0; i < values.length; i++) {
        const weight = values[i] ?? 0;
        sumWeighted += (startIndex + i) * weight;
        sumWeights += weight;
    }

    return sumWeights > 0 ? sumWeighted / sumWeights : startIndex + values.length / 2;
}

/**
 * Compute variance of an array.
 */
function variance(values: Float32Array): number {
    if (values.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i] ?? 0;
    }
    const mean = sum / values.length;

    let sumSquaredDiff = 0;
    for (let i = 0; i < values.length; i++) {
        const diff = (values[i] ?? 0) - mean;
        sumSquaredDiff += diff * diff;
    }

    return sumSquaredDiff / values.length;
}

// ----------------------------
// Harmonic Energy
// ----------------------------

/**
 * Compute harmonic energy for a single CQT frame.
 *
 * Harmonic energy measures the ratio of energy concentrated at harmonic
 * intervals (integer multiples of a fundamental) vs total energy.
 *
 * Algorithm:
 * 1. Find the strongest bin as a candidate fundamental
 * 2. Sum energy at harmonic positions (2x, 3x, 4x, ... of fundamental)
 * 3. Divide by total energy
 *
 * High values indicate tonal/harmonic content; low values indicate noise.
 */
function computeHarmonicEnergyFrame(
    frame: Float32Array,
    cqt: CqtSpectrogram
): number {
    if (frame.length === 0) return 0;

    // Find total energy
    let totalEnergy = 0;
    for (let i = 0; i < frame.length; i++) {
        const mag = frame[i] ?? 0;
        totalEnergy += mag * mag;
    }

    if (totalEnergy === 0) return 0;

    // Find the strongest bin as fundamental candidate
    let maxMag = 0;
    let fundamentalBin = 0;
    for (let i = 0; i < frame.length; i++) {
        const mag = frame[i] ?? 0;
        if (mag > maxMag) {
            maxMag = mag;
            fundamentalBin = i;
        }
    }

    const fundamentalFreq = cqtBinToHz(fundamentalBin, cqt.config);

    // Sum energy at harmonic positions
    let harmonicEnergy = 0;
    const numHarmonics = 6; // Check first 6 harmonics

    for (let h = 1; h <= numHarmonics; h++) {
        const harmonicFreq = fundamentalFreq * h;
        const harmonicBin = Math.round(hzToCqtBin(harmonicFreq, cqt.config));

        if (harmonicBin >= 0 && harmonicBin < frame.length) {
            const mag = frame[harmonicBin] ?? 0;
            // Weight lower harmonics more heavily
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

    // Return ratio of harmonic to total energy
    return Math.min(1, harmonicEnergy / totalEnergy);
}

/**
 * Compute harmonic energy signal from CQT.
 *
 * Measures sustained, pitch-aligned energy across harmonic bins.
 * Intended to capture "tonal presence" vs noise.
 */
export function harmonicEnergy(cqt: CqtSpectrogram): CqtSignalResult {
    const startTime = performance.now();
    const nFrames = cqt.magnitudes.length;
    const values = new Float32Array(nFrames);

    for (let frame = 0; frame < nFrames; frame++) {
        const cqtFrame = cqt.magnitudes[frame];
        if (cqtFrame) {
            values[frame] = computeHarmonicEnergyFrame(cqtFrame, cqt);
        }
    }

    // Normalize to [0, 1]
    const normalized = normalizeMinMax(values);

    const endTime = performance.now();

    return {
        kind: "cqt1d",
        signalId: "harmonicEnergy",
        times: cqt.times,
        values: normalized,
        meta: {
            backend: "cpu",
            usedGpu: false,
            timings: {
                totalMs: endTime - startTime,
                cpuMs: endTime - startTime,
            },
        },
    };
}

// ----------------------------
// Bass Pitch Motion
// ----------------------------

/**
 * Compute bass pitch motion signal from CQT.
 *
 * Measures rate and magnitude of pitch movement in low-frequency CQT bins.
 * Intended to capture bassline motion, groove, and low-end activity.
 *
 * Algorithm:
 * 1. Extract bass-range bins from each frame
 * 2. Compute pitch centroid in bass range
 * 3. Compute absolute difference between consecutive frames
 */
export function bassPitchMotion(cqt: CqtSpectrogram): CqtSignalResult {
    const startTime = performance.now();
    const nFrames = cqt.magnitudes.length;

    // Find bass bin range
    const bassStartBin = Math.max(0, Math.floor(hzToCqtBin(BASS_MIN_HZ, cqt.config)));
    const bassEndBin = Math.min(
        cqt.magnitudes[0]?.length ?? 0,
        Math.ceil(hzToCqtBin(BASS_MAX_HZ, cqt.config))
    );
    const bassNumBins = bassEndBin - bassStartBin;

    if (bassNumBins <= 0) {
        // No bass bins available
        return {
            kind: "cqt1d",
            signalId: "bassPitchMotion",
            times: cqt.times,
            values: new Float32Array(nFrames),
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: { totalMs: 0, cpuMs: 0 },
            },
        };
    }

    // Compute bass centroid for each frame
    const centroids = new Float32Array(nFrames);

    for (let frame = 0; frame < nFrames; frame++) {
        const cqtFrame = cqt.magnitudes[frame];
        if (!cqtFrame) continue;

        // Extract bass bins
        const bassBins = new Float32Array(bassNumBins);
        for (let i = 0; i < bassNumBins; i++) {
            bassBins[i] = cqtFrame[bassStartBin + i] ?? 0;
        }

        // Compute weighted centroid
        centroids[frame] = weightedCentroid(bassBins, bassStartBin);
    }

    // Compute motion as absolute difference between consecutive frames
    const motion = new Float32Array(nFrames);
    for (let frame = 1; frame < nFrames; frame++) {
        motion[frame] = Math.abs((centroids[frame] ?? 0) - (centroids[frame - 1] ?? 0));
    }
    motion[0] = motion[1] ?? 0; // First frame has no previous

    // Normalize to [0, 1]
    const normalized = normalizeMinMax(motion);

    const endTime = performance.now();

    return {
        kind: "cqt1d",
        signalId: "bassPitchMotion",
        times: cqt.times,
        values: normalized,
        meta: {
            backend: "cpu",
            usedGpu: false,
            timings: {
                totalMs: endTime - startTime,
                cpuMs: endTime - startTime,
            },
        },
    };
}

// ----------------------------
// Tonal Stability
// ----------------------------

/**
 * Fold CQT bins into chroma (12 semitones).
 */
function computeChroma(frame: Float32Array, binsPerOctave: number): Float32Array {
    const chroma = new Float32Array(CHROMA_BINS);
    const binsPerSemitone = binsPerOctave / CHROMA_BINS;

    for (let i = 0; i < frame.length; i++) {
        // Map CQT bin to chroma bin
        const chromaBin = Math.floor((i % binsPerOctave) / binsPerSemitone) % CHROMA_BINS;
        const mag = frame[i] ?? 0;
        chroma[chromaBin] = (chroma[chromaBin] ?? 0) + mag * mag; // Energy
    }

    // Normalize
    let sum = 0;
    for (let i = 0; i < CHROMA_BINS; i++) {
        sum += chroma[i] ?? 0;
    }
    if (sum > 0) {
        for (let i = 0; i < CHROMA_BINS; i++) {
            chroma[i] = (chroma[i] ?? 0) / sum;
        }
    }

    return chroma;
}

/**
 * Compute tonal stability signal from CQT.
 *
 * Measures consistency of dominant pitch structure over time.
 * High values imply harmonic stability; low values imply modulation or noise.
 *
 * Algorithm:
 * 1. Compute chroma histogram for each frame
 * 2. Over a sliding window, compute variance of chroma distribution
 * 3. Low variance = stable tonality; high variance = unstable
 * 4. Invert so that high values = stable
 */
export function tonalStability(cqt: CqtSpectrogram): CqtSignalResult {
    const startTime = performance.now();
    const nFrames = cqt.magnitudes.length;

    // Compute chroma for each frame
    const chromas: Float32Array[] = new Array(nFrames);
    for (let frame = 0; frame < nFrames; frame++) {
        const cqtFrame = cqt.magnitudes[frame];
        if (cqtFrame) {
            chromas[frame] = computeChroma(cqtFrame, cqt.binsPerOctave);
        } else {
            chromas[frame] = new Float32Array(CHROMA_BINS);
        }
    }

    // Compute stability over sliding window
    const halfWindow = Math.floor(TONAL_STABILITY_WINDOW_FRAMES / 2);
    const instability = new Float32Array(nFrames);

    for (let frame = 0; frame < nFrames; frame++) {
        // Define window bounds
        const windowStart = Math.max(0, frame - halfWindow);
        const windowEnd = Math.min(nFrames, frame + halfWindow + 1);
        const windowSize = windowEnd - windowStart;

        // Compute average chroma over window
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

        // Compute variance of chroma values within window
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

        instability[frame] = totalVariance;
    }

    // Normalize instability to [0, 1]
    const normalizedInstability = normalizeMinMax(instability);

    // Invert to get stability (high stability = low variance)
    const stability = new Float32Array(nFrames);
    for (let frame = 0; frame < nFrames; frame++) {
        stability[frame] = 1 - (normalizedInstability[frame] ?? 0);
    }

    const endTime = performance.now();

    return {
        kind: "cqt1d",
        signalId: "tonalStability",
        times: cqt.times,
        values: stability,
        meta: {
            backend: "cpu",
            usedGpu: false,
            timings: {
                totalMs: endTime - startTime,
                cpuMs: endTime - startTime,
            },
        },
    };
}

// ----------------------------
// Unified Signal Computation
// ----------------------------

/**
 * Compute a CQT-derived signal by ID.
 */
export function computeCqtSignal(
    cqt: CqtSpectrogram,
    signalId: CqtSignalId
): CqtSignalResult {
    switch (signalId) {
        case "harmonicEnergy":
            return harmonicEnergy(cqt);
        case "bassPitchMotion":
            return bassPitchMotion(cqt);
        case "tonalStability":
            return tonalStability(cqt);
        default:
            throw new Error(`@octoseq/mir: unknown CQT signal ID: ${signalId}`);
    }
}

/**
 * Compute all CQT-derived signals.
 */
export function computeAllCqtSignals(
    cqt: CqtSpectrogram
): Map<CqtSignalId, CqtSignalResult> {
    const results = new Map<CqtSignalId, CqtSignalResult>();

    results.set("harmonicEnergy", harmonicEnergy(cqt));
    results.set("bassPitchMotion", bassPitchMotion(cqt));
    results.set("tonalStability", tonalStability(cqt));

    return results;
}
