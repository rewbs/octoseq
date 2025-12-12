import { describe, expect, it } from "vitest";

import { getFftBackend } from "../src/dsp/fftBackend";

function argMax(arr: Float32Array): number {
    let bestI = 0;
    let bestV = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i] ?? 0;
        if (v > bestV) {
            bestV = v;
            bestI = i;
        }
    }
    return bestI;
}

describe("@octoseq/mir FFT backend (fft.js)", () => {
    it("silence -> all zeros (no NaNs)", () => {
        const N = 1024;
        const fft = getFftBackend(N);
        const frame = new Float32Array(N);

        const { real, imag } = fft.forwardReal(frame);
        expect(real.length).toBe(N);
        expect(imag.length).toBe(N);

        for (let i = 0; i < N; i++) {
            const re = real[i] ?? 0;
            const im = imag[i] ?? 0;
            expect(Number.isFinite(re)).toBe(true);
            expect(Number.isFinite(im)).toBe(true);
            // Canonicalise -0 -> +0; backend should already do this.
            expect(re).toBe(0);
            expect(im).toBe(0);
        }
    });

    it("impulse -> flat magnitude spectrum (approximately)", () => {
        const N = 1024;
        const fft = getFftBackend(N);
        const frame = new Float32Array(N);
        frame[0] = 1;

        const { real, imag } = fft.forwardReal(frame);

        const nBins = N / 2 + 1;
        const mags = new Float32Array(nBins);
        for (let k = 0; k < nBins; k++) mags[k] = Math.hypot(real[k] ?? 0, imag[k] ?? 0);

        // For an impulse, |FFT| should be ~1 for all bins.
        // Tolerance: small float error only.
        const tol = 1e-4;
        const target = mags[0] ?? 0;
        for (let k = 0; k < nBins; k++) {
            expect(Math.abs((mags[k] ?? 0) - target)).toBeLessThanOrEqual(tol);
        }
    });

    it("sine -> dominant bin when frequency is exactly bin-centered", () => {
        const sampleRate = 48000;
        const N = 2048;

        // Choose a bin-centered frequency to avoid spectral leakage:
        // f = k * sr / N  => exactly k cycles in N samples.
        const kExpected = 19;
        const f = (kExpected * sampleRate) / N;

        const fft = getFftBackend(N);
        const frame = new Float32Array(N);
        for (let n = 0; n < N; n++) {
            frame[n] = Math.sin((2 * Math.PI * f * n) / sampleRate);
        }

        const { real, imag } = fft.forwardReal(frame);
        const nBins = N / 2 + 1;
        const mags = new Float32Array(nBins);
        for (let k = 0; k < nBins; k++) mags[k] = Math.hypot(real[k] ?? 0, imag[k] ?? 0);

        const kMax = argMax(mags);
        expect(kMax).toBe(kExpected);

        // For a perfectly bin-centered sine, energy should be concentrated mostly in that bin.
        // (We use a fairly conservative dominance factor due to float error.)
        const peak = mags[kMax] ?? 0;
        let next = 0;
        for (let k = 0; k < nBins; k++) {
            if (k === kMax) continue;
            next = Math.max(next, mags[k] ?? 0);
        }
        expect(peak).toBeGreaterThan(next * 50);
    });
});
