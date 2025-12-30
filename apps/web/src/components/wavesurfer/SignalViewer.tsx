"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { GripHorizontal } from "lucide-react";
import type { WaveSurferViewport } from "./types";
import {
  decimator,
  normalizer,
  renderLine,
  renderStepped,
  renderImpulses,
  renderMarkers,
  renderHeatStrip,
  getBaselineY,
  clamp,
  type ContinuousSignal,
  type SparseSignal,
  type SignalData,
  type RenderMode,
  type BaselineMode,
  type NormalizationMode,
  type ColorConfig,
  type NormalizationBounds,
  type RenderPoint,
} from "@octoseq/wavesurfer-signalviewer";

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 100;

export type SignalViewerProps = {
  /** Signal data to render */
  signal: SignalData;
  /** Viewport from the main WaveSurfer instance (source-of-truth) */
  viewport: WaveSurferViewport | null;
  /** Initial height (defaults to DEFAULT_HEIGHT). Component manages its own height state for resizing. */
  initialHeight?: number;
  /** Shared mirrored cursor (hover or playhead) to display */
  cursorTimeSec?: number | null;
  /** Notify parent when this view is hovered so other views can mirror cursor */
  onCursorTimeChange?: (timeSec: number | null) => void;
  /** Render mode (default: "filled") */
  mode?: RenderMode;
  /** Baseline position (default: "bottom") */
  baseline?: BaselineMode;
  /** Normalization mode (default: "global") */
  normalization?: NormalizationMode;
  /** Color configuration */
  color?: ColorConfig;
  /** Optional threshold line (normalized 0-1) */
  threshold?: number | null;
  /** Whether the panel is resizable (default: true) */
  resizable?: boolean;
  /** Label to display */
  label?: string;
};

/**
 * Standalone signal viewer that renders 1D signals synchronized with a shared viewport.
 * Uses the same rendering logic as the wavesurfer-signalviewer plugin but doesn't require
 * a WaveSurfer instance.
 */
