/**
 * Constant-Q Transform (CQT) implementation for F5.
 *
 * CQT provides log-frequency resolution aligned to musical pitch ratios.
 * This implementation builds on the existing STFT infrastructure by:
 * 1. Computing an STFT using the existing spectrogram function
 * 2. Applying a CQT filterbank in the frequency domain
 *
 * The CQT is an internal spectral view, not a user-facing spectrogram.
 */

import type { CqtConfig, CqtSpectrogram, MirRunMeta } from "../types";
import { spectrogram, type AudioBufferLike } from "./spectrogram";

// ----------------------------
// Default Configuration
// ----------------------------

/** Default CQT configuration values */
export const CQT_DEFAULTS = {
    /** Quarter-tone resolution (24 bins per octave) */
    binsPerOctave: 24,
    /** C1 (lowest note on a standard piano) */
    fMin: 32.7,
    /** C9 (well above audible range for most content) */
    fMax: 8372,
} as const;

// ----------------------------
// Utility Functions
// ----------------------------

/**
 * Convert CQT bin index to frequency in Hz.
 */
export function cqtBinToHz(bin: number, config: CqtConfig): number {
    return config.fMin * Math.pow(2, bin / config.binsPerOctave);
}

/**
 * Convert frequency in Hz to CQT bin index (may be fractional).
 */
export function hzToCqtBin(hz: number, config: CqtConfig): number {
    if (hz <= 0) return -Infinity;
    return config.binsPerOctave * Math.log2(hz / config.fMin);
}

/**
 * Calculate number of octaves covered by the CQT config.
 */
export function getNumOctaves(config: CqtConfig): number {
    return Math.log2(config.fMax / config.fMin);
}

/**
 * Calculate total number of CQT bins.
 */
export function getNumBins(config: CqtConfig): number {
    const nOctaves = getNumOctaves(config);
    return Math.ceil(nOctaves * config.binsPerOctave);
}

/**
 * Generate the center frequencies for all CQT bins.
 */
export function getCqtBinFrequencies(config: CqtConfig): Float32Array {
    const nBins = getNumBins(config);
    const freqs = new Float32Array(nBins);
    for (let k = 0; k < nBins; k++) {
        freqs[k] = cqtBinToHz(k, config);
    }
    return freqs;
}

// ----------------------------
// CQT Kernel Bank
// ----------------------------

/**
 * A sparse CQT kernel for a single frequency bin.
 * Each kernel maps a range of STFT bins to a single CQT bin.
 */
type CqtKernel = {
    /** Center frequency of this CQT bin in Hz */
    centerFreq: number;
    /** Starting STFT bin index (inclusive) */
    startBin: number;
    /** Ending STFT bin index (exclusive) */
    endBin: number;
    /** Weights for each STFT bin in the range [startBin, endBin) */
    weights: Float32Array;
};

/**
 * Pre-computed CQT kernel bank for efficient application to STFT frames.
 */
type CqtKernelBank = {
    config: CqtConfig;
    fftSize: number;
    sampleRate: number;
    kernels: CqtKernel[];
};

/** Cache for kernel banks to avoid recomputation */
const kernelBankCache = new Map<string, CqtKernelBank>();

/**
 * Generate a cache key for the kernel bank.
 */
function kernelCacheKey(config: CqtConfig, fftSize: number, sampleRate: number): string {
    return `${config.binsPerOctave}:${config.fMin}:${config.fMax}:${fftSize}:${sampleRate}`;
}

/**
 * Create a triangular window centered at a frequency with log-spaced bandwidth.
 * This creates a simple triangular filterbank similar to mel filterbanks.
 */
function createCqtKernel(
    binIndex: number,
    config: CqtConfig,
    fftSize: number,
    sampleRate: number
): CqtKernel {
    const centerFreq = cqtBinToHz(binIndex, config);
    const freqResolution = sampleRate / fftSize;

    // Q factor: ratio of center frequency to bandwidth
    // For CQT, Q is constant, which gives logarithmic frequency resolution
    // Q = f / Δf = 1 / (2^(1/binsPerOctave) - 1)
    const Q = 1 / (Math.pow(2, 1 / config.binsPerOctave) - 1);

    // Bandwidth for this bin
    const bandwidth = centerFreq / Q;

    // Lower and upper edge frequencies
    const fLow = centerFreq - bandwidth / 2;
    const fHigh = centerFreq + bandwidth / 2;

    // Convert to STFT bin indices
    const startBin = Math.max(0, Math.floor(fLow / freqResolution));
    const endBin = Math.min(
        Math.floor(fftSize / 2) + 1,
        Math.ceil(fHigh / freqResolution) + 1
    );

    const numBins = Math.max(1, endBin - startBin);
    const weights = new Float32Array(numBins);

    // Create triangular window weights
    for (let i = 0; i < numBins; i++) {
        const binFreq = (startBin + i) * freqResolution;

        if (binFreq <= centerFreq) {
            // Rising edge
            if (centerFreq > fLow) {
                weights[i] = (binFreq - fLow) / (centerFreq - fLow);
            } else {
                weights[i] = 1;
            }
        } else {
            // Falling edge
            if (fHigh > centerFreq) {
                weights[i] = (fHigh - binFreq) / (fHigh - centerFreq);
            } else {
                weights[i] = 1;
            }
        }

        // Clamp to valid range
        weights[i] = Math.max(0, Math.min(1, weights[i] ?? 0));
    }

    // Normalize weights so they sum to 1
    let sum = 0;
    for (let i = 0; i < numBins; i++) {
        sum += weights[i] ?? 0;
    }
    if (sum > 0) {
        for (let i = 0; i < numBins; i++) {
            weights[i] = (weights[i] ?? 0) / sum;
        }
    }

    return {
        centerFreq,
        startBin,
        endBin,
        weights,
    };
}

