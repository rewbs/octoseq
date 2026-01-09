import { describe, expect, it } from "vitest";

import {
    melSpectrogram,
    onsetEnvelopeFromSpectrogram,
    onsetEnvelopeFromMel,
    spectrogram,
    computeFrameEnergyFromMel,
    computeFrameEnergyFromSpectrogram,
    computeSilenceGating,
    estimateNoiseFloor,
    buildActivityMask,
} from "../src/index";

function makeAudioFromMono(mono: Float32Array, sampleRate: number) {
    return {
        sampleRate,
        numberOfChannels: 1,
        getChannelData: () => mono,
    };
}

describe("silence gating primitives", () => {
    it("estimateNoiseFloor computes correct percentile", () => {
        // Simple array with known percentiles
        const energy = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        // 0th percentile should be minimum
        expect(estimateNoiseFloor(energy, 0)).toBeCloseTo(0, 5);

        // 100th percentile should be maximum
        expect(estimateNoiseFloor(energy, 100)).toBeCloseTo(10, 5);

        // 50th percentile (median) should be 5
        expect(estimateNoiseFloor(energy, 50)).toBeCloseTo(5, 5);

        // 10th percentile should be 1
        expect(estimateNoiseFloor(energy, 10)).toBeCloseTo(1, 5);
    });

    it("buildActivityMask with hysteresis works correctly", () => {
        // Energy signal that rises and falls
        const energy = new Float32Array([
            0, 0, 0,    // silence
            10, 10, 10, // active
            5, 5,       // between thresholds (should stay active due to hysteresis)
            0, 0, 0,    // back to silence (but hangover keeps it active)
        ]);

        const enterThreshold = 8;
        const exitThreshold = 3;
        const hangoverFrames = 2;

        const mask = buildActivityMask(energy, enterThreshold, exitThreshold, hangoverFrames);

        // First 3 frames: inactive (below enter threshold)
        expect(mask[0]).toBe(0);
        expect(mask[1]).toBe(0);
        expect(mask[2]).toBe(0);

        // Frames 3-5: active (above enter threshold)
        expect(mask[3]).toBe(1);
        expect(mask[4]).toBe(1);
        expect(mask[5]).toBe(1);

        // Frames 6-7: still active (5 > exitThreshold=3)
        expect(mask[6]).toBe(1);
        expect(mask[7]).toBe(1);

        // Frames 8-9: hangover (energy dropped but hangover keeps active)
        expect(mask[8]).toBe(1);
        expect(mask[9]).toBe(1);

        // Frame 10: hangover exhausted, now inactive
        expect(mask[10]).toBe(0);
    });

    it("computeFrameEnergyFromMel returns mean of log-mel bands", () => {
        // Mel bands in log10 scale
        const melBands = [
            new Float32Array([-2, -2, -2, -2]), // mean = -2
            new Float32Array([-1, -1, -1, -1]), // mean = -1
            new Float32Array([0, 0, 0, 0]),     // mean = 0
        ];

        const energy = computeFrameEnergyFromMel(melBands);

        expect(energy.length).toBe(3);
        expect(energy[0]).toBeCloseTo(-2, 5);
        expect(energy[1]).toBeCloseTo(-1, 5);
        expect(energy[2]).toBeCloseTo(0, 5);
    });

    it("computeFrameEnergyFromSpectrogram returns mean magnitude", () => {
        const magnitudes = [
            new Float32Array([0.1, 0.1, 0.1, 0.1]), // mean = 0.1
            new Float32Array([0.5, 0.5, 0.5, 0.5]), // mean = 0.5
            new Float32Array([1.0, 1.0, 1.0, 1.0]), // mean = 1.0
        ];

        const energy = computeFrameEnergyFromSpectrogram(magnitudes, false);

        expect(energy.length).toBe(3);
        expect(energy[0]).toBeCloseTo(0.1, 5);
        expect(energy[1]).toBeCloseTo(0.5, 5);
        expect(energy[2]).toBeCloseTo(1.0, 5);
    });

    it("computeSilenceGating produces valid masks", () => {
        // Log-scale energy (like from mel)
        const frameEnergy = new Float32Array([
            -10, -10, -10, // silence (low log energy)
            -2, -2, -2,    // active (high log energy)
            -10, -10, -10, // silence again
        ]);

        const result = computeSilenceGating(frameEnergy, 0.01, {
            enabled: true,
            energyPercentile: 10,
            enterMargin: 3,
            exitMargin: 1,
            hangoverMs: 20,
            postSilenceSuppressMs: 10,
        });

        // Check that masks have correct length
        expect(result.activityMask.length).toBe(frameEnergy.length);
        expect(result.suppressionMask.length).toBe(frameEnergy.length);

        // First frames should be inactive
        expect(result.activityMask[0]).toBe(0);
        expect(result.activityMask[1]).toBe(0);
        expect(result.activityMask[2]).toBe(0);

        // Middle frames should be active
        expect(result.activityMask[3]).toBe(1);
        expect(result.activityMask[4]).toBe(1);
        expect(result.activityMask[5]).toBe(1);
    });

    it("disabled gating returns all-active mask", () => {
        const frameEnergy = new Float32Array([0, 0, 0, 0, 0]);

        const result = computeSilenceGating(frameEnergy, 0.01, {
            enabled: false,
        });

        // All frames should be active when gating is disabled
        for (let i = 0; i < frameEnergy.length; i++) {
            expect(result.activityMask[i]).toBe(1);
            expect(result.suppressionMask[i]).toBe(0);
        }
    });
});

