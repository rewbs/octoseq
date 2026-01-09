/**
 * Activity Signal - First-class MIR feature for audibility detection.
 *
 * The Activity Signal represents whether audible content is present at each frame.
 * It is the foundation for silence-aware MIR processing across all features.
 *
 * Design Principles:
 * 1. Silence is a distinct state, not "low energy sound"
 * 2. Activity detection is shared, not reimplemented per feature
 * 3. Activity is computed from whole-track context (adaptive thresholds)
 * 4. The signal is inspectable and visualizable
 *
 * Semantics:
 * - activity_level: 0 = silence/inaudible, 1 = confidently audible
 * - is_active: boolean derived from activity_level
 */

import type { MelSpectrogram } from "./mel";
import type { Spectrogram } from "./spectrogram";
import {
    computeFrameEnergyFromMel,
    computeFrameEnergyFromSpectrogram,
    estimateNoiseFloor,
    buildActivityMask,
    buildSuppressionMask,
    applyMinActiveDuration,
} from "./silenceGating";

/**
 * Configuration for activity detection.
 */
export type ActivityConfig = {
    /**
     * Percentile (0-100) used to estimate the noise floor from frame energies.
     * Lower values are more conservative (estimate floor from quieter frames).
     * @default 10
     */
    energyPercentile?: number;

    /**
     * Margin above noise floor to enter active state.
     * For log-scale energies (mel), this is effectively dB.
     * @default 6
     */
    enterMargin?: number;

    /**
     * Margin above noise floor to remain in active state.
     * Must be less than enterMargin for proper hysteresis.
     * @default 3
     */
    exitMargin?: number;

    /**
     * Duration in milliseconds to remain active after energy drops below exit threshold.
     * Prevents rapid toggling near silence.
     * @default 50
     */
    hangoverMs?: number;

    /**
     * Minimum duration in milliseconds a region must be active.
     * Regions shorter than this are marked inactive.
     * @default 30
     */
    minActiveMs?: number;

    /**
     * Smoothing window in milliseconds for activity_level output.
     * Produces smoother transitions. 0 = no smoothing.
     * @default 20
     */
    smoothMs?: number;
};

/**
 * Activity Signal result - the main output type.
 */
export type ActivitySignal = {
    /** Frame times in seconds, aligned with source spectrogram/mel. */
    times: Float32Array;

    /**
     * Continuous activity level in range [0, 1].
     * 0 = silence, 1 = confidently active.
     * Intermediate values occur at transitions and represent uncertainty.
     */
    activityLevel: Float32Array;

    /**
     * Binary activity mask (0 = inactive, 1 = active).
     * Derived from the underlying hysteresis state machine.
     */
    isActive: Uint8Array;

    /**
     * Per-frame suppression mask (0 = allow, 1 = suppress).
     * Used to suppress features immediately after silence-to-active transitions.
     */
    suppressMask: Uint8Array;

    /** Diagnostic information for debugging and visualization. */
    diagnostics: ActivityDiagnostics;
};

/**
 * Diagnostics for inspecting activity detection behavior.
 */
export type ActivityDiagnostics = {
    /** Per-frame energy values used for detection. */
    frameEnergy: Float32Array;

    /** Estimated noise floor value. */
    noiseFloor: number;

    /** Threshold for entering active state. */
    enterThreshold: number;

    /** Threshold for exiting active state. */
    exitThreshold: number;
};

// Default configuration values
const DEFAULT_ACTIVITY_CONFIG: Required<ActivityConfig> = {
    energyPercentile: 10,
    enterMargin: 6,
    exitMargin: 3,
    hangoverMs: 50,
    minActiveMs: 30,
    smoothMs: 20,
};

/**
 * Merge user config with defaults.
 */
export function withActivityDefaults(config?: ActivityConfig): Required<ActivityConfig> {
    return {
        energyPercentile: config?.energyPercentile ?? DEFAULT_ACTIVITY_CONFIG.energyPercentile,
        enterMargin: config?.enterMargin ?? DEFAULT_ACTIVITY_CONFIG.enterMargin,
        exitMargin: config?.exitMargin ?? DEFAULT_ACTIVITY_CONFIG.exitMargin,
        hangoverMs: config?.hangoverMs ?? DEFAULT_ACTIVITY_CONFIG.hangoverMs,
        minActiveMs: config?.minActiveMs ?? DEFAULT_ACTIVITY_CONFIG.minActiveMs,
        smoothMs: config?.smoothMs ?? DEFAULT_ACTIVITY_CONFIG.smoothMs,
    };
}

