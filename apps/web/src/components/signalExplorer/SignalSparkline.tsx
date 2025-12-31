"use client";

import { memo, useRef, useEffect, useCallback } from "react";
import type { TransformType } from "@/lib/signalExplorer/types";

interface SignalSparklineProps {
  /** Sample times */
  times: number[];
  /** Sample values */
  values: number[];
  /** Time range [start, end] */
  timeRange: [number, number];
  /** Height in pixels */
  height?: number;
  /** Transform type for color */
  transformType?: TransformType;
}

/** Color mapping for different transform types */
const sparklineColors: Record<string, { stroke: string; fill: string }> = {
  Source: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.2)" },
  Smooth: { stroke: "#a855f7", fill: "rgba(168, 85, 247, 0.2)" },
  Normalise: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.2)" },
  Gate: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.2)" },
  Arithmetic: { stroke: "#06b6d4", fill: "rgba(6, 182, 212, 0.2)" },
  Math: { stroke: "#ec4899", fill: "rgba(236, 72, 153, 0.2)" },
  Trig: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.2)" },
  ExpLog: { stroke: "#f97316", fill: "rgba(249, 115, 22, 0.2)" },
  Modular: { stroke: "#14b8a6", fill: "rgba(20, 184, 166, 0.2)" },
  Mapping: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.2)" },
  TimeShift: { stroke: "#6366f1", fill: "rgba(99, 102, 241, 0.2)" },
  RateChange: { stroke: "#f43f5e", fill: "rgba(244, 63, 94, 0.2)" },
  Debug: { stroke: "#71717a", fill: "rgba(113, 113, 122, 0.2)" },
};

export const SignalSparkline = memo(function SignalSparkline({
  times,
  values,
  timeRange,
  height = 32,
  transformType = "Source",
}: SignalSparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const colors = sparklineColors[transformType] ?? sparklineColors["Source"]!;
    const [startTime, endTime] = timeRange;
    const duration = endTime - startTime || 1;

    // Compute local min/max with padding
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    // Add small padding to range
    const range = max - min || 1;
    const paddedMin = min - range * 0.05;
    const paddedMax = max + range * 0.05;
    const paddedRange = paddedMax - paddedMin;

    // Draw filled area
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < times.length; i++) {
      const t = times[i] ?? 0;
      const v = values[i] ?? 0;
      const x = ((t - startTime) / duration) * width;
      const y = height - ((v - paddedMin) / paddedRange) * (height - 4) - 2;

      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = colors.fill;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    for (let i = 0; i < times.length; i++) {
      const t = times[i] ?? 0;
      const v = values[i] ?? 0;
      const x = ((t - startTime) / duration) * width;
      const y = height - ((v - paddedMin) / paddedRange) * (height - 4) - 2;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw center line (current time marker)
    ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [times, values, timeRange, height, transformType]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  return <canvas ref={canvasRef} className="w-full" style={{ height }} />;
});
