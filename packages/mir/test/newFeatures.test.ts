import { describe, expect, it } from "vitest";

import {
    melSpectrogram,
    mfcc,
    delta,
    deltaDelta,
    onsetEnvelopeFromSpectrogram,
    onsetEnvelopeFromMel,
    peakPick,
    spectrogram,
    hpss,
} from "../src/index";

function makeAudioFromMono(mono: Float32Array, sampleRate: number) {
    return {
        sampleRate,
        numberOfChannels: 1,
        getChannelData: () => mono,
    };
}

describe("@octoseq/mir new MIR features", () => {
    it("silence produces near-zero onset envelope and no NaNs", async () => {
        const sampleRate = 48000;
        const mono = new Float32Array(sampleRate); // 1s silence

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), { fftSize: 1024, hopSize: 256, window: "hann" });
        const onset = onsetEnvelopeFromSpectrogram(spec, { smoothMs: 30, diffMethod: "rectified" });

        let max = 0;
        for (let i = 0; i < onset.values.length; i++) {
            const v = onset.values[i] ?? 0;
            expect(Number.isFinite(v)).toBe(true);
            if (Math.abs(v) > max) max = Math.abs(v);
        }
        expect(max).toBeLessThan(1e-6);
    });

    it("impulse train produces strong onset peaks near impulse times", async () => {
        const sampleRate = 48000;
        const durSec = 2;
        const mono = new Float32Array(sampleRate * durSec);

        // Clicks at 0.5s, 1.0s, 1.5s
        const clickTimes = [0.5, 1.0, 1.5];
        for (const t of clickTimes) {
            const idx = Math.round(t * sampleRate);
            if (idx >= 0 && idx < mono.length) mono[idx] = 1;
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), { fftSize: 1024, hopSize: 256, window: "hann" });
        const mel = await melSpectrogram(spec, { nMels: 64 });

        const onset = onsetEnvelopeFromMel(mel, { smoothMs: 20, diffMethod: "rectified" });

        // For click-tracks we expect a few strong peaks. Use a simple relative threshold.
        let max = 0;
        for (let i = 0; i < onset.values.length; i++) max = Math.max(max, onset.values[i] ?? 0);

        const peaks = peakPick(onset.times, onset.values, {
            minIntervalSec: 0.2,
            threshold: max * 0.3,
            strict: false,
        });

        // Expect at least 3 peaks.
        expect(peaks.length).toBeGreaterThanOrEqual(3);

        // Each click time should have a nearby peak (within a couple of hops).
        // (Frame times are window-centered, so perfect alignment to sample-index times isn't expected.)
        const tolSec = (spec.hopSize / sampleRate) * 3;
        for (const ct of clickTimes) {
            const found = peaks.some((p) => Math.abs(p.time - ct) <= tolSec);
            expect(found).toBe(true);
        }
    });

    it("sustained sine is mostly harmonic in HPSS and has low onset", async () => {
        const sampleRate = 48000;
        const durSec = 1.5;
        const mono = new Float32Array(sampleRate * durSec);

        const f = 440;
        for (let i = 0; i < mono.length; i++) {
            mono[i] = Math.sin((2 * Math.PI * f * i) / sampleRate);
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), { fftSize: 1024, hopSize: 256, window: "hann" });

        const onset = onsetEnvelopeFromSpectrogram(spec, { smoothMs: 30, diffMethod: "rectified", useLog: true });
        let mean = 0;
        for (let i = 0; i < onset.values.length; i++) mean += onset.values[i] ?? 0;
        mean /= Math.max(1, onset.values.length);
        expect(mean).toBeLessThan(1e-1);

        const { harmonic, percussive } = hpss(spec, { timeMedian: 9, freqMedian: 9 });

        // Compare total energy of outputs.
        let eH = 0;
        let eP = 0;
        for (let t = 0; t < harmonic.frames; t++) {
            const h = harmonic.magnitudes[t];
            const p = percussive.magnitudes[t];
            if (!h || !p) continue;
            for (let k = 0; k < harmonic.bins; k++) {
                eH += (h[k] ?? 0) * (h[k] ?? 0);
                eP += (p[k] ?? 0) * (p[k] ?? 0);
            }
        }

        expect(eH).toBeGreaterThan(eP * 5);
    });

    it("delta and delta-delta preserve shape and are finite at boundaries", async () => {
        const sampleRate = 48000;
        const mono = new Float32Array(sampleRate); // 1s
        for (let i = 0; i < mono.length; i++) mono[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate);

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), { fftSize: 1024, hopSize: 256, window: "hann" });
        const mel = await melSpectrogram(spec, { nMels: 40 });

        const base = mfcc(mel, { nCoeffs: 13 });
        const f2d = { times: base.times, values: base.coeffs };

        const d1 = delta(f2d, { window: 2 });
        const d2 = deltaDelta(f2d, { window: 2 });

        expect(d1.times).toBe(f2d.times);
        expect(d2.times).toBe(f2d.times);
        expect(d1.values.length).toBe(f2d.values.length);
        expect(d2.values.length).toBe(f2d.values.length);
        expect(d1.values[0]?.length).toBe(13);
        expect(d2.values[0]?.length).toBe(13);

        for (let t = 0; t < d1.values.length; t++) {
            for (let i = 0; i < 13; i++) {
                expect(Number.isFinite(d1.values[t]?.[i] ?? NaN)).toBe(true);
                expect(Number.isFinite(d2.values[t]?.[i] ?? NaN)).toBe(true);
            }
        }
    });
});
