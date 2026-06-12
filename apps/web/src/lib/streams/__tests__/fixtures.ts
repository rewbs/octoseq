import type { AudioBufferLike, FrequencySegment } from "@octoseq/mir";
import type { AudioReference } from "../types";

export function makeAudioRef(overrides: Partial<AudioReference> = {}): AudioReference {
  return {
    origin: "file",
    url: null,
    fileName: "test.wav",
    durationSec: 10,
    sampleRate: 44100,
    channels: 2,
    ...overrides,
  };
}

export function makeBuffer(sampleRate = 44100): AudioBufferLike {
  const samples = new Float32Array(64);
  return {
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

export function makeSegment(
  overrides: Partial<FrequencySegment> = {}
): FrequencySegment {
  return {
    startTime: 0,
    endTime: 10,
    lowHzStart: 20,
    highHzStart: 200,
    lowHzEnd: 20,
    highHzEnd: 200,
    ...overrides,
  };
}
