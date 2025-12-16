import type { MelSpectrogram } from "../dsp/mel";
import type { Features2D } from "../dsp/mfcc";
import { peakPick } from "../dsp/peakPick";

import type { MirSearchCandidate, MirSearchOptionsV1 } from "./searchTrackV1";
import { makeFeatureVectorLayoutV1 } from "./featureVectorV1";
import {
    buildPrototypeModelV1,
    logitContributionsByGroupV1,
    scoreWithModelV1,
    trainLogisticModelV1,
    type MirLogitContributionsByGroupV1,
    type MirRefinedModelExplainV1,
    type MirRefinedModelKindV1,
} from "./refinedModelV1";

export type MirRefinementCandidateLabelV1 = {
    t0: number;
    t1: number;
    status: "accepted" | "rejected";
    source: "auto" | "manual";
};

export type MirSearchGuidedOptionsV1 = MirSearchOptionsV1 & {
    /**
     * Local contrast features: foreground (query-length) vs surrounding background.
     * Enabled by default because it improves discrimination in dense mixes.
     */
    localContrast?: {
        enabled?: boolean;
        /** Background duration multiplier relative to the foreground. Default 3. */
        backgroundScale?: number;
    };
    refinement?: {
        enabled?: boolean;
        /**
         * Human labels (accepted/rejected). Unreviewed candidates should not be sent.
         */
        labels?: MirRefinementCandidateLabelV1[];
        /** Optional: include the query as an extra positive exemplar once enough positives exist. */
        includeQueryAsPositive?: boolean;
    };
};

export type MirSearchCurveKindV1 = "similarity" | "confidence";

export type MirGuidedCandidateExplainV1 = {
    /** Only present for logistic models; values are in logit space (sum + bias = total logit). */
    groupLogit?: MirLogitContributionsByGroupV1;
};

export type MirSearchCandidateV1Guided = MirSearchCandidate & {
    explain?: MirGuidedCandidateExplainV1;
};

export type MirSearchResultV1Guided = {
    times: Float32Array; // window start times
    scores: Float32Array; // [0,1] similarity or confidence
    candidates: MirSearchCandidateV1Guided[];
    curveKind: MirSearchCurveKindV1;
    model: MirRefinedModelExplainV1;
    meta: {
        /** Feature prep time (legacy name retained for UI compatibility). */
        fingerprintMs: number;
        scanMs: number;
        modelMs: number;
        totalMs: number;
        windowSec: number;
        hopSec: number;
        skippedWindows: number;
        scannedWindows: number;
    };
};

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clamp01(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x;
}

function zScoreInPlace(out: Float32Array, mean: Float32Array, invStd: Float32Array): void {
    const n = Math.min(out.length, mean.length, invStd.length);
    for (let j = 0; j < n; j++) out[j] = ((out[j] ?? 0) - (mean[j] ?? 0)) * (invStd[j] ?? 1);
}

function decideModelKind(params: {
    enabled: boolean;
    labels: MirRefinementCandidateLabelV1[];
}): { kind: MirRefinedModelKindV1; positives: MirRefinementCandidateLabelV1[]; negatives: MirRefinementCandidateLabelV1[] } {
    if (!params.enabled) return { kind: "baseline", positives: [], negatives: [] };

    const positives = params.labels.filter((l) => l.status === "accepted");
    const negatives = params.labels.filter((l) => l.status === "rejected");

    // Training rule: fewer than 2 positive examples => skip training.
    if (positives.length < 2) return { kind: "baseline", positives, negatives };
    if (negatives.length === 0) return { kind: "prototype", positives, negatives };
    return { kind: "logistic", positives, negatives };
}

function advanceStartIndex(times: Float32Array, start: number, t0: number): number {
    let i = start;
    while (i < times.length && (times[i] ?? 0) < t0) i++;
    return i;
}

function advanceEndIndex(times: Float32Array, endExclusive: number, t1: number): number {
    let i = endExclusive;
    while (i < times.length && (times[i] ?? 0) <= t1) i++;
    return i;
}

