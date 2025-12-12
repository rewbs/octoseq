import { describe, expect, it } from "vitest";

import {
  helloMir,
  melSpectrogram,
  normaliseForWaveform,
  spectralCentroid,
  spectralFlux,
  spectrogram
} from "../src/index";

describe("@octoseq/mir", () => {
  it("helloMir returns a greeting", () => {
    expect(helloMir("test")).toContain("Hello, test");
  });

  it("computes a spectrogram and derived features aligned to time", async () => {
    const sampleRate = 48000;
    const length = sampleRate * 1; // 1 second

    // Simple deterministic signal: 440Hz sine
    const ch0 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      ch0[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const audio = {
      sampleRate,
      numberOfChannels: 1,
      getChannelData: () => ch0
    };

    const spec = await spectrogram(audio, { fftSize: 1024, hopSize: 256, window: "hann" });
    expect(spec.times.length).toBe(spec.magnitudes.length);

    const centroid = spectralCentroid(spec);
    const flux = spectralFlux(spec);

    expect(centroid.length).toBe(spec.times.length);
    expect(flux.length).toBe(spec.times.length);

    // Mel projection should preserve time alignment.
    const mel = await melSpectrogram(spec, { nMels: 40 });
    expect(mel.times).toBe(spec.times);
    expect(mel.melBands.length).toBe(spec.times.length);
    expect(mel.melBands[0]?.length).toBe(40);

    const wf = normaliseForWaveform(flux, { center: true });
    expect(wf.length).toBe(flux.length);
  });
});
