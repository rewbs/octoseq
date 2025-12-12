/**
 * Minimal, dependency-free FFT implementation.
 *
 * Design choice:
 * - v0.1 uses a straightforward radix-2 Cooley–Tukey complex FFT.
 * - We always run a full complex FFT for simplicity (real->complex optimisations can come later).
 * - This module is intentionally small and self-contained so a WebGPU FFT can replace it later.
 */

export type ComplexArray = {
    real: Float32Array;
    imag: Float32Array;
};

export function hannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    // Periodic Hann (common for STFT overlap-add).
    for (let n = 0; n < size; n++) {
        w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
    }
    return w;
}

function reverseBits(x: number, bits: number): number {
    let y = 0;
    for (let i = 0; i < bits; i++) {
        y = (y << 1) | (x & 1);
        x >>>= 1;
    }
    return y;
}

/**
 * In-place radix-2 FFT.
 *
 * @param real real part (length must be power of two)
 * @param imag imag part (length must be power of two)
 */
export function fftInPlace(real: Float32Array, imag: Float32Array): void {
    const n = real.length;
    if (n !== imag.length) {
        throw new Error("fftInPlace: real/imag lengths must match");
    }
    if ((n & (n - 1)) !== 0) {
        throw new Error("fftInPlace: length must be a power of two");
    }

    const bits = Math.log2(n) | 0;

    // Bit-reversal permutation
    // Note: this repo uses `noUncheckedIndexedAccess`, so TypedArray reads are `number | undefined`.
    // Indices here are always valid, so we use `?? 0` to satisfy the type system.
    for (let i = 0; i < n; i++) {
        const j = reverseBits(i, bits);
        if (j > i) {
            const tr = real[i] ?? 0;
            real[i] = real[j] ?? 0;
            real[j] = tr;

            const ti = imag[i] ?? 0;
            imag[i] = imag[j] ?? 0;
            imag[j] = ti;
        }
    }

    // Iterative Danielson–Lanczos
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >>> 1;
        const theta = (-2 * Math.PI) / size;

        // We update twiddle factors via recurrence for speed & stability.
        const wtemp = Math.sin(0.5 * theta);
        const wpr = -2.0 * wtemp * wtemp;
        const wpi = Math.sin(theta);

        for (let start = 0; start < n; start += size) {
            let wr = 1.0;
            let wi = 0.0;

            for (let k = 0; k < half; k++) {
                const i = start + k;
                const j = i + half;

                const rj = real[j] ?? 0;
                const ij = imag[j] ?? 0;
                const ri = real[i] ?? 0;
                const ii = imag[i] ?? 0;

                const tr = wr * rj - wi * ij;
                const ti = wr * ij + wi * rj;

                real[j] = ri - tr;
                imag[j] = ii - ti;
                real[i] = ri + tr;
                imag[i] = ii + ti;

                const wrNext = wr + wr * wpr - wi * wpi;
                const wiNext = wi + wi * wpr + wr * wpi;
                wr = wrNext;
                wi = wiNext;
            }
        }
    }
}

export function magnitudesFromFft(
    real: Float32Array,
    imag: Float32Array
): Float32Array {
    const n = real.length;
    const nBins = (n >>> 1) + 1;
    const mags = new Float32Array(nBins);
    for (let k = 0; k < nBins; k++) {
        const re = real[k] ?? 0;
        const im = imag[k] ?? 0;
        mags[k] = Math.hypot(re, im);
    }
    return mags;
}