function cosineSimilarity01ByBlocks(
    query: Float32Array,
    window: Float32Array,
    layout: ReturnType<typeof makeFeatureVectorLayoutV1>,
    weights: { mel?: number; transient?: number; mfcc?: number } | undefined
): number {
    const wMel = weights?.mel ?? 1;
    const wTrans = weights?.transient ?? 1;
    const wMfcc = weights?.mfcc ?? 1;

    const addBlock = (offset: number, length: number, weight: number, acc: { dot: number; aa: number; bb: number }) => {
        if (length <= 0 || weight === 0) return;

        const ww = weight * weight;
        const eps = 1e-12;

        // Compute dot + norms for this block in one pass; then normalise to match
        // fingerprintToVectorV1(): L2-normalise each block independently, then weight.
        let dotRaw = 0;
        let qSumSq = 0;
        let xSumSq = 0;
        const end = Math.min(query.length, window.length, offset + length);
        for (let i = offset; i < end; i++) {
            const q = query[i] ?? 0;
            const x = window[i] ?? 0;
            dotRaw += q * x;
            qSumSq += q * q;
            xSumSq += x * x;
        }

        const qNorm = Math.sqrt(qSumSq);
        const xNorm = Math.sqrt(xSumSq);

        if (qNorm > eps) acc.aa += ww;
        if (xNorm > eps) acc.bb += ww;
        if (!(qNorm > eps && xNorm > eps)) return;

        acc.dot += ww * (dotRaw / (qNorm * xNorm));
    };

    const acc = { dot: 0, aa: 0, bb: 0 };

    // Foreground blocks
    addBlock(layout.melMeanFg.offset, layout.melMeanFg.length + layout.melVarianceFg.length, wMel, acc);
    addBlock(layout.onsetFg.offset, layout.onsetFg.length, wTrans, acc);
    if (layout.mfccMeanFg && layout.mfccVarianceFg) {
        addBlock(layout.mfccMeanFg.offset, layout.mfccMeanFg.length + layout.mfccVarianceFg.length, wMfcc, acc);
    }

    // Contrast blocks (if present)
    if (layout.melContrast) addBlock(layout.melContrast.offset, layout.melContrast.length, wMel, acc);
    if (layout.onsetContrast) addBlock(layout.onsetContrast.offset, layout.onsetContrast.length, wTrans, acc);
    if (layout.mfccMeanContrast && layout.mfccVarianceContrast) {
        addBlock(layout.mfccMeanContrast.offset, layout.mfccMeanContrast.length + layout.mfccVarianceContrast.length, wMfcc, acc);
    }

    const denom = Math.sqrt(acc.aa) * Math.sqrt(acc.bb);
    if (denom <= 0) return 0;

    const cos = acc.dot / denom;
    const clamped = Math.max(-1, Math.min(1, cos));
    return (clamped + 1) / 2;
}

type SparseMaxQuery = {
    query: (start: number, endExclusive: number) => number;
};

function buildSparseTableMax(values: Float32Array, isCancelled?: () => boolean): SparseMaxQuery {
    const n = values.length;
    const log = new Uint8Array(n + 1);
    for (let i = 2; i <= n; i++) log[i] = ((log[i >>> 1] ?? 0) + 1) as number;
    const maxK = log[n] ?? 0;

    const table: Float32Array[] = [];
    table[0] = values;

    for (let k = 1; k <= maxK; k++) {
        const span = 1 << k;
        const half = span >>> 1;
        const prev = table[k - 1]!;
        const len = Math.max(0, n - span + 1);
        const cur = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            if ((i & 2047) === 0 && isCancelled?.()) throw new Error("@octoseq/mir: cancelled");
            const a = prev[i] ?? 0;
            const b = prev[i + half] ?? 0;
            cur[i] = a > b ? a : b;
        }
        table[k] = cur;
    }

    return {
        query: (start: number, endExclusive: number) => {
            const l = Math.max(0, start | 0);
            const r = Math.min(n, endExclusive | 0);
            const len = r - l;
            if (len <= 0) return -Infinity;
            const k = log[len] ?? 0;
            const span = 1 << k;
            const row = table[k]!;
            const a = row[l] ?? -Infinity;
            const b = row[r - span] ?? -Infinity;
            return a > b ? a : b;
        },
    };
}

