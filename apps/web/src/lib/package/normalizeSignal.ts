/**
 * Normalize an array to [0, 1].
 *
 * This is THE normalization used by the visualiser push layer (VisualiserPanel)
 * and by the Interpretation Package export — the two must stay identical so a
 * script sees the same inputs in the browser and in offline rendering.
 *
 * Without `customRange`, min/max are taken from the data. A zero range yields
 * all zeros.
 */
export function normalizeSignal(
  data: number[] | Float32Array,
  customRange?: [number, number]
): Float32Array {
  let min = Infinity;
  let max = -Infinity;

  if (customRange) {
    min = customRange[0];
    max = customRange[1];
  } else {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min;
  const out = new Float32Array(data.length);
  if (range === 0) return out; // All zeros

  for (let i = 0; i < data.length; i++) {
    out[i] = ((data[i] as number) - min) / range;
  }
  return out;
}
