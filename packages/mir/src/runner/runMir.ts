import { melSpectrogram, type MelConfig, type MelSpectrogram } from "../dsp/mel";
import { mfcc, delta, deltaDelta } from "../dsp/mfcc";
import { onsetEnvelopeFromMel, onsetEnvelopeFromMelGpu } from "../dsp/onset";
import { peakPick } from "../dsp/peakPick";
import { hpss } from "../dsp/hpss";
import { hpssGpu } from "../dsp/hpssGpu";
import { spectralCentroid, spectralFlux } from "../dsp/spectral";
import { spectrogram, type AudioBufferLike, type Spectrogram, type SpectrogramConfig } from "../dsp/spectrogram";
import type { MirGPU } from "../gpu/context";
import type { MirAudioPayload, MirBackend, MirResult, MirRunRequest } from "../types";

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function asAudioBufferLike(audio: MirAudioPayload): AudioBufferLike {
    return {
        sampleRate: audio.sampleRate,
        numberOfChannels: 1,
        getChannelData: () => audio.mono,
    };
}

export type RunMirOptions = {
    gpu?: MirGPU;
    /** If provided, long loops should periodically call this and abort if true. */
    isCancelled?: () => boolean;
    /** If true and backend==='gpu', do not silently fall back to CPU on GPU errors. */
    strictGpu?: boolean;

    // v0.1 feature-specific options (kept minimal; UI provides basic controls)
    onset?: {
        smoothMs?: number;
        diffMethod?: "rectified" | "abs";
        useLog?: boolean;
    };
    peakPick?: {
        minIntervalSec?: number;
        threshold?: number;
        adaptiveFactor?: number;
    };
    hpss?: {
        timeMedian?: number;
        freqMedian?: number;
    };
    mfcc?: {
        nCoeffs?: number;
    };
};

// Backwards-compat export alias (some earlier tasks referenced this name).
export type RunMirBackendOptions = RunMirOptions;

/**
 * Shared MIR execution entrypoint used by the main thread and by the worker.
 *
 * Notes:
 * - We keep FFT/STFT on CPU for now (spectrogram()), but allow one downstream stage
 *   (mel projection) to run on real WebGPU via `melSpectrogram(spec, config, gpu)`.
 */
