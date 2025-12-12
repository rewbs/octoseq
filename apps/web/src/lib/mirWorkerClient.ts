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

    run(
        audio: MirAudioPayload,
        request: MirRunRequest,
        opts: MirWorkerClientOptions
    ): MirWorkerJob {
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

    destroy() {
        this.worker.terminate();
    }
}
