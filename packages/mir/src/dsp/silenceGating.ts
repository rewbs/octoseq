/**
 * Silence-aware gating for onset detection.
 *
 * This module implements a production-grade silence detection and activity masking
 * pipeline. Silence is treated as a first-class state, not "low energy sound".
 *
 * Pipeline stages:
 * 1. Frame-level energy computation
 * 2. Adaptive noise floor estimation (percentile-based)
 * 3. Activity mask with hysteresis and hangover
 * 4. Post-silence suppression window
 *
 * Design principles:
 * - No fixed absolute thresholds - all thresholds are relative to estimated noise floor
 * - Hysteresis prevents oscillation at threshold boundaries
 * - Hangover prevents premature exit from active state
 * - Post-silence suppression prevents the first audible frame from being an onset
 */

/**
 * Configuration for silence-aware gating.
 */
export type SilenceGateConfig = {
    /**
     * Whether gating is enabled. If false, all frames are considered active.
     * @default true
     */
    enabled?: boolean;

    /**
     * Percentile (0-100) used to estimate the noise floor from frame energies.
     * Lower values are more conservative (estimate floor from quieter frames).
     * @default 10
     */
    energyPercentile?: number;

    /**
     * Margin above noise floor (in the same units as frame energy) to enter active state.
     * For log-scale energies (mel), this is effectively dB.
     * @default 6 (approximately 6 dB above floor for mel-based energy)
     */
    enterMargin?: number;

    /**
     * Margin above noise floor to remain in active state.
     * Must be less than enterMargin for proper hysteresis.
     * @default 3 (approximately 3 dB above floor)
     */
    exitMargin?: number;

    /**
     * Duration in milliseconds to remain active after energy drops below exit threshold.
     * Prevents premature exit during brief dips.
     * @default 50
     */
    hangoverMs?: number;

    /**
     * Minimum duration in milliseconds a region must be active before allowing onsets.
     * @default 0
     */
    minActiveMs?: number;

    /**
     * Duration in milliseconds after transitioning from inactive to active
     * during which onsets are suppressed.
     * Prevents the first audible frame from being detected as an onset.
     * @default 50
     */
    postSilenceSuppressMs?: number;
};

/**
 * Configuration for bin-level gating (CPU paths only).
 * Ignores bins whose energy is below a relative floor.
 */
export type BinGateConfig = {
    /**
     * Whether bin-level gating is enabled.
     * @default true
     */
    enabled?: boolean;

    /**
     * Relative floor as a fraction of frame energy.
     * Bins with value < frameEnergy * binFloorRel are ignored.
     * @default 0.05
     */
    binFloorRel?: number;
};

/**
 * Result of silence gating analysis.
 * Useful for debugging and visualization.
 */
export type SilenceGateResult = {
    /** Per-frame energy values used for gating. */
    frameEnergy: Float32Array;

    /** Estimated noise floor value. */
    noiseFloor: number;

    /** Threshold for entering active state. */
    enterThreshold: number;

    /** Threshold for exiting active state. */
    exitThreshold: number;

    /** Per-frame activity mask (true = active). */
    activityMask: Uint8Array;

    /** Per-frame onset suppression mask (true = suppress onset). */
    suppressionMask: Uint8Array;
};

// Default configuration values
const DEFAULT_SILENCE_GATE_CONFIG: Required<SilenceGateConfig> = {
    enabled: false, // Disabled by default to avoid breaking existing behavior
    energyPercentile: 10,
    enterMargin: 6,
    exitMargin: 3,
    hangoverMs: 50,
    minActiveMs: 0,
    postSilenceSuppressMs: 50,
};

const DEFAULT_BIN_GATE_CONFIG: Required<BinGateConfig> = {
    enabled: true,
    binFloorRel: 0.05,
};

/**
 * Merge user config with defaults.
 */
