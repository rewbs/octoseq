/**
 * Heat strip renderer for 1D signals
 *
 * Renders a color-coded horizontal strip where color intensity
 * represents signal value. Useful for dense events or amplitude envelopes.
 */

import type { ColorConfig } from "../types.js";
import { colorMapValue, COLOR_MAPS } from "../utils.js";

export interface HeatStripRenderOptions {
  color: ColorConfig;
  canvasHeight: number;
  stripHeight?: number; // Height of the strip (default: full canvas height)
  stripOffsetY?: number; // Offset from top (default: 0)
}

/**
 * Render a heat strip from normalized values
 *
 * @param ctx - Canvas context
 * @param normalizedValues - Array of [x, normalizedValue] pairs
 * @param options - Render options
 */
export function renderHeatStrip(
  ctx: CanvasRenderingContext2D,
  normalizedValues: Array<{ x: number; normalized: number }>,
  options: HeatStripRenderOptions
): void {
  if (normalizedValues.length === 0) return;

  const {
    color,
    canvasHeight,
    stripHeight = canvasHeight,
    stripOffsetY = 0,
  } = options;

  const colorMap = color.colorMap ?? "viridis";
  const opacity = color.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Sort by x position
  const sorted = [...normalizedValues].sort((a, b) => a.x - b.x);

  // Render rectangles between consecutive x positions
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    if (!current) continue;

    const x = current.x;
    const width = next ? next.x - x : 2; // Default width for last segment

    // Get color from color map
    const colorValue = colorMapValue(colorMap as keyof typeof COLOR_MAPS, current.normalized);

    ctx.fillStyle = colorValue;
    ctx.fillRect(x, stripOffsetY, Math.max(1, width), stripHeight);
  }

  ctx.restore();
}

/**
 * Render a continuous heat strip by sampling at regular pixel intervals
 *
 * More efficient for dense signals where we have many more samples than pixels.
 */
export function renderContinuousHeatStrip(
  ctx: CanvasRenderingContext2D,
  times: Float32Array,
  normalizedValues: Float32Array,
  timeToX: (time: number) => number,
  xToTime: (x: number) => number,
  options: HeatStripRenderOptions & {
    startX: number;
    endX: number;
  }
): void {
  const {
    color,
    canvasHeight,
    stripHeight = canvasHeight,
    stripOffsetY = 0,
    startX,
    endX,
  } = options;

  const colorMap = color.colorMap ?? "viridis";
  const opacity = color.opacity ?? 1;

  if (times.length === 0 || startX >= endX) return;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Sample at each pixel column
  const width = Math.ceil(endX - startX);

  for (let px = 0; px < width; px++) {
    const x = startX + px;
    const time = xToTime(x);

    // Find the corresponding normalized value
    // Binary search for the closest time
    let low = 0;
    let high = times.length - 1;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midTime = times[mid];
      if (midTime === undefined) break;

      if (midTime < time) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    // Get normalized value (clamp to valid index)
    const idx = Math.min(low, normalizedValues.length - 1);
    const normalized = normalizedValues[idx] ?? 0;

    // Get color
    const colorValue = colorMapValue(colorMap as keyof typeof COLOR_MAPS, normalized);

    ctx.fillStyle = colorValue;
    ctx.fillRect(x, stripOffsetY, 1, stripHeight);
  }

  ctx.restore();
}
