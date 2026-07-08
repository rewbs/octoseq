"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import {
  decimator,
  normalizer,
  renderLine,
  clamp,
  type NormalizationBounds,
  type RenderPoint,
} from "@octoseq/wavesurfer-signalviewer";

/** Min/max of the values currently inside the viewport (for hover readouts). */
export type ViewportBounds = { min: number; max: number };

export type ComparisonSignalCanvasProps = {
  times: Float32Array;
  values: Float32Array;
  /** Stroke color (hex). Fill derives from it at 30% opacity. */
  color: string;
  viewport: WaveSurferViewport | null;
  /** Shared mirrored cursor (hover or playhead), drawn as a vertical line. */
  cursorTimeSec?: number | null;
  /** Row height in CSS pixels. */
  height: number;
  /** Written during each render with the visible min/max (read at hover time). */
  viewportBoundsRef?: { current: ViewportBounds | null };
  /** Called once after the first successful render of this signal. */
  onReady?: () => void;
};

/**
 * Filled canvas line for one 1D signal — the generalized core of
 * BandMirSignalViewer's BandSignalRow: decimate → normalize (global bounds) →
 * renderLine, DPR-aware resize, cursor line, and a one-shot ready callback.
 * Mouse interaction lives in the parent row (which also hosts overlays).
 */
export function ComparisonSignalCanvas({
  times,
  values,
  color,
  viewport,
  cursorTimeSec,
  height,
  viewportBoundsRef,
  onReady,
}: ComparisonSignalCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const boundsRef = useRef<NormalizationBounds | null>(null);
  const hasCalledReady = useRef(false);

  const signal = useMemo(() => createContinuousSignal(times, values), [times, values]);

  // Compute normalization bounds when the signal changes.
  useEffect(() => {
    boundsRef.current = normalizer.computeBounds(signal, "global");
    hasCalledReady.current = false;
  }, [signal]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper || !viewport) return;

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext("2d");
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const rect = wrapper.getBoundingClientRect();
    const width = rect.width;
    if (width === 0) return;

    // Resize canvas if needed (DPR-aware).
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.clearRect(0, 0, width, height);

    const bounds = boundsRef.current ?? { min: 0, max: 1 };

    const { startTime, endTime } = viewport;
    const visibleDuration = endTime - startTime;
    if (visibleDuration <= 0) return;

    const pxPerSec = width / visibleDuration;
    const timeToX = (time: number): number => (time - startTime) * pxPerSec;

    const targetPoints = Math.min(width * 2, 4000);

    // Track visible min/max for the hover readout.
    const { times: sigTimes, values: sigValues } = signal;
    let vpMin = Infinity;
    let vpMax = -Infinity;
    for (let i = 0; i < sigTimes.length; i++) {
      const t = sigTimes[i];
      const v = sigValues[i];
      if (t !== undefined && v !== undefined && t >= startTime && t <= endTime) {
        if (v < vpMin) vpMin = v;
        if (v > vpMax) vpMax = v;
      }
    }
    if (viewportBoundsRef && vpMin !== Infinity && vpMax !== -Infinity) {
      viewportBoundsRef.current = { min: vpMin, max: vpMax };
    }

    // Decimate to render resolution.
    const decimated = decimator.decimate(sigTimes, sigValues, startTime, endTime, targetPoints);

    const points: RenderPoint[] = [];
    for (let i = 0; i < decimated.times.length; i++) {
      const time = decimated.times[i];
      const value = decimated.values[i];
      if (time === undefined || value === undefined) continue;

      const x = timeToX(time);
      const normalized = normalizer.normalize(value, bounds);
      const y = height * (1 - clamp(normalized, 0, 1));
      points.push({ x, y, value, time });
    }

    renderLine(ctx, points, {
      color: {
        stroke: color,
        fill: `${color}4D`, // 30% opacity
        strokeWidth: 1.5,
        opacity: 1,
      },
      baseline: "bottom",
      mode: "filled",
      canvasHeight: height,
    });

    // Shared cursor line.
    if (cursorTimeSec != null && cursorTimeSec >= startTime && cursorTimeSec <= endTime) {
      const cursorX = timeToX(cursorTimeSec);
      ctx.save();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, height);
      ctx.stroke();
      ctx.restore();
    }

    if (!hasCalledReady.current && points.length > 0) {
      hasCalledReady.current = true;
      onReady?.();
    }
  }, [viewport, signal, cursorTimeSec, color, height, viewportBoundsRef, onReady]);

  useEffect(() => {
    render();
  }, [render]);

  // Re-render on container resize.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const resizeObserver = new ResizeObserver(() => {
      render();
    });
    resizeObserver.observe(wrapper);
    return () => resizeObserver.disconnect();
  }, [render]);

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/**
 * Interpolated value of a sampled signal at a given time (binary search),
 * mirroring BandSignalRow's hover lookup.
 */
export function signalValueAtTime(
  times: Float32Array,
  values: Float32Array,
  time: number
): number | null {
  if (times.length === 0) return null;

  let left = 0;
  let right = times.length - 1;

  if (time <= (times[0] ?? 0)) return values[0] ?? null;
  if (time >= (times[right] ?? 0)) return values[right] ?? null;

  while (left < right - 1) {
    const mid = Math.floor((left + right) / 2);
    const midTime = times[mid] ?? 0;
    if (midTime <= time) {
      left = mid;
    } else {
      right = mid;
    }
  }

  const t0 = times[left] ?? 0;
  const t1 = times[right] ?? 0;
  const v0 = values[left] ?? 0;
  const v1 = values[right] ?? 0;

  if (t1 === t0) return v0;
  const ratio = (time - t0) / (t1 - t0);
  return v0 + ratio * (v1 - v0);
}
