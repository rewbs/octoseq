/**
 * Line renderer for continuous signals
 *
 * Supports both simple line mode and filled area mode.
 */

import type { RenderPoint, ColorConfig, BaselineMode } from "../types.js";

export interface LineRenderOptions {
  color: ColorConfig;
  baseline: BaselineMode;
  mode: "line" | "filled";
  canvasHeight: number;
}

/**
 * Calculate the baseline Y position in pixels
 */
export function getBaselineY(baseline: BaselineMode, height: number): number {
  if (baseline === "bottom") {
    return height;
  } else if (baseline === "center") {
    return height / 2;
  } else if (typeof baseline === "object" && "y" in baseline) {
    return height * (1 - baseline.y); // Convert from normalized (0=bottom) to canvas (0=top)
  }
  return height;
}

/**
 * Render a line or filled area from a series of points
 */
export function renderLine(
  ctx: CanvasRenderingContext2D,
  points: RenderPoint[],
  options: LineRenderOptions
): void {
  if (points.length === 0) return;

  const {
    color,
    baseline,
    mode,
    canvasHeight,
  } = options;

  const stroke = color.stroke ?? "#3b82f6";
  const fill = color.fill ?? "rgba(59, 130, 246, 0.3)";
  const strokeWidth = color.strokeWidth ?? 1.5;
  const opacity = color.opacity ?? 1;

  const baselineY = getBaselineY(baseline, canvasHeight);

  ctx.save();
  ctx.globalAlpha = opacity;

  // Build the path
  ctx.beginPath();

  const firstPoint = points[0];
  if (!firstPoint) {
    ctx.restore();
    return;
  }

  ctx.moveTo(firstPoint.x, firstPoint.y);

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (point) {
      ctx.lineTo(point.x, point.y);
    }
  }

  // Draw fill if in filled mode
  if (mode === "filled") {
    // Close the path back to baseline
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      ctx.lineTo(lastPoint.x, baselineY);
      ctx.lineTo(firstPoint.x, baselineY);
      ctx.closePath();
    }

    ctx.fillStyle = fill;
    ctx.fill();

    // Redraw the line path for stroke
    ctx.beginPath();
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (point) {
        ctx.lineTo(point.x, point.y);
      }
    }
  }

  // Draw stroke
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.restore();
}
