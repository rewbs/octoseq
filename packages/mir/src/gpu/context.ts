import { BufferPool, type BufferPoolOptions, type BufferPoolStats } from "./bufferPool";

/**
 * WebGPU context wrapper for MIR computations.
 *
 * Includes buffer pooling for efficient GPU memory reuse across operations.
 */
export class MirGPU {
  public readonly device: GPUDevice;
  public readonly queue: GPUQueue;
  public readonly bufferPool: BufferPool;

  private constructor(device: GPUDevice, bufferPoolOptions?: BufferPoolOptions) {
    this.device = device;
    this.queue = device.queue;
    this.bufferPool = new BufferPool(device, bufferPoolOptions);
  }

  static async create(bufferPoolOptions?: BufferPoolOptions): Promise<MirGPU> {
    // Next.js note: callers must create MirGPU from a client component.
    if (typeof navigator === "undefined") {
      throw new Error(
        "@octoseq/mir: WebGPU is only available in the browser (navigator is undefined)."
      );
    }

    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) {
      throw new Error(
        "@octoseq/mir: WebGPU is unavailable (navigator.gpu is missing). Use CPU mode or a WebGPU-capable browser."
      );
    }

    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      throw new Error(
        "@octoseq/mir: Failed to acquire a WebGPU adapter. WebGPU may be disabled or unsupported."
      );
    }

    // We keep this minimal: no required features for v0.1.
    const device = await adapter.requestDevice();

    return new MirGPU(device, bufferPoolOptions);
  }

  /**
   * Get statistics about buffer pool usage.
   */
  getBufferPoolStats(): BufferPoolStats {
    return this.bufferPool.getStats();
  }

  /**
   * Manually trigger buffer pool cleanup (normally runs automatically).
   */
  cleanupBufferPool(): void {
    this.bufferPool.cleanup();
  }

  /**
   * Dispose of the GPU context and clean up all resources.
   */
  dispose(): void {
    this.bufferPool.dispose();
    // Note: GPUDevice doesn't have a dispose method, but we clean up our resources
  }
}