/**
 * Smooth a signal using a moving average.
 */
function smoothSignal(values: Float32Array, windowFrames: number): Float32Array {
    if (windowFrames <= 1) return values;

    const n = values.length;
    const out = new Float32Array(n);
    const half = Math.floor(windowFrames / 2);

    // Prefix sums for O(n) moving average
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

/**
 * Convert binary activity mask to continuous activity level.
 *
 * The raw mask is 0/1. We apply smoothing to create gradual transitions
 * that better represent uncertainty at boundaries.
 */
function maskToActivityLevel(
    mask: Uint8Array,
    smoothFrames: number
): Float32Array {
    const n = mask.length;
    const level = new Float32Array(n);

    // Convert to float
    for (let i = 0; i < n; i++) {
        level[i] = mask[i] ?? 0;
    }

    // Apply smoothing if requested
    if (smoothFrames > 1) {
        return smoothSignal(level, smoothFrames);
    }

    return level;
}

/**
 * Compute Activity Signal from mel spectrogram.
 *
 * This is the primary entry point for activity detection.
 * Mel spectrograms are preferred because their log-scale energies
 * provide more perceptually meaningful thresholds.
 *
 * @param mel - Mel spectrogram (log-scale energies)
 * @param config - Activity detection configuration
 * @returns Complete activity signal with diagnostics
 */
export function computeActivityFromMel(
    mel: MelSpectrogram,
    config?: ActivityConfig
): ActivitySignal {
    const cfg = withActivityDefaults(config);
    const nFrames = mel.times.length;

    // Step 1: Compute frame energy (mean of log-mel bands)
    const frameEnergy = computeFrameEnergyFromMel(mel.melBands);

    // Step 2: Estimate noise floor
    const noiseFloor = estimateNoiseFloor(frameEnergy, cfg.energyPercentile);

    // Step 3: Compute thresholds
    const enterThreshold = noiseFloor + cfg.enterMargin;
    const exitThreshold = noiseFloor + cfg.exitMargin;

    // Step 4: Convert time parameters to frames
    const frameDurationSec = nFrames >= 2
        ? (mel.times[1] ?? 0) - (mel.times[0] ?? 0)
        : 0.01;

    const hangoverFrames = Math.max(0, Math.round(cfg.hangoverMs / 1000 / frameDurationSec));
    const minActiveFrames = Math.max(0, Math.round(cfg.minActiveMs / 1000 / frameDurationSec));
    const smoothFrames = Math.max(1, Math.round(cfg.smoothMs / 1000 / frameDurationSec)) | 1; // Ensure odd

    // Step 5: Build activity mask with hysteresis
    const isActive = buildActivityMask(frameEnergy, enterThreshold, exitThreshold, hangoverFrames);

    // Step 6: Apply minimum active duration
    if (minActiveFrames > 1) {
        applyMinActiveDuration(isActive, minActiveFrames);
    }

    // Step 7: Build suppression mask (for post-silence onset suppression)
    const suppressFrames = Math.max(0, Math.round(50 / 1000 / frameDurationSec)); // Fixed 50ms
    const suppressMask = buildSuppressionMask(isActive, suppressFrames);

    // Step 8: Convert to continuous activity level
    const activityLevel = maskToActivityLevel(isActive, smoothFrames);

    return {
        times: mel.times,
        activityLevel,
        isActive,
        suppressMask,
        diagnostics: {
            frameEnergy,
            noiseFloor,
            enterThreshold,
            exitThreshold,
        },
    };
}

/**
 * Compute Activity Signal from linear magnitude spectrogram.
 *
 * This function first converts magnitudes to log scale for threshold computation.
 *
 * @param spec - Linear magnitude spectrogram
 * @param config - Activity detection configuration
 * @returns Complete activity signal with diagnostics
 */
export function computeActivityFromSpectrogram(
    spec: Spectrogram,
    config?: ActivityConfig
): ActivitySignal {
    const cfg = withActivityDefaults(config);
    const nFrames = spec.times.length;

    // Step 1: Compute frame energy (mean magnitude) and convert to log scale
    const linearEnergy = computeFrameEnergyFromSpectrogram(spec.magnitudes, false);
    const frameEnergy = new Float32Array(nFrames);
    const eps = 1e-12;
    for (let t = 0; t < nFrames; t++) {
        frameEnergy[t] = Math.log10(eps + (linearEnergy[t] ?? 0));
    }

    // Step 2: Estimate noise floor
    const noiseFloor = estimateNoiseFloor(frameEnergy, cfg.energyPercentile);

    // Step 3: Compute thresholds
    const enterThreshold = noiseFloor + cfg.enterMargin;
    const exitThreshold = noiseFloor + cfg.exitMargin;

    // Step 4: Convert time parameters to frames
    const frameDurationSec = nFrames >= 2
        ? (spec.times[1] ?? 0) - (spec.times[0] ?? 0)
        : 0.01;

    const hangoverFrames = Math.max(0, Math.round(cfg.hangoverMs / 1000 / frameDurationSec));
    const minActiveFrames = Math.max(0, Math.round(cfg.minActiveMs / 1000 / frameDurationSec));
    const smoothFrames = Math.max(1, Math.round(cfg.smoothMs / 1000 / frameDurationSec)) | 1;

    // Step 5: Build activity mask with hysteresis
    const isActive = buildActivityMask(frameEnergy, enterThreshold, exitThreshold, hangoverFrames);

    // Step 6: Apply minimum active duration
    if (minActiveFrames > 1) {
        applyMinActiveDuration(isActive, minActiveFrames);
    }

    // Step 7: Build suppression mask
    const suppressFrames = Math.max(0, Math.round(50 / 1000 / frameDurationSec));
    const suppressMask = buildSuppressionMask(isActive, suppressFrames);

    // Step 8: Convert to continuous activity level
    const activityLevel = maskToActivityLevel(isActive, smoothFrames);

    return {
        times: spec.times,
        activityLevel,
        isActive,
        suppressMask,
        diagnostics: {
            frameEnergy,
            noiseFloor,
            enterThreshold,
            exitThreshold,
        },
    };
}

/**
 * Compute Activity Signal from raw audio samples.
 *
 * Uses a simple RMS-based energy computation. This is useful when
 * no spectrogram is available, but mel-based detection is preferred.
 *
 * @param samples - Mono audio samples
 * @param sampleRate - Sample rate of the audio
 * @param hopSize - Analysis hop size in samples
 * @param windowSize - Analysis window size in samples
 * @param config - Activity detection configuration
 * @returns Complete activity signal with diagnostics
 */
export function computeActivityFromAudio(
    samples: Float32Array,
    sampleRate: number,
    hopSize: number,
    windowSize: number,
    config?: ActivityConfig
): ActivitySignal {
    const cfg = withActivityDefaults(config);

    // Compute frame-based RMS energy
    const nFrames = Math.max(0, Math.floor((samples.length - windowSize) / hopSize) + 1);
    const times = new Float32Array(nFrames);
    const frameEnergy = new Float32Array(nFrames);
    const eps = 1e-12;

    for (let frame = 0; frame < nFrames; frame++) {
        const start = frame * hopSize;
        const end = Math.min(start + windowSize, samples.length);

        // RMS energy
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            const s = samples[i] ?? 0;
            sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / (end - start));

        times[frame] = (start + windowSize / 2) / sampleRate;
        // Convert to log scale for threshold computation
        frameEnergy[frame] = Math.log10(eps + rms);
    }

    // Estimate noise floor and thresholds
    const noiseFloor = estimateNoiseFloor(frameEnergy, cfg.energyPercentile);
    const enterThreshold = noiseFloor + cfg.enterMargin;
    const exitThreshold = noiseFloor + cfg.exitMargin;

    // Convert time parameters to frames
    const frameDurationSec = hopSize / sampleRate;
    const hangoverFrames = Math.max(0, Math.round(cfg.hangoverMs / 1000 / frameDurationSec));
    const minActiveFrames = Math.max(0, Math.round(cfg.minActiveMs / 1000 / frameDurationSec));
    const smoothFrames = Math.max(1, Math.round(cfg.smoothMs / 1000 / frameDurationSec)) | 1;

    // Build activity mask
    const isActive = buildActivityMask(frameEnergy, enterThreshold, exitThreshold, hangoverFrames);

    if (minActiveFrames > 1) {
        applyMinActiveDuration(isActive, minActiveFrames);
    }

    // Build suppression mask
    const suppressFrames = Math.max(0, Math.round(50 / 1000 / frameDurationSec));
    const suppressMask = buildSuppressionMask(isActive, suppressFrames);

    // Convert to activity level
    const activityLevel = maskToActivityLevel(isActive, smoothFrames);

    return {
        times,
        activityLevel,
        isActive,
        suppressMask,
        diagnostics: {
            frameEnergy,
            noiseFloor,
            enterThreshold,
            exitThreshold,
        },
    };
}

