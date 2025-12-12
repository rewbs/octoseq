import { describe, expect, it } from "vitest";

import { runMir } from "../src/runner/runMir";

function buildSine(sampleRate: number, nSamples: number, hz = 440): Float32Array {
    const out = new Float32Array(nSamples);
    const w = (2 * Math.PI * hz) / sampleRate;
    for (let i = 0; i < nSamples; i++) out[i] = Math.sin(w * i);
    return out;
}

describe("@octoseq/mir large-audio regression", () => {
    // Goal: ensure no stack overflow / spread/Array.from issues for long audio.
    // 5M samples @ 48kHz is ~104 seconds.
    const sampleRate = 48_000;
    const nSamples = 5_000_000;

    const audio = {
        sampleRate,
        mono: buildSine(sampleRate, nSamples),
    };

    it("runs spectralFlux on 5M samples", async () => {
        const res = await runMir(
            audio,
            {
                fn: "spectralFlux",
                backend: "cpu",
                spectrogram: { fftSize: 2048, hopSize: 512, window: "hann" },
            },
            {}
        );

        expect(res.kind).toBe("1d");
        expect(res.times.length).toBe(res.kind === "1d" ? res.values.length : res.times.length);
        expect(res.times.length).toBeGreaterThan(0);
    }, 60_000);

    it("runs onsetPeaks on 5M samples", async () => {
        const res = await runMir(
            audio,
            {
                fn: "onsetPeaks",
                backend: "cpu",
                spectrogram: { fftSize: 2048, hopSize: 512, window: "hann" },
                mel: { nMels: 64 },
            },
            {}
        );

        expect(res.kind).toBe("events");
        expect(res.times.length).toBeGreaterThan(0);
    }, 60_000);

    it("runs mfccDelta on 5M samples", async () => {
        const res = await runMir(
            audio,
            {
                fn: "mfccDelta",
                backend: "cpu",
                spectrogram: { fftSize: 2048, hopSize: 512, window: "hann" },
                mel: { nMels: 64 },
                mfcc: { nCoeffs: 13 },
            },
            {}
        );

        expect(res.kind).toBe("2d");
        expect(res.times.length).toBe(res.kind === "2d" ? res.data.length : res.times.length);
        expect(res.times.length).toBeGreaterThan(0);
        expect(res.kind === "2d" ? res.data[0]?.length : 0).toBe(13);
    }, 60_000);
});
