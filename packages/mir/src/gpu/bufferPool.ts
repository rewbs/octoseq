/**
 * GPU Buffer Pool for efficient buffer reuse across MIR computations.
 *
 * Reduces allocation overhead by maintaining pools of buffers grouped by
 * size and usage flags. Buffers are acquired for operations and released
 * back to the pool for reuse.
 */

export interface BufferPoolEntry {
  buffer: GPUBuffer;
  size: number;
  usage: number;
  lastUsed: number;
}

export interface BufferPoolStats {
  totalBuffers: number;
  activeBuffers: number;
  availableBuffers: number;
  poolsByUsage: Map<number, number>;
  totalMemoryBytes: number;
}

/**
 * Buffer pool configuration options.
 */
export interface BufferPoolOptions {
  /**
   * Maximum number of buffers to keep in the pool per usage type.
   * Default: 32
   */
  maxBuffersPerUsage?: number;

  /**
   * Time in milliseconds before an unused buffer is destroyed.
   * Default: 60000 (1 minute)
   */
  bufferTTLMs?: number;

  /**
   * Whether to enable automatic cleanup of old buffers.
   * Default: true
   */
  enableAutoCleanup?: boolean;

  /**
   * Interval in milliseconds for automatic cleanup.
   * Default: 30000 (30 seconds)
   */
  cleanupIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<BufferPoolOptions> = {
  maxBuffersPerUsage: 32,
  bufferTTLMs: 60000,
  enableAutoCleanup: true,
  cleanupIntervalMs: 30000,
};

/**
 * Key for indexing buffers by size and usage.
 */
function makePoolKey(size: number, usage: number): string {
  return `${size}-${usage}`;
}

/**
 * BufferPool manages reusable GPU buffers to reduce allocation overhead.
 *
 * Usage:
 * ```ts
 * const pool = new BufferPool(gpu.device);
 * const buffer = pool.acquire(1024, GPUBufferUsage.STORAGE);
 * // ... use buffer ...
 * pool.release(buffer);
 * ```
 */
export class BufferPool {
  private device: GPUDevice;
  private options: Required<BufferPoolOptions>;

  // Available buffers indexed by size+usage key
  private availableBuffers = new Map<string, BufferPoolEntry[]>();

  // Currently in-use buffers (for tracking and stats)
  private activeBuffers = new Set<GPUBuffer>();

  // Cleanup interval handle
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(device: GPUDevice, options: BufferPoolOptions = {}) {
    this.device = device;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    if (this.options.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Acquire a buffer from the pool or create a new one if none available.
   *
   * @param size - Byte size of the buffer
   * @param usage - Buffer usage flags (e.g. GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
   * @returns A GPUBuffer ready for use
   */
  acquire(size: number, usage: number): GPUBuffer {
    const key = makePoolKey(size, usage);
    const pool = this.availableBuffers.get(key);

    // Try to reuse an existing buffer
    if (pool && pool.length > 0) {
      const entry = pool.pop()!;
      this.activeBuffers.add(entry.buffer);
      return entry.buffer;
    }

    // No buffer available, create a new one
    const buffer = this.device.createBuffer({ size, usage });
    this.activeBuffers.add(buffer);
    return buffer;
  }

  /**
   * Release a buffer back to the pool for reuse.
   *
   * @param buffer - The buffer to release
   * @param size - Original size of the buffer
   * @param usage - Original usage flags of the buffer
   */
  release(buffer: GPUBuffer, size: number, usage: number): void {
    if (!this.activeBuffers.has(buffer)) {
      console.warn("@octoseq/mir: Attempting to release buffer not tracked by pool");
      return;
    }

    this.activeBuffers.delete(buffer);

    const key = makePoolKey(size, usage);
    let pool = this.availableBuffers.get(key);

    if (!pool) {
      pool = [];
      this.availableBuffers.set(key, pool);
    }

    // Check if pool is full
    if (pool.length >= this.options.maxBuffersPerUsage) {
      // Pool is full, destroy the buffer instead of pooling it
      buffer.destroy();
      return;
    }

    // Add to pool for reuse
    pool.push({
      buffer,
      size,
      usage,
      lastUsed: performance.now(),
    });
  }

  /**
   * Clean up old unused buffers that exceed the TTL.
   */
  cleanup(): void {
    const now = performance.now();
    const ttl = this.options.bufferTTLMs;

    for (const [key, pool] of this.availableBuffers.entries()) {
      const remaining: BufferPoolEntry[] = [];

      for (const entry of pool) {
        if (now - entry.lastUsed > ttl) {
          // Buffer is too old, destroy it
          entry.buffer.destroy();
        } else {
          // Keep this buffer
          remaining.push(entry);
        }
      }

      if (remaining.length === 0) {
        this.availableBuffers.delete(key);
      } else {
        this.availableBuffers.set(key, remaining);
      }
    }
  }

  /**
   * Destroy all pooled buffers and clear the pool.
   */
  clear(): void {
    // Destroy all available buffers
    for (const pool of this.availableBuffers.values()) {
      for (const entry of pool) {
        entry.buffer.destroy();
      }
    }

    this.availableBuffers.clear();

    // Note: We don't destroy active buffers as they're still in use
    // Callers are responsible for releasing them properly
  }

  /**
   * Get statistics about the buffer pool.
   */
  getStats(): BufferPoolStats {
    let totalBuffers = this.activeBuffers.size;
    let totalMemoryBytes = 0;
    const poolsByUsage = new Map<number, number>();

    for (const pool of this.availableBuffers.values()) {
      totalBuffers += pool.length;

      for (const entry of pool) {
        totalMemoryBytes += entry.size;

        const count = poolsByUsage.get(entry.usage) || 0;
        poolsByUsage.set(entry.usage, count + 1);
      }
    }

    return {
      totalBuffers,
      activeBuffers: this.activeBuffers.size,
      availableBuffers: totalBuffers - this.activeBuffers.size,
      poolsByUsage,
      totalMemoryBytes,
    };
  }

  /**
   * Start automatic cleanup of old buffers.
   */
  private startAutoCleanup(): void {
    if (this.cleanupInterval !== null) {
      return; // Already running
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupIntervalMs);
  }

  /**
   * Stop automatic cleanup.
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Dispose of the buffer pool and destroy all buffers.
   */
  dispose(): void {
    this.stopAutoCleanup();
    this.clear();
  }
}
