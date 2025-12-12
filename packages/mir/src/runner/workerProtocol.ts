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

export type MirWorkerInMessage = MirWorkerInitMessage | MirWorkerRunMessage | MirWorkerCancelMessage;

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

export type MirWorkerOutMessage = MirWorkerResultMessage | MirWorkerErrorMessage | MirWorkerLogMessage;

export function rebuildAudioPayload(a: MirWorkerRunMessage["audio"]): MirAudioPayload {
    return {
        sampleRate: a.sampleRate,
        mono: new Float32Array(a.mono as ArrayBuffer),
    };
}
