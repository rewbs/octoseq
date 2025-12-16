import type { Spectrogram } from "./spectrogram";
import type { SpectrogramLike2D, HpssOptions } from "./hpss";

import type { MirGPU } from "../gpu/context";
import { gpuHpssMasks } from "../gpu/hpssMasks";

export type HpssGpuResult = {
    harmonic: SpectrogramLike2D;
    percussive: SpectrogramLike2D;
    gpuMs: number;
};

function flattenMagnitudes(mags: Float32Array[], nFrames: number, nBins: number): Float32Array {
    const flat = new Float32Array(nFrames * nBins);
    for (let t = 0; t < nFrames; t++) {
        const row = mags[t] ?? new Float32Array(nBins);
        flat.set(row, t * nBins);
    }
    return flat;
}

function assertFiniteMask(name: string, v: number): void {
    if (!Number.isFinite(v)) {
        throw new Error(`@octoseq/mir: GPU HPSS produced non-finite ${name}`);
    }
}

/**
 * GPU-accelerated HPSS (mask estimation on GPU, apply on CPU).
 *
 * Important:
 * - CPU median HPSS remains the reference implementation.
 * - GPU uses fixed median-of-9 approximation, regardless of CPU options.
 *   Mapping (documented): CPU defaults (17) -> GPU fixed (9).
 */
export async function hpssGpu(
    spec: Spectrogram,
    gpu: MirGPU,
    options: HpssOptions = {}
): Promise<HpssGpuResult> {
    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

    // Flatten spectrogram magnitudes for GPU.
    const magsFlat = flattenMagnitudes(spec.magnitudes, nFrames, nBins);

    const soft = options.softMask ?? true;

    const masks = await gpuHpssMasks(gpu, {
        nFrames,
        nBins,
        magsFlat,
        softMask: soft,
    });

    if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

    const hMask = masks.value.harmonicMaskFlat;
    const pMask = masks.value.percussiveMaskFlat;

    const harmonic: Float32Array[] = new Array(nFrames);
    const percussive: Float32Array[] = new Array(nFrames);

    // Apply masks on CPU to preserve exact output shape/type.
    // We also do a best-effort cancellation check per frame.
    for (let t = 0; t < nFrames; t++) {
        if (options.isCancelled?.()) throw new Error("@octoseq/mir: cancelled");

        const mags = spec.magnitudes[t] ?? new Float32Array(nBins);
        const outH = new Float32Array(nBins);
        const outP = new Float32Array(nBins);

        const base = t * nBins;
        for (let k = 0; k < nBins; k++) {
            const x = mags[k] ?? 0;
            const mh = hMask[base + k] ?? 0;
            const mp = pMask[base + k] ?? 0;

            assertFiniteMask("mask", mh);
            assertFiniteMask("mask", mp);

            // masks are expected in [0,1] (kernel outputs that), but clamp defensively.
            const ch = Math.max(0, Math.min(1, mh));
            const cp = Math.max(0, Math.min(1, mp));

            outH[k] = x * ch;
            outP[k] = x * cp;
        }

        harmonic[t] = outH;
        percussive[t] = outP;
    }

    return {
        harmonic: { times: spec.times, bins: nBins, frames: nFrames, magnitudes: harmonic },
        percussive: { times: spec.times, bins: nBins, frames: nFrames, magnitudes: percussive },
        gpuMs: masks.timing.gpuSubmitToReadbackMs,
    };
}
