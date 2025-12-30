/**
 * Stepped line renderer for signals
 *
 * Renders as a step function (zero-order hold) - useful for
 * discrete or quantized signals.
 */

import type { RenderPoint, ColorConfig, BaselineMode } from "../types.js";
import { getBaselineY } from "./line.js";

export interface SteppedRenderOptions {
  color: ColorConfig;
  baseline: BaselineMode;
  filled: boolean;
  canvasHeight: number;
}

/**
 * Render a stepped line from a series of points
 */
export function renderStepped(
  ctx: CanvasRenderingContext2D,
  points: RenderPoint[],
  options: SteppedRenderOptions
): void {
  if (points.length === 0) return;

  const { color, baseline, filled, canvasHeight } = options;

  const stroke = color.stroke ?? "#3b82f6";
  const fill = color.fill ?? "rgba(59, 130, 246, 0.3)";
  const strokeWidth = color.strokeWidth ?? 1.5;
  const opacity = color.opacity ?? 1;

  const baselineY = getBaselineY(baseline, canvasHeight);

  ctx.save();
  ctx.globalAlpha = opacity;

  // Build stepped path
  ctx.beginPath();

  const firstPoint = points[0];
  if (!firstPoint) {
    ctx.restore();
    return;
  }

  ctx.moveTo(firstPoint.x, firstPoint.y);

  for (let i = 1; i < points.length; i++) {
    const prevPoint = points[i - 1];
    const point = points[i];
    if (prevPoint && point) {
      // Horizontal line to new x at old y
      ctx.lineTo(point.x, prevPoint.y);
      // Vertical line to new y
      ctx.lineTo(point.x, point.y);
    }
  }

  // Draw fill if requested
  if (filled) {
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      ctx.lineTo(lastPoint.x, baselineY);
      ctx.lineTo(firstPoint.x, baselineY);
      ctx.closePath();
    }

    ctx.fillStyle = fill;
    ctx.fill();

    // Redraw path for stroke
    ctx.beginPath();
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (let i = 1; i < points.length; i++) {
      const prevPoint = points[i - 1];
      const point = points[i];
      if (prevPoint && point) {
        ctx.lineTo(point.x, prevPoint.y);
        ctx.lineTo(point.x, point.y);
      }
    }
  }

  // Draw stroke
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.stroke();

  ctx.restore();
}