export async function runMir(
    audio: MirAudioPayload,
    request: MirRunRequest,
    options: RunMirOptions = {}
): Promise<MirResult> {
    // Allow callers to pass per-run config via the request (needed for worker runs).
    // If both are provided, `options.*` wins.
    options = {
        ...options,
        onset: { ...request.onset, ...options.onset },
        peakPick: { ...request.peakPick, ...options.peakPick },
        hpss: { ...request.hpss, ...options.hpss },
        mfcc: { ...request.mfcc, ...options.mfcc },
    };
    const t0 = nowMs();

    const backend: MirBackend = request.backend ?? "cpu";

    const specConfig: SpectrogramConfig = request.spectrogram ?? {
        fftSize: 2048,
        hopSize: 512,
        window: "hann",
    };

    // CPU: spectrogram + centroid/flux are CPU-only today.
    const cpuStart = nowMs();
    const spec: Spectrogram = await spectrogram(asAudioBufferLike(audio), specConfig, undefined, {
        isCancelled: options.isCancelled,
    });
    const cpuAfterSpec = nowMs();

    if (options.isCancelled?.()) {
        throw new Error("@octoseq/mir: cancelled");
    }

    if (request.fn === "spectralCentroid") {
        const values = spectralCentroid(spec);
        const cpuEnd = nowMs();
        return {
            kind: "1d",
            times: spec.times,
            values,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: {
                    totalMs: cpuEnd - t0,
                    cpuMs: cpuEnd - cpuStart,
                },
            },
        };
    }

    if (request.fn === "spectralFlux") {
        const values = spectralFlux(spec);
        const cpuEnd = nowMs();
        return {
            kind: "1d",
            times: spec.times,
            values,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: {
                    totalMs: cpuEnd - t0,
                    cpuMs: cpuEnd - cpuStart,
                },
            },
        };
    }

    // melSpectrogram
    const melConfig: MelConfig = request.mel ?? { nMels: 64 };

    // Helper: compute mel (possibly GPU-accelerated projection).
    const computeMel = async (useGpu: boolean): Promise<{ mel: MelSpectrogram; usedGpu: boolean; gpuMs?: number; cpuExtraMs: number }> => {
        const melCpuStart = nowMs();

        if (useGpu) {
            if (!options.gpu) {
                throw new Error("@octoseq/mir: backend='gpu' requested but no MirGPU provided");
            }

            const gpuStart = nowMs();
            try {
                const mel = await melSpectrogram(spec, melConfig, options.gpu);
                const gpuEnd = nowMs();
                const gpuKernelMs = mel.gpuTimings?.gpuSubmitToReadbackMs;

                return {
                    mel,
                    usedGpu: true,
                    gpuMs: gpuKernelMs ?? gpuEnd - gpuStart,
                    cpuExtraMs: nowMs() - melCpuStart - (gpuEnd - gpuStart),
                };
            } catch (e) {
                if (options.strictGpu) throw e;
                // fall back to CPU
            }
        }

        const mel = await melSpectrogram(spec, melConfig, undefined);
        const melCpuEnd = nowMs();

        return {
            mel,
            usedGpu: false,
            cpuExtraMs: melCpuEnd - melCpuStart,
        };
    };

    // Branch by fn.
    if (request.fn === "melSpectrogram") {
        const { mel, usedGpu, gpuMs, cpuExtraMs } = await computeMel(backend === "gpu");
        const end = nowMs();

        return {
            kind: "2d",
            times: mel.times,
            data: mel.melBands,
            meta: {
                backend: usedGpu ? "gpu" : "cpu",
                usedGpu,
                timings: {
                    totalMs: end - t0,
                    cpuMs: cpuAfterSpec - cpuStart + cpuExtraMs,
                    gpuMs,
                },
            },
        };
    }

    if (request.fn === "onsetEnvelope") {
        // For this milestone we compute onset from mel by default.
        // GPU path: diff+reduction kernel on melFlat.
        if (backend === "gpu") {
            if (!options.gpu) throw new Error("@octoseq/mir: backend='gpu' requested but no MirGPU provided");

            const { mel, usedGpu: usedGpuForMel, gpuMs: melGpuMs, cpuExtraMs: melCpuMs } = await computeMel(true);

            const onsetStart = nowMs();
            try {
                const onsetGpu = await onsetEnvelopeFromMelGpu(mel, options.gpu, {
                    diffMethod: options.onset?.diffMethod,
                });
                const end = nowMs();

                return {
                    kind: "1d",
                    times: onsetGpu.times,
                    values: onsetGpu.values,
                    meta: {
                        backend: "gpu",
                        usedGpu: true,
                        timings: {
                            totalMs: end - t0,
                            cpuMs: cpuAfterSpec - cpuStart + melCpuMs,
                            gpuMs: (melGpuMs ?? 0) + onsetGpu.gpuTimings.gpuSubmitToReadbackMs,
                        },
                    },
                };
            } catch (e) {
                if (options.strictGpu) throw e;
                // fallback to CPU onset
                void usedGpuForMel;
            } finally {
                void onsetStart;
            }
        }

        const { mel, cpuExtraMs: melCpuMs } = await computeMel(false);
        const onset = onsetEnvelopeFromMel(mel, {
            smoothMs: options.onset?.smoothMs,
            diffMethod: options.onset?.diffMethod,
            useLog: options.onset?.useLog,
        });
        const end = nowMs();

        return {
            kind: "1d",
            times: onset.times,
            values: onset.values,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: {
                    totalMs: end - t0,
                    cpuMs: cpuAfterSpec - cpuStart + melCpuMs,
                },
            },
        };
    }

    if (request.fn === "onsetPeaks") {
        const { mel, cpuExtraMs: melCpuMs } = await computeMel(false);
        const onset = onsetEnvelopeFromMel(mel, {
            smoothMs: options.onset?.smoothMs,
            diffMethod: options.onset?.diffMethod,
            useLog: options.onset?.useLog,
        });

        const events = peakPick(onset.times, onset.values, {
            minIntervalSec: options.peakPick?.minIntervalSec,
            threshold: options.peakPick?.threshold,
            adaptive: options.peakPick?.adaptiveFactor
                ? { method: "meanStd", factor: options.peakPick.adaptiveFactor }
                : undefined,
        });

        const end = nowMs();
        return {
            kind: "events",
            times: onset.times,
            events,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: {
                    totalMs: end - t0,
                    cpuMs: cpuAfterSpec - cpuStart + melCpuMs,
                },
            },
        };
    }

    if (request.fn === "hpssHarmonic" || request.fn === "hpssPercussive") {
        // HPSS is CPU-heavy; we optionally accelerate mask estimation with WebGPU.
        // CPU path remains the reference implementation and is used as fallback.
        if (backend === "gpu") {
            if (!options.gpu) throw new Error("@octoseq/mir: backend='gpu' requested but no MirGPU provided");

            const hpssStart = nowMs();
            try {
                const out = await hpssGpu(spec, options.gpu, {
                    timeMedian: options.hpss?.timeMedian,
                    freqMedian: options.hpss?.freqMedian,
                    softMask: true, // preserve CPU default
                    isCancelled: options.isCancelled,
                });
                const end = nowMs();

                const chosen = request.fn === "hpssHarmonic" ? out.harmonic : out.percussive;
                return {
                    kind: "2d",
                    times: chosen.times,
                    data: chosen.magnitudes,
                    meta: {
                        backend: "gpu",
                        usedGpu: true,
                        timings: {
                            totalMs: end - t0,
                            cpuMs: cpuAfterSpec - cpuStart + ((end - hpssStart) - out.gpuMs),
                            gpuMs: out.gpuMs,
                        },
                    },
                };
            } catch (e) {
                if (options.strictGpu) throw e;
                // fall back to CPU HPSS
            }
        }

        const hpssStart = nowMs();
        const { harmonic, percussive } = hpss(spec, {
            timeMedian: options.hpss?.timeMedian,
            freqMedian: options.hpss?.freqMedian,
            isCancelled: options.isCancelled,
        });
        const end = nowMs();
        const cpuMs = cpuAfterSpec - cpuStart + (end - hpssStart);

        const chosen = request.fn === "hpssHarmonic" ? harmonic : percussive;
        return {
            kind: "2d",
            times: chosen.times,
            data: chosen.magnitudes,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: { totalMs: end - t0, cpuMs },
            },
        };
    }

    if (request.fn === "mfcc" || request.fn === "mfccDelta" || request.fn === "mfccDeltaDelta") {
        const { mel, cpuExtraMs: melCpuMs } = await computeMel(false);
        const mfccStart = nowMs();
        const base = mfcc(mel, { nCoeffs: options.mfcc?.nCoeffs });

        const features = { times: base.times, values: base.coeffs };
        const chosen =
            request.fn === "mfcc"
                ? features
                : request.fn === "mfccDelta"
                    ? delta(features)
                    : deltaDelta(features);

        const end = nowMs();
        return {
            kind: "2d",
            times: chosen.times,
            data: chosen.values,
            meta: {
                backend: "cpu",
                usedGpu: false,
                timings: {
                    totalMs: end - t0,
                    cpuMs: cpuAfterSpec - cpuStart + melCpuMs + (end - mfccStart),
                },
            },
        };
    }

    // Fallback: keep old behaviour (melSpectrogram) if unknown fn.
    const { mel, usedGpu, gpuMs, cpuExtraMs } = await computeMel(backend === "gpu");
    const end = nowMs();

    return {
        kind: "2d",
        times: mel.times,
        data: mel.melBands,
        meta: {
            backend: usedGpu ? "gpu" : "cpu",
            usedGpu,
            timings: {
                totalMs: end - t0,
                cpuMs: cpuAfterSpec - cpuStart + cpuExtraMs,
                gpuMs,
            },
        },
    };
}
