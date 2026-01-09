/**
 * Resample audio using linear interpolation.
 *
 * This is a simple, fast resampling algorithm suitable for MIR analysis
 * where perfect reconstruction is not critical.
 *
 * @param samples - Input audio samples
 * @param fromRate - Original sample rate (Hz)
 * @param toRate - Target sample rate (Hz)
 * @returns Resampled audio samples
 */
export function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  // No-op if rates match
  if (fromRate === toRate) {
    return samples;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.floor(samples.length / ratio);

  // Handle edge case of empty input
  if (newLength <= 0) {
    return new Float32Array(0);
  }

  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const frac = srcIndex - srcIndexFloor;

    // Linear interpolation between adjacent samples
    const a = samples[srcIndexFloor] ?? 0;
    const b = samples[srcIndexFloor + 1] ?? a;
    result[i] = a + frac * (b - a);
  }

  return result;
}
