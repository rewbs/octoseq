export type MinMax = {
    min: number;
    max: number;
};

/**
 * Compute min/max in a single pass without using spread / Math.min(...arr).
 *
 * Safe for very large arrays (millions of samples).
 */
export function minMax(values: ArrayLike<number>): MinMax {
    const n = values.length >>> 0;
    if (n === 0) return { min: Infinity, max: -Infinity };

    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < n; i++) {
        const v = values[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
    }

    return { min, max };
}
