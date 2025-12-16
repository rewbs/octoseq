import { describe, expect, it } from "vitest";

import { spectrogram } from "../src/dsp/spectrogram";
import { hpss } from "../src/dsp/hpss";
import { hpssGpu } from "../src/dsp/hpssGpu";
import { MirGPU } from "../src/gpu/context";

function sum2d(x: Float32Array[]): number {
    let s = 0;
    for (const row of x) {
        for (let i = 0; i < row.length; i++) s += row[i] ?? 0;
    }
    return s;
}

function assertFinite2d(x: Float32Array[]): void {
    for (const row of x) {
        for (let i = 0; i < row.length; i++) {
            const v = row[i];
            expect(Number.isFinite(v)).toBe(true);
        }
    }
}

function mkSine(sampleRate: number, seconds: number, freq: number): Float32Array {
    const n = Math.floor(sampleRate * seconds);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    return out;
}

function mkImpulseTrain(sampleRate: number, seconds: number, hz: number): Float32Array {
    const n = Math.floor(sampleRate * seconds);
    const out = new Float32Array(n);
    const period = Math.max(1, Math.floor(sampleRate / hz));
    for (let i = 0; i < n; i += period) out[i] = 1;
    return out;
}

function mkWhiteNoise(sampleRate: number, seconds: number, seed = 1): Float32Array {
    const n = Math.floor(sampleRate * seconds);
    const out = new Float32Array(n);
    // simple deterministic LCG
    let s = seed >>> 0;
    for (let i = 0; i < n; i++) {
        s = (1664525 * s + 1013904223) >>> 0;
        const u = s / 0xffffffff;
        out[i] = (u * 2 - 1) * 0.25;
    }
    return out;
}

async function tryCreateGpu(): Promise<MirGPU | undefined> {
    try {
        return await MirGPU.create();
    } catch {
        return undefined;
    }
}

describe("@octoseq/mir HPSS GPU qualitative", () => {
    it("GPU HPSS matches shapes and has finite values (when WebGPU is available)", async () => {
        const gpu = await tryCreateGpu();
        if (!gpu) {
            // Vitest runs in Node in this repo; skip if not in a WebGPU-capable environment.
            return;
        }

        const sampleRate = 48000;
        const audio = {
            sampleRate,
            numberOfChannels: 1,
            getChannelData: () => mkSine(sampleRate, 1.0, 440),
        };

        const spec = await spectrogram(audio, { fftSize: 1024, hopSize: 256, window: "hann" });

        const cpu = hpss(spec, { timeMedian: 17, freqMedian: 17, softMask: true });
        const gpuOut = await hpssGpu(spec, gpu, { softMask: true });

        expect(gpuOut.harmonic.frames).toBe(cpu.harmonic.frames);
        expect(gpuOut.harmonic.bins).toBe(cpu.harmonic.bins);
        expect(gpuOut.percussive.frames).toBe(cpu.percussive.frames);
        expect(gpuOut.percussive.bins).toBe(cpu.percussive.bins);

        expect(gpuOut.harmonic.magnitudes.length).toBe(cpu.harmonic.magnitudes.length);
        expect(gpuOut.harmonic.magnitudes[0]?.length).toBe(cpu.harmonic.magnitudes[0]?.length);

        assertFinite2d(gpuOut.harmonic.magnitudes);
        assertFinite2d(gpuOut.percussive.magnitudes);

        expect(gpuOut.gpuMs).toBeGreaterThan(0);
    });

    it("sanity: sine is mostly harmonic (GPU)", async () => {
        const gpu = await tryCreateGpu();
        if (!gpu) return;

        const sampleRate = 48000;
        const audio = {
            sampleRate,
            numberOfChannels: 1,
            getChannelData: () => mkSine(sampleRate, 1.0, 440),
        };

        const spec = await spectrogram(audio, { fftSize: 1024, hopSize: 256, window: "hann" });
        const out = await hpssGpu(spec, gpu, { softMask: true });

        const h = sum2d(out.harmonic.magnitudes);
        const p = sum2d(out.percussive.magnitudes);

        expect(h).toBeGreaterThan(p * 1.5);
    });

    it("sanity: impulse train is mostly percussive (GPU)", async () => {
        const gpu = await tryCreateGpu();
        if (!gpu) return;

        const sampleRate = 48000;
        const audio = {
            sampleRate,
            numberOfChannels: 1,
            getChannelData: () => mkImpulseTrain(sampleRate, 1.0, 8),
        };

        const spec = await spectrogram(audio, { fftSize: 1024, hopSize: 256, window: "hann" });
        const out = await hpssGpu(spec, gpu, { softMask: true });

        const h = sum2d(out.harmonic.magnitudes);
        const p = sum2d(out.percussive.magnitudes);

        expect(p).toBeGreaterThan(h * 1.2);
    });

    it("sanity: white noise is percussive-dominant (GPU)", async () => {
        const gpu = await tryCreateGpu();
        if (!gpu) return;

        const sampleRate = 48000;
        const audio = {
            sampleRate,
            numberOfChannels: 1,
            getChannelData: () => mkWhiteNoise(sampleRate, 1.0, 123),
        };

        const spec = await spectrogram(audio, { fftSize: 1024, hopSize: 256, window: "hann" });
        const out = await hpssGpu(spec, gpu, { softMask: true });

        const h = sum2d(out.harmonic.magnitudes);
        const p = sum2d(out.percussive.magnitudes);

        expect(p).toBeGreaterThan(h);
    });
});
