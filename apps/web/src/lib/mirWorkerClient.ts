"use client";

import type {
    MirAudioPayload,
    MirBackend,
    MirResult,
    MirRunRequest,
} from "@octoseq/mir";

import type { MirWorkerInMessage, MirWorkerOutMessage } from "@octoseq/mir/runner/workerProtocol";

export type MirWorkerClientOptions = {
    enableGpu: boolean;
    strictGpu?: boolean;
    debug?: boolean;
};

export type MirWorkerJob = {
    id: string;
    cancel: () => void;
    promise: Promise<MirResult>;
    /** Observability: wall-clock time spent in the worker handling the RUN. */
    workerTotalMs: Promise<number>;
};

export type MirWorkerSearchJob = {
    id: string;
    cancel: () => void;
    promise: Promise<{
        times: Float32Array;
        scores: Float32Array;
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
            training?: { iterations: number; finalLoss: number };
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
        timings: { fingerprintMs: number; scanMs: number; modelMs?: number; totalMs: number };
        meta: { windowSec: number; hopSec: number; skippedWindows: number; scannedWindows: number };
    }>;
};

function uuid(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class MirWorkerClient {
    private readonly worker: Worker;

    constructor() {
        // Next.js: worker bundling via URL import.
        this.worker = new Worker(new URL("../workers/mirWorker.ts", import.meta.url), { type: "module" });
    }

    init(enableGpu: boolean) {
        const msg: MirWorkerInMessage = { type: "INIT", enableGpu };
        this.worker.postMessage(msg);
    }

    run(audio: MirAudioPayload, request: MirRunRequest, opts: MirWorkerClientOptions): MirWorkerJob {
        const jobId = uuid();
        const { enableGpu, strictGpu, debug } = opts;

        const monoBuf = audio.mono.buffer;
        const msg: MirWorkerInMessage = {
            type: "RUN",
            jobId,
            request: {
                ...request,
                backend: request.backend ?? (enableGpu ? ("gpu" as MirBackend) : ("cpu" as MirBackend)),
            },
            audio: {
                sampleRate: audio.sampleRate,
                mono: monoBuf,
            },
            enableGpu,
            strictGpu,
        };

        let resolveWorkerTotalMs!: (ms: number) => void;
        let rejectWorkerTotalMs!: (e: Error) => void;
        const workerTotalMs = new Promise<number>((resolve, reject) => {
            resolveWorkerTotalMs = resolve;
            rejectWorkerTotalMs = reject;
        });

        let cancelledLocally = false;
        let rejectMain!: (e: Error) => void;
        let onMessageRef: ((ev: MessageEvent<MirWorkerOutMessage>) => void) | null = null;

        const promise = new Promise<MirResult>((resolve, reject) => {
            rejectMain = reject;
            const onMessage = (ev: MessageEvent<MirWorkerOutMessage>) => {
                const m = ev.data;
                if (m.type === "LOG") {
                    if (debug) {
                        const fn: (msg?: unknown, ...args: unknown[]) => void =
                            m.level === "debug"
                                ? console.debug
                                : m.level === "info"
                                    ? console.info
                                    : m.level === "warn"
                                        ? console.warn
                                        : console.error;
                        fn("[MIR-WORKER]", m.message, m.data ?? "");
                    }
                    return;
                }

                if (m.jobId !== jobId) return;

                // If the UI cancelled, ignore any late result/error for this job.
                if (cancelledLocally) {
                    this.worker.removeEventListener("message", onMessage);
                    return;
                }

                this.worker.removeEventListener("message", onMessage);

                if (m.type === "ERROR") {
                    const err = new Error(m.message);
                    rejectWorkerTotalMs(err);
                    reject(err);
                    return;
                }

                if (m.type !== "RESULT") return;

                // RESULT
                resolveWorkerTotalMs(m.workerTotalMs);

                const times = new Float32Array(m.result.times);

                if (m.result.kind === "1d") {
                    const values = new Float32Array(m.result.values ?? new ArrayBuffer(0));
                    resolve({
                        kind: "1d",
                        times,
                        values,
                        meta: m.result.meta,
                    });
                    return;
                }

                if (m.result.kind === "events") {
                    resolve({
                        kind: "events",
                        times,
                        events: m.result.events ?? [],
                        meta: m.result.meta,
                    });
                    return;
                }

                const data = (m.result.data2d ?? []).map((b: ArrayBufferLike) => new Float32Array(b as ArrayBuffer));
                resolve({
                    kind: "2d",
                    times,
                    data,
                    meta: m.result.meta,
                });
            };

            onMessageRef = onMessage;
            this.worker.addEventListener("message", onMessage);
            this.worker.postMessage(msg, [monoBuf]);
        });

        return {
            id: jobId,
            cancel: () => {
                cancelledLocally = true;

                // Stop listening immediately (prevents leaks if worker never responds).
                if (onMessageRef) {
                    this.worker.removeEventListener("message", onMessageRef);
                    onMessageRef = null;
                }

                // AbortSignal-like: message-based cancellation.
                // The worker will best-effort stop long loops, and will always ignore late results.
                const cancelMsg: MirWorkerInMessage = { type: "CANCEL", jobId };
                this.worker.postMessage(cancelMsg);

                const err = new Error("cancelled");
                rejectWorkerTotalMs(err);
                rejectMain(err);
            },
            promise,
            workerTotalMs,
        };
    }

    search(
        audio: MirAudioPayload,
        params: {
            query: { t0: number; t1: number };
            search?: {
                hopSec?: number;
                threshold?: number;
                skipOverlap?: boolean;
                weights?: { mel?: number; transient?: number; mfcc?: number };
                applySoftmax?: boolean;
            };
            features?: {
                spectrogram?: MirRunRequest["spectrogram"];
                mel?: MirRunRequest["mel"];
                onset?: MirRunRequest["onset"];
                mfcc?: MirRunRequest["mfcc"];
            };
            refinement?: {
                enabled?: boolean;
                includeQueryAsPositive?: boolean;
                labels?: Array<{ t0: number; t1: number; status: "accepted" | "rejected"; source: "auto" | "manual" }>;
            };
        },
        opts: MirWorkerClientOptions
    ): MirWorkerSearchJob {
        const jobId = uuid();
        const { enableGpu, strictGpu, debug } = opts;

        const monoBuf = audio.mono.buffer;

        const msg = {
            type: "SEARCH" as const,
            jobId,
            audio: { sampleRate: audio.sampleRate, mono: monoBuf },
            query: params.query,
            search: params.search,
            features: params.features,
            refinement: params.refinement,
            enableGpu,
            strictGpu,
        };

        let cancelledLocally = false;
        let rejectMain!: (e: Error) => void;
        let onMessageRef: ((ev: MessageEvent<MirWorkerOutMessage>) => void) | null = null;

        const promise = new Promise<{
            times: Float32Array;
            scores: Float32Array;
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
                training?: { iterations: number; finalLoss: number };
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
            timings: { fingerprintMs: number; scanMs: number; modelMs?: number; totalMs: number };
            meta: { windowSec: number; hopSec: number; skippedWindows: number; scannedWindows: number };
        }>((resolve, reject) => {
            rejectMain = reject;

            const onMessage = (ev: MessageEvent<MirWorkerOutMessage>) => {
                const m = ev.data;
                if (m.type === "LOG") {
                    if (debug) {
                        const fn: (msg?: unknown, ...args: unknown[]) => void =
                            m.level === "debug"
                                ? console.debug
                                : m.level === "info"
                                    ? console.info
                                    : m.level === "warn"
                                        ? console.warn
                                        : console.error;
                        fn("[MIR-WORKER]", m.message, m.data ?? "");
                    }
                    return;
                }

                if (m.jobId !== jobId) return;

                if (cancelledLocally) {
                    this.worker.removeEventListener("message", onMessage);
                    return;
                }

                this.worker.removeEventListener("message", onMessage);

                if (m.type === "ERROR") {
                    reject(new Error(m.message));
                    return;
                }

                if (m.type !== "SEARCH_RESULT") return;

                resolve({
                    times: new Float32Array(m.result.times),
                    scores: new Float32Array(m.result.scores),
                    curveKind: m.result.curveKind,
                    model: m.result.model,
                    candidates: m.result.candidates,
                    timings: m.timings,
                    meta: m.result.meta,
                });
            };

            onMessageRef = onMessage;
            this.worker.addEventListener("message", onMessage);
            this.worker.postMessage(msg, [monoBuf]);
        });

        return {
            id: jobId,
            cancel: () => {
                cancelledLocally = true;

                if (onMessageRef) {
                    this.worker.removeEventListener("message", onMessageRef);
                    onMessageRef = null;
                }

                this.worker.postMessage({ type: "CANCEL", jobId });
                rejectMain(new Error("cancelled"));
            },
            promise,
        };
    }

    destroy() {
        this.worker.terminate();
    }
}
