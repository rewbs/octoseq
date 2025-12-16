import type { MelSpectrogram } from "../dsp/mel";
import type { Features2D } from "../dsp/mfcc";
import { peakPick } from "../dsp/peakPick";

import { fingerprintV1 } from "./fingerprintV1";
import type { MirFingerprintVectorWeights } from "./similarity";
import { similarityFingerprintV1 } from "./similarity";

export type MirSearchCandidate = {
    timeSec: number;
    score: number;
    windowStartSec: number;
    windowEndSec: number;
};

export type MirSearchResultV1 = {
    times: Float32Array; // window start times
    similarity: Float32Array; // [0,1]
    candidates: MirSearchCandidate[];
    meta: {
        fingerprintMs: number;
        scanMs: number;
        totalMs: number;
        windowSec: number;
        hopSec: number;
        skippedWindows: number;
        scannedWindows: number;
    };
};

export type MirSearchOptionsV1 = {
    /** Sliding window hop size in seconds. Default ~0.03s. */
    hopSec?: number;

    /** Similarity threshold for candidate detection. Default 0.75. */
    threshold?: number;

    /**
     * Min spacing between candidates (seconds). Default is selectionDuration*0.8.
     * Implemented via peakPick(minIntervalSec).
     */
    minCandidateSpacingSec?: number;

    /** If provided, windows overlapping [skipT0, skipT1] are skipped. */
    skipWindowOverlap?: { t0: number; t1: number };

    /** Optional weights for similarity vector blocks. */
    weights?: MirFingerprintVectorWeights;

    /** Peak-pick settings for query fingerprint peak density. */
    queryPeakPick?: {
        minIntervalSec?: number;
        threshold?: number;
        adaptiveFactor?: number;
    };

    /** Peak-pick settings for candidate detection on the similarity curve. */
    candidatePeakPick?: {
        strict?: boolean;
    };

    /** Cooperative cancellation hook (called frequently in scan loop). */
    isCancelled?: () => boolean;
};

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clamp01(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x;
}

// (no local helpers; keep this module minimal and lint-clean)

export async function searchTrackV1(params: {
    queryRegion: { t0: number; t1: number };

    mel: MelSpectrogram;
    onsetEnvelope: { times: Float32Array; values: Float32Array };
    mfcc?: Features2D;

    options?: MirSearchOptionsV1;
}): Promise<MirSearchResultV1> {
    const tStart = nowMs();

    const options = params.options ?? {};
    const hopSec = Math.max(0.005, options.hopSec ?? 0.03);
    const threshold = clamp01(options.threshold ?? 0.75);

    const qt0 = Math.min(params.queryRegion.t0, params.queryRegion.t1);
    const qt1 = Math.max(params.queryRegion.t0, params.queryRegion.t1);
    const windowSec = Math.max(1e-3, qt1 - qt0);

    const minSpacingSec = Math.max(0, options.minCandidateSpacingSec ?? windowSec * 0.8);

    // --- query fingerprint
    const tFp0 = nowMs();
    const queryFp = fingerprintV1({
        t0: qt0,
        t1: qt1,
        mel: params.mel,
        onsetEnvelope: params.onsetEnvelope,
        mfcc: params.mfcc,
        peakPick: options.queryPeakPick,
    });
    const fingerprintMs = nowMs() - tFp0;

    // --- sliding scan
    const scanStartMs = nowMs();

    const trackDuration = Math.max(
        params.mel.times.length ? (params.mel.times[params.mel.times.length - 1] ?? 0) : 0,
        params.onsetEnvelope.times.length
            ? (params.onsetEnvelope.times[params.onsetEnvelope.times.length - 1] ?? 0)
            : 0
    );

    const nWindows = Math.max(0, Math.floor((trackDuration - windowSec) / hopSec) + 1);
    const times = new Float32Array(nWindows);
    const sim = new Float32Array(nWindows);

    let skippedWindows = 0;
    let scannedWindows = 0;

    for (let w = 0; w < nWindows; w++) {
        if (options.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        const t0 = w * hopSec;
        const t1 = t0 + windowSec;

        // Optionally skip windows overlapping the query itself.
        if (options.skipWindowOverlap) {
            const s0 = options.skipWindowOverlap.t0;
            const s1 = options.skipWindowOverlap.t1;
            const overlaps = t0 < s1 && t1 > s0;
            if (overlaps) {
                times[w] = t0;
                sim[w] = 0;
                skippedWindows++;
                continue;
            }
        }

        times[w] = t0;

        // Compute window fingerprint using the same feature extraction logic.
        // We avoid re-running spectrogram/mel computation; we only aggregate
        // from existing mel/onset/mfcc time-aligned arrays.
        const fp = fingerprintV1({
            t0,
            t1,
            mel: params.mel,
            onsetEnvelope: params.onsetEnvelope,
            mfcc: params.mfcc,
            peakPick: options.queryPeakPick,
        });

        const score = similarityFingerprintV1(queryFp, fp, options.weights);
        sim[w] = clamp01(score);
        scannedWindows++;
    }

    const scanMs = nowMs() - scanStartMs;

    // --- candidate detection on similarity curve
    // We use peakPick on (times, sim), with minIntervalSec enforcing spacing.
    // We apply threshold as an absolute minimum peak height.
    const events = peakPick(times, sim, {
        threshold,
        minIntervalSec: minSpacingSec,
        strict: options.candidatePeakPick?.strict ?? true,
    });

    const candidates: MirSearchCandidate[] = events.map((e) => {
        const windowStartSec = e.time;
        const windowEndSec = windowStartSec + windowSec;
        return {
            timeSec: e.time,
            score: e.strength,
            windowStartSec,
            windowEndSec,
        };
    });

    const totalMs = nowMs() - tStart;

    return {
        times,
        similarity: sim,
        candidates,
        meta: {
            fingerprintMs,
            scanMs,
            totalMs,
            windowSec,
            hopSec,
            skippedWindows,
            scannedWindows,
        },
    };
}
