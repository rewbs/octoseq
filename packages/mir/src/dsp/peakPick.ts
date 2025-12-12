export type PeakPickEvent = {
    time: number;
    strength: number;
    index: number;
};

export type PeakPickOptions = {
    /** Minimum peak height (absolute). */
    threshold?: number;
    /** Minimum inter-peak interval (seconds). */
    minIntervalSec?: number;

    /** If provided, use adaptive threshold: mean(values) + factor*std(values). */
    adaptive?: {
        method?: "meanStd" | "median";
        factor?: number;
    };

    /** If true, prefer strict maxima (> neighbors); else allow flat plateaus. */
    strict?: boolean;
};

function meanStd(values: Float32Array): { mean: number; std: number } {
    const n = values.length;
    if (n <= 0) return { mean: 0, std: 0 };

    let mean = 0;
    for (let i = 0; i < n; i++) mean += values[i] ?? 0;
    mean /= n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
        const d = (values[i] ?? 0) - mean;
        varSum += d * d;
    }

    const std = Math.sqrt(varSum / n);
    return { mean, std };
}

function median(values: Float32Array): number {
    const arr = Array.from(values);
    arr.sort((a, b) => a - b);
    const n = arr.length;
    if (n === 0) return 0;
    const mid = n >>> 1;
    if (n % 2 === 1) return arr[mid] ?? 0;
    return ((arr[mid - 1] ?? 0) + (arr[mid] ?? 0)) / 2;
}

export function peakPick(
    times: Float32Array,
    values: Float32Array,
    options: PeakPickOptions = {}
): PeakPickEvent[] {
    if (times.length !== values.length) {
        throw new Error("@octoseq/mir: peakPick times/values length mismatch");
    }

    const n = values.length;
    if (n === 0) return [];

    const strict = options.strict ?? true;

    let thr = options.threshold ?? 0;
    if (options.adaptive) {
        const method = options.adaptive.method ?? "meanStd";
        const factor = options.adaptive.factor ?? 1;

        if (method === "median") {
            thr = median(values) * factor;
        } else {
            const { mean, std } = meanStd(values);
            thr = mean + factor * std;
        }
    }

    const minIntervalSec = options.minIntervalSec ?? 0;

    const out: PeakPickEvent[] = [];

    let lastPeakTime = -Infinity;

    for (let i = 1; i < n - 1; i++) {
        const v = values[i] ?? 0;
        if (!(v >= thr)) continue;

        const prev = values[i - 1] ?? 0;
        const next = values[i + 1] ?? 0;

        const isMax = strict ? v > prev && v > next : v >= prev && v >= next;
        if (!isMax) continue;

        const t = times[i] ?? 0;
        if (t - lastPeakTime < minIntervalSec) {
            // If we're within the minimum interval, keep the stronger peak.
            const last = out[out.length - 1];
            if (last && v > last.strength) {
                last.time = t;
                last.strength = v;
                last.index = i;
                lastPeakTime = t;
            }
            continue;
        }

        out.push({ time: t, strength: v, index: i });
        lastPeakTime = t;
    }

    return out;
}