/**
 * Apply activity gating to a 1D signal.
 *
 * Zeros out values where activity is low.
 *
 * @param values - Signal values to gate (modified in place)
 * @param activity - Activity signal
 * @param options - Gating options
 */
export function applyActivityGating(
    values: Float32Array,
    activity: ActivitySignal,
    options?: {
        /** Use binary mask instead of continuous level. Default: true */
        useBinaryMask?: boolean;
        /** Also apply post-silence suppression. Default: true */
        suppressPostSilence?: boolean;
        /** Threshold for activity_level when not using binary mask. Default: 0.5 */
        levelThreshold?: number;
    }
): void {
    const useBinary = options?.useBinaryMask ?? true;
    const suppressPostSilence = options?.suppressPostSilence ?? true;
    const levelThreshold = options?.levelThreshold ?? 0.5;

    const n = Math.min(values.length, activity.activityLevel.length);

    for (let i = 0; i < n; i++) {
        let shouldGate = false;

        if (useBinary) {
            shouldGate = (activity.isActive[i] ?? 0) === 0;
        } else {
            shouldGate = (activity.activityLevel[i] ?? 0) < levelThreshold;
        }

        if (suppressPostSilence && (activity.suppressMask[i] ?? 0) === 1) {
            shouldGate = true;
        }

        if (shouldGate) {
            values[i] = 0;
        }
    }
}

