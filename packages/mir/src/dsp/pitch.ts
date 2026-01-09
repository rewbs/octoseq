/**
 * YIN-based monophonic pitch detection.
 *
 * Implements the YIN algorithm for fundamental frequency (f0) estimation.
 * Designed for monophonic sources: vocals, bass, lead synths.
 *
 * Reference: de Cheveigné, A., & Kawahara, H. (2002).
 * "YIN, a fundamental frequency estimator for speech and music."
 * Journal of the Acoustical Society of America, 111(4), 1917-1930.
 */

import type { ActivitySignal } from "./activity";
import { interpolateActivity } from "./activity";

/** Options for activity gating in pitch detection */
export type PitchActivityOptions = {
    /** Pre-computed activity signal to use for gating */
    activity?: ActivitySignal;
    /** How to handle inactive frames. Default: "zero" */
    inactiveBehavior?: "zero" | "hold";
};

export type PitchConfig = {
    /** Minimum detectable frequency in Hz. Default: 50 */
    fMinHz?: number;
    /** Maximum detectable frequency in Hz. Default: 1000 */
    fMaxHz?: number;
    /** Hop size in samples (determines time resolution). Default: 512 */
    hopSize?: number;
    /** Window size for analysis. Default: 2048 */
    windowSize?: number;
    /** YIN threshold for voiced detection (0-1). Default: 0.15 */
    threshold?: number;
    /** Activity gating options */
    activityOptions?: PitchActivityOptions;
};

export type PitchResult = {
    times: Float32Array;
    values: Float32Array;
};

/**
 * Extract fundamental frequency (f0) from mono audio.
 *
 * Uses the YIN algorithm for robust pitch detection.
 * Returns 0 Hz for unvoiced/silent frames.
 *
 * @param samples - Mono audio samples
 * @param sampleRate - Sample rate of the audio
 * @param config - Configuration options
 * @returns Times (seconds) and f0 values (Hz, 0 for unvoiced)
 */
export function pitchF0(
    samples: Float32Array,
    sampleRate: number,
    config?: PitchConfig
): PitchResult {
    const result = yinPitchDetection(samples, sampleRate, config);
    const f0 = result.f0;

    // Apply activity gating if provided
    const activityOpts = config?.activityOptions;
    if (activityOpts?.activity) {
        const activity = interpolateActivity(activityOpts.activity, result.times);
        const behavior = activityOpts.inactiveBehavior ?? "zero";

        let lastActiveValue = 0;
        for (let i = 0; i < f0.length; i++) {
            if (!activity.isActive[i]) {
                if (behavior === "zero") {
                    f0[i] = 0;
                } else {
                    // hold: keep last active value
                    f0[i] = lastActiveValue;
                }
            } else {
                lastActiveValue = f0[i] ?? 0;
            }
        }
    }

    return {
        times: result.times,
        values: f0,
    };
}

/**
 * Extract pitch detection confidence from mono audio.
 *
 * Uses the YIN algorithm's aperiodicity measure.
 * Returns values in [0, 1] where 1 = highly periodic (confident pitch).
 *
 * @param samples - Mono audio samples
 * @param sampleRate - Sample rate of the audio
 * @param config - Configuration options
 * @returns Times (seconds) and confidence values (0-1)
 */
export function pitchConfidence(
    samples: Float32Array,
    sampleRate: number,
    config?: PitchConfig
): PitchResult {
    const result = yinPitchDetection(samples, sampleRate, config);
    const confidence = result.confidence;

    // Apply activity gating if provided
    const activityOpts = config?.activityOptions;
    if (activityOpts?.activity) {
        const activity = interpolateActivity(activityOpts.activity, result.times);
        const behavior = activityOpts.inactiveBehavior ?? "zero";

        let lastActiveValue = 0;
        for (let i = 0; i < confidence.length; i++) {
            if (!activity.isActive[i]) {
                if (behavior === "zero") {
                    confidence[i] = 0;
                } else {
                    // hold: keep last active value
                    confidence[i] = lastActiveValue;
                }
            } else {
                lastActiveValue = confidence[i] ?? 0;
            }
        }
    }

    return {
        times: result.times,
        values: confidence,
    };
}

// Internal result type with both f0 and confidence
type YinResult = {
    times: Float32Array;
    f0: Float32Array;
    confidence: Float32Array;
};

/**
 * Core YIN pitch detection algorithm.
 *
 * Computes both f0 and confidence in a single pass.
 */
