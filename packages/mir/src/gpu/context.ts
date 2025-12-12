/**
 * WebGPU context wrapper for MIR computations.
 *
 * v0.1 scope:
 * - Provide a safe, explicit way for callers to opt into GPU usage.
 * - Throw a clear error when called outside the browser or when WebGPU is unavailable.
 */
export class MirGPU {
    public readonly device: GPUDevice;
    public readonly queue: GPUQueue;

    private constructor(device: GPUDevice) {
        this.device = device;
        this.queue = device.queue;
    }

    static async create(): Promise<MirGPU> {
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

        return new MirGPU(device);
    }
}