/**
 * Create or retrieve a cached CQT kernel bank.
 */
function getCqtKernelBank(
    config: CqtConfig,
    fftSize: number,
    sampleRate: number
): CqtKernelBank {
    const key = kernelCacheKey(config, fftSize, sampleRate);
    const cached = kernelBankCache.get(key);
    if (cached) return cached;

    const nBins = getNumBins(config);
    const kernels: CqtKernel[] = new Array(nBins);

    for (let k = 0; k < nBins; k++) {
        kernels[k] = createCqtKernel(k, config, fftSize, sampleRate);
    }

    const bank: CqtKernelBank = {
        config,
        fftSize,
        sampleRate,
        kernels,
    };

    kernelBankCache.set(key, bank);
    return bank;
}

/**
 * Apply CQT kernel bank to an STFT magnitude frame.
 */
function applyCqtKernels(
    stftMagnitudes: Float32Array,
    kernelBank: CqtKernelBank
): Float32Array {
    const nCqtBins = kernelBank.kernels.length;
    const cqtMagnitudes = new Float32Array(nCqtBins);

    for (let k = 0; k < nCqtBins; k++) {
        const kernel = kernelBank.kernels[k];
        if (!kernel) continue;

        let sum = 0;
        for (let i = 0; i < kernel.weights.length; i++) {
            const stftBin = kernel.startBin + i;
            const stftMag = stftMagnitudes[stftBin] ?? 0;
            const weight = kernel.weights[i] ?? 0;
            sum += stftMag * weight;
        }
        cqtMagnitudes[k] = sum;
    }

    return cqtMagnitudes;
}

// ----------------------------
// Main CQT Function
// ----------------------------

export type CqtOptions = {
    /** Optional cancellation hook; checked periodically. */
    isCancelled?: () => boolean;
};

/**
 * Apply default values to a partial CQT config.
 */
export function withCqtDefaults(partial?: Partial<CqtConfig>): CqtConfig {
    return {
        binsPerOctave: partial?.binsPerOctave ?? CQT_DEFAULTS.binsPerOctave,
        fMin: partial?.fMin ?? CQT_DEFAULTS.fMin,
        fMax: partial?.fMax ?? CQT_DEFAULTS.fMax,
        hopSize: partial?.hopSize,
    };
}

/**
 * Compute a CQT spectrogram from audio.
 *
 * This function:
 * 1. Computes an STFT using the existing spectrogram infrastructure
 * 2. Applies a CQT filterbank to each STFT frame
 * 3. Returns a log-frequency representation
 *
 * @param audio - Audio buffer to analyze
 * @param config - CQT configuration
 * @param options - Optional processing options
 * @returns CQT spectrogram with log-frequency resolution
 */
export async function cqtSpectrogram(
    audio: AudioBufferLike,
    config: CqtConfig,
    options: CqtOptions = {}
): Promise<CqtSpectrogram> {
    const sampleRate = audio.sampleRate;

    // Validate config
    if (config.fMin <= 0) {
        throw new Error("@octoseq/mir: CQT fMin must be positive");
    }
    if (config.fMax <= config.fMin) {
        throw new Error("@octoseq/mir: CQT fMax must be greater than fMin");
    }
    if (config.binsPerOctave <= 0) {
        throw new Error("@octoseq/mir: CQT binsPerOctave must be positive");
    }

    // Determine FFT size based on lowest frequency
    // We need sufficient frequency resolution for the lowest CQT bins
    // Rule of thumb: fftSize should give frequency resolution of fMin / Q
    const Q = 1 / (Math.pow(2, 1 / config.binsPerOctave) - 1);
    const minFreqResolution = config.fMin / Q / 2; // Nyquist for the lowest bin
    const minFftSize = Math.ceil(sampleRate / minFreqResolution);

    // Round up to next power of 2
    let fftSize = 1;
    while (fftSize < minFftSize) {
        fftSize *= 2;
    }

    // Cap at reasonable maximum to avoid memory issues
    fftSize = Math.min(fftSize, 16384);

    // Hop size: default to 1/4 of FFT size for good time resolution
    const hopSize = config.hopSize ?? Math.floor(fftSize / 4);

    // Compute STFT
    const stft = await spectrogram(
        audio,
        { fftSize, hopSize, window: "hann" },
        undefined,
        { isCancelled: options.isCancelled }
    );

    // Create or get cached kernel bank
    const kernelBank = getCqtKernelBank(config, fftSize, sampleRate);

    // Apply CQT kernels to each STFT frame
    const nFrames = stft.magnitudes.length;
    const cqtMagnitudes: Float32Array[] = new Array(nFrames);

    for (let frame = 0; frame < nFrames; frame++) {
        if (options.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        const stftFrame = stft.magnitudes[frame];
        if (!stftFrame) continue;

        cqtMagnitudes[frame] = applyCqtKernels(stftFrame, kernelBank);
    }

    const nOctaves = getNumOctaves(config);
    const nBins = getNumBins(config);

    return {
        sampleRate,
        config,
        times: stft.times,
        magnitudes: cqtMagnitudes,
        nOctaves,
        binsPerOctave: config.binsPerOctave,
        binFrequencies: getCqtBinFrequencies(config),
    };
}

/**
 * Compute CQT and return with metadata for MIR pipeline.
 */
export async function computeCqt(
    audio: AudioBufferLike,
    config?: Partial<CqtConfig>,
    options: CqtOptions = {}
): Promise<{ cqt: CqtSpectrogram; meta: MirRunMeta }> {
    const startTime = performance.now();

    const fullConfig = withCqtDefaults(config);
    const cqt = await cqtSpectrogram(audio, fullConfig, options);

    const endTime = performance.now();

    return {
        cqt,
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
