import type { MirAudioPayload, MirResult, MirRunRequest } from "../types";

export type MirWorkerInitMessage = {
    type: "INIT";
    enableGpu: boolean;
};

export type MirWorkerRunMessage = {
    type: "RUN";
    jobId: string;
    request: MirRunRequest;
    audio: {
        sampleRate: number;
        mono: ArrayBufferLike; // transferred
    };
    enableGpu: boolean;
    strictGpu?: boolean;
};

export type MirWorkerCancelMessage = {
    type: "CANCEL";
    jobId: string;
};

export type MirWorkerSearchMessage = {
    type: "SEARCH";
    jobId: string;

    audio: {
        sampleRate: number;
        mono: ArrayBufferLike; // transferred
    };

    query: {
        t0: number;
        t1: number;
    };

    /** Search tuning (kept small and explicit, like MirRunRequest). */
    search?: {
        hopSec?: number;
        threshold?: number;
        /** 0..1; if true, skip windows overlapping the query itself. */
        skipOverlap?: boolean;
        weights?: {
            mel?: number;
            transient?: number;
            mfcc?: number;
        };
        /** Optional: apply softmax to similarity curve before returning. */
        applySoftmax?: boolean;
    };

    /** Feature extraction config (re-uses existing MIR request knobs). */
    features?: {
        spectrogram?: MirRunRequest["spectrogram"];
        mel?: MirRunRequest["mel"];
        onset?: MirRunRequest["onset"];
        mfcc?: MirRunRequest["mfcc"];
    };

    /**
     * Optional human-in-the-loop refinement data.
     * When enabled, the worker can use accepted/rejected exemplars to produce a
     * per-track confidence curve and a re-ranked candidate list.
     */
    refinement?: {
        enabled?: boolean;
        includeQueryAsPositive?: boolean;
        labels?: Array<{
            t0: number;
            t1: number;
            status: "accepted" | "rejected";
            source: "auto" | "manual";
        }>;
    };

    enableGpu: boolean;
    strictGpu?: boolean;
};

export type MirWorkerInMessage = MirWorkerInitMessage | MirWorkerRunMessage | MirWorkerSearchMessage | MirWorkerCancelMessage;

export type MirWorkerResultMessage = {
    type: "RESULT";
    jobId: string;
    /** Total time spent in the worker handling this RUN, including (optional) GPU readback. */
    workerTotalMs: number;
    result: {
        // Mirror MirResult but transfer underlying buffers.
        kind: MirResult["kind"];
        times: ArrayBufferLike;
        values?: ArrayBufferLike;
        data2d?: ArrayBufferLike[];
        events?: Array<{ time: number; strength: number; index: number }>;
        meta: MirResult["meta"];
    };
};

export type MirWorkerErrorMessage = {
    type: "ERROR";
    jobId: string;
    message: string;
    stack?: string;
};

export type MirWorkerLogMessage = {
    type: "LOG";
    jobId?: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: unknown;
};

export type MirWorkerSearchResultMessage = {
    type: "SEARCH_RESULT";
    jobId: string;
    timings: {
        fingerprintMs: number;
        scanMs: number;
        modelMs?: number;
        totalMs: number;
    };
    result: {
        times: ArrayBufferLike;
        scores: ArrayBufferLike;
        curveKind: "similarity" | "confidence";
        model: {
            kind: "baseline" | "prototype" | "logistic";
            positives: number;
            negatives: number;
            weightL2?: {
                mel: number;
                melForeground: number;
                melContrast?: number;
                onset: number;
                onsetForeground: number;
                onsetContrast?: number;
                mfcc?: number;
                mfccForeground?: number;
                mfccContrast?: number;
            };
            training?: {
                iterations: number;
                finalLoss: number;
            };
        };
        candidates: Array<{
            timeSec: number;
            score: number;
            windowStartSec: number;
            windowEndSec: number;
            explain?: {
                groupLogit?: {
                    logit: number;
                    bias: number;
                    mel: number;
                    melForeground: number;
                    melContrast?: number;
                    onset: number;
                    onsetForeground: number;
                    onsetContrast?: number;
                    mfcc?: number;
                    mfccForeground?: number;
                    mfccContrast?: number;
                };
            };
        }>;
        meta: {
            windowSec: number;
            hopSec: number;
            skippedWindows: number;
            scannedWindows: number;
        };
    };
};

export type MirWorkerOutMessage =
    | MirWorkerResultMessage
    | MirWorkerSearchResultMessage
    | MirWorkerErrorMessage
    | MirWorkerLogMessage;

export function rebuildAudioPayload(a: MirWorkerRunMessage["audio"]): MirAudioPayload {
    return {
        sampleRate: a.sampleRate,
        mono: new Float32Array(a.mono as ArrayBuffer),
    };
}
