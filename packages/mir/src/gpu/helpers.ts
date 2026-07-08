import type { MirGPU } from "./context";

export function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export type GpuStageTiming = {
    /** wall-clock time from queue.submit() to readback completion */
    gpuSubmitToReadbackMs: number;
};

export type GpuDispatchResult<T> = {
    value: T;
    timing: GpuStageTiming;
};

export function byteSizeF32(n: number): number {
    return n * 4;
}

/**
 * Metadata for pooled buffers to track their properties for release.
 */
export interface PooledBuffer {
    buffer: GPUBuffer;
    size: number;
    usage: number;
}

export function createAndWriteStorageBuffer(gpu: MirGPU, data: Float32Array): GPUBuffer {
    const buf = gpu.device.createBuffer({
        size: byteSizeF32(data.length),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Some TS lib definitions make BufferSource incompatible with ArrayBufferLike.
    // WebGPU implementations accept typed arrays; cast to keep this package dependency-free.
    gpu.queue.writeBuffer(buf, 0, data as unknown as BufferSource);
    return buf;
}

export function createUniformBufferU32x4(gpu: MirGPU, u32x4: Uint32Array): GPUBuffer {
    if (u32x4.length !== 4) throw new Error("@octoseq/mir: uniform buffer must be 4 u32 values");
    const buf = gpu.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpu.queue.writeBuffer(buf, 0, u32x4 as unknown as BufferSource);
    return buf;
}

export function createStorageOutBuffer(gpu: MirGPU, byteLength: number): GPUBuffer {
    return gpu.device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
}

export function createReadbackBuffer(gpu: MirGPU, byteLength: number): GPUBuffer {
    return gpu.device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Submit an encoder that copies `outBuffer` to a MAP_READ buffer and returns the mapped bytes.
 *
 * Note: mapping is the completion signal; we intentionally measure submit->map to validate
 * real GPU work end-to-end.
 */
export async function submitAndReadback(
    gpu: MirGPU,
    encoder: GPUCommandEncoder,
    outBuffer: GPUBuffer,
    readback: GPUBuffer,
    byteLength: number
): Promise<GpuDispatchResult<ArrayBuffer>> {
    encoder.copyBufferToBuffer(outBuffer, 0, readback, 0, byteLength);

    const tSubmit = nowMs();
    gpu.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const tDone = nowMs();

    const mapped = readback.getMappedRange();
    const copy = mapped.slice(0); // copies to standalone ArrayBuffer
    readback.unmap();

    return {
        value: copy,
        timing: {
            gpuSubmitToReadbackMs: tDone - tSubmit,
        },
    };
}

// ============================================================================
// Pooled Buffer Creation Functions
// ============================================================================

/**
 * Create or acquire a storage buffer from the pool and write data to it.
 *
 * Returns a PooledBuffer that must be released back to the pool after use.
 */
export function createPooledStorageBuffer(gpu: MirGPU, data: Float32Array): PooledBuffer {
    const size = byteSizeF32(data.length);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

    const buffer = gpu.bufferPool.acquire(size, usage);
    gpu.queue.writeBuffer(buffer, 0, data as unknown as BufferSource);

    return { buffer, size, usage };
}

/**
 * Create or acquire a uniform buffer from the pool and write u32x4 data to it.
 *
 * Returns a PooledBuffer that must be released back to the pool after use.
 */
export function createPooledUniformBufferU32x4(gpu: MirGPU, u32x4: Uint32Array): PooledBuffer {
    if (u32x4.length !== 4) throw new Error("@octoseq/mir: uniform buffer must be 4 u32 values");

    const size = 16;
    const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

    const buffer = gpu.bufferPool.acquire(size, usage);
    gpu.queue.writeBuffer(buffer, 0, u32x4 as unknown as BufferSource);

    return { buffer, size, usage };
}

/**
 * Create or acquire a storage output buffer from the pool.
 *
 * Returns a PooledBuffer that must be released back to the pool after use.
 */
export function createPooledStorageOutBuffer(gpu: MirGPU, byteLength: number): PooledBuffer {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const buffer = gpu.bufferPool.acquire(byteLength, usage);

    return { buffer, size: byteLength, usage };
}

/**
 * Create or acquire a readback buffer from the pool.
 *
 * Returns a PooledBuffer that must be released back to the pool after use.
 */
export function createPooledReadbackBuffer(gpu: MirGPU, byteLength: number): PooledBuffer {
    const usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
    const buffer = gpu.bufferPool.acquire(byteLength, usage);

    return { buffer, size: byteLength, usage };
}

/**
 * Release a pooled buffer back to the pool for reuse.
 */
export function releasePooledBuffer(gpu: MirGPU, pooled: PooledBuffer): void {
    gpu.bufferPool.release(pooled.buffer, pooled.size, pooled.usage);
}

/**
 * Release multiple pooled buffers back to the pool at once.
 */
export function releasePooledBuffers(gpu: MirGPU, buffers: PooledBuffer[]): void {
    for (const pooled of buffers) {
        releasePooledBuffer(gpu, pooled);
    }
}
