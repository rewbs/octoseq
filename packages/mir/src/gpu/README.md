# WebGPU acceleration

This folder contains the WebGPU compute implementation that powers optional GPU paths in `@octoseq/mir`.

## What runs on GPU?

- **Mel filterbank projection** (spectrogram magnitudes → mel bands) — real WGSL compute kernel.
- **HPSS mask estimation** — WGSL kernels for soft harmonic/percussive masks (see `hpssMasks.wgsl.ts`).
- FFT/STFT remains on CPU (see `src/dsp/spectrogram.ts`); GPU is used as an acceleration stage rather than a full pipeline.

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
- HPSS masks are soft probabilities; expect small differences in the 1e-3 range.

## Files

- `kernels/melProject.wgsl.ts` — WGSL kernel source
- `kernels/hpssMasks.wgsl.ts` — WGSL kernels for harmonic/percussive mask estimation
- `helpers.ts` — small buffer/dispatch/readback helpers
- `melProject.ts` — kernel wrapper that runs the projection and reads back `Float32Array`
- `hpssMasks.ts` — GPU HPSS mask orchestration + readback
