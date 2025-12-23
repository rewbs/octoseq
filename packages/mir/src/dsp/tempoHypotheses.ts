import type { BeatCandidate, TempoHypothesis, TempoHypothesisEvidence } from "../types";

/**
 * Configuration for tempo hypothesis generation.
 */
export type TempoHypothesesOptions = {
    /** Minimum BPM to consider. Default: 24. */
    minBpm?: number;
    /** Maximum BPM to consider. Default: 300. */
    maxBpm?: number;
    /** Histogram bin size in BPM. Default: 1.0. */
    binSizeBpm?: number;
    /** Maximum hypotheses to return. Default: 10. */
    maxHypotheses?: number;
    /** Minimum confidence threshold (0-1). Default: 0.05. */
    minConfidence?: number;
    /** Weight IOIs by candidate strength. Default: true. */
    weightByStrength?: boolean;
    /** Include histogram data in output. Default: false. */
    includeHistogram?: boolean;
};

export type TempoHypothesesOutput = {
    hypotheses: TempoHypothesis[];
    inputCandidateCount: number;
    histogram?: {
        bpmBins: Float32Array;
        counts: Float32Array;
    };
};

/**
 * Convert interval (seconds) to BPM.
 */
function intervalToBpm(intervalSec: number): number {
    return 60.0 / intervalSec;
}

/**
 * Convert BPM to interval (seconds).
 */
function bpmToInterval(bpm: number): number {
    return 60.0 / bpm;
}

type IOI = { intervalSec: number; weight: number };

/**
 * Compute inter-onset intervals from beat candidates.
 *
 * @param candidates - Beat candidates sorted by time
 * @param weightByStrength - Whether to weight by candidate strength
 * @returns Array of { intervalSec, weight } pairs
 */
function computeIOIs(candidates: BeatCandidate[], weightByStrength: boolean): IOI[] {
    if (candidates.length < 2) return [];

    const iois: IOI[] = [];

    // Sort candidates by time (should already be sorted, but be defensive)
    const sorted = [...candidates].sort((a, b) => a.time - b.time);

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        const interval = curr.time - prev.time;

        // Skip invalid intervals
        if (interval <= 0) continue;

        // Weight is geometric mean of adjacent strengths, or 1.0 if not weighting
        const weight = weightByStrength
            ? Math.sqrt(prev.strength * curr.strength)
            : 1.0;

        iois.push({ intervalSec: interval, weight });
    }

    return iois;
}

/**
 * Build a weighted histogram of BPM values from IOIs.
 *
 * @param iois - Inter-onset intervals with weights
 * @param minBpm - Minimum BPM (determines max interval)
 * @param maxBpm - Maximum BPM (determines min interval)
 * @param binSizeBpm - Size of each histogram bin in BPM
 * @returns { bins: center BPM of each bin, counts: weighted counts }
 */
function buildBpmHistogram(
    iois: IOI[],
    minBpm: number,
    maxBpm: number,
    binSizeBpm: number
): { bpmBins: Float32Array; counts: Float32Array } {
    const numBins = Math.ceil((maxBpm - minBpm) / binSizeBpm);
    const counts = new Float32Array(numBins);
    const bpmBins = new Float32Array(numBins);

    // Initialize bin centers
    for (let i = 0; i < numBins; i++) {
        bpmBins[i] = minBpm + (i + 0.5) * binSizeBpm;
    }

    // Convert interval range to BPM range
    const minInterval = bpmToInterval(maxBpm);
    const maxInterval = bpmToInterval(minBpm);

    for (const { intervalSec, weight } of iois) {
        // Filter to plausible range
        if (intervalSec < minInterval || intervalSec > maxInterval) continue;

        const bpm = intervalToBpm(intervalSec);
        const binIndex = Math.floor((bpm - minBpm) / binSizeBpm);

        if (binIndex >= 0 && binIndex < numBins) {
            counts[binIndex] = (counts[binIndex] ?? 0) + weight;
        }
    }

    return { bpmBins, counts };
}

/**
 * Find peaks in the histogram using local maximum detection.
 *
 * @param counts - Weighted counts per bin
 * @param minHeight - Minimum peak height (absolute)
 * @returns Array of peak indices sorted by height descending
 */
