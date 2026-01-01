import type { AudioBufferLike } from "@octoseq/mir";

export interface MixdownOptions {
  /** Target sample rate. Defaults to first stem's sample rate. */
  targetSampleRate?: number;
  /** Whether to normalize output to prevent clipping. Defaults to true. */
  normalize?: boolean;
}

/**
 * Generate a mixdown by summing multiple audio stems.
 * Handles sample rate differences via simple linear resampling.
 *
 * @param stems - Array of audio buffers to mix
 * @param options - Optional configuration
 * @returns A new AudioBufferLike containing the summed audio
 */
export function generateMixdownFromStems(
  stems: AudioBufferLike[],
  options?: MixdownOptions
): AudioBufferLike {
  if (stems.length === 0) {
    throw new Error("No stems to mix");
  }

  const firstStem = stems[0];
  if (!firstStem) {
    throw new Error("No stems to mix");
  }

  const sampleRate = options?.targetSampleRate ?? firstStem.sampleRate;
  const normalize = options?.normalize ?? true;

  // Find max duration across all stems
  let maxSamples = 0;
  for (const stem of stems) {
    // Calculate equivalent samples at target sample rate
    const stemDurationSec = stem.getChannelData(0).length / stem.sampleRate;
    const samples = Math.floor(stemDurationSec * sampleRate);
    maxSamples = Math.max(maxSamples, samples);
  }

  // Sum all stems
  const mixedData = new Float32Array(maxSamples);

  for (const stem of stems) {
    const ch0 = stem.getChannelData(0);
    const ratio = stem.sampleRate / sampleRate;

    for (let i = 0; i < maxSamples; i++) {
      const srcIdx = Math.floor(i * ratio);
      if (srcIdx < ch0.length) {
        const srcVal = ch0[srcIdx] ?? 0;
        const dstVal = mixedData[i] ?? 0;
        mixedData[i] = dstVal + srcVal;
      }
    }
  }

  // Normalize to prevent clipping
  if (normalize) {
    let maxAbs = 0;
    for (let i = 0; i < mixedData.length; i++) {
      const val = mixedData[i];
      if (val !== undefined) {
        const abs = Math.abs(val);
        if (abs > maxAbs) maxAbs = abs;
      }
    }

    if (maxAbs > 1) {
      for (let i = 0; i < mixedData.length; i++) {
        const val = mixedData[i];
        if (val !== undefined) {
          mixedData[i] = val / maxAbs;
        }
      }
    }
  }

  return {
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => mixedData,
  };
}

/**
 * Create a blob URL from an AudioBufferLike for playback.
 * Encodes to WAV format.
 */
export function createBlobUrlFromBuffer(
  buffer: AudioBufferLike,
  sampleRate: number
): string {
  const data = buffer.getChannelData(0);
  const wavBuffer = encodeWav(data, sampleRate);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

/**
 * Encode Float32Array PCM data to WAV format.
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const rawSample = samples[i] ?? 0;
    const sample = Math.max(-1, Math.min(1, rawSample));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
