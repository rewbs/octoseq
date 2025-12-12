import type { MirGPU } from "../gpu/context";

import { fftInPlace, hannWindow, magnitudesFromFft } from "./fft";

// AudioBufferLike is re-exported from the package root.
// Keeping this local type avoids importing from ../index (which can create circular deps).
export type AudioBufferLike = {
    sampleRate: number;
    getChannelData(channel: number): Float32Array;
    numberOfChannels: number;
};

export type SpectrogramConfig = {
    fftSize: number;
    hopSize: number;
    window: "hann";
};

export type SpectrogramOptions = {
    /** Optional cancellation hook; checked once per frame. */
    isCancelled?: () => boolean;
};

export type Spectrogram = {
    sampleRate: number;
    fftSize: number;
    hopSize: number;
    times: Float32Array; // seconds (center of each frame)
    magnitudes: Float32Array[]; // [frame][bin]
};

function assertPositiveInt(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0 || (value | 0) !== value) {
        throw new Error(`@octoseq/mir: ${name} must be a positive integer`);
    }
}

function mixToMono(audio: AudioBufferLike): Float32Array {
    const nCh = audio.numberOfChannels;
    if (nCh <= 0) {
        throw new Error("@octoseq/mir: audio.numberOfChannels must be >= 1");
    }

    if (nCh === 1) {
        return audio.getChannelData(0);
    }

    const length = audio.getChannelData(0).length;
    const out = new Float32Array(length);

    for (let ch = 0; ch < nCh; ch++) {
        const data = audio.getChannelData(ch);
        if (data.length !== length) {
            throw new Error(
                "@octoseq/mir: all channels must have equal length (AudioBuffer-like invariant)"
            );
        }
        for (let i = 0; i < length; i++) {
            // `out[i]` is `number|undefined` under `noUncheckedIndexedAccess`.
            out[i] = (out[i] ?? 0) + (data[i] ?? 0);
        }
    }

    const inv = 1 / nCh;
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) * inv;

    return out;
}

/**
 * Compute a magnitude spectrogram.
 *
 * v0.1 implementation:
 * - CPU STFT + FFT for correctness.
 * - The function accepts an optional MirGPU to match the future API.
 *   (STFT/FFT is the largest dense math block and can be ported to WebGPU later.)
 */
export async function spectrogram(
    audio: AudioBufferLike,
    config: SpectrogramConfig,
    gpu?: MirGPU,
    options: SpectrogramOptions = {}
): Promise<Spectrogram> {
    // Keep the parameter to make the expensive step explicitly reusable.
    // (v0.1 computes FFT on CPU; GPU is accepted for future acceleration.)
    void gpu;

    assertPositiveInt("config.fftSize", config.fftSize);
    assertPositiveInt("config.hopSize", config.hopSize);

    if (config.window !== "hann") {
        throw new Error(
            `@octoseq/mir: unsupported window '${config.window}'. v0.1 supports only 'hann'.`
        );
    }

    const fftSize = config.fftSize;
    if ((fftSize & (fftSize - 1)) !== 0) {
        throw new Error("@octoseq/mir: config.fftSize must be a power of two");
    }

    const hopSize = config.hopSize;
    if (hopSize > fftSize) {
        throw new Error(
            "@octoseq/mir: config.hopSize must be <= config.fftSize"
        );
    }

    const sr = audio.sampleRate;
    const mono = mixToMono(audio);

    // Number of frames with 'valid' windows.
    // We prefer explicitness over padding for v0.1.
    const nFrames = Math.max(0, 1 + Math.floor((mono.length - fftSize) / hopSize));

    const times = new Float32Array(nFrames);
    const mags: Float32Array[] = new Array(nFrames);

    const window = hannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let frame = 0; frame < nFrames; frame++) {
        if (options.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }
        const start = frame * hopSize;

        // time is the center of the analysis window.
        times[frame] = (start + fftSize / 2) / sr;

        for (let i = 0; i < fftSize; i++) {
            const s = mono[start + i] ?? 0;
            re[i] = s * (window[i] ?? 0);
            im[i] = 0;
        }

        fftInPlace(re, im);
        mags[frame] = magnitudesFromFft(re, im);
    }

    return {
        sampleRate: sr,
        fftSize,
        hopSize,
        times,
        magnitudes: mags
    };
}