export function withSilenceGateDefaults(config?: SilenceGateConfig): Required<SilenceGateConfig> {
    return {
        enabled: config?.enabled ?? DEFAULT_SILENCE_GATE_CONFIG.enabled,
        energyPercentile: config?.energyPercentile ?? DEFAULT_SILENCE_GATE_CONFIG.energyPercentile,
        enterMargin: config?.enterMargin ?? DEFAULT_SILENCE_GATE_CONFIG.enterMargin,
        exitMargin: config?.exitMargin ?? DEFAULT_SILENCE_GATE_CONFIG.exitMargin,
        hangoverMs: config?.hangoverMs ?? DEFAULT_SILENCE_GATE_CONFIG.hangoverMs,
        minActiveMs: config?.minActiveMs ?? DEFAULT_SILENCE_GATE_CONFIG.minActiveMs,
        postSilenceSuppressMs: config?.postSilenceSuppressMs ?? DEFAULT_SILENCE_GATE_CONFIG.postSilenceSuppressMs,
    };
}

/**
 * Merge user config with defaults for bin gating.
 */
export function withBinGateDefaults(config?: BinGateConfig): Required<BinGateConfig> {
    return {
        enabled: config?.enabled ?? DEFAULT_BIN_GATE_CONFIG.enabled,
        binFloorRel: config?.binFloorRel ?? DEFAULT_BIN_GATE_CONFIG.binFloorRel,
    };
}

/**
 * Compute per-frame energy from mel spectrogram.
 *
 * Since mel bands are already log10(eps + energy), we compute the mean
 * of the log-energy values. This gives us a perceptually-relevant
 * frame energy proxy in log space.
 *
 * @param melBands - Array of frames, each containing mel band values (log10 scale)
 * @returns Per-frame energy values (log scale)
 */
export function computeFrameEnergyFromMel(melBands: Float32Array[]): Float32Array {
    const nFrames = melBands.length;
    const energy = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const bands = melBands[t];
        if (!bands || bands.length === 0) {
            energy[t] = -100; // Very low energy for empty frames
            continue;
        }

        // Mean of log energies (equivalent to log of geometric mean of linear energies)
        let sum = 0;
        for (let m = 0; m < bands.length; m++) {
            sum += bands[m] ?? -100;
        }
        energy[t] = sum / bands.length;
    }

    return energy;
}

/**
 * Compute per-frame energy from linear magnitude spectrogram.
 *
 * Uses mean magnitude (or power) across bins as the energy proxy.
 *
 * @param magnitudes - Array of frames, each containing magnitude values (linear scale)
 * @param usePower - If true, use sum of squared magnitudes (power). Default: false (RMS-like).
 * @returns Per-frame energy values (linear scale)
 */
export function computeFrameEnergyFromSpectrogram(
    magnitudes: Float32Array[],
    usePower = false
): Float32Array {
    const nFrames = magnitudes.length;
    const energy = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const mags = magnitudes[t];
        if (!mags || mags.length === 0) {
            energy[t] = 0;
            continue;
        }

        let sum = 0;
        for (let k = 0; k < mags.length; k++) {
            const m = mags[k] ?? 0;
            sum += usePower ? m * m : m;
        }
        energy[t] = sum / mags.length;
    }

    return energy;
}

/**
 * Compute percentile of values.
 *
 * @param values - Input array
 * @param percentile - Percentile to compute (0-100)
 * @returns The percentile value
 */
export function computePercentile(values: Float32Array, percentile: number): number {
    if (values.length === 0) return 0;

    // Create a sorted copy
    const sorted = Float32Array.from(values).sort((a, b) => a - b);

    // Clamp percentile
    const p = Math.max(0, Math.min(100, percentile));
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);

    if (lower === upper) {
        return sorted[lower] ?? 0;
    }

    // Linear interpolation
    const frac = idx - lower;
    const lowVal = sorted[lower] ?? 0;
    const highVal = sorted[upper] ?? 0;
    return lowVal + frac * (highVal - lowVal);
}

/**
 * Estimate adaptive noise floor from frame energies.
 *
 * Uses a robust percentile-based estimation rather than absolute thresholds.
 *
 * @param frameEnergy - Per-frame energy values
 * @param percentile - Percentile to use for floor estimation (0-100)
 * @returns Estimated noise floor
 */