function findHistogramPeaks(counts: Float32Array, minHeight: number): number[] {
    const peaks: Array<{ index: number; height: number }> = [];

    for (let i = 1; i < counts.length - 1; i++) {
        const curr = counts[i]!;
        const prev = counts[i - 1]!;
        const next = counts[i + 1]!;

        // Local maximum
        if (curr > prev && curr > next && curr >= minHeight) {
            peaks.push({ index: i, height: curr });
        }
    }

    // Also check boundary bins if they're high enough
    if (counts.length > 0 && counts[0]! >= minHeight && counts[0]! > (counts[1] ?? 0)) {
        peaks.push({ index: 0, height: counts[0]! });
    }
    if (counts.length > 1) {
        const last = counts.length - 1;
        if (counts[last]! >= minHeight && counts[last]! > (counts[last - 1] ?? 0)) {
            peaks.push({ index: last, height: counts[last]! });
        }
    }

    // Sort by height descending
    peaks.sort((a, b) => b.height - a.height);

    return peaks.map((p) => p.index);
}

/**
 * Merge adjacent peak bins to get refined BPM estimate.
 * Uses weighted centroid of adjacent bins.
 */
function refinePeakBpm(
    peakIndex: number,
    bpmBins: Float32Array,
    counts: Float32Array,
    binSizeBpm: number
): { bpm: number; peakHeight: number; binRange: [number, number]; totalWeight: number } {
    // Consider the peak bin and immediate neighbors
    let totalWeight = 0;
    let weightedBpm = 0;
    let minBinBpm = bpmBins[peakIndex]! - binSizeBpm / 2;
    let maxBinBpm = bpmBins[peakIndex]! + binSizeBpm / 2;

    for (let offset = -1; offset <= 1; offset++) {
        const idx = peakIndex + offset;
        if (idx < 0 || idx >= bpmBins.length) continue;

        const w = counts[idx]!;
        const bpm = bpmBins[idx]!;

        totalWeight += w;
        weightedBpm += w * bpm;

        if (w > 0) {
            minBinBpm = Math.min(minBinBpm, bpm - binSizeBpm / 2);
            maxBinBpm = Math.max(maxBinBpm, bpm + binSizeBpm / 2);
        }
    }

    const refinedBpm = totalWeight > 0 ? weightedBpm / totalWeight : bpmBins[peakIndex]!;

    return {
        bpm: refinedBpm,
        peakHeight: counts[peakIndex]!,
        binRange: [minBinBpm, maxBinBpm],
        totalWeight,
    };
}

/**
 * Check if two BPMs are harmonically related (within tolerance).
 * Returns the harmonic ratio if related, null otherwise.
 */
function getHarmonicRatio(bpm1: number, bpm2: number, tolerance: number = 0.03): number | null {
    const ratios = [0.5, 1 / 3, 2 / 3, 1.0, 1.5, 2.0, 3.0];

    for (const ratio of ratios) {
        const expected = bpm1 * ratio;
        const relativeError = Math.abs(bpm2 - expected) / expected;
        if (relativeError <= tolerance) {
            return ratio;
        }
    }

    return null;
}

/**
 * Group hypotheses into harmonic families.
 * Assigns familyId and harmonicRatio to each hypothesis.
 *
 * Uses deterministic family IDs based on the root BPM.
 */
function assignHarmonicFamilies(hypotheses: TempoHypothesis[]): void {
    if (hypotheses.length === 0) return;

    const families: Map<string, { rootBpm: number; members: TempoHypothesis[] }> = new Map();

    for (const hyp of hypotheses) {
        let foundFamily = false;

        for (const [familyId, family] of families) {
            const ratio = getHarmonicRatio(family.rootBpm, hyp.bpm);
            if (ratio !== null) {
                hyp.familyId = familyId;
                hyp.harmonicRatio = ratio;
                family.members.push(hyp);
                foundFamily = true;
                break;
            }
        }

        if (!foundFamily) {
            // Create new family with this hypothesis as root
            // Use deterministic family ID based on root BPM
            const familyId = `fam-${Math.round(hyp.bpm)}`;
            hyp.familyId = familyId;
            hyp.harmonicRatio = 1.0;
            families.set(familyId, { rootBpm: hyp.bpm, members: [hyp] });
        }
    }
}

/**
 * Normalize confidence scores to [0, 1] range.
 */
