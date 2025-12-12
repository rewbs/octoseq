/**
 * `fft.js` backend.
 *
 * Notes:
 * - We intentionally keep this file small and self-contained so we can replace it later with a GPU FFT.
 * - `fft.js` performs an unnormalised forward FFT (same convention as our previous radix-2 code).
 * - We allocate the plan once per fftSize and reuse internal buffers across frames.
 */

import FFT from "fft.js";

import type { FftBackend, FftComplexOutput } from "./fftBackend";

export function createFftJsBackend(fftSize: number): FftBackend {
    if (!Number.isFinite(fftSize) || fftSize <= 0 || (fftSize | 0) !== fftSize) {
        throw new Error("@octoseq/mir: fftSize must be a positive integer");
    }

    const fft = new FFT(fftSize);

    // `fft.js` uses interleaved complex arrays [re0, im0, re1, im1, ...]
    // It accepts input for realTransform as a real array of length N.
    const inReal = new Float32Array(fftSize);
    const outComplexInterleaved = fft.createComplexArray() as unknown as Float32Array;

    const outReal = new Float32Array(fftSize);
    const outImag = new Float32Array(fftSize);

    return {
        fftSize,
        forwardReal(frame: Float32Array): FftComplexOutput {
            if (frame.length !== fftSize) {
                throw new Error(
                    `@octoseq/mir: FFT input length (${frame.length}) must equal fftSize (${fftSize})`
                );
            }

            // Copy to stable buffer to avoid fft.js mutating user-owned arrays.
            inReal.set(frame);

            // Real-input FFT.
            // `realTransform(out, data)` fills out with interleaved complex spectrum.
            // `completeSpectrum(out)` fills the negative frequencies so we get full N complex bins.
            fft.realTransform(outComplexInterleaved as unknown as number[], inReal as unknown as number[]);
            fft.completeSpectrum(outComplexInterleaved as unknown as number[]);

            // De-interleave into (real, imag) arrays.
            // Note: we keep full spectrum even though most consumers only need 0..N/2.
            for (let k = 0; k < fftSize; k++) {
                const re = outComplexInterleaved[2 * k] ?? 0;
                const im = outComplexInterleaved[2 * k + 1] ?? 0;
                // Canonicalise -0 -> +0 so silence tests and downstream comparisons are stable.
                outReal[k] = re === 0 ? 0 : re;
                outImag[k] = im === 0 ? 0 : im;
            }

            return { real: outReal, imag: outImag };
        }
    };
}
