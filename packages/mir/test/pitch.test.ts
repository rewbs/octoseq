import { describe, expect, it } from "vitest";

import { pitchF0, pitchConfidence } from "../src/dsp/pitch";

describe("Pitch detection (YIN)", () => {
  const sampleRate = 44100;

  /**
   * Generate a pure sine wave at a given frequency.
   */
  function generateSine(freqHz: number, durationSec: number, sr: number = sampleRate): Float32Array {
    const samples = new Float32Array(Math.floor(sr * durationSec));
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freqHz * i) / sr);
    }
    return samples;
  }

  /**
   * Generate deterministic pseudo-random noise.
   */
  function generateNoise(durationSec: number, sr: number = sampleRate): Float32Array {
    const samples = new Float32Array(Math.floor(sr * durationSec));
    let seed = 12345;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      samples[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return samples;
  }

  it("detects 440Hz sine wave with high confidence", () => {
    const samples = generateSine(440, 0.5);

    const f0Result = pitchF0(samples, sampleRate, {});
    const confResult = pitchConfidence(samples, sampleRate, {});

    // Skip edge frames where transient effects may occur
    const middleStart = 5;
    const middleEnd = f0Result.values.length - 5;

    // Check f0 values are close to 440Hz
    let sumF0 = 0;
    let count = 0;
    for (let i = middleStart; i < middleEnd; i++) {
      const f0 = f0Result.values[i] ?? 0;
      if (f0 > 0) {
        sumF0 += f0;
        count++;
      }
    }
    const avgF0 = sumF0 / count;

    expect(avgF0).toBeGreaterThan(430);
    expect(avgF0).toBeLessThan(450);

    // Check confidence is high
    let sumConf = 0;
    for (let i = middleStart; i < middleEnd; i++) {
      sumConf += confResult.values[i] ?? 0;
    }
    const avgConf = sumConf / (middleEnd - middleStart);

    expect(avgConf).toBeGreaterThan(0.7);
  });

  it("detects 220Hz sine wave (lower frequency)", () => {
    const samples = generateSine(220, 0.5);

    const f0Result = pitchF0(samples, sampleRate, {});

    const middleStart = 5;
    const middleEnd = f0Result.values.length - 5;

    let sumF0 = 0;
    let count = 0;
    for (let i = middleStart; i < middleEnd; i++) {
      const f0 = f0Result.values[i] ?? 0;
      if (f0 > 0) {
        sumF0 += f0;
        count++;
      }
    }
    const avgF0 = sumF0 / count;

    expect(avgF0).toBeGreaterThan(210);
    expect(avgF0).toBeLessThan(230);
  });

  it("returns 0 Hz and low confidence for silence", () => {
    const samples = new Float32Array(22050); // 500ms of silence

    const f0Result = pitchF0(samples, sampleRate, {});
    const confResult = pitchConfidence(samples, sampleRate, {});

    // All frames should be unvoiced (f0 = 0)
    for (let i = 0; i < f0Result.values.length; i++) {
      expect(f0Result.values[i] ?? 0).toBe(0);
    }

    // All confidence values should be very low
    for (let i = 0; i < confResult.values.length; i++) {
      expect(confResult.values[i] ?? 0).toBeLessThan(0.1);
    }
  });

  it("returns low confidence for white noise", () => {
    const samples = generateNoise(0.5);

    const confResult = pitchConfidence(samples, sampleRate, {});

    // Average confidence should be low for noise
    let sumConf = 0;
    for (let i = 0; i < confResult.values.length; i++) {
      sumConf += confResult.values[i] ?? 0;
    }
    const avgConf = sumConf / confResult.values.length;

    expect(avgConf).toBeLessThan(0.5);
  });

  it("time axis aligns with spectrogram convention", () => {
    const samples = new Float32Array(44100); // 1 second
    const hopSize = 512;
    const windowSize = 2048;

    const f0Result = pitchF0(samples, sampleRate, { hopSize, windowSize });

    // First time should be at (windowSize/2) / sampleRate
    const expectedFirstTime = windowSize / 2 / sampleRate;
    expect(f0Result.times[0] ?? 0).toBeCloseTo(expectedFirstTime, 5);

    // Frame spacing should be hopSize / sampleRate
    const expectedSpacing = hopSize / sampleRate;
    const time0 = f0Result.times[0] ?? 0;
    const time1 = f0Result.times[1] ?? 0;
    expect(time1 - time0).toBeCloseTo(expectedSpacing, 5);
  });

  it("is deterministic - same input produces same output", () => {
    const samples = generateSine(330, 0.3);

    const f0_1 = pitchF0(samples, sampleRate, {});
    const f0_2 = pitchF0(samples, sampleRate, {});

    // Check arrays are exactly equal
    expect(f0_1.times.length).toBe(f0_2.times.length);
    expect(f0_1.values.length).toBe(f0_2.values.length);

    for (let i = 0; i < f0_1.values.length; i++) {
      expect(f0_1.values[i] ?? 0).toBe(f0_2.values[i] ?? 0);
      expect(f0_1.times[i] ?? 0).toBe(f0_2.times[i] ?? 0);
    }

    const conf_1 = pitchConfidence(samples, sampleRate, {});
    const conf_2 = pitchConfidence(samples, sampleRate, {});

    for (let i = 0; i < conf_1.values.length; i++) {
      expect(conf_1.values[i] ?? 0).toBe(conf_2.values[i] ?? 0);
    }
  });

  it("respects fMinHz and fMaxHz configuration", () => {
    // Generate 100Hz sine - should be detected with default config
    const samples = generateSine(100, 0.5);

    // With fMinHz=50, should detect 100Hz
    const f0WithLowMin = pitchF0(samples, sampleRate, { fMinHz: 50, fMaxHz: 500 });

    // With fMinHz=150, should NOT detect 100Hz (below minimum)
    const f0WithHighMin = pitchF0(samples, sampleRate, { fMinHz: 150, fMaxHz: 500 });

    // Low min should detect the pitch
    let detectedCount = 0;
    for (let i = 5; i < f0WithLowMin.values.length - 5; i++) {
      if ((f0WithLowMin.values[i] ?? 0) > 0) detectedCount++;
    }
    expect(detectedCount).toBeGreaterThan(0);

    // High min should detect fewer or no frames
    let detectedHighMinCount = 0;
    for (let i = 5; i < f0WithHighMin.values.length - 5; i++) {
      if ((f0WithHighMin.values[i] ?? 0) > 0) detectedHighMinCount++;
    }
    expect(detectedHighMinCount).toBeLessThan(detectedCount);
  });

  it("both f0 and confidence have same length and times", () => {
    const samples = generateSine(440, 0.5);

    const f0Result = pitchF0(samples, sampleRate, {});
    const confResult = pitchConfidence(samples, sampleRate, {});

    expect(f0Result.times.length).toBe(confResult.times.length);
    expect(f0Result.values.length).toBe(confResult.values.length);

    // Times should be identical
    for (let i = 0; i < f0Result.times.length; i++) {
      expect(f0Result.times[i]).toBe(confResult.times[i]);
    }
  });
});