/**
 * Interpolate activity signal to a different time grid.
 *
 * Useful when you have activity computed at one resolution (e.g., mel frames)
 * but need it at another resolution (e.g., pitch frames).
 *
 * @param activity - Source activity signal
 * @param targetTimes - Target time grid
 * @returns Activity signal interpolated to target times
 */
export function interpolateActivity(
    activity: ActivitySignal,
    targetTimes: Float32Array
): ActivitySignal {
    const n = targetTimes.length;
    const activityLevel = new Float32Array(n);
    const isActive = new Uint8Array(n);
    const suppressMask = new Uint8Array(n);
    const frameEnergy = new Float32Array(n);

    const srcTimes = activity.times;
    const srcN = srcTimes.length;

    if (srcN === 0) {
        return {
            times: targetTimes,
            activityLevel,
            isActive,
            suppressMask,
            diagnostics: {
                frameEnergy,
                noiseFloor: activity.diagnostics.noiseFloor,
                enterThreshold: activity.diagnostics.enterThreshold,
                exitThreshold: activity.diagnostics.exitThreshold,
            },
        };
    }

    // Nearest-neighbor interpolation for each target time
    for (let i = 0; i < n; i++) {
        const t = targetTimes[i] ?? 0;

        // Binary search for nearest source frame
        let lo = 0;
        let hi = srcN - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if ((srcTimes[mid] ?? 0) < t) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        // Check if lo or lo-1 is closer
        let nearest = lo;
        if (lo > 0 && Math.abs((srcTimes[lo - 1] ?? 0) - t) < Math.abs((srcTimes[lo] ?? 0) - t)) {
            nearest = lo - 1;
        }

        activityLevel[i] = activity.activityLevel[nearest] ?? 0;
        isActive[i] = activity.isActive[nearest] ?? 0;
        suppressMask[i] = activity.suppressMask[nearest] ?? 0;
        frameEnergy[i] = activity.diagnostics.frameEnergy[nearest] ?? 0;
    }

    return {
        times: targetTimes,
        activityLevel,
        isActive,
        suppressMask,
        diagnostics: {
            frameEnergy,
            noiseFloor: activity.diagnostics.noiseFloor,
            enterThreshold: activity.diagnostics.enterThreshold,
            exitThreshold: activity.diagnostics.exitThreshold,
        },
    };
}