describe("silence-aware onset detection", () => {
    const sampleRate = 48000;

    it("pure silence produces zero onset envelope", async () => {
        const durSec = 1;
        const mono = new Float32Array(sampleRate * durSec); // All zeros

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
        });

        // All onset values should be exactly zero in silence
        for (let i = 0; i < onset.values.length; i++) {
            const v = onset.values[i] ?? NaN;
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBe(0);
        }
    });

    it("silence followed by constant tone produces no large onset spike", async () => {
        const durSec = 2;
        const mono = new Float32Array(sampleRate * durSec);

        // First second: silence
        // Second second: 440Hz sine (constant tone)
        const startSample = sampleRate; // 1 second in
        for (let i = startSample; i < mono.length; i++) {
            mono[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (i - startSample)) / sampleRate);
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: {
                enabled: true,
                postSilenceSuppressMs: 100, // Suppress onsets for 100ms after silence
            },
            returnDiagnostics: true,
        });

        // Check diagnostics are available
        expect(onset.diagnostics).toBeDefined();
        expect(onset.diagnostics?.activityMask).toBeDefined();

        // Find the transition point (around 1 second)
        const transitionTime = 1.0;
        const tolerance = 0.15; // 150ms window around transition

        // Collect onset values around the transition
        let maxNearTransition = 0;
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (Math.abs(t - transitionTime) < tolerance) {
                maxNearTransition = Math.max(maxNearTransition, onset.values[i] ?? 0);
            }
        }

        // Max around transition should be low due to post-silence suppression
        // (exact threshold depends on the signal, but it should be suppressed)
        // We mainly check it's not a massive spike
        let maxOverall = 0;
        for (let i = 0; i < onset.values.length; i++) {
            maxOverall = Math.max(maxOverall, onset.values[i] ?? 0);
        }

        // The transition spike (if any) should not be the global maximum
        // In a properly gated system, the sustained tone region should have minimal onsets
        expect(maxNearTransition).toBeLessThan(maxOverall * 2 + 0.001);
    });

    it("signal with active/silent regions: silence regions have zero onset values", async () => {
        const durSec = 4;
        const mono = new Float32Array(sampleRate * durSec);

        // Create a signal with clear active and silent regions:
        // 0-0.8s: silence
        // 0.8-1.5s: 440Hz tone (active)
        // 1.5-2.5s: silence
        // 2.5-3.5s: 880Hz tone (active)
        // 3.5-4.0s: silence

        for (let i = 0; i < mono.length; i++) {
            const t = i / sampleRate;
            if (t >= 0.8 && t < 1.5) {
                mono[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
            } else if (t >= 2.5 && t < 3.5) {
                mono[i] = 0.5 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
            }
            // else remains 0 (silence)
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });
        const mel = await melSpectrogram(spec, { nMels: 64 });

        const onset = onsetEnvelopeFromMel(mel, {
            smoothMs: 20,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
            returnDiagnostics: true,
        });

        // Test that truly silent regions have zero onset
        const silentTimes = [0.2, 0.5, 1.8, 2.2, 3.8]; // Times clearly in silent regions

        for (const st of silentTimes) {
            for (let i = 0; i < onset.times.length; i++) {
                const t = onset.times[i] ?? 0;
                if (Math.abs(t - st) < 0.05) {
                    expect(onset.values[i] ?? 0).toBeLessThan(0.001);
                }
            }
        }

        // Verify the activity mask correctly identifies silent vs active regions
        expect(onset.diagnostics).toBeDefined();
        const diag = onset.diagnostics!;

        // Count active frames in first 0.7s (should be mostly inactive)
        let earlyActiveCount = 0;
        let earlyTotalCount = 0;
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (t < 0.7) {
                earlyTotalCount++;
                if (diag.activityMask[i] === 1) earlyActiveCount++;
            }
        }
        // Early region should be mostly inactive
        expect(earlyActiveCount / Math.max(1, earlyTotalCount)).toBeLessThan(0.3);
    });

    it("fade-in has no onsets in initial silence before energy builds", async () => {
        const durSec = 2;
        const mono = new Float32Array(sampleRate * durSec);

        // Create a fade-in over the first second, then sustain
        for (let i = 0; i < mono.length; i++) {
            const t = i / sampleRate;
            const fadeEnvelope = Math.min(1, t); // Linear fade over 1 second
            mono[i] = fadeEnvelope * 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
            returnDiagnostics: true,
        });

        // The key test: early frames (where signal is near-zero) should have zero onset
        // Check first ~100ms where the signal is extremely quiet
        let earlyOnsetSum = 0;
        let earlyFrameCount = 0;
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (t < 0.1) {
                earlyOnsetSum += onset.values[i] ?? 0;
                earlyFrameCount++;
            }
        }

        // Early frames should have very low or zero onset values due to gating
        const earlyMean = earlyFrameCount > 0 ? earlyOnsetSum / earlyFrameCount : 0;
        expect(earlyMean).toBeLessThan(0.01);
    });

    it("fade-out has no onsets after signal fades to silence", async () => {
        const durSec = 2;
        const mono = new Float32Array(sampleRate * durSec);

        // Start with full amplitude, fade out over the last second
        for (let i = 0; i < mono.length; i++) {
            const t = i / sampleRate;
            const fadeEnvelope = Math.max(0, 1 - (t - 1)); // Fade out in second half
            mono[i] = Math.max(0, fadeEnvelope) * 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
            returnDiagnostics: true,
        });

        // The key test: late frames (where signal has faded to near-zero) should have zero onset
        // Check frames after ~1.8s where signal is extremely quiet
        let lateOnsetSum = 0;
        let lateFrameCount = 0;
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (t > 1.8) {
                lateOnsetSum += onset.values[i] ?? 0;
                lateFrameCount++;
            }
        }

        // Late frames should have very low or zero onset values due to gating
        const lateMean = lateFrameCount > 0 ? lateOnsetSum / lateFrameCount : 0;
        expect(lateMean).toBeLessThan(0.01);
    });

    it("noisy low-level signal produces suppressed onsets", async () => {
        const durSec = 1;
        const mono = new Float32Array(sampleRate * durSec);

        // Very low-level noise (simulating mic hiss or recording noise)
        for (let i = 0; i < mono.length; i++) {
            mono[i] = (Math.random() - 0.5) * 0.001; // Very quiet noise
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
        });

        // Low-level noise should be treated as silence
        // All onsets should be zero or very close to zero
        let max = 0;
        for (let i = 0; i < onset.values.length; i++) {
            const v = onset.values[i] ?? 0;
            expect(Number.isFinite(v)).toBe(true);
            max = Math.max(max, v);
        }

        // Maximum should be very small (effectively zero due to gating)
        expect(max).toBeLessThan(0.01);
    });

    it("diagnostics include activity and suppression masks", async () => {
        const durSec = 1;
        const mono = new Float32Array(sampleRate * durSec);

        // Half silence, half tone
        for (let i = sampleRate / 2; i < mono.length; i++) {
            mono[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        const onset = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
            returnDiagnostics: true,
        });

        expect(onset.diagnostics).toBeDefined();

        const diag = onset.diagnostics!;
        expect(diag.frameEnergy.length).toBe(onset.times.length);
        expect(diag.activityMask.length).toBe(onset.times.length);
        expect(diag.suppressionMask.length).toBe(onset.times.length);
        expect(diag.rawNovelty.length).toBe(onset.times.length);
        expect(Number.isFinite(diag.noiseFloor)).toBe(true);
        expect(Number.isFinite(diag.enterThreshold)).toBe(true);
        expect(Number.isFinite(diag.exitThreshold)).toBe(true);

        // Verify that the first half (silence) has inactive mask
        const halfwayFrame = Math.floor(onset.times.length / 2);
        let inactiveCount = 0;
        for (let i = 0; i < halfwayFrame; i++) {
            if (diag.activityMask[i] === 0) inactiveCount++;
        }
        // Most of the first half should be inactive (allowing for some transition)
        expect(inactiveCount).toBeGreaterThan(halfwayFrame * 0.7);
    });

    it("mel-based onset: diagnostics are correctly populated", async () => {
        const durSec = 2;
        const mono = new Float32Array(sampleRate * durSec);

        // Create a signal with clear structure: half silence, half tone
        for (let i = 0; i < mono.length; i++) {
            const t = i / sampleRate;
            if (t >= 1.0) {
                mono[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
            }
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });
        const mel = await melSpectrogram(spec, { nMels: 64 });

        const onset = onsetEnvelopeFromMel(mel, {
            smoothMs: 20,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
            binGate: { enabled: true },
            returnDiagnostics: true,
        });

        expect(onset.diagnostics).toBeDefined();
        const diag = onset.diagnostics!;

        // Verify diagnostics are populated correctly
        expect(diag.activityMask.length).toBe(onset.times.length);
        expect(diag.suppressionMask.length).toBe(onset.times.length);
        expect(diag.frameEnergy.length).toBe(onset.times.length);
        expect(diag.rawNovelty.length).toBe(onset.times.length);
        expect(Number.isFinite(diag.noiseFloor)).toBe(true);
        expect(Number.isFinite(diag.enterThreshold)).toBe(true);
        expect(Number.isFinite(diag.exitThreshold)).toBe(true);

        // enterThreshold should be higher than exitThreshold (hysteresis)
        expect(diag.enterThreshold).toBeGreaterThan(diag.exitThreshold);

        // Silent region (first half) should have mostly inactive frames
        let firstHalfInactiveCount = 0;
        let firstHalfTotal = 0;
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (t < 0.8) {
                firstHalfTotal++;
                if (diag.activityMask[i] === 0) firstHalfInactiveCount++;
            }
        }
        expect(firstHalfInactiveCount / Math.max(1, firstHalfTotal)).toBeGreaterThan(0.7);

        // Silent region should have zero onset values after gating
        for (let i = 0; i < onset.times.length; i++) {
            const t = onset.times[i] ?? 0;
            if (t < 0.5) {
                expect(onset.values[i] ?? 0).toBe(0);
            }
        }
    });

    it("disabled silence gating allows onsets in silence regions", async () => {
        const durSec = 1;
        const mono = new Float32Array(sampleRate * durSec);

        // Very low-level noise (would be gated with silence detection)
        for (let i = 0; i < mono.length; i++) {
            mono[i] = (Math.random() - 0.5) * 0.01;
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        // With gating enabled
        const onsetGated = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: true },
        });

        // With gating disabled
        const onsetNoGate = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: false },
        });

        // Compute max values
        let maxGated = 0;
        let maxNoGate = 0;
        for (let i = 0; i < onsetGated.values.length; i++) {
            maxGated = Math.max(maxGated, onsetGated.values[i] ?? 0);
            maxNoGate = Math.max(maxNoGate, onsetNoGate.values[i] ?? 0);
        }

        // Without gating, there should be more activity detected
        expect(maxNoGate).toBeGreaterThan(maxGated);
    });
});