function computeBackgroundWindow(params: {
    fgStartSec: number;
    fgEndSec: number;
    trackDurationSec: number;
    backgroundScale: number;
}): { bgStartSec: number; bgEndSec: number } {
    const fgStartSec = Math.min(params.fgStartSec, params.fgEndSec);
    const fgEndSec = Math.max(params.fgStartSec, params.fgEndSec);
    const fgDur = Math.max(1e-6, fgEndSec - fgStartSec);

    const desired = Math.max(fgDur, fgDur * Math.max(1, params.backgroundScale));
    const maxDur = Math.max(fgDur, params.trackDurationSec);
    const dur = Math.min(desired, maxDur);

    const center = (fgStartSec + fgEndSec) / 2;
    let bgStart = center - dur / 2;
    let bgEnd = bgStart + dur;

    // Preserve duration when possible by shifting the window instead of shrinking it.
    if (bgStart < 0) {
        bgStart = 0;
        bgEnd = Math.min(params.trackDurationSec, dur);
    }
    if (bgEnd > params.trackDurationSec) {
        bgEnd = params.trackDurationSec;
        bgStart = Math.max(0, bgEnd - dur);
    }

    // Defensive: ensure the window contains the foreground.
    bgStart = Math.min(bgStart, fgStartSec);
    bgEnd = Math.max(bgEnd, fgEndSec);

    return { bgStartSec: bgStart, bgEndSec: bgEnd };
}

class SlidingMoments {
    private start = 0;
    private end = 0;
    readonly sum: Float64Array;
    readonly sumSq: Float64Array;

    constructor(
        private readonly dim: number,
        private readonly addFrame: (frame: number, sum: Float64Array, sumSq: Float64Array) => void,
        private readonly removeFrame: (frame: number, sum: Float64Array, sumSq: Float64Array) => void
    ) {
        this.sum = new Float64Array(dim);
        this.sumSq = new Float64Array(dim);
    }

    update(newStart: number, newEnd: number) {
        const s = Math.max(0, newStart | 0);
        const e = Math.max(s, newEnd | 0);

        while (this.end < e) {
            this.addFrame(this.end, this.sum, this.sumSq);
            this.end++;
        }
        while (this.start < s) {
            this.removeFrame(this.start, this.sum, this.sumSq);
            this.start++;
        }

        // This class assumes monotonic windows (start/end only move forward).
        // If that assumption is violated, reset deterministically.
        if (this.start > s || this.end > e) {
            this.sum.fill(0);
            this.sumSq.fill(0);
            this.start = s;
            this.end = s;
            while (this.end < e) {
                this.addFrame(this.end, this.sum, this.sumSq);
                this.end++;
            }
        }
    }
}