export function estimateNoiseFloor(frameEnergy: Float32Array, percentile: number): number {
    return computePercentile(frameEnergy, percentile);
}

/**
 * Build activity mask with hysteresis and hangover.
 *
 * State machine:
 * - INACTIVE: energy < enterThreshold -> stay inactive
 * - INACTIVE: energy >= enterThreshold -> enter ACTIVE
 * - ACTIVE: energy >= exitThreshold -> stay active, reset hangover counter
 * - ACTIVE: energy < exitThreshold -> decrement hangover counter
 * - ACTIVE: hangover counter exhausted -> enter INACTIVE
 *
 * @param frameEnergy - Per-frame energy values
 * @param enterThreshold - Threshold to enter active state
 * @param exitThreshold - Threshold to remain in active state
 * @param hangoverFrames - Number of frames to remain active after dropping below exit threshold
 * @returns Activity mask (1 = active, 0 = inactive)
 */
export function buildActivityMask(
    frameEnergy: Float32Array,
    enterThreshold: number,
    exitThreshold: number,
    hangoverFrames: number
): Uint8Array {
    const nFrames = frameEnergy.length;
    const mask = new Uint8Array(nFrames);

    let isActive = false;
    let hangoverRemaining = 0;

    for (let t = 0; t < nFrames; t++) {
        const e = frameEnergy[t] ?? 0;

        if (!isActive) {
            // Inactive state: check if we should enter active
            if (e >= enterThreshold) {
                isActive = true;
                hangoverRemaining = hangoverFrames;
                mask[t] = 1;
            } else {
                mask[t] = 0;
            }
        } else {
            // Active state: check if we should remain active
            if (e >= exitThreshold) {
                // Energy is above exit threshold, reset hangover
                hangoverRemaining = hangoverFrames;
                mask[t] = 1;
            } else if (hangoverRemaining > 0) {
                // Energy dropped but hangover not exhausted
                hangoverRemaining--;
                mask[t] = 1;
            } else {
                // Hangover exhausted, enter inactive
                isActive = false;
                mask[t] = 0;
            }
        }
    }

    return mask;
}

/**
 * Build suppression mask for post-silence onset suppression.
 *
 * When transitioning from inactive to active, suppress onsets for a window
 * to prevent the first audible frame from being detected as an onset.
 *
 * @param activityMask - Activity mask from buildActivityMask
 * @param suppressFrames - Number of frames to suppress after entering active state
 * @returns Suppression mask (1 = suppress onset, 0 = allow onset)
 */
export function buildSuppressionMask(
    activityMask: Uint8Array,
    suppressFrames: number
): Uint8Array {
    const nFrames = activityMask.length;
    const suppress = new Uint8Array(nFrames);

    let suppressRemaining = 0;
    let wasActive = false;

    for (let t = 0; t < nFrames; t++) {
        const isActive = (activityMask[t] ?? 0) === 1;

        if (isActive && !wasActive) {
            // Just transitioned from inactive to active
            suppressRemaining = suppressFrames;
        }

        if (isActive && suppressRemaining > 0) {
            suppress[t] = 1;
            suppressRemaining--;
        } else {
            suppress[t] = 0;
        }

        wasActive = isActive;
    }

    return suppress;
}

/**
 * Apply minimum active duration requirement.
 *
 * Regions that are active for less than minActiveFrames are set to inactive.
 *
 * @param activityMask - Activity mask to modify (in place)
 * @param minActiveFrames - Minimum number of consecutive active frames required
 */
