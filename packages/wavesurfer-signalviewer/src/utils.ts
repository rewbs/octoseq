/**
 * Math and color utility functions
 */

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Remap a value from one range to another
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, t);
}

/**
 * Binary search to find the index of the largest value <= target
 * Returns -1 if all values are greater than target
 */
export function binarySearchFloor(arr: Float32Array, target: number): number {
  let low = 0;
  let high = arr.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midVal = arr[mid];

    if (midVal === undefined) break;

    if (midVal <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Binary search to find the index of the smallest value >= target
 * Returns arr.length if all values are less than target
 */
export function binarySearchCeil(arr: Float32Array, target: number): number {
  let low = 0;
  let high = arr.length - 1;
  let result = arr.length;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midVal = arr[mid];

    if (midVal === undefined) break;

    if (midVal >= target) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

/**
 * Find the time range indices for a given time window
 * Returns [startIndex, endIndex) (exclusive end)
 */
export function findTimeRange(
  times: Float32Array,
  startTime: number,
  endTime: number
): [number, number] {
  const startIdx = binarySearchCeil(times, startTime);
  const endIdx = binarySearchFloor(times, endTime) + 1;
  return [Math.max(0, startIdx), Math.min(times.length, endIdx)];
}

/**
 * Get interpolated value at a specific time
 */
export function interpolateValue(
  times: Float32Array,
  values: Float32Array,
  time: number
): number | null {
  if (times.length === 0) return null;

  const firstTime = times[0];
  const lastTime = times[times.length - 1];

  if (firstTime === undefined || lastTime === undefined) return null;

  // Clamp to signal bounds
  if (time <= firstTime) return values[0] ?? null;
  if (time >= lastTime) return values[values.length - 1] ?? null;

  // Binary search for the interval
  const idx = binarySearchFloor(times, time);
  if (idx < 0 || idx >= times.length - 1) return null;

  const t0 = times[idx];
  const t1 = times[idx + 1];
  const v0 = values[idx];
  const v1 = values[idx + 1];

  if (
    t0 === undefined ||
    t1 === undefined ||
    v0 === undefined ||
    v1 === undefined
  )
    return null;

  // Linear interpolation
  const t = (time - t0) / (t1 - t0);
  return lerp(v0, v1, t);
}

/**
 * Calculate percentile value from sorted array
 */
export function percentile(sortedValues: Float32Array, p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;

  const idx = (sortedValues.length - 1) * (p / 100);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;

  const lowerVal = sortedValues[lower] ?? 0;
  const upperVal = sortedValues[upper] ?? 0;

  return lerp(lowerVal, upperVal, weight);
}

/**
 * Parse a CSS color string to RGBA components (0-255)
 */
export function parseColor(
  color: string
): { r: number; g: number; b: number; a: number } | null {
  // Handle hex colors
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = hex[0] ?? "0";
      const g = hex[1] ?? "0";
      const b = hex[2] ?? "0";
      return {
        r: parseInt(r + r, 16),
        g: parseInt(g + g, 16),
        b: parseInt(b + b, 16),
        a: 255,
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 255,
      };
    } else if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16),
      };
    }
  }

  // Handle rgba/rgb
  const rgbaMatch = color.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1] ?? "0", 10),
      g: parseInt(rgbaMatch[2] ?? "0", 10),
      b: parseInt(rgbaMatch[3] ?? "0", 10),
      a: rgbaMatch[4] ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255,
    };
  }

  return null;
}

/**
 * Interpolate between two colors
 */
export function interpolateColor(
  color1: string,
  color2: string,
  t: number
): string {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);

  if (!c1 || !c2) return color1;

  const r = Math.round(lerp(c1.r, c2.r, t));
  const g = Math.round(lerp(c1.g, c2.g, t));
  const b = Math.round(lerp(c1.b, c2.b, t));
  const a = lerp(c1.a / 255, c2.a / 255, t);

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Color maps for heat-strip rendering
 */
export const COLOR_MAPS = {
  viridis: [
    "#440154",
    "#482878",
    "#3e4a89",
    "#31688e",
    "#26828e",
    "#1f9e89",
    "#35b779",
    "#6ece58",
    "#b5de2b",
    "#fde725",
  ],
  plasma: [
    "#0d0887",
    "#46039f",
    "#7201a8",
    "#9c179e",
    "#bd3786",
    "#d8576b",
    "#ed7953",
    "#fb9f3a",
    "#fdca26",
    "#f0f921",
  ],
  magma: [
    "#000004",
    "#180f3d",
    "#440f76",
    "#721f81",
    "#9e2f7f",
    "#cd4071",
    "#f1605d",
    "#fd9668",
    "#feca8d",
    "#fcfdbf",
  ],
  inferno: [
    "#000004",
    "#1b0c41",
    "#4a0c6b",
    "#781c6d",
    "#a52c60",
    "#cf4446",
    "#ed6925",
    "#fb9b06",
    "#f7d13d",
    "#fcffa4",
  ],
  grayscale: [
    "#000000",
    "#1c1c1c",
    "#383838",
    "#545454",
    "#707070",
    "#8c8c8c",
    "#a8a8a8",
    "#c4c4c4",
    "#e0e0e0",
    "#ffffff",
  ],
} as const;

/**
 * Get color from a color map at a normalized position (0-1)
 */
export function colorMapValue(
  colorMap: keyof typeof COLOR_MAPS,
  t: number
): string {
  const colors = COLOR_MAPS[colorMap];
  const clampedT = clamp(t, 0, 1);

  if (clampedT === 1) return colors[colors.length - 1] ?? colors[0] ?? "#000";

  const idx = clampedT * (colors.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;

  const lowerColor = colors[lower];
  const upperColor = colors[upper];

  if (!lowerColor) return "#000";
  if (!upperColor) return lowerColor;

  return interpolateColor(lowerColor, upperColor, weight);
}

/**
 * Create a canvas with proper DPI scaling
 */
export function createScaledCanvas(
  container: HTMLElement
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  resize: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;";

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  };

  container.appendChild(canvas);
  resize();

  return { canvas, ctx, resize };
}