export function SignalViewer({
  signal,
  viewport,
  initialHeight = DEFAULT_HEIGHT,
  cursorTimeSec,
  onCursorTimeChange,
  mode = "filled",
  baseline = "bottom",
  normalization = "global",
  color,
  threshold,
  resizable = true,
  label,
}: SignalViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Cached bounds
  const boundsRef = useRef<NormalizationBounds | null>(null);

  // Hover state for value display
  const [hoverInfo, setHoverInfo] = useState<{
    value: number | null;
    time: number;
    x: number;
    viewportMin: number;
    viewportMax: number;
  } | null>(null);

  // Store viewport bounds for display
  const viewportBoundsRef = useRef<{ min: number; max: number } | null>(null);

  // Default colors based on theme
  const defaultColor: ColorConfig = {
    stroke: "rgb(59, 130, 246)", // blue-500
    fill: "rgba(59, 130, 246, 0.3)",
    strokeWidth: 1.5,
    opacity: 1,
  };
  const mergedColor = { ...defaultColor, ...color };

  // Resize handlers
  const handleResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dy = e.clientY - startYRef.current;
      const newHeight = clamp(startHeightRef.current + dy, MIN_HEIGHT, MAX_HEIGHT);
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Compute normalization bounds when signal changes
  useEffect(() => {
    boundsRef.current = normalizer.computeBounds(signal, normalization);
  }, [signal, normalization]);

  // Get value at a specific time using binary search
  const getValueAtTime = useCallback((time: number): number | null => {
    if (signal.kind !== "continuous") return null;
    const { times, values } = signal;
    if (times.length === 0) return null;

    // Binary search for the closest time
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

    // Linear interpolation between left and right
    const t0 = times[left] ?? 0;
    const t1 = times[right] ?? 0;
    const v0 = values[left] ?? 0;
    const v1 = values[right] ?? 0;

    if (t1 === t0) return v0;
    const ratio = (time - t0) / (t1 - t0);
    return v0 + ratio * (v1 - v0);
  }, [signal]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !viewport) return;

    // Get or initialize context
    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext("2d");
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) return;

    // Resize canvas if needed
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Get bounds
    const bounds = boundsRef.current ?? { min: 0, max: 1 };

    // Calculate visible time range
    const { startTime, endTime } = viewport;
    const visibleDuration = endTime - startTime;
    if (visibleDuration <= 0) return;

    // Calculate actual pixels per second based on container width
    const pxPerSec = width / visibleDuration;

    // Time to X conversion
    const timeToX = (time: number): number => {
      return (time - startTime) * pxPerSec;
    };

    // Get decimated data
    const targetPoints = Math.min(width * 2, 4000);

    // Calculate viewport min/max for continuous signals
    if (signal.kind === "continuous") {
      const { times, values } = signal;
      let vpMin = Infinity;
      let vpMax = -Infinity;
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const v = values[i];
        if (t !== undefined && v !== undefined && t >= startTime && t <= endTime) {
          if (v < vpMin) vpMin = v;
          if (v > vpMax) vpMax = v;
        }
      }
      if (vpMin !== Infinity && vpMax !== -Infinity) {
        viewportBoundsRef.current = { min: vpMin, max: vpMax };
      }
    }

    if (signal.kind === "sparse") {
      // Render sparse events
      renderSparseSignal(ctx, signal, timeToX, bounds, width, height);
    } else {
      // Render continuous signal
      renderContinuousSignal(ctx, signal, timeToX, bounds, targetPoints, startTime, endTime, width, height);
    }

    // Draw threshold line if specified
    if (threshold != null && threshold >= 0 && threshold <= 1) {
      drawThresholdLine(ctx, threshold, width, height);
    }

    // Draw cursor
    if (cursorTimeSec != null && cursorTimeSec >= startTime && cursorTimeSec <= endTime) {
      drawCursor(ctx, timeToX(cursorTimeSec), height);
    }
  }, [viewport, signal, cursorTimeSec, threshold, mode, baseline, normalization, mergedColor]);

  // Render sparse signal
  const renderSparseSignal = useCallback((
    ctx: CanvasRenderingContext2D,
    sig: SparseSignal,
    timeToX: (t: number) => number,
    bounds: NormalizationBounds,
    width: number,
    height: number
  ) => {
    const { times, strengths } = sig;
    const canvasHeight = height;

    if (mode === "markers") {
      const points: RenderPoint[] = [];
      for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const strength = strengths?.[i] ?? 1;
        if (time !== undefined) {
          const x = timeToX(time);
          if (x >= -10 && x <= width + 10) {
            const y = canvasHeight * (1 - strength);
            points.push({ x, y, value: strength, time });
          }
        }
      }
      renderMarkers(ctx, points, {
        color: mergedColor,
        canvasHeight,
      });
    } else {
      // Impulses
      for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const strength = strengths?.[i] ?? 1;
        if (time !== undefined) {
          const x = timeToX(time);
          if (x >= -5 && x <= width + 5) {
            ctx.globalAlpha = (mergedColor.opacity ?? 1) * (0.3 + 0.7 * strength);
            ctx.strokeStyle = mergedColor.stroke ?? "#3b82f6";
            ctx.lineWidth = mergedColor.strokeWidth ?? 2;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x, canvasHeight);
            ctx.lineTo(x, canvasHeight * (1 - strength));
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }, [mode, mergedColor]);

  // Render continuous signal
  const renderContinuousSignal = useCallback((
    ctx: CanvasRenderingContext2D,
    sig: ContinuousSignal,
    timeToX: (t: number) => number,
    bounds: NormalizationBounds,
    targetPoints: number,
    startTime: number,
    endTime: number,
    width: number,
    height: number
  ) => {
    const { times, values } = sig;
    const canvasHeight = height;
    const baselineY = getBaselineY(baseline, canvasHeight);

    // Decimate
    const decimated = decimator.decimate(times, values, startTime, endTime, targetPoints);

    // Convert to render points
    const points: RenderPoint[] = [];
    for (let i = 0; i < decimated.times.length; i++) {
      const time = decimated.times[i];
      const value = decimated.values[i];
      if (time === undefined || value === undefined) continue;

      const x = timeToX(time);
      const normalized = normalizer.normalize(value, bounds);

      let y: number;
      if (baseline === "bottom") {
        y = canvasHeight * (1 - clamp(normalized, 0, 1));
      } else if (baseline === "center") {
        const centered = clamp(normalized, 0, 1) - 0.5;
        y = canvasHeight * (0.5 - centered);
      } else {
        const customY = typeof baseline === "object" ? baseline.y : 0;
        const scaledValue = clamp(normalized, 0, 1);
        y = canvasHeight * (1 - customY) - scaledValue * canvasHeight * (1 - customY);
      }

      points.push({ x, y, value, time });
    }

    // Render based on mode
    switch (mode) {
      case "line":
        renderLine(ctx, points, {
          color: mergedColor,
          baseline,
          mode: "line",
          canvasHeight,
        });
        break;

      case "filled":
        renderLine(ctx, points, {
          color: mergedColor,
          baseline,
          mode: "filled",
          canvasHeight,
        });
        break;

      case "stepped":
        renderStepped(ctx, points, {
          color: mergedColor,
          baseline,
          filled: false,
          canvasHeight,
        });
        break;

      case "impulses":
        renderImpulses(ctx, points, {
          color: mergedColor,
          baseline,
          canvasHeight,
        });
        break;

      case "markers":
        renderMarkers(ctx, points, {
          color: mergedColor,
          canvasHeight,
        });
        break;

      case "heat-strip":
        renderHeatStrip(
          ctx,
          points.map((p) => ({
            x: p.x,
            normalized: normalizer.normalize(p.value, bounds),
          })),
          {
            color: mergedColor,
            canvasHeight,
          }
        );
        break;
    }
  }, [mode, baseline, mergedColor]);

  // Draw threshold line
  const drawThresholdLine = useCallback((
    ctx: CanvasRenderingContext2D,
    threshold: number,
    width: number,
    height: number
  ) => {
    const y = height * (1 - threshold);
    ctx.save();
    ctx.strokeStyle = "rgba(239, 68, 68, 0.7)"; // red-500
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
  }, []);

  // Draw cursor
  const drawCursor = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    height: number
  ) => {
    ctx.save();
    ctx.strokeStyle = "rgba(239, 68, 68, 0.8)"; // red-500
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.restore();
  }, []);

  // Re-render when dependencies change
  useEffect(() => {
    render();
  }, [render]);

  // Handle resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      render();
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [render]);

  // Handle mouse events for cursor
  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!viewport) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const visibleDuration = viewport.endTime - viewport.startTime;
    if (visibleDuration <= 0 || rect.width <= 0) return;
    const time = viewport.startTime + (x / rect.width) * visibleDuration;

    onCursorTimeChange?.(time);

    // Get value at cursor for display
    const value = getValueAtTime(time);
    const vpBounds = viewportBoundsRef.current;
    setHoverInfo({
      value,
      time,
      x,
      viewportMin: vpBounds?.min ?? 0,
      viewportMax: vpBounds?.max ?? 0,
    });
  }, [viewport, onCursorTimeChange, getValueAtTime]);

  const handleMouseLeave = useCallback(() => {
    onCursorTimeChange?.(null);
    setHoverInfo(null);
  }, [onCursorTimeChange]);

  return (
    <div className="relative bg-zinc-100 dark:bg-zinc-900 rounded overflow-hidden">
      {label && (
        <div className="absolute top-1 left-2 z-10">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {label}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: `${panelHeight}px` }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
        {/* Floating value display on hover */}
        {hoverInfo && hoverInfo.value !== null && (
          <div
            className="absolute top-1 z-20 pointer-events-none"
            style={{
              left: `${Math.min(Math.max(hoverInfo.x, 60), (containerRef.current?.getBoundingClientRect().width ?? 200) - 60)}px`,
              transform: "translateX(-50%)",
            }}
          >
            <div className="bg-zinc-800/90 dark:bg-zinc-200/90 text-zinc-100 dark:text-zinc-900 text-xs px-2 py-1 rounded shadow-lg backdrop-blur-sm whitespace-nowrap">
              <div className="font-mono font-medium">{hoverInfo.value.toFixed(4)}</div>
              <div className="text-tiny opacity-70 mt-0.5">
                <span>vp: {hoverInfo.viewportMin.toFixed(2)}–{hoverInfo.viewportMax.toFixed(2)}</span>
                {boundsRef.current && (
                  <span className="ml-1.5">all: {boundsRef.current.min.toFixed(2)}–{boundsRef.current.max.toFixed(2)}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {resizable && (
        <div
          className="absolute bottom-0 left-0 right-0 h-4 flex items-center justify-center cursor-ns-resize bg-gradient-to-t from-zinc-200/50 dark:from-zinc-800/50 to-transparent hover:from-zinc-300/70 dark:hover:from-zinc-700/70 transition-colors"
          onMouseDown={handleResizeStart}
        >
          <GripHorizontal className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
        </div>
      )}
    </div>
  );
}

/**
 * Helper to create a continuous signal from Float32Arrays
 */
export function createContinuousSignal(
  times: Float32Array,
  values: Float32Array,
  meta?: ContinuousSignal["meta"]
): ContinuousSignal {
  return {
    kind: "continuous",
    times,
    values,
    meta,
  };
}

/**
 * Helper to create a sparse signal from Float32Arrays
 */
export function createSparseSignal(
  times: Float32Array,
  strengths?: Float32Array,
  meta?: SparseSignal["meta"]
): SparseSignal {
  return {
    kind: "sparse",
    times,
    strengths,
    meta,
  };
}
