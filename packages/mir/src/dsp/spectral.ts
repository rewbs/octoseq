import type { Spectrogram } from "./spectrogram";

/**
 * Spectral centroid per frame (Hz).
 *
 * Output is aligned 1:1 with `spec.times`.
 */
export function spectralCentroid(spec: Spectrogram): Float32Array {
    const nFrames = spec.times.length;
    const out = new Float32Array(nFrames);

    const nBins = (spec.fftSize >>> 1) + 1;
    const binHz = spec.sampleRate / spec.fftSize;

    for (let t = 0; t < nFrames; t++) {
        const mags = spec.magnitudes[t];
        if (!mags) {
            out[t] = 0;
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

        out[t] = den > 0 ? num / den : 0;
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
 */
export function spectralFlux(spec: Spectrogram): Float32Array {
    const nFrames = spec.times.length;
    const out = new Float32Array(nFrames);

    const nBins = (spec.fftSize >>> 1) + 1;

    let prev: Float32Array | null = null;

    for (let t = 0; t < nFrames; t++) {
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
