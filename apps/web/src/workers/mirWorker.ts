/// <reference lib="webworker" />

import {
    MirGPU,
    melSpectrogram,
    mfcc,
    onsetEnvelopeFromMel,
    onsetEnvelopeFromMelGpu,
    spectrogram,
    searchTrackV1Guided,
} from "@octoseq/mir";
import { runMir } from "@octoseq/mir/runner/runMir";
import type { MirResult, MirAudioPayload } from "@octoseq/mir";

import {
    rebuildAudioPayload,
    type MirWorkerInMessage,
    type MirWorkerOutMessage,
    type MirWorkerRunMessage,
    type MirWorkerSearchMessage,
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

async function handleSearch(m: MirWorkerSearchMessage) {
    const { jobId } = m;
    cancelled.delete(jobId);

    const t0 = performance.now();
    postLog(jobId, "info", "SEARCH", { query: m.query, search: m.search, enableGpu: m.enableGpu });

    const audio: MirAudioPayload = {
        sampleRate: m.audio.sampleRate,
        mono: new Float32Array(m.audio.mono as ArrayBuffer),
    };

    try {
        const useGpu = m.enableGpu;
        const gpuCtx = useGpu ? await ensureGpu() : undefined;

        // 1) Compute spectrogram (CPU STFT) once.
        const spec = await spectrogram(
            {
                sampleRate: audio.sampleRate,
                numberOfChannels: 1,
                getChannelData: () => audio.mono,
            },
            m.features?.spectrogram ?? { fftSize: 2048, hopSize: 512, window: "hann" },
            undefined,
            {
                isCancelled: () => cancelled.has(jobId),
            }
        );

        if (cancelled.has(jobId)) {
            postLog(jobId, "warn", "CANCELLED (search ignored)");
            return;
        }

        // 2) Compute mel (GPU optional) and onset envelope.
        const mel = await melSpectrogram(spec, m.features?.mel ?? { nMels: 64 }, gpuCtx);

        let onset;
        if (useGpu && gpuCtx) {
            try {
                const onsetGpu = await onsetEnvelopeFromMelGpu(mel, gpuCtx, { diffMethod: m.features?.onset?.diffMethod });
                onset = { times: onsetGpu.times, values: onsetGpu.values };
            } catch {
                // Fallback to CPU onset for robustness.
                onset = onsetEnvelopeFromMel(mel, m.features?.onset);
            }
        } else {
            onset = onsetEnvelopeFromMel(mel, m.features?.onset);
        }

        // 3) Optional MFCC (CPU)
        const mfccResult = m.features?.mfcc ? mfcc(mel, m.features.mfcc) : undefined;
        const mfccFeatures = mfccResult ? { times: mfccResult.times, values: mfccResult.coeffs } : undefined;

        // 4) Search
        const skipOverlap = m.search?.skipOverlap
            ? { t0: Math.min(m.query.t0, m.query.t1), t1: Math.max(m.query.t0, m.query.t1) }
            : undefined;

        const res = await searchTrackV1Guided({
            queryRegion: m.query,
            mel,
            onsetEnvelope: onset,
            mfcc: mfccFeatures,
            options: {
                hopSec: m.search?.hopSec,
                threshold: m.search?.threshold,
                skipWindowOverlap: skipOverlap,
                weights: m.search?.weights,
                isCancelled: () => cancelled.has(jobId),
                refinement: m.refinement,
            },
        });

        if (cancelled.has(jobId)) {
            postLog(jobId, "warn", "CANCELLED (search result ignored)");
            return;
        }

        // Optional post-processing: softmax the *similarity* curve to sharpen peaks.
        // (We do not apply this to confidence curves; it breaks threshold semantics.)
        if (m.search?.applySoftmax && res.curveKind === "similarity") {
            const sim = res.scores;
            let max = -Infinity;
            for (let i = 0; i < sim.length; i++) {
                const v = sim[i] ?? 0;
                if (v > max) max = v;
            }
            const out = new Float32Array(sim.length);
            let sum = 0;
            for (let i = 0; i < sim.length; i++) {
                const e = Math.exp((sim[i] ?? 0) - max);
                out[i] = e;
                sum += e;
            }
            const denom = sum > 0 ? sum : 1;
            for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / denom;
            res.scores = out;
        }

        // Transfer curve buffers.
        const timesBuf = res.times.buffer.slice(0) as ArrayBuffer;
        const scoresBuf = res.scores.buffer.slice(0) as ArrayBuffer;

        const msgOut: MirWorkerOutMessage = {
            type: "SEARCH_RESULT",
            jobId,
            timings: {
                fingerprintMs: res.meta.fingerprintMs,
                scanMs: res.meta.scanMs,
                modelMs: res.meta.modelMs > 0 ? res.meta.modelMs : undefined,
                totalMs: res.meta.totalMs,
            },
            result: {
                times: timesBuf,
                scores: scoresBuf,
                curveKind: res.curveKind,
                model: res.model,
                candidates: res.candidates,
                meta: {
                    windowSec: res.meta.windowSec,
                    hopSec: res.meta.hopSec,
                    skippedWindows: res.meta.skippedWindows,
                    scannedWindows: res.meta.scannedWindows,
                },
            },
        };

        post(msgOut, [timesBuf, scoresBuf]);

        const totalMs = performance.now() - t0;
        postLog(jobId, "info", "SEARCH done", {
            totalMs,
            windows: res.times.length,
            candidates: res.candidates.length,
            curveKind: res.curveKind,
            model: res.model.kind,
            positives: res.model.positives,
            negatives: res.model.negatives,
        });
    } catch (e) {
        if (cancelled.has(jobId)) {
            postLog(jobId, "warn", "CANCELLED (search error ignored)");
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
        return;
    }

    if (msg.type === "SEARCH") {
        void handleSearch(msg);
    }
};
