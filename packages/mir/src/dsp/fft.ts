/**
 * Windowing utilities.
 *
 * Note:
 * - The FFT implementation previously lived in this file.
 * - As of v0.1.x we use `fft.js` behind an internal backend abstraction (see `fftBackend.ts`).
 * - We keep only the window function here because it is part of the STFT behaviour that downstream
 *   stages depend on.
 */

// (Complex FFT implementation removed; kept intentionally empty.)

export function hannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    // Periodic Hann (common for STFT overlap-add).
    for (let n = 0; n < size; n++) {
        w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
    }
    return w;
}

// FFT and magnitude helpers removed.
