/**
 * Display-only transforms for spectrogram-like (magnitude) data.
 *
 * These helpers are intentionally *not* used inside core MIR algorithms.
 * They exist so applications can apply established visualisation practices
 * (e.g. dB conversion, clamping) without mutating or rescaling the analysis
 * outputs.
 *
 * Shape conventions:
 * - 2D arrays are `[frame][bin]`.
 */

export type Spectrogram2D = Float32Array[]; // [frame][bin]

export type SpectrogramToDbOptions = {
    /**
     * Optional floor (minimum) dB value applied during conversion.
     * This is a display convenience only.
     */
    floorDb?: number;

    /** Epsilon used to avoid log(0). Defaults to 1e-12. */
    epsilon?: number;
};

/**
 * Convert linear magnitudes to dB.
 *
 * Formula: `db = 20 * log10(max(eps, magnitude))`
 *
 * Notes:
 * - This does *not* normalise or re-reference the values.
 * - The input is not mutated.
 * - Intended for visualisation only.
 */
export function spectrogramToDb(magnitudes2d: Spectrogram2D, options: SpectrogramToDbOptions = {}): Spectrogram2D {
    const eps = options.epsilon ?? 1e-12;
    const floorDb = options.floorDb;

    const out: Float32Array[] = new Array(magnitudes2d.length);

    for (let t = 0; t < magnitudes2d.length; t++) {
        const row = magnitudes2d[t] ?? new Float32Array(0);
        const dbRow = new Float32Array(row.length);

        for (let k = 0; k < row.length; k++) {
            const mag = row[k] ?? 0;
            const db = 20 * Math.log10(Math.max(eps, mag));
            dbRow[k] = floorDb !== undefined ? Math.max(floorDb, db) : db;
        }

        out[t] = dbRow;
    }

    return out;
}

/**
 * Clamp a dB-scaled 2D array to a fixed range.
 *
 * The input is not mutated.
 * Intended for visualisation only.
 */
export function clampDb(db2d: Spectrogram2D, minDb: number, maxDb: number): Spectrogram2D {
    const out: Float32Array[] = new Array(db2d.length);

    for (let t = 0; t < db2d.length; t++) {
        const row = db2d[t] ?? new Float32Array(0);
        const clamped = new Float32Array(row.length);

        for (let k = 0; k < row.length; k++) {
            const v = row[k] ?? 0;
            clamped[k] = v < minDb ? minDb : v > maxDb ? maxDb : v;
        }

        out[t] = clamped;
    }

    return out;
}
