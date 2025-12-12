/**
 * Internal FFT backend abstraction.
 *
 * Why:
 * - The rest of the STFT pipeline should not care about the FFT implementation.
 * - We want to be able to swap this layer for a future WebGPU FFT without touching callers.
 */

export type FftComplexOutput = {
    /** Full-length FFT output (length = fftSize). */
    real: Float32Array;
    /** Full-length FFT output (length = fftSize). */
    imag: Float32Array;
};

export interface FftBackend {
    readonly fftSize: number;

    /**
     * Forward FFT for real-valued input.
     *
     * Contract:
     * - input length must equal fftSize.
     * - returns full complex spectrum (not just rfft half-spectrum) to keep the interface generic.
     *
     * Scaling:
     * - No normalisation is applied (same convention as typical FFT libraries, incl. fft.js).
     * - Therefore magnitude values scale roughly with window sum and fftSize.
     *   This matches the previous hand-rolled FFT behaviour and is close to librosa's default
     *   `np.abs(np.fft.rfft(...))` magnitude semantics (also unnormalised).
     */
    forwardReal(input: Float32Array): FftComplexOutput;
}

/**
 * Internal cache to avoid re-creating FFT plans for the same size.
 * Safe for Web Workers (per-worker module instance). Not shared across threads.
 */
const backendCache = new Map<number, FftBackend>();

export function getFftBackend(fftSize: number): FftBackend {
    const existing = backendCache.get(fftSize);
    if (existing) return existing;

    // Note: ESM static import is OK in browsers and Web Workers.
    // The cache ensures the plan is only created once per fftSize per worker.
    const created = createFftJsBackend(fftSize);
    backendCache.set(fftSize, created);
    return created;
}

// Implemented in separate file to keep the public surface minimal.
import { createFftJsBackend } from "./fftBackendFftjs";