export async function searchTrackV1Guided(params: {
    queryRegion: { t0: number; t1: number };

    mel: MelSpectrogram;
    onsetEnvelope: { times: Float32Array; values: Float32Array };
    mfcc?: Features2D;

    options?: MirSearchGuidedOptionsV1;
}): Promise<MirSearchResultV1Guided> {
    const tStart = nowMs();

    const options = params.options ?? {};
    const hopSec = Math.max(0.005, options.hopSec ?? 0.03);
    const threshold = clamp01(options.threshold ?? 0.75);
    const localContrastEnabled = options.localContrast?.enabled ?? true;
    const backgroundScale = Math.max(1, options.localContrast?.backgroundScale ?? 3);

    const qt0 = Math.min(params.queryRegion.t0, params.queryRegion.t1);
    const qt1 = Math.max(params.queryRegion.t0, params.queryRegion.t1);
    const windowSec = Math.max(1e-3, qt1 - qt0);

    const minSpacingSec = Math.max(0, options.minCandidateSpacingSec ?? windowSec * 0.8);

    const refinementEnabled = !!options.refinement?.enabled;
    const refinementLabels = options.refinement?.labels ?? [];
    const includeQueryAsPositive = options.refinement?.includeQueryAsPositive ?? true;

    const modelDecision = decideModelKind({ enabled: refinementEnabled, labels: refinementLabels });
    const baselineExplain: MirRefinedModelExplainV1 = refinementEnabled
        ? {
            kind: "baseline",
            positives: modelDecision.positives.length,
            negatives: modelDecision.negatives.length,
        }
        : { kind: "baseline", positives: 0, negatives: 0 };

    const tPrep0 = nowMs();

    const timesFrames = params.mel.times;
    const nFrames = timesFrames.length;

    const trackDuration = Math.max(
        nFrames ? (timesFrames[nFrames - 1] ?? 0) : 0,
        params.onsetEnvelope.times.length ? (params.onsetEnvelope.times[params.onsetEnvelope.times.length - 1] ?? 0) : 0
    );

    const nWindows = Math.max(0, Math.floor((trackDuration - windowSec) / hopSec) + 1);
    const times = new Float32Array(nWindows);
    const scores = new Float32Array(nWindows);

    if (nWindows === 0) {
        const totalMs = nowMs() - tStart;
        return {
            times,
            scores,
            candidates: [],
            curveKind: "similarity",
            model: baselineExplain,
            meta: {
                fingerprintMs: 0,
                scanMs: 0,
                modelMs: 0,
                totalMs,
                windowSec,
                hopSec,
                skippedWindows: 0,
                scannedWindows: 0,
            },
        };
    }

    const skipOverlap = options.skipWindowOverlap;
    const shouldSkip = (t0: number, t1: number) => {
        if (!skipOverlap) return false;
        const s0 = skipOverlap.t0;
        const s1 = skipOverlap.t1;
        return t0 < s1 && t1 > s0;
    };

    const melDim = params.mel.melBands[0]?.length ?? 0;
    const mfccFullDim = params.mfcc?.values[0]?.length ?? 0;
    const mfccDim = Math.max(0, Math.min(12, mfccFullDim - 1)); // coeffs 1..12

    const layout = makeFeatureVectorLayoutV1({ melDim, mfccDim, includeContrast: localContrastEnabled });

    // --- precompute per-frame normalisation scales (L2) for mel/mfcc blocks
    const melScale = new Float32Array(nFrames);
    const melBands = params.mel.melBands;
    for (let t = 0; t < nFrames; t++) {
        if ((t & 2047) === 0 && options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");
        const row = melBands[t];
        if (!row) {
            melScale[t] = 1;
            continue;
        }
        let sumSq = 0;
        for (let i = 0; i < melDim; i++) {
            const x = row[i] ?? 0;
            sumSq += x * x;
        }
        const n = Math.sqrt(sumSq);
        melScale[t] = n > 1e-12 ? (1 / n) : 1;
    }

    const mfccScale = mfccDim > 0 ? new Float32Array(nFrames) : null;
    const mfccFrames = params.mfcc?.values ?? null;
    if (mfccScale && mfccFrames) {
        for (let t = 0; t < nFrames; t++) {
            if ((t & 2047) === 0 && options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");
            const row = mfccFrames[t];
            if (!row) {
                mfccScale[t] = 1;
                continue;
            }
            let sumSq = 0;
            for (let i = 0; i < mfccDim; i++) {
                const x = row[i + 1] ?? 0;
                sumSq += x * x;
            }
            const n = Math.sqrt(sumSq);
            mfccScale[t] = n > 1e-12 ? (1 / n) : 1;
        }
    }

    // --- onset helpers (prefix sums + range max + peak counts)
    const onsetValues = new Float32Array(nFrames);
    const onsetSrc = params.onsetEnvelope.values;
    for (let i = 0; i < nFrames; i++) onsetValues[i] = onsetSrc[i] ?? 0;

    const onsetPrefix = new Float64Array(nFrames + 1);
    onsetPrefix[0] = 0;
    for (let i = 0; i < nFrames; i++) {
        if ((i & 4095) === 0 && options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");
        onsetPrefix[i + 1] = (onsetPrefix[i] ?? 0) + (onsetValues[i] ?? 0);
    }

    const onsetMax = buildSparseTableMax(onsetValues, options.isCancelled);

    const onsetPeaks = peakPick(timesFrames, onsetValues, {
        minIntervalSec: options.queryPeakPick?.minIntervalSec,
        threshold: options.queryPeakPick?.threshold,
        adaptive: options.queryPeakPick?.adaptiveFactor
            ? { method: "meanStd", factor: options.queryPeakPick.adaptiveFactor }
            : undefined,
        strict: true,
    });

    const isPeak = new Uint8Array(nFrames);
    for (const p of onsetPeaks) {
        const idx = p.index | 0;
        if (idx >= 0 && idx < nFrames) isPeak[idx] = 1;
    }
    const peakPrefix = new Uint32Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) peakPrefix[i + 1] = (peakPrefix[i] ?? 0) + (isPeak[i] ?? 0);

    const fingerprintMs = nowMs() - tPrep0;

    const addMelFrame = (frame: number, sum: Float64Array, sumSq: Float64Array) => {
        const row = melBands[frame];
        const s = melScale[frame] ?? 1;
        for (let i = 0; i < melDim; i++) {
            const x = (row?.[i] ?? 0) * s;
            sum[i] = (sum[i] ?? 0) + x;
            sumSq[i] = (sumSq[i] ?? 0) + x * x;
        }
    };
    const removeMelFrame = (frame: number, sum: Float64Array, sumSq: Float64Array) => {
        const row = melBands[frame];
        const s = melScale[frame] ?? 1;
        for (let i = 0; i < melDim; i++) {
            const x = (row?.[i] ?? 0) * s;
            sum[i] = (sum[i] ?? 0) - x;
            sumSq[i] = (sumSq[i] ?? 0) - x * x;
        }
    };

    const addMfccFrame = (frame: number, sum: Float64Array, sumSq: Float64Array) => {
        const row = mfccFrames?.[frame];
        const s = mfccScale?.[frame] ?? 1;
        for (let i = 0; i < mfccDim; i++) {
            const x = (row?.[i + 1] ?? 0) * s;
            sum[i] = (sum[i] ?? 0) + x;
            sumSq[i] = (sumSq[i] ?? 0) + x * x;
        }
    };
    const removeMfccFrame = (frame: number, sum: Float64Array, sumSq: Float64Array) => {
        const row = mfccFrames?.[frame];
        const s = mfccScale?.[frame] ?? 1;
        for (let i = 0; i < mfccDim; i++) {
            const x = (row?.[i + 1] ?? 0) * s;
            sum[i] = (sum[i] ?? 0) - x;
            sumSq[i] = (sumSq[i] ?? 0) - x * x;
        }
    };

    const melFg = new SlidingMoments(melDim, addMelFrame, removeMelFrame);
    const melBg = new SlidingMoments(melDim, addMelFrame, removeMelFrame);
    const mfccFg = mfccDim > 0 ? new SlidingMoments(mfccDim, addMfccFrame, removeMfccFrame) : null;
    const mfccBg = mfccDim > 0 ? new SlidingMoments(mfccDim, addMfccFrame, removeMfccFrame) : null;

    const writeVectorFromState = (opts: {
        fgStartIdx: number;
        fgEndIdx: number;
        bgStartIdx: number;
        bgEndIdx: number;
        fgStartSec: number;
        fgEndSec: number;
        bgStartSec: number;
        bgEndSec: number;
        out: Float32Array;
    }) => {
        const out = opts.out;
        out.fill(0);

        const fgCount = Math.max(0, opts.fgEndIdx - opts.fgStartIdx);
        const bgCount = Math.max(0, opts.bgEndIdx - opts.bgStartIdx);
        const bgExCount = Math.max(0, bgCount - fgCount);

        // --- mel foreground
        for (let i = 0; i < melDim; i++) {
            const sum = melFg.sum[i] ?? 0;
            const sumSq = melFg.sumSq[i] ?? 0;
            const mean = fgCount > 0 ? sum / fgCount : 0;
            const variance = fgCount > 0 ? Math.max(0, sumSq / fgCount - mean * mean) : 0;
            out[layout.melMeanFg.offset + i] = mean;
            out[layout.melVarianceFg.offset + i] = variance;

            if (layout.melContrast) {
                const bgSum = melBg.sum[i] ?? 0;
                const bgMeanEx = bgExCount > 0 ? (bgSum - sum) / bgExCount : mean;
                out[layout.melContrast.offset + i] = mean - bgMeanEx;
            }
        }

        // --- onset foreground
        const fgOnsetSum = (onsetPrefix[opts.fgEndIdx] ?? 0) - (onsetPrefix[opts.fgStartIdx] ?? 0);
        const fgOnsetMean = fgCount > 0 ? fgOnsetSum / fgCount : 0;
        const fgOnsetMaxRaw = onsetMax.query(opts.fgStartIdx, opts.fgEndIdx);
        const fgOnsetMax = Number.isFinite(fgOnsetMaxRaw) && fgOnsetMaxRaw !== -Infinity ? fgOnsetMaxRaw : 0;
        const fgPeaks = (peakPrefix[opts.fgEndIdx] ?? 0) - (peakPrefix[opts.fgStartIdx] ?? 0);
        const fgDur = Math.max(1e-6, opts.fgEndSec - opts.fgStartSec);
        const fgPeakDensity = fgPeaks / fgDur;

        out[layout.onsetFg.offset + 0] = fgOnsetMean;
        out[layout.onsetFg.offset + 1] = fgOnsetMax;
        out[layout.onsetFg.offset + 2] = fgPeakDensity;

        if (layout.onsetContrast) {
            const bgOnsetSum = (onsetPrefix[opts.bgEndIdx] ?? 0) - (onsetPrefix[opts.bgStartIdx] ?? 0);
            const bgOnsetMeanEx = bgExCount > 0 ? (bgOnsetSum - fgOnsetSum) / bgExCount : fgOnsetMean;

            const leftMax = onsetMax.query(opts.bgStartIdx, opts.fgStartIdx);
            const rightMax = onsetMax.query(opts.fgEndIdx, opts.bgEndIdx);
            const bgOnsetMaxEx = Math.max(
                Number.isFinite(leftMax) && leftMax !== -Infinity ? leftMax : -Infinity,
                Number.isFinite(rightMax) && rightMax !== -Infinity ? rightMax : -Infinity
            );
            const bgOnsetMaxExSafe = bgOnsetMaxEx === -Infinity ? fgOnsetMax : bgOnsetMaxEx;

            const bgPeaks = (peakPrefix[opts.bgEndIdx] ?? 0) - (peakPrefix[opts.bgStartIdx] ?? 0);
            const bgPeaksEx = Math.max(0, bgPeaks - fgPeaks);
            const bgExDur = Math.max(1e-6, (opts.bgEndSec - opts.bgStartSec) - fgDur);
            const bgPeakDensityEx = bgPeaksEx / bgExDur;

            out[layout.onsetContrast.offset + 0] = fgOnsetMean - bgOnsetMeanEx;
            out[layout.onsetContrast.offset + 1] = fgOnsetMax - bgOnsetMaxExSafe;
            out[layout.onsetContrast.offset + 2] = fgPeakDensity - bgPeakDensityEx;
        }

        // --- mfcc (optional)
        if (mfccDim > 0 && mfccFg && mfccBg && layout.mfccMeanFg && layout.mfccVarianceFg) {
            for (let i = 0; i < mfccDim; i++) {
                const sum = mfccFg.sum[i] ?? 0;
                const sumSq = mfccFg.sumSq[i] ?? 0;
                const mean = fgCount > 0 ? sum / fgCount : 0;
                const variance = fgCount > 0 ? Math.max(0, sumSq / fgCount - mean * mean) : 0;
                out[layout.mfccMeanFg.offset + i] = mean;
                out[layout.mfccVarianceFg.offset + i] = variance;

                if (layout.mfccMeanContrast && layout.mfccVarianceContrast) {
                    const bgSum = mfccBg.sum[i] ?? 0;
                    const bgSumSq = mfccBg.sumSq[i] ?? 0;
                    const bgMeanEx = bgExCount > 0 ? (bgSum - sum) / bgExCount : mean;
                    const bgVarEx = bgExCount > 0 ? Math.max(0, (bgSumSq - sumSq) / bgExCount - bgMeanEx * bgMeanEx) : variance;
                    out[layout.mfccMeanContrast.offset + i] = mean - bgMeanEx;
                    out[layout.mfccVarianceContrast.offset + i] = variance - bgVarEx;
                }
            }
        }
    };

    const computeVectorForInterval = (t0: number, t1: number, out: Float32Array) => {
        const fgStartSec = Math.min(t0, t1);
        const fgEndSec = Math.max(t0, t1);
        const { bgStartSec, bgEndSec } = computeBackgroundWindow({
            fgStartSec,
            fgEndSec,
            trackDurationSec: trackDuration,
            backgroundScale,
        });

        const fgStartIdx = advanceStartIndex(timesFrames, 0, fgStartSec);
        const fgEndIdx = advanceEndIndex(timesFrames, fgStartIdx, fgEndSec);
        const bgStartIdx = advanceStartIndex(timesFrames, 0, bgStartSec);
        const bgEndIdx = advanceEndIndex(timesFrames, bgStartIdx, bgEndSec);

        // Populate SlidingMoments deterministically for this one-off interval.
        melFg.update(fgStartIdx, fgEndIdx);
        melBg.update(bgStartIdx, bgEndIdx);
        mfccFg?.update(fgStartIdx, fgEndIdx);
        mfccBg?.update(bgStartIdx, bgEndIdx);

        writeVectorFromState({
            fgStartIdx,
            fgEndIdx,
            bgStartIdx,
            bgEndIdx,
            fgStartSec,
            fgEndSec,
            bgStartSec,
            bgEndSec,
            out,
        });
    };

    // Query vector for baseline similarity + as optional positive anchor for refinement.
    const queryVec = new Float32Array(layout.dim);
    computeVectorForInterval(qt0, qt1, queryVec);

    // --- scanning helpers (sliding window indices)
    const resetSlidingState = () => {
        melFg.update(0, 0);
        melBg.update(0, 0);
        mfccFg?.update(0, 0);
        mfccBg?.update(0, 0);
    };

    const buildWindowVectorsPass = (onWindow: (w: number, t0: number, t1: number, bg: { start: number; end: number }, vec: Float32Array) => void) => {
        resetSlidingState();

        let fgStartIdx = 0;
        let fgEndIdx = 0;
        let bgStartIdx = 0;
        let bgEndIdx = 0;

        const vec = new Float32Array(layout.dim);

        for (let w = 0; w < nWindows; w++) {
            if ((w & 255) === 0 && options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

            const t0 = w * hopSec;
            const t1 = t0 + windowSec;
            times[w] = t0;

            fgStartIdx = advanceStartIndex(timesFrames, fgStartIdx, t0);
            fgEndIdx = advanceEndIndex(timesFrames, fgEndIdx, t1);

            const { bgStartSec, bgEndSec } = computeBackgroundWindow({
                fgStartSec: t0,
                fgEndSec: t1,
                trackDurationSec: trackDuration,
                backgroundScale,
            });
            bgStartIdx = advanceStartIndex(timesFrames, bgStartIdx, bgStartSec);
            bgEndIdx = advanceEndIndex(timesFrames, bgEndIdx, bgEndSec);

            melFg.update(fgStartIdx, fgEndIdx);
            melBg.update(bgStartIdx, bgEndIdx);
            mfccFg?.update(fgStartIdx, fgEndIdx);
            mfccBg?.update(bgStartIdx, bgEndIdx);

            writeVectorFromState({
                fgStartIdx,
                fgEndIdx,
                bgStartIdx,
                bgEndIdx,
                fgStartSec: t0,
                fgEndSec: t1,
                bgStartSec,
                bgEndSec,
                out: vec,
            });

            onWindow(w, t0, t1, { start: bgStartSec, end: bgEndSec }, vec);
        }
    };

    let skippedWindows = 0;
    let scannedWindows = 0;

    const scanStartMs = nowMs();

    let curveKind: MirSearchCurveKindV1 = "similarity";
    let modelExplain: MirRefinedModelExplainV1 = baselineExplain;
    let modelMs = 0;
    let trainedModel: ReturnType<typeof trainLogisticModelV1> | ReturnType<typeof buildPrototypeModelV1> | null = null;
    let zMean: Float32Array | null = null;
    let zInvStd: Float32Array | null = null;

    const runBaselineSimilarityScan = () => {
        // We write into scores[w] directly; use the same index `w` inside the callback to avoid rounding.
        skippedWindows = 0;
        scannedWindows = 0;
        buildWindowVectorsPass((w, t0, t1, _bg, vec) => {
            if (shouldSkip(t0, t1)) {
                scores[w] = 0;
                skippedWindows++;
                return;
            }
            scannedWindows++;
            scores[w] = cosineSimilarity01ByBlocks(queryVec, vec, layout, options.weights);
        });
    };

    if (modelDecision.kind === "baseline") {
        runBaselineSimilarityScan();
    } else {
        const tModel0 = nowMs();
        curveKind = "confidence";

        try {
            // Pass 1: accumulate z-score params across all windows (per-track, per-search, ephemeral).
            const dim = layout.dim;
            const sum = new Float64Array(dim);
            const sumSq = new Float64Array(dim);

            buildWindowVectorsPass((_w, _t0, _t1, _bg, vec) => {
                for (let j = 0; j < dim; j++) {
                    const x = vec[j] ?? 0;
                    sum[j] = (sum[j] ?? 0) + x;
                    sumSq[j] = (sumSq[j] ?? 0) + x * x;
                }
            });

            const mean = new Float32Array(dim);
            const invStd = new Float32Array(dim);
            const n = Math.max(1, nWindows);
            for (let j = 0; j < dim; j++) {
                const mu = (sum[j] ?? 0) / n;
                const ex2 = (sumSq[j] ?? 0) / n;
                const v = Math.max(0, ex2 - mu * mu);
                const std = Math.sqrt(v);
                mean[j] = mu;
                invStd[j] = std > 1e-6 ? 1 / std : 1;
            }

            zMean = mean;
            zInvStd = invStd;

            // Build exemplar vectors.
            const positives: Float32Array[] = [];
            const negatives: Float32Array[] = [];

            const makeExample = (t0: number, t1: number): Float32Array => {
                const v = new Float32Array(dim);
                computeVectorForInterval(t0, t1, v);
                zScoreInPlace(v, mean, invStd);
                return v;
            };

            for (const l of modelDecision.positives) positives.push(makeExample(l.t0, l.t1));
            for (const l of modelDecision.negatives) negatives.push(makeExample(l.t0, l.t1));

            // Optional anchor: only include query once we already meet the ">=2 positives" rule.
            if (includeQueryAsPositive) {
                const q = new Float32Array(dim);
                q.set(queryVec);
                zScoreInPlace(q, mean, invStd);
                positives.push(q);
            }

            // Train model (deterministic, tiny).
            trainedModel =
                modelDecision.kind === "logistic"
                    ? trainLogisticModelV1({ positives, negatives, layout })
                    : buildPrototypeModelV1({ positives, layout });
            modelExplain = trainedModel.explain;

            // Pass 2: score windows using the classifier.
            skippedWindows = 0;
            scannedWindows = 0;
            buildWindowVectorsPass((w, t0, t1, _bg, vec) => {
                if (shouldSkip(t0, t1)) {
                    scores[w] = 0;
                    skippedWindows++;
                    return;
                }
                scannedWindows++;
                zScoreInPlace(vec, mean, invStd);
                scores[w] = scoreWithModelV1(trainedModel!, vec);
            });
        } catch (e) {
            // Respect cooperative cancellation semantics.
            if (e instanceof Error && e.message === "@octoseq/mir: cancelled") throw e;

            // Robustness rule: never crash search due to refinement; degrade gracefully.
            // If refinement fails, fall back to baseline similarity (with contrast features if enabled).
            curveKind = "similarity";
            modelExplain = baselineExplain;
            trainedModel = null;
            zMean = null;
            zInvStd = null;
            runBaselineSimilarityScan();
        } finally {
            modelMs = nowMs() - tModel0;
        }
    }

    const scanMs = nowMs() - scanStartMs;

    // --- candidate detection on curve
    const events = peakPick(times, scores, {
        threshold,
        minIntervalSec: minSpacingSec,
        strict: options.candidatePeakPick?.strict ?? true,
    });

    const candidates: MirSearchCandidateV1Guided[] = events.map((e) => {
        const windowStartSec = e.time;
        const windowEndSec = windowStartSec + windowSec;
        return {
            timeSec: e.time,
            score: e.strength,
            windowStartSec,
            windowEndSec,
        };
    });

    // Explainability: per-candidate group contributions (logistic only).
    if (trainedModel?.kind === "logistic" && zMean && zInvStd) {
        const tmp = new Float32Array(layout.dim);
        for (const c of candidates) {
            tmp.fill(0);
            computeVectorForInterval(c.windowStartSec, c.windowEndSec, tmp);
            zScoreInPlace(tmp, zMean, zInvStd);
            c.explain = {
                groupLogit: logitContributionsByGroupV1(trainedModel.w, trainedModel.b, tmp, layout),
            };
        }
    }

    const totalMs = nowMs() - tStart;

    return {
        times,
        scores,
        candidates,
        curveKind,
        model: modelExplain,
        meta: {
            fingerprintMs,
            scanMs,
            modelMs,
            totalMs,
            windowSec,
            hopSec,
            skippedWindows,
            scannedWindows,
        },
    };
}
