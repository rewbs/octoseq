/// <reference lib="webworker" />

import { MirGPU } from "@octoseq/mir";
import { runMir } from "@octoseq/mir/runner/runMir";
import type { MirResult } from "@octoseq/mir";

import {
    rebuildAudioPayload,
    type MirWorkerInMessage,
    type MirWorkerOutMessage,
    type MirWorkerRunMessage,
} from "@octoseq/mir/runner/workerProtocol";

// Web Worker global
const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let gpu: MirGPU | null = null;

// jobId -> cancelled
const cancelled = new Set<string>();

function post(msg: MirWorkerOutMessage, transfer?: Transferable[]) {
    ctx.postMessage(msg, transfer ?? []);
}


function postLog(jobId: string | undefined, level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) {
    post({ type: "LOG", jobId, level, message, data });
}

async function ensureGpu() {
    if (gpu) return gpu;
    gpu = await MirGPU.create();
    return gpu;
}

function serialiseResult(
    jobId: string,
    workerTotalMs: number,
    result: MirResult
): { msg: MirWorkerOutMessage; transfer: Transferable[] } {
    const transfer: Transferable[] = [];

    const timesBuf = result.times.buffer.slice(0) as ArrayBuffer;
    transfer.push(timesBuf);

    if (result.kind === "1d") {
        const valuesBuf = result.values.buffer.slice(0) as ArrayBuffer;
        transfer.push(valuesBuf);
        return {
            msg: {
                type: "RESULT",
                jobId,
                workerTotalMs,
                result: {
                    kind: "1d",
                    times: timesBuf,
                    values: valuesBuf,
                    meta: result.meta,
                },
            },
            transfer,
        };
    }

    if (result.kind === "events") {
        return {
            msg: {
                type: "RESULT",
                jobId,
                workerTotalMs,
                result: {
                    kind: "events",
                    times: timesBuf,
                    events: result.events,
                    meta: result.meta,
                },
            },
            transfer,
        };
    }

    // 2d
    const data2d: ArrayBuffer[] = new Array(result.data.length);
    for (let i = 0; i < result.data.length; i++) {
        // Copy into a standalone ArrayBuffer so it can be transferred.
        const row = result.data[i] ?? new Float32Array();
        const buf = row.buffer.slice(row.byteOffset, row.byteOffset + row.byteLength) as ArrayBuffer;
        data2d[i] = buf;
        transfer.push(buf);
    }

    return {
        msg: {
            type: "RESULT",
            jobId,
            workerTotalMs,
            result: {
                kind: "2d",
                times: timesBuf,
                data2d,
                meta: result.meta,
            },
        },
        transfer,
    };
}

async function handleRun(m: MirWorkerRunMessage) {
    const { jobId } = m;
    cancelled.delete(jobId);

    const t0 = performance.now();

    postLog(jobId, "info", "RUN", { fn: m.request.fn, backend: m.request.backend, enableGpu: m.enableGpu });

    const audio = rebuildAudioPayload(m.audio);

    try {
        const useGpu = m.enableGpu && m.request.backend === "gpu";
        const gpuCtx = useGpu ? await ensureGpu() : undefined;

        const res = await runMir(audio, m.request, {
            gpu: gpuCtx,
            strictGpu: m.strictGpu,
            isCancelled: () => cancelled.has(jobId),
        });

        const workerTotalMs = performance.now() - t0;

        if (cancelled.has(jobId)) {
            postLog(jobId, "warn", "CANCELLED (result ignored)");
            return;
        }

        const { msg, transfer } = serialiseResult(jobId, workerTotalMs, res);
        post(msg, transfer);
    } catch (e) {
        if (cancelled.has(jobId)) {
            postLog(jobId, "warn", "CANCELLED (error ignored)");
            return;
        }

        const err = e as Error;
        post({
            type: "ERROR",
            jobId,
            message: err.message || String(e),
            stack: err.stack,
        });
    }
}

ctx.onmessage = (ev: MessageEvent<MirWorkerInMessage>) => {
    const msg = ev.data;

    if (msg.type === "CANCEL") {
        cancelled.add(msg.jobId);
        postLog(msg.jobId, "info", "CANCEL");
        return;
    }

    if (msg.type === "INIT") {
        // Optional eager GPU init
        if (msg.enableGpu) {
            void ensureGpu()
                .then(() => postLog(undefined, "info", "GPU init ok"))
                .catch((e) => postLog(undefined, "error", "GPU init failed", { message: (e as Error).message }));
        }
        return;
    }

    if (msg.type === "RUN") {
        void handleRun(msg);
    }
};
