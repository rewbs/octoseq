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

import { melProjectWGSL } from "./kernels/melProject.wgsl";

export type GpuMelProjectInput = {
    nFrames: number;
    nBins: number;
    nMels: number;
    magsFlat: Float32Array; // length = nFrames*nBins
    filterFlat: Float32Array; // length = nMels*nBins
};

export type GpuMelProjectOutput = {
    outFlat: Float32Array; // length = nFrames*nMels
};

/**
 * Real WebGPU compute stage: dense mel projection.
 *
 * Returns outFlat plus GPU timing that measures submit->readback.
 */
export async function gpuMelProjectFlat(
    gpu: MirGPU,
    input: GpuMelProjectInput
): Promise<GpuDispatchResult<GpuMelProjectOutput>> {
    const { device } = gpu;

    const { nFrames, nBins, nMels, magsFlat, filterFlat } = input;
    if (magsFlat.length !== nFrames * nBins) {
        throw new Error("@octoseq/mir: magsFlat length mismatch");
    }
    if (filterFlat.length !== nMels * nBins) {
        throw new Error("@octoseq/mir: filterFlat length mismatch");
    }

    const magsBuffer = createAndWriteStorageBuffer(gpu, magsFlat);
    const filterBuffer = createAndWriteStorageBuffer(gpu, filterFlat);

    const outByteLen = byteSizeF32(nFrames * nMels);
    const outBuffer = createStorageOutBuffer(gpu, outByteLen);
    const readback = createReadbackBuffer(gpu, outByteLen);

    const shader = device.createShaderModule({ code: melProjectWGSL });
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
            module: shader,
            entryPoint: "main",
        },
    });

    const params = createUniformBufferU32x4(gpu, new Uint32Array([nBins, nMels, nFrames, 0]));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: magsBuffer } },
            { binding: 1, resource: { buffer: filterBuffer } },
            { binding: 2, resource: { buffer: outBuffer } },
            { binding: 3, resource: { buffer: params } },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    const wgX = Math.ceil(nFrames / 16);
    const wgY = Math.ceil(nMels / 16);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    const { value: bytes, timing } = await submitAndReadback(gpu, encoder, outBuffer, readback, outByteLen);

    // Cleanup (simple; no pooling in v0.1)
    magsBuffer.destroy();
    filterBuffer.destroy();
    outBuffer.destroy();
    params.destroy();
    readback.destroy();

    const outFlat = new Float32Array(bytes);
    return {
        value: { outFlat },
        timing,
    };
}
