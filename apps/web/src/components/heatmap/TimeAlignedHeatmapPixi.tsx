"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { Application, Sprite, Texture } from "pixi.js";
import { GripHorizontal } from "lucide-react";
import { GenericBeatGridOverlay } from "@/components/beatGrid/GenericBeatGridOverlay";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";

// Pre-computed color lookup tables for performance (256 entries per scheme)
const COLOR_LUT_SIZE = 256;
type ColorLUT = Uint8Array; // RGBA * 256 = 1024 bytes

const colorLUTCache = new Map<HeatmapColorScheme, ColorLUT>();

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 150;

export type TimeAlignedHeatmapData = {
  /** Shape: [timeIndex][featureIndex] */
  data: Float32Array[];
  /** Seconds for each timeIndex. Must align 1:1 with `data.length`. */
  times: Float32Array;
};

export type HeatmapColorScheme = "grayscale" | "viridis" | "plasma" | "magma";

export type TimeAlignedHeatmapProps = {
  input: TimeAlignedHeatmapData | null;

  /** Visible time range in seconds, driven externally (WaveSurfer is the source-of-truth). */
  startTime: number;
  endTime: number;

  width: number;
  /** Initial height (defaults to DEFAULT_HEIGHT). Component manages its own height state for resizing. */
  initialHeight?: number;

  /** Optional: if provided, clamps to a fixed scale. */
  valueRange?: { min: number; max: number };

  /** Optional display label for the Y axis. */
  yLabel?: string;

  colorScheme?: HeatmapColorScheme;

  /** Whether to show beat grid overlay (default: false) */
  showBeatGrid?: boolean;
  /** Audio duration in seconds (required if showBeatGrid is true) */
  audioDuration?: number;
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

type ColorStop = { t: number; rgb: [number, number, number] };

function lerpColor(stops: ColorStop[], t: number): [number, number, number, number] {
  if (stops.length === 0) return [0, 0, 0, 255];
  const v = clamp01(t);

  // find interval
  let i = 0;
  while (i + 1 < stops.length && v > stops[i + 1]!.t) i++;

  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  if (!a || !b) {
    const c = stops[stops.length - 1]?.rgb ?? [0, 0, 0];
    return [c[0], c[1], c[2], 255];
  }

  const span = Math.max(1e-6, b.t - a.t);
  const f = clamp01((v - a.t) / span);

  const r = Math.round((a.rgb[0] ?? 0) + (b.rgb[0] - (a.rgb[0] ?? 0)) * f);
  const g = Math.round((a.rgb[1] ?? 0) + (b.rgb[1] - (a.rgb[1] ?? 0)) * f);
  const bCh = Math.round((a.rgb[2] ?? 0) + (b.rgb[2] - (a.rgb[2] ?? 0)) * f);

  return [r, g, bCh, 255];
}

const COLOR_STOPS: Record<HeatmapColorScheme, ColorStop[]> = {
  grayscale: [
    { t: 0, rgb: [0, 0, 0] },
    { t: 1, rgb: [255, 255, 255] },
  ],
  viridis: [
    { t: 0, rgb: [68, 1, 84] },
    { t: 0.25, rgb: [59, 82, 139] },
    { t: 0.5, rgb: [33, 145, 140] },
    { t: 0.75, rgb: [94, 201, 98] },
    { t: 1, rgb: [253, 231, 37] },
  ],
  plasma: [
    { t: 0, rgb: [13, 8, 135] },
    { t: 0.25, rgb: [75, 3, 161] },
    { t: 0.5, rgb: [125, 3, 168] },
    { t: 0.75, rgb: [168, 34, 150] },
    { t: 1, rgb: [240, 249, 33] },
  ],
  magma: [
    { t: 0, rgb: [0, 0, 4] },
    { t: 0.25, rgb: [28, 16, 68] },
    { t: 0.5, rgb: [79, 18, 123] },
    { t: 0.75, rgb: [150, 33, 109] },
    { t: 1, rgb: [252, 255, 191] },
  ],
};

/** Build a 256-entry RGBA lookup table for a color scheme (computed once, cached). */
function getColorLUT(scheme: HeatmapColorScheme): ColorLUT {
  const cached = colorLUTCache.get(scheme);
  if (cached) return cached;

  const lut = new Uint8Array(COLOR_LUT_SIZE * 4);
  const stops = COLOR_STOPS[scheme] ?? COLOR_STOPS.grayscale;

  for (let i = 0; i < COLOR_LUT_SIZE; i++) {
    const t = i / (COLOR_LUT_SIZE - 1);
    const [r, g, b, a] = lerpColor(stops, t);
    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = a;
  }

  colorLUTCache.set(scheme, lut);
  return lut;
}

/** Fast color lookup using pre-computed LUT (avoids interpolation per-pixel). */
function colourMapFast(lut: ColorLUT, v01: number): [number, number, number, number] {
  const idx = Math.round(clamp01(v01) * (COLOR_LUT_SIZE - 1)) * 4;
  return [lut[idx]!, lut[idx + 1]!, lut[idx + 2]!, lut[idx + 3]!];
}

function lowerBound(times: Float32Array, t: number): number {
  // First index i where times[i] >= t
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(times: Float32Array, t: number): number {
  // First index i where times[i] > t
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] ?? 0) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Generic, time-aligned 2D heatmap viewer using PixiJS.
 *
 * Rendering assumptions / decisions:
 * - Input data is [frame][feature]. We render a bitmap where:
 *   - X = time (mapped via `times`)
 *   - Y = feature index (0..nFeatures-1)
 * - We only render the *visible* time window for performance.
 * - We do not interpolate time; each pixel column samples the nearest frame.
 *   (This keeps mapping simple and avoids inventing new time values.)
 */
export function TimeAlignedHeatmapPixi({
  input,
  startTime,
  endTime,
  width,
  initialHeight = DEFAULT_HEIGHT,
  valueRange,
  colorScheme = "grayscale",
  showBeatGrid = false,
  audioDuration = 0,
}: TimeAlignedHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Create a viewport object for beat grid overlay
  const viewport: WaveSurferViewport | null = useMemo(() => {
    if (width <= 0 || endTime <= startTime) return null;
    const duration = endTime - startTime;
    return {
      startTime,
      endTime,
      containerWidthPx: width,
      totalWidthPx: width,
      minPxPerSec: width / duration,
    };
  }, [startTime, endTime, width]);

  const appRef = useRef<Application | null>(null);
  const spriteRef = useRef<Sprite | null>(null);
  const initDoneRef = useRef(false);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleResizeStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientY - startYRef.current;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Keep latest render inputs in refs so we can trigger a render once Pixi finishes async init.
  const inputRef = useRef<TimeAlignedHeatmapData | null>(null);
  const startTimeRef = useRef(0);
  const endTimeRef = useRef(0);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  const colorRef = useRef<HeatmapColorScheme>(colorScheme);

  // Track unmount to avoid updating Pixi after teardown.
  const aliveRef = useRef(true);

  // Callable ref so we can trigger a render from async init without "use before declare".
  const renderNowRef = useRef<() => void>(() => { });

  // RAF-based render throttling to avoid rendering on every scroll/zoom frame
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Create / destroy Pixi app.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const app = new Application();
    appRef.current = app;

    let destroyed = false;

    // Track init so cleanup can await it (avoids races under React StrictMode).
    initDoneRef.current = false;
    const initPromise = (async () => {
      try {
        initDoneRef.current = false;
        // Pixi v8 prefers async init.
        // We disable autoStart so the renderer doesn't tick/render until the
        // stage is fully created and attached.
        await app.init({
          width,
          height: initialHeight,
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          autoStart: false,
        });

        if (destroyed) return;

        host.appendChild(app.canvas);

        const sprite = new Sprite(Texture.EMPTY);
        spriteRef.current = sprite;
        sprite.width = width;
        sprite.height = initialHeight;
        app.stage.addChild(sprite);

        // Now safe to start ticking.
        initDoneRef.current = true;
        app.start();

        // If analysis finished before Pixi init, render once now.
        // (This fixes the "need to click Run Analysis twice" UX.)
        renderNowRef.current();
      } catch {
        // If init fails (WebGL unavailable, etc.), we fail "blank".
        // This widget is diagnostic; we prefer not crashing the app.
      }
    })();

    return () => {
      destroyed = true;

      // Clear refs first so any in-flight async bitmap updates no-op.
      spriteRef.current = null;
      const toDestroy = appRef.current;
      appRef.current = null;

      void initPromise.finally(() => {
        // In React dev (StrictMode), effects may mount/unmount rapidly.
        // Guard destroy so we don't throw if Pixi didn't fully init.
        try {
          toDestroy?.stop();
          const canvas = toDestroy?.canvas;
          if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
          toDestroy?.destroy(true);
        } catch {
          // ignore
        }
      });
    };
    // width changes recreate app for simplicity.
  }, [width, initialHeight]);

  // Resize Pixi renderer dynamically without recreating
  useEffect(() => {
    const app = appRef.current;
    const sprite = spriteRef.current;
    if (!app || !initDoneRef.current) return;

    app.renderer.resize(width, panelHeight);
    if (sprite) {
      sprite.width = width;
      sprite.height = panelHeight;
    }
  }, [width, panelHeight]);

  // Store valueRange in a ref so renderNow can access the current value
  const valueRangeRef = useRef(valueRange);
  useEffect(() => {
    valueRangeRef.current = valueRange;
  }, [valueRange]);

  function renderNow() {
    const app = appRef.current;
    const sprite = spriteRef.current;
    if (!app || !sprite) return;
    if (!aliveRef.current) return;
    if (!initDoneRef.current) {
      console.debug("[Heatmap] skip render: pixi init not done yet");
      return;
    }

    const curInput = inputRef.current;
    const curStartTime = startTimeRef.current;
    const curEndTime = endTimeRef.current;
    const curWidth = widthRef.current;
    const curHeight = heightRef.current;

    // Avoid Pixi rendering while we hot-swap textures.
    app.stop();

    if (!curInput || curInput.data.length === 0 || curInput.times.length === 0) {
      console.debug("[Heatmap] no input/times", {
        hasInput: !!curInput,
        frames: curInput?.data.length ?? 0,
        times: curInput?.times.length ?? 0,
      });
      sprite.texture = Texture.EMPTY;
      app.start();
      return;
    }

    const { data, times } = curInput;
    const nFrames = data.length;
    const nFeatures = data[0]?.length ?? 0;

    console.debug("[Heatmap] render request", {
      startTime: curStartTime,
      endTime: curEndTime,
      frames: nFrames,
      nFeatures,
      t0: times[0],
      tN: times[times.length - 1],
      width: curWidth,
      height: curHeight,
    });

    if (nFeatures <= 0 || curWidth <= 0 || curHeight <= 0) {
      console.warn("[Heatmap] invalid dimensions", { nFeatures, curWidth, curHeight });
      sprite.texture = Texture.EMPTY;
      app.start();
      return;
    }

    const frame0 = Math.max(0, lowerBound(times, curStartTime));
    const frame1 = Math.min(nFrames, upperBound(times, curEndTime));
    if (frame1 <= frame0) {
      console.warn("[Heatmap] empty visible window", {
        frame0,
        frame1,
        startTime: curStartTime,
        endTime: curEndTime,
        t0: times[0],
        tN: times[times.length - 1],
      });
      sprite.texture = Texture.EMPTY;
      app.start();
      return;
    }

    // Compute value range for normalization (now inside RAF-throttled render)
    let range: { min: number; max: number };
    if (valueRangeRef.current) {
      range = valueRangeRef.current;
    } else {
      let min = Infinity;
      let max = -Infinity;
      for (let i = frame0; i < frame1; i++) {
        const row = data[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
          const v = row[j] ?? 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      range = (!Number.isFinite(min) || !Number.isFinite(max) || min === max)
        ? { min: 0, max: 1 }
        : { min, max };
    }

    const inv = 1 / (range.max - range.min);

    const w = Math.max(1, Math.floor(curWidth));
    const h = Math.max(1, Math.floor(curHeight));
    const pixels = new Uint8Array(w * h * 4);

    // Use pre-computed LUT for fast color mapping
    const lut = getColorLUT(colorRef.current);

    for (let x = 0; x < w; x++) {
      const a = w <= 1 ? 0 : x / (w - 1);
      const frame = Math.min(frame1 - 1, frame0 + Math.round(a * (frame1 - frame0 - 1)));
      const row = data[frame] ?? new Float32Array(nFeatures);

      for (let y = 0; y < h; y++) {
        const fj = h <= 1 ? 0 : Math.round(((h - 1 - y) / (h - 1)) * (nFeatures - 1));
        const v = row[fj] ?? 0;
        const v01 = clamp01((v - range.min) * inv);
        const [r, g, b, a255] = colourMapFast(lut, v01);

        const idx = (y * w + x) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = a255;
      }
    }

    const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
    void createImageBitmap(imageData).then((bmp) => {
      if (!aliveRef.current) return;
      if (!appRef.current || !spriteRef.current) return;

      const tex = Texture.from(bmp);
      spriteRef.current.texture = tex;
      spriteRef.current.width = curWidth;
      spriteRef.current.height = curHeight;

      appRef.current?.render();
      appRef.current?.start();

      console.debug("[Heatmap] rendered", { frame0, frame1, w, h, rangeMin: range.min, rangeMax: range.max });
    });
  }

  // Keep callable ref in sync.
  useEffect(() => {
    renderNowRef.current = renderNow;
  });

  // Schedule a render on the next animation frame (coalesces rapid updates)
  const scheduleRender = useCallback(() => {
    // Cancel any pending RAF and schedule a new one
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      renderNowRef.current();
    });
  }, []);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Keep refs in sync and schedule render on updates (RAF-throttled).
  useEffect(() => {
    inputRef.current = input;
    startTimeRef.current = startTime;
    endTimeRef.current = endTime;
    widthRef.current = width;
    heightRef.current = panelHeight;
    colorRef.current = colorScheme;

    scheduleRender();
  }, [input, startTime, endTime, width, panelHeight, colorScheme, scheduleRender]);

  return (
    <div className="w-full">
      <div className="rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="relative">
          <div
            ref={(el) => {
              containerRef.current = el;
            }}
            style={{ width, height: panelHeight }}
          />
          {/* Beat grid overlay */}
          {showBeatGrid && audioDuration > 0 && viewport && (
            <GenericBeatGridOverlay
              viewport={viewport}
              audioDuration={audioDuration}
              height={panelHeight}
            />
          )}
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleResizeStart}
          className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group"
        >
          <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
        </div>
      </div>
    </div>
  );
}
