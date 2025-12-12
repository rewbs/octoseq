/**
 * Minimal WebGPU type declarations.
 *
 * Why this exists:
 * - TypeScript's built-in lib set does not always include WebGPU types in all environments.
 * - We avoid adding extra dependencies in this scaffold package.
 *
 * These declarations are intentionally minimal and are designed to *merge* with real WebGPU
 * types when they are available (interface merging), rather than conflicting.
 */

export { };

declare global {
    interface Navigator {
        gpu?: GPU;
    }

    interface GPU {
        requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    }

    interface GPURequestAdapterOptions {
        powerPreference?: "low-power" | "high-performance";
        forceFallbackAdapter?: boolean;
    }

    interface GPUAdapter {
        requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    }

    interface GPUDeviceDescriptor {
        requiredFeatures?: Iterable<string>;
        requiredLimits?: Record<string, number>;
        label?: string;
    }

    interface GPUDevice {
        readonly queue: GPUQueue;
        createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
        createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
        createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
        createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
        createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
        createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
        createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    }

    interface GPUQueue {
        writeBuffer(
            buffer: GPUBuffer,
            bufferOffset: number,
            data: BufferSource,
            dataOffset?: number,
            size?: number
        ): void;
        submit(commandBuffers: Iterable<GPUCommandBuffer>): void;
    }

    interface GPUBuffer {
        mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
        getMappedRange(offset?: number, size?: number): ArrayBuffer;
        unmap(): void;
        destroy(): void;
    }

    interface GPUBufferDescriptor {
        size: number;
        usage: number;
        mappedAtCreation?: boolean;
        label?: string;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface GPUShaderModule { }

    interface GPUShaderModuleDescriptor {
        code: string;
        label?: string;
    }

    interface GPUComputePipeline {
        getBindGroupLayout(index: number): GPUBindGroupLayout;
    }

    interface GPUComputePipelineDescriptor {
        layout?: GPUPipelineLayout | "auto";
        compute: {
            module: GPUShaderModule;
            entryPoint: string;
        };
        label?: string;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface GPUBindGroupLayout { }

    interface GPUBindGroupLayoutDescriptor {
        entries: Array<{
            binding: number;
            visibility: number;
            buffer?: { type?: "uniform" | "storage" | "read-only-storage" };
        }>;
        label?: string;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface GPUPipelineLayout { }

    interface GPUPipelineLayoutDescriptor {
        bindGroupLayouts: GPUBindGroupLayout[];
        label?: string;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface GPUBindGroup { }

    interface GPUBindGroupDescriptor {
        layout: GPUBindGroupLayout;
        entries: Array<{ binding: number; resource: { buffer: GPUBuffer } }>;
        label?: string;
    }

    interface GPUCommandEncoder {
        beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
        copyBufferToBuffer(
            source: GPUBuffer,
            sourceOffset: number,
            destination: GPUBuffer,
            destinationOffset: number,
            size: number
        ): void;
        finish(): GPUCommandBuffer;
    }

    interface GPUCommandEncoderDescriptor {
        label?: string;
    }

    interface GPUComputePassEncoder {
        setPipeline(pipeline: GPUComputePipeline): void;
        setBindGroup(index: number, bindGroup: GPUBindGroup): void;
        dispatchWorkgroups(
            workgroupCountX: number,
            workgroupCountY?: number,
            workgroupCountZ?: number
        ): void;
        end(): void;
    }

    interface GPUComputePassDescriptor {
        label?: string;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface GPUCommandBuffer { }

    // Common WebGPU constants. These are numbers in the real API.
    // We declare them as `var` so they exist at runtime only if provided by the environment.
    // (We only use these constants when running in a WebGPU-capable browser.)
    var GPUBufferUsage: {
        MAP_READ: number;
        COPY_DST: number;
        COPY_SRC: number;
        STORAGE: number;
        UNIFORM: number;
    };

    var GPUMapMode: {
        READ: number;
    };

    var GPUShaderStage: {
        COMPUTE: number;
    };
}
