# WebGPU acceleration (v0.1)

This folder contains a minimal WebGPU compute implementation used to validate GPU execution inside `@octoseq/mir`.

## What is on GPU?

- **Mel filterbank projection** (spectrogram magnitudes → mel bands) runs as a real WebGPU compute shader.
- FFT/STFT remains on CPU (see `src/dsp/spectrogram.ts`).

## Timing / observability

The GPU stage measures **submit → readback completion** time (`gpuSubmitToReadbackMs`) by awaiting `GPUBuffer.mapAsync()` on a readback buffer.
This timing is surfaced through:

- `MelSpectrogram.gpuTimings.gpuSubmitToReadbackMs`
- `MirResult.meta.timings.gpuMs` (prefers the submit→readback timing when present)

## Numeric tolerance

GPU and CPU results may differ slightly due to floating point order-of-operations.
These differences should be small and not visually significant.
A reasonable tolerance for comparison is:

- `absDiff <= 1e-4` for individual mel bin values (after log10)

## Files

- `kernels/melProject.wgsl.ts` — WGSL kernel source
- `helpers.ts` — small buffer/dispatch/readback helpers
- `melProject.ts` — kernel wrapper that runs the projection and reads back `Float32Array`