function normalizeConfidence(hypotheses: TempoHypothesis[]): void {
    if (hypotheses.length === 0) return;

    const maxHeight = Math.max(...hypotheses.map((h) => h.evidence.peakHeight));
    if (maxHeight <= 0) return;

    for (const hyp of hypotheses) {
        hyp.confidence = hyp.evidence.peakHeight / maxHeight;
    }
}

/**
 * Generate tempo hypotheses from beat candidates.
 *
 * Algorithm:
 * 1. Compute inter-onset intervals (IOIs) from beat candidates
 * 2. Filter IOIs to musically plausible range (0.2s-2.5s -> 24-300 BPM)
 * 3. Build weighted histogram with configurable bin size
 * 4. Extract peaks as tempo candidates
 * 5. Refine BPM estimates using weighted centroid
 * 6. Group into harmonic families
 * 7. Normalize confidence scores
 *
 * @param candidates - Beat candidates from B1
 * @param options - Configuration options
 * @returns Tempo hypotheses with confidence and family groupings
 */
export function generateTempoHypotheses(
    candidates: BeatCandidate[],
    options?: TempoHypothesesOptions
): TempoHypothesesOutput {
    const minBpm = options?.minBpm ?? 24;
    const maxBpm = options?.maxBpm ?? 300;
    const binSizeBpm = options?.binSizeBpm ?? 1.0;
    const maxHypotheses = options?.maxHypotheses ?? 10;
    const minConfidence = options?.minConfidence ?? 0.05;
    const weightByStrength = options?.weightByStrength ?? true;
    const includeHistogram = options?.includeHistogram ?? false;

    // Early return if insufficient candidates
    if (candidates.length < 2) {
        return {
            hypotheses: [],
            inputCandidateCount: candidates.length,
            histogram: includeHistogram
                ? {
                      bpmBins: new Float32Array(0),
                      counts: new Float32Array(0),
                  }
                : undefined,
        };
    }

    // Step 1: Compute IOIs
    const iois = computeIOIs(candidates, weightByStrength);

    if (iois.length === 0) {
        return {
            hypotheses: [],
            inputCandidateCount: candidates.length,
            histogram: includeHistogram
                ? {
                      bpmBins: new Float32Array(0),
                      counts: new Float32Array(0),
                  }
                : undefined,
        };
    }

    // Step 2-3: Build histogram (filtering happens during binning)
    const { bpmBins, counts } = buildBpmHistogram(iois, minBpm, maxBpm, binSizeBpm);

    // Calculate minimum height threshold based on minConfidence
    const maxCount = Math.max(...counts);
    const minHeight = maxCount * minConfidence;

    // Step 4: Find peaks
    const peakIndices = findHistogramPeaks(counts, minHeight);

    // Step 5: Create hypotheses with refined BPM
    const hypotheses: TempoHypothesis[] = [];

    for (const peakIndex of peakIndices.slice(0, maxHypotheses * 2)) {
        // Get extra for filtering
        const { bpm, peakHeight, binRange, totalWeight } = refinePeakBpm(
            peakIndex,
            bpmBins,
            counts,
            binSizeBpm
        );

        // Skip if below confidence threshold
        if (maxCount > 0 && peakHeight / maxCount < minConfidence) continue;

        const evidence: TempoHypothesisEvidence = {
            supportingIntervalCount: Math.round(totalWeight),
            weightedSupport: totalWeight,
            peakHeight,
            binRange,
        };

        hypotheses.push({
            id: "", // Will be assigned after sorting
            bpm: Math.round(bpm * 10) / 10, // Round to 0.1 BPM precision
            confidence: 0, // Will be normalized
            evidence,
            familyId: "", // Will be assigned
            harmonicRatio: 1.0, // Will be assigned
        });
    }

    // Step 6: Group into harmonic families
    assignHarmonicFamilies(hypotheses);

    // Step 7: Normalize confidence
    normalizeConfidence(hypotheses);

    // Filter by minConfidence and sort by confidence descending
    const filtered = hypotheses
        .filter((h) => h.confidence >= minConfidence)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxHypotheses);

    // Assign deterministic IDs based on rank
    for (let i = 0; i < filtered.length; i++) {
        filtered[i]!.id = `hyp-${i}`;
    }

    return {
        hypotheses: filtered,
        inputCandidateCount: candidates.length,
        histogram: includeHistogram ? { bpmBins, counts } : undefined,
    };
}