function yinPitchDetection(
    samples: Float32Array,
    sampleRate: number,
    config?: PitchConfig
): YinResult {
    const fMinHz = config?.fMinHz ?? 50;
    const fMaxHz = config?.fMaxHz ?? 1000;
    const hopSize = config?.hopSize ?? 512;
    const windowSize = config?.windowSize ?? 2048;
    const threshold = config?.threshold ?? 0.15;

    // Convert frequency limits to lag limits
    // tau_max corresponds to fMin, tau_min corresponds to fMax
    const tauMin = Math.max(2, Math.floor(sampleRate / fMaxHz));
    const tauMax = Math.min(windowSize / 2, Math.ceil(sampleRate / fMinHz));

    // Number of frames
    const nFrames = Math.max(0, Math.floor((samples.length - windowSize) / hopSize) + 1);

    const times = new Float32Array(nFrames);
    const f0 = new Float32Array(nFrames);
    const confidence = new Float32Array(nFrames);

    // Working buffers (reused across frames)
    const d = new Float32Array(tauMax + 1); // Difference function
    const dPrime = new Float32Array(tauMax + 1); // Cumulative mean normalized difference

    for (let frame = 0; frame < nFrames; frame++) {
        const start = frame * hopSize;
        const frameCenter = start + windowSize / 2;
        times[frame] = frameCenter / sampleRate;

        // Extract frame
        const frameEnd = Math.min(start + windowSize, samples.length);
        const frameLen = frameEnd - start;

        // Check for silence (avoid division by zero and false detections)
        let energy = 0;
        for (let i = 0; i < frameLen; i++) {
            const s = samples[start + i] ?? 0;
            energy += s * s;
        }
        const rms = Math.sqrt(energy / frameLen);

        if (rms < 1e-6) {
            // Silence: unvoiced with zero confidence
            f0[frame] = 0;
            confidence[frame] = 0;
            continue;
        }

        // Step 1: Compute difference function d(tau)
        // d(tau) = sum_{j=0}^{W-1-tau} (x[j] - x[j+tau])^2
        d[0] = 0;
        for (let tau = 1; tau <= tauMax && tau < frameLen; tau++) {
            let sum = 0;
            const limit = Math.min(frameLen - tau, windowSize - tau);
            for (let j = 0; j < limit; j++) {
                const diff = (samples[start + j] ?? 0) - (samples[start + j + tau] ?? 0);
                sum += diff * diff;
            }
            d[tau] = sum;
        }

        // Step 2: Compute cumulative mean normalized difference d'(tau)
        // d'(tau) = d(tau) / ((1/tau) * sum_{j=1}^{tau} d(j))
        dPrime[0] = 1;
        let runningSum = 0;
        for (let tau = 1; tau <= tauMax && tau < frameLen; tau++) {
            const dVal = d[tau] ?? 0;
            runningSum += dVal;
            if (runningSum > 0) {
                dPrime[tau] = dVal * tau / runningSum;
            } else {
                dPrime[tau] = 1;
            }
        }

        // Step 3: Absolute threshold search
        // Find first tau where d'(tau) < threshold, starting from tauMin
        let bestTau = -1;
        let bestDPrime = 1;

        for (let tau = tauMin; tau <= tauMax && tau < frameLen - 1; tau++) {
            const dPrimeVal = dPrime[tau] ?? 1;
            if (dPrimeVal < threshold) {
                // Found a candidate - look for local minimum
                while (tau + 1 <= tauMax && tau + 1 < frameLen - 1 && (dPrime[tau + 1] ?? 1) < (dPrime[tau] ?? 1)) {
                    tau++;
                }
                bestTau = tau;
                bestDPrime = dPrime[tau] ?? 1;
                break;
            }
        }

        // If no tau found below threshold, find global minimum in range
        if (bestTau < 0) {
            for (let tau = tauMin; tau <= tauMax && tau < frameLen; tau++) {
                const dPrimeVal = dPrime[tau] ?? 1;
                if (dPrimeVal < bestDPrime) {
                    bestDPrime = dPrimeVal;
                    bestTau = tau;
                }
            }
        }

        // Step 4: Parabolic interpolation for sub-sample precision
        if (bestTau > tauMin && bestTau < tauMax - 1 && bestTau < frameLen - 1) {
            const y0 = dPrime[bestTau - 1] ?? 1;
            const y1 = dPrime[bestTau] ?? 1;
            const y2 = dPrime[bestTau + 1] ?? 1;

            // Parabolic interpolation: find vertex of parabola through 3 points
            const denom = 2 * (2 * y1 - y0 - y2);
            if (Math.abs(denom) > 1e-10) {
                const delta = (y0 - y2) / denom;
                const interpolatedTau = bestTau + delta;

                // Only use if interpolation stays within bounds
                if (interpolatedTau >= tauMin && interpolatedTau <= tauMax) {
                    // Convert to frequency
                    f0[frame] = sampleRate / interpolatedTau;
                    // Confidence is 1 - d'(tau) at the minimum
                    confidence[frame] = Math.max(0, Math.min(1, 1 - bestDPrime));
                    continue;
                }
            }
        }

        // Fallback: use integer tau
        if (bestTau >= tauMin && bestTau <= tauMax) {
            f0[frame] = sampleRate / bestTau;
            confidence[frame] = Math.max(0, Math.min(1, 1 - bestDPrime));
        } else {
            // No valid pitch found
            f0[frame] = 0;
            confidence[frame] = 0;
        }
    }

    return { times, f0, confidence };
}
