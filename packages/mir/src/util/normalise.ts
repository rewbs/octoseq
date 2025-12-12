export type NormaliseForWaveformOptions = {
    min?: number;
    max?: number;
    center?: boolean;
};

/**
 * Normalise a time-aligned feature array into a waveform-friendly range.
 *
 * Typical uses:
 * - Map spectralFlux or centroid to [-1, 1] to re-use a waveform renderer.
 *
 * Defaults:
 * - If `center` is true: range [-1, 1] (zero-centered)
 * - Else: range [0, 1]
 */
export function normaliseForWaveform(
    data: Float32Array,
    options: NormaliseForWaveformOptions = {}
): Float32Array {
    const center = options.center ?? false;

    const targetMin = options.min ?? (center ? -1 : 0);
    const targetMax = options.max ?? 1;

    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax)) {
        throw new Error("@octoseq/mir: normaliseForWaveform min/max must be finite");
    }
    if (targetMax === targetMin) {
        throw new Error("@octoseq/mir: normaliseForWaveform max must differ from min");
    }

    let srcMin = Infinity;
    let srcMax = -Infinity;
    for (let i = 0; i < data.length; i++) {
        const v = data[i] ?? 0;
        if (v < srcMin) srcMin = v;
        if (v > srcMax) srcMax = v;
    }

    // Degenerate or empty: return a constant line at the middle of the target range.
    if (!Number.isFinite(srcMin) || !Number.isFinite(srcMax) || srcMax === srcMin) {
        const out = new Float32Array(data.length);
        const mid = (targetMin + targetMax) / 2;
        out.fill(mid);
        return out;
    }

    const out = new Float32Array(data.length);
    const scale = (targetMax - targetMin) / (srcMax - srcMin);

    for (let i = 0; i < data.length; i++) {
        const v = data[i] ?? 0;
        out[i] = targetMin + (v - srcMin) * scale;
    }

    return out;
}