export function applyMinActiveDuration(
    activityMask: Uint8Array,
    minActiveFrames: number
): void {
    if (minActiveFrames <= 1) return;

    const nFrames = activityMask.length;

    // Find all active regions and their lengths
    type Region = { start: number; end: number };
    const regions: Region[] = [];
    let regionStart = -1;

    for (let t = 0; t <= nFrames; t++) {
        const isActive = t < nFrames && (activityMask[t] ?? 0) === 1;

        if (isActive && regionStart < 0) {
            regionStart = t;
        } else if (!isActive && regionStart >= 0) {
            regions.push({ start: regionStart, end: t });
            regionStart = -1;
        }
    }

    // Suppress regions that are too short
    for (const region of regions) {
        const length = region.end - region.start;
        if (length < minActiveFrames) {
            for (let t = region.start; t < region.end; t++) {
                activityMask[t] = 0;
            }
        }
    }
}

/**
 * Full silence gating analysis.
 *
 * Computes frame energy, noise floor, thresholds, activity mask, and suppression mask.
 *
 * @param frameEnergy - Per-frame energy values
 * @param frameDurationSec - Duration of one frame in seconds
 * @param config - Silence gate configuration
 * @returns Complete gating result including all intermediate values
 */
export function computeSilenceGating(
    frameEnergy: Float32Array,
    frameDurationSec: number,
    config?: SilenceGateConfig
): SilenceGateResult {
    const cfg = withSilenceGateDefaults(config);

    const nFrames = frameEnergy.length;

    // If gating is disabled, return all-active mask
    if (!cfg.enabled) {
        return {
            frameEnergy,
            noiseFloor: -Infinity,
            enterThreshold: -Infinity,
            exitThreshold: -Infinity,
            activityMask: new Uint8Array(nFrames).fill(1),
            suppressionMask: new Uint8Array(nFrames), // All zeros = no suppression
        };
    }

    // Step 1: Estimate noise floor
    const noiseFloor = estimateNoiseFloor(frameEnergy, cfg.energyPercentile);

    // Step 2: Compute thresholds
    const enterThreshold = noiseFloor + cfg.enterMargin;
    const exitThreshold = noiseFloor + cfg.exitMargin;

    // Step 3: Convert time parameters to frames
    const hangoverFrames = Math.max(0, Math.round(cfg.hangoverMs / 1000 / frameDurationSec));
    const suppressFrames = Math.max(0, Math.round(cfg.postSilenceSuppressMs / 1000 / frameDurationSec));
    const minActiveFrames = Math.max(0, Math.round(cfg.minActiveMs / 1000 / frameDurationSec));

    // Step 4: Build activity mask with hysteresis
    const activityMask = buildActivityMask(frameEnergy, enterThreshold, exitThreshold, hangoverFrames);

    // Step 5: Apply minimum active duration
    if (minActiveFrames > 1) {
        applyMinActiveDuration(activityMask, minActiveFrames);
    }

    // Step 6: Build suppression mask
    const suppressionMask = buildSuppressionMask(activityMask, suppressFrames);

    return {
        frameEnergy,
        noiseFloor,
        enterThreshold,
        exitThreshold,
        activityMask,
        suppressionMask,
    };
}

/**
 * Apply silence gating to onset novelty values.
 *
 * Zeros out novelty values where the activity mask is inactive
 * or the suppression mask is active.
 *
 * @param novelty - Onset novelty values (modified in place)
 * @param activityMask - Activity mask (1 = active)
 * @param suppressionMask - Suppression mask (1 = suppress)
 */
export function applySilenceGating(
    novelty: Float32Array,
    activityMask: Uint8Array,
    suppressionMask: Uint8Array
): void {
    const nFrames = novelty.length;

    for (let t = 0; t < nFrames; t++) {
        const isActive = (activityMask[t] ?? 0) === 1;
        const isSuppressed = (suppressionMask[t] ?? 0) === 1;

        if (!isActive || isSuppressed) {
            novelty[t] = 0;
        }
    }
}

/**
 * Compute bin floor threshold for bin-level gating.
 *
 * @param frameEnergy - Energy of the current frame
 * @param binFloorRel - Relative floor as fraction of frame energy
 * @returns Absolute bin floor threshold
 */
export function computeBinFloor(frameEnergy: number, binFloorRel: number): number {
    return frameEnergy * binFloorRel;
}
