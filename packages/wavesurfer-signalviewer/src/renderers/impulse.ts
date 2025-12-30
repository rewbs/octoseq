/**
 * Impulse and marker renderers for sparse signals
 *
 * Impulses: vertical lines from baseline to value
 * Markers: dots/circles at each point
 */

import type { RenderPoint, ColorConfig, BaselineMode } from "../types.js";
import { getBaselineY } from "./line.js";

export interface ImpulseRenderOptions {
  color: ColorConfig;
  baseline: BaselineMode;
  canvasHeight: number;
}

export interface MarkerRenderOptions {
  color: ColorConfig;
  markerRadius?: number;
  canvasHeight: number;
}

/**
 * Render impulses (vertical lines) at each point
 */
export function renderImpulses(
  ctx: CanvasRenderingContext2D,
  points: RenderPoint[],
  options: ImpulseRenderOptions
): void {
  if (points.length === 0) return;

  const { color, baseline, canvasHeight } = options;

  const stroke = color.stroke ?? "#3b82f6";
  const strokeWidth = color.strokeWidth ?? 2;
  const opacity = color.opacity ?? 1;

  const baselineY = getBaselineY(baseline, canvasHeight);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";

  ctx.beginPath();

  for (const point of points) {
    ctx.moveTo(point.x, baselineY);
    ctx.lineTo(point.x, point.y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Render markers (circles) at each point
 */
export function renderMarkers(
  ctx: CanvasRenderingContext2D,
  points: RenderPoint[],
  options: MarkerRenderOptions
): void {
  if (points.length === 0) return;

  const { color, markerRadius = 3 } = options;

  const stroke = color.stroke ?? "#3b82f6";
  const fill = color.fill ?? stroke;
  const strokeWidth = color.strokeWidth ?? 1;
  const opacity = color.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, markerRadius, 0, Math.PI * 2);

    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }

    if (stroke && strokeWidth > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Render sparse events as vertical lines with optional strength-based opacity
 */
export function renderSparseEvents(
  ctx: CanvasRenderingContext2D,
  times: Float32Array,
  strengths: Float32Array | undefined,
  timeToX: (time: number) => number,
  options: {
    color: ColorConfig;
    canvasHeight: number;
    topPadding?: number;
  }
): void {
  if (times.length === 0) return;

  const { color, canvasHeight, topPadding = 0 } = options;

  const stroke = color.stroke ?? "#f59e0b";
  const strokeWidth = color.strokeWidth ?? 2;
  const baseOpacity = color.opacity ?? 1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = strokeWidth;

  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    if (time === undefined) continue;

    const x = timeToX(time);

    // Skip if outside visible area
    if (x < -strokeWidth || x > ctx.canvas.width / (window.devicePixelRatio || 1) + strokeWidth) {
      continue;
    }

    // Calculate opacity based on strength if available
    const strength = strengths?.[i] ?? 1;
    const opacity = baseOpacity * (0.3 + 0.7 * strength); // Min 30% opacity

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = stroke;

    ctx.beginPath();
    ctx.moveTo(x, topPadding);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }

  ctx.restore();
}
