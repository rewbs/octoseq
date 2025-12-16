import type { MirGPU } from "./context";

import {
    byteSizeF32,
    createAndWriteStorageBuffer,
    createReadbackBuffer,
    createStorageOutBuffer,
    createUniformBufferU32x4,
    nowMs,
    type GpuDispatchResult,
} from "./helpers";

import { hpssMasksWGSL } from "./kernels/hpssMasks.wgsl";

export type GpuHpssMasksInput = {
    nFrames: number;
    nBins: number;
    magsFlat: Float32Array; // [frame][bin] row-major, length=nFrames*nBins
    softMask: boolean;
};

export type GpuHpssMasksOutput = {
    harmonicMaskFlat: Float32Array; // length=nFrames*nBins
    percussiveMaskFlat: Float32Array; // length=nFrames*nBins
};

/**
 * Compute HPSS masks on the GPU.
 *
 * Notes:
 * - This stage intentionally only estimates masks. Applying masks to the original magnitude
 *   spectrogram is done on CPU for clarity and to preserve existing output shapes/types.
 * - Kernel uses a fixed median-of-9 approximation (see WGSL source for details).
 */
export async function gpuHpssMasks(
    gpu: MirGPU,
    input: GpuHpssMasksInput
): Promise<GpuDispatchResult<GpuHpssMasksOutput>> {
    const { device } = gpu;

    const { nFrames, nBins, magsFlat, softMask } = input;

    if (magsFlat.length !== nFrames * nBins) {
        throw new Error("@octoseq/mir: magsFlat length mismatch");
    }

    const magsBuffer = createAndWriteStorageBuffer(gpu, magsFlat);

    const outByteLen = byteSizeF32(nFrames * nBins);
    const harmonicOutBuffer = createStorageOutBuffer(gpu, outByteLen);
    const percussiveOutBuffer = createStorageOutBuffer(gpu, outByteLen);

    const harmonicReadback = createReadbackBuffer(gpu, outByteLen);
    const percussiveReadback = createReadbackBuffer(gpu, outByteLen);

    const shader = device.createShaderModule({ code: hpssMasksWGSL });
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shader, entryPoint: "main" },
    });

    // Params matches WGSL: (nBins, nFrames, softMaskU32, _pad)
    const params = createUniformBufferU32x4(gpu, new Uint32Array([nBins, nFrames, softMask ? 1 : 0, 0]));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: magsBuffer } },
            { binding: 1, resource: { buffer: harmonicOutBuffer } },
            { binding: 2, resource: { buffer: percussiveOutBuffer } },
            { binding: 3, resource: { buffer: params } },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    const wgX = Math.ceil(nFrames / 16);
    const wgY = Math.ceil(nBins / 16);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    // Read back both masks from a single submission.
    encoder.copyBufferToBuffer(harmonicOutBuffer, 0, harmonicReadback, 0, outByteLen);
    encoder.copyBufferToBuffer(percussiveOutBuffer, 0, percussiveReadback, 0, outByteLen);

    const tSubmit = nowMs();
    gpu.queue.submit([encoder.finish()]);

    await Promise.all([harmonicReadback.mapAsync(GPUMapMode.READ), percussiveReadback.mapAsync(GPUMapMode.READ)]);
    const tDone = nowMs();

    const hBytes = harmonicReadback.getMappedRange().slice(0);
    const pBytes = percussiveReadback.getMappedRange().slice(0);
    harmonicReadback.unmap();
    percussiveReadback.unmap();

    magsBuffer.destroy();
    harmonicOutBuffer.destroy();
    percussiveOutBuffer.destroy();
    params.destroy();
    harmonicReadback.destroy();
    percussiveReadback.destroy();

    return {
        value: {
            harmonicMaskFlat: new Float32Array(hBytes),
            percussiveMaskFlat: new Float32Array(pBytes),
        },
        timing: {
            gpuSubmitToReadbackMs: tDone - tSubmit,
        },
    };
}
