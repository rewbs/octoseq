import type { MirGPU } from "./context";

import {
    byteSizeF32,
    createAndWriteStorageBuffer,
    createReadbackBuffer,
    createStorageOutBuffer,
    createUniformBufferU32x4,
    submitAndReadback,
    type GpuDispatchResult,
} from "./helpers";

import { onsetEnvelopeWGSL } from "./kernels/onsetEnvelope.wgsl";

export type GpuOnsetEnvelopeInput = {
    nFrames: number;
    nMels: number;
    melFlat: Float32Array; // length=nFrames*nMels
    diffMethod: "rectified" | "abs";
};

export type GpuOnsetEnvelopeOutput = {
    out: Float32Array; // length=nFrames
};

export async function gpuOnsetEnvelopeFromMelFlat(
    gpu: MirGPU,
    input: GpuOnsetEnvelopeInput
): Promise<GpuDispatchResult<GpuOnsetEnvelopeOutput>> {
    const { device } = gpu;

    const { nFrames, nMels, melFlat, diffMethod } = input;
    if (melFlat.length !== nFrames * nMels) {
        throw new Error("@octoseq/mir: melFlat length mismatch");
    }

    const melBuffer = createAndWriteStorageBuffer(gpu, melFlat);

    const outByteLen = byteSizeF32(nFrames);
    const outBuffer = createStorageOutBuffer(gpu, outByteLen);
    const readback = createReadbackBuffer(gpu, outByteLen);

    const shader = device.createShaderModule({ code: onsetEnvelopeWGSL });
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shader, entryPoint: "main" },
    });

    const diffU32 = diffMethod === "abs" ? 1 : 0;
    const params = createUniformBufferU32x4(gpu, new Uint32Array([nMels, nFrames, diffU32, 0]));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: melBuffer } },
            { binding: 1, resource: { buffer: outBuffer } },
            { binding: 2, resource: { buffer: params } },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    const wg = Math.ceil(nFrames / 256);
    pass.dispatchWorkgroups(wg);
    pass.end();

    const { value: bytes, timing } = await submitAndReadback(gpu, encoder, outBuffer, readback, outByteLen);

    melBuffer.destroy();
    outBuffer.destroy();
    params.destroy();
    readback.destroy();

    return {
        value: { out: new Float32Array(bytes) },
        timing,
    };
}