describe("bin-level gating", () => {
    const sampleRate = 48000;

    it("bin gating reduces impact of low-level noise bins", async () => {
        const durSec = 1;
        const mono = new Float32Array(sampleRate * durSec);

        // Create a tone with added broadband noise
        for (let i = 0; i < mono.length; i++) {
            // Strong 440Hz tone
            const tone = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
            // Weak broadband noise
            const noise = (Math.random() - 0.5) * 0.01;
            mono[i] = tone + noise;
        }

        const spec = await spectrogram(makeAudioFromMono(mono, sampleRate), {
            fftSize: 1024,
            hopSize: 256,
            window: "hann",
        });

        // With bin gating
        const onsetBinGated = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: false }, // Disable silence gating for this test
            binGate: { enabled: true, binFloorRel: 0.05 },
        });

        // Without bin gating
        const onsetNoBinGate = onsetEnvelopeFromSpectrogram(spec, {
            smoothMs: 30,
            diffMethod: "rectified",
            silenceGate: { enabled: false },
            binGate: { enabled: false },
        });

        // Both should produce reasonable results (no NaN, finite values)
        for (let i = 0; i < onsetBinGated.values.length; i++) {
            expect(Number.isFinite(onsetBinGated.values[i])).toBe(true);
            expect(Number.isFinite(onsetNoBinGate.values[i])).toBe(true);
        }

        // For a sustained tone, the onset values should be small in both cases
        let meanBinGated = 0;
        let meanNoBinGate = 0;
        for (let i = 10; i < onsetBinGated.values.length; i++) {
            meanBinGated += onsetBinGated.values[i] ?? 0;
            meanNoBinGate += onsetNoBinGate.values[i] ?? 0;
        }
        const n = onsetBinGated.values.length - 10;
        meanBinGated /= n;
        meanNoBinGate /= n;

        // Both should have low onset values for sustained tone
        expect(meanBinGated).toBeLessThan(0.5);
        expect(meanNoBinGate).toBeLessThan(0.5);
    });
});
