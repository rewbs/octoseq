import type { Spectrogram } from "./spectrogram";
import type { ActivitySignal } from "./activity";

/**
 * Options for activity-aware spectral features.
 */
export type SpectralActivityOptions = {
    /**
     * Activity signal to use for gating.
     * If provided, feature values will be zeroed in inactive regions.
     */
    activity?: ActivitySignal;

    /**
     * Behavior for inactive frames.
     * - "zero": Output 0 (default)
     * - "hold": Hold the last active value
     */
    inactiveBehavior?: "zero" | "hold";
};

export type AmplitudeEnvelopeConfig = {
    /** Hop size in samples (determines time resolution). Default: 512 */
    hopSize?: number;
    /** Window size for RMS calculation. Default: same as hopSize */
    windowSize?: number;
};

export type AmplitudeEnvelopeResult = {
    times: Float32Array;
    values: Float32Array;
};

/**
 * Amplitude envelope from raw audio samples.
 *
 * Computes RMS amplitude over windows of the time-domain signal.
 * More efficient than spectrogram-based computation for full spectrum.
 *
 * @param samples - Mono audio samples
 * @param sampleRate - Sample rate of the audio
 * @param config - Configuration options
 * @returns Times (seconds) and RMS amplitude values
 */
export function amplitudeEnvelope(
    samples: Float32Array,
    sampleRate: number,
    config?: AmplitudeEnvelopeConfig
): AmplitudeEnvelopeResult {
    const hopSize = config?.hopSize ?? 512;
    const windowSize = config?.windowSize ?? hopSize;

    const nFrames = Math.floor((samples.length - windowSize) / hopSize) + 1;
    const times = new Float32Array(nFrames);
    const values = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const start = t * hopSize;
        const end = Math.min(start + windowSize, samples.length);

        // RMS amplitude
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            const s = samples[i] ?? 0;
            sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / (end - start));

        times[t] = (start + windowSize / 2) / sampleRate;
        values[t] = rms;
    }

    return { times, values };
}

/**
 * Spectral centroid per frame (Hz).
 *
 * Output is aligned 1:1 with `spec.times`.
 *
 * When activity gating is enabled:
 * - Inactive frames output 0 (or hold last valid value if configured)
 * - This prevents noise-induced centroid values during silence
 *
 * @param spec - Input spectrogram
 * @param options - Activity gating options
 */
export function spectralCentroid(
    spec: Spectrogram,
    options?: SpectralActivityOptions
): Float32Array {
    const nFrames = spec.times.length;
    const out = new Float32Array(nFrames);

    const nBins = (spec.fftSize >>> 1) + 1;
    const binHz = spec.sampleRate / spec.fftSize;

    const activity = options?.activity;
    const holdBehavior = options?.inactiveBehavior === "hold";
    let lastActiveValue = 0;

    for (let t = 0; t < nFrames; t++) {
        // Check activity if provided
        const isActive = activity ? (activity.isActive[t] ?? 0) === 1 : true;

        if (!isActive) {
            out[t] = holdBehavior ? lastActiveValue : 0;
            continue;
        }

        const mags = spec.magnitudes[t];
        if (!mags) {
            out[t] = holdBehavior ? lastActiveValue : 0;
            continue;
        }

        let num = 0;
        let den = 0;

        // DC..Nyquist inclusive.
        for (let k = 0; k < nBins; k++) {
            const m = mags[k] ?? 0;
            const f = k * binHz;
            num += f * m;
            den += m;
        }

        const centroid = den > 0 ? num / den : 0;
        out[t] = centroid;
        lastActiveValue = centroid;
    }

    return out;
}

/**
 * Spectral flux per frame (unitless).
 *
 * Definition used here:
 * - L1 distance between successive *normalised* magnitude spectra.
 * - First frame flux is 0.
 *
 * Output is aligned 1:1 with `spec.times`.
 *
 * When activity gating is enabled:
 * - Inactive frames output 0
 * - Post-silence suppression is applied (first active frames after silence are zeroed)
 * - This prevents false flux spikes at silence/sound boundaries
 *
 * @param spec - Input spectrogram
 * @param options - Activity gating options
 */
export function spectralFlux(
    spec: Spectrogram,
    options?: SpectralActivityOptions
): Float32Array {
    const nFrames = spec.times.length;
    const out = new Float32Array(nFrames);

    const nBins = (spec.fftSize >>> 1) + 1;
    const activity = options?.activity;

    let prev: Float32Array | null = null;

    for (let t = 0; t < nFrames; t++) {
        // Check activity and suppression if provided
        const isActive = activity ? (activity.isActive[t] ?? 0) === 1 : true;
        const isSuppressed = activity ? (activity.suppressMask[t] ?? 0) === 1 : false;

        if (!isActive || isSuppressed) {
            out[t] = 0;
            // Reset prev to avoid spurious flux when activity resumes
            prev = null;
            continue;
        }

        const mags = spec.magnitudes[t];
        if (!mags) {
            out[t] = 0;
            prev = null;
            continue;
        }

        // Normalise to reduce sensitivity to overall level.
        let sum = 0;
        for (let k = 0; k < nBins; k++) sum += mags[k] ?? 0;

        if (sum <= 0) {
            out[t] = 0;
            prev = null;
            continue;
        }

        const cur = new Float32Array(nBins);
        const inv = 1 / sum;
        for (let k = 0; k < nBins; k++) cur[k] = (mags[k] ?? 0) * inv;

        if (!prev) {
            out[t] = 0;
            prev = cur;
            continue;
        }

        let flux = 0;
        for (let k = 0; k < nBins; k++) {
            const d = (cur[k] ?? 0) - (prev[k] ?? 0);
            flux += Math.abs(d);
        }

        out[t] = flux;
        prev = cur;
    }

    return out;
}
