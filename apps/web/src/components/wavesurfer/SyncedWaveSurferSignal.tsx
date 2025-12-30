"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { minMax } from "@octoseq/mir";
import { GripHorizontal } from "lucide-react";

import WaveSurfer from "wavesurfer.js";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 150;

const getScrollContainer = (ws: WaveSurfer | null) => {
  const wrapper = ws?.getWrapper?.();
  return wrapper?.parentElement ?? null;
};



import type { WaveSurferViewport } from "./types";

export type SyncedWaveSurferSignalProps = {
  /** Time-aligned signal to render as a pseudo-waveform (already normalised to [-1,1] or [0,1]). */
  data: Float32Array;

  /** Time (seconds) for each data sample. Must be aligned 1:1 with `data`. */
  times: Float32Array;

  /** Viewport from the main WaveSurfer instance (source-of-truth). */
  viewport: WaveSurferViewport | null;

  /** Initial height (defaults to DEFAULT_HEIGHT). Component manages its own height state for resizing. */
  initialHeight?: number;
  /** Shared mirrored cursor (hover or playhead) to display. */
  cursorTimeSec?: number | null;
  /** Notify parent when this view is hovered so other views can mirror cursor. */
  onCursorTimeChange?: (timeSec: number | null) => void;

  /** Optional: horizontal threshold in the normalised 0..1 display range. */
  overlayThreshold?: number | null;
};

/**
 * Read-only, time-synchronised waveform renderer for 1D MIR features.
 *
 * Implementation note:
 * WebAudio enforces a minimum AudioBuffer sampleRate (~3000Hz).
 * MIR features are low-rate, so we upsample into a display-only buffer at 3000Hz
 * using a simple step-hold driven by the provided MIR `times` array.
 *
 * We then drive zoom/scroll from the main viewport.
 */
export function SyncedWaveSurferSignal({
  data,
  times,
  viewport,
  initialHeight = DEFAULT_HEIGHT,
  cursorTimeSec,
  onCursorTimeChange,
  overlayThreshold,
}: SyncedWaveSurferSignalProps) {
  const wsRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleResizeStart = useCallback((e: ReactMouseEvent) => {
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



  // Lint rule in this repo discourages setState within effects.
  // This component doesn't need to re-render on readiness, so we track it in a ref.
  const readyRef = useRef(false);

  // Important: viewport updates frequently (scroll/zoom). We MUST NOT recreate WaveSurfer
  // on every viewport change; instead we keep the latest viewport in a ref.
  const viewportRef = useRef<WaveSurferViewport | null>(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ws = WaveSurfer.create({
      container,
      height: initialHeight,
      waveColor: "#7c3aed", // violet-600
      progressColor: "#c4b5fd", // violet-300
      cursorColor: "#d4af37",
      normalize: false,
      autoScroll: true,
      autoCenter: false,
      interact: false,
      dragToSeek: false,
      minPxPerSec: 0,
    });

    wsRef.current = ws;

    const onReady = () => {
      readyRef.current = true;

      // If viewport already exists, apply it now (no React state needed).
      const vp = viewportRef.current;
      const scrollContainer = getScrollContainer(ws);
      if (scrollContainer && vp?.minPxPerSec) {
        ws.zoom(vp.minPxPerSec);
        scrollContainer.scrollLeft = Math.max(0, vp.startTime * vp.minPxPerSec);
      }

      console.debug("[MIR-1D] wavesurfer ready", {
        hasViewport: !!vp,
        minPxPerSec: vp?.minPxPerSec,
      });
    };
    ws.on("ready", onReady);

    return () => {
      readyRef.current = false;
      ws.destroy();
      wsRef.current = null;
    };
  }, [initialHeight]);

  // Update WaveSurfer height dynamically without recreating
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setOptions({ height: panelHeight });
  }, [panelHeight]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (data.length === 0 || times.length === 0) {
      console.warn("[MIR-1D] empty data/times", { data: data.length, times: times.length });
      return;
    }
    if (data.length !== times.length) {
      console.warn("[MIR-1D] data/times length mismatch", { data: data.length, times: times.length });
      return;
    }

    console.debug("[MIR-1D] build display buffer", {
      frames: data.length,
      t0: times[0],
      tN: times[times.length - 1],
    });

    // WebAudio AudioBuffer enforces a minimum sampleRate (~3000Hz in browsers).
    // Our MIR features are typically low-rate (e.g. ~86 frames/sec), so we
    // upsample into a display buffer at a valid sampleRate using a simple
    // step-hold (nearest-frame) mapping driven by the provided `times`.
    //
    // This preserves *time alignment* without inventing new feature times.
    const duration = Math.max(0, times[times.length - 1] ?? 0);
    const displaySampleRate = 3000;
    const displayLength = Math.max(1, Math.ceil(duration * displaySampleRate));

    const out = new Float32Array(displayLength);

    // Walk through display samples and advance the frame index as time increases.
    // `times` are frame-center times; we treat each frame's value as constant
    // until the next frame time.
    let frame = 0;
    for (let i = 0; i < displayLength; i++) {
      const t = i / displaySampleRate;
      while (frame + 1 < times.length && (times[frame + 1] ?? 0) <= t) frame++;
      out[i] = data[frame] ?? 0;
    }

    // IMPORTANT: WaveSurfer v7 does not expose a public `loadDecodedBuffer()` API.
    // The supported way to visualise non-audio signals is to pass *precomputed peaks*
    // plus an explicit duration.
    //
    // By providing `peaks` we avoid any audio decoding. WaveSurfer internally creates
    // a synthetic AudioBuffer from peaks+duration and then renders it.
    // This is ideal for 1D MIR features.
    const peaks: Array<Float32Array> = [out];
    const dummyBlob = new Blob([], { type: "application/octet-stream" });

    const { min: peaksMin, max: peaksMax } = minMax(out);

    console.debug("[MIR-1D] ws.loadBlob(peaks)", {
      duration,
      peaksLength: out.length,
      peaksMin,
      peaksMax,
    });

    // mark not ready until load completes to avoid zoom() errors.
    readyRef.current = false;

    void ws.loadBlob(dummyBlob, peaks, duration)
      .then(() => {
        console.debug("[MIR-1D] ws.loadBlob(peaks) ready", {
          decodedDuration: ws.getDuration(),
        });
        readyRef.current = true;

        // Re-apply viewport now that data is ready.
        const vp = viewportRef.current;
        if (vp) {
          try {
            if (vp.minPxPerSec > 0) ws.zoom(vp.minPxPerSec);
          } catch (e) {
            console.warn("[MIR-1D] zoom after load failed", e);
          }
          const scrollContainer = getScrollContainer(ws);
          if (scrollContainer && vp.minPxPerSec > 0) {
            scrollContainer.scrollLeft = Math.max(0, vp.startTime * vp.minPxPerSec);
          }
        }
      })
      .catch((err) => {
        console.error("[MIR-1D] ws.loadBlob(peaks) failed", err);
      });
  }, [data, times]);

  useEffect(() => {
    const ws = wsRef.current;
    const container = containerRef.current;
    if (!ws || !container || !viewport) return;
    if (!readyRef.current) return;

    // Keep zoom consistent.
    try {
      ws.zoom(viewport.minPxPerSec);
    } catch (e) {
      console.warn("[MIR-1D] zoom skipped (no audio yet)", e);
      return;
    }

    // Map visible time window -> scrollLeft in pixels.
    // We prefer using the shared minPxPerSec mapping so we don't rely on
    // WaveSurfer's internal duration being exactly the same as the main audio.
    //
    // This keeps time alignment tight:
    //   scrollLeftPx = startTimeSec * minPxPerSec
    const scrollContainer = getScrollContainer(ws);
    if (!scrollContainer) return;

    if (viewport.minPxPerSec > 0) {
      scrollContainer.scrollLeft = Math.max(0, viewport.startTime * viewport.minPxPerSec);
    } else {
      scrollContainer.scrollLeft = 0;
    }
  }, [viewport]);

  const handleMouseMove = (evt: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCursorTimeChange || !viewport) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const span = viewport.endTime - viewport.startTime;
    if (span <= 0) return;
    const pxPerSec = rect.width > 0 ? rect.width / span : viewport.minPxPerSec;
    if (!pxPerSec || pxPerSec <= 0) return;
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = viewport.startTime + x / pxPerSec;
    onCursorTimeChange(Math.max(0, t));
  };

  const handleMouseLeave = () => {
    onCursorTimeChange?.(null);
  };

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !readyRef.current || cursorTimeSec == null) return;

    // Use native WaveSurfer playhead/cursor instead of a manual overlay.
    // This ensures perfect alignment with the waveform rendering.
    const duration = ws.getDuration();
    if (duration > 0) {
      ws.setTime(Math.min(duration, Math.max(0, cursorTimeSec)));
    }
  }, [cursorTimeSec]);



  return (
    <div className="w-full">
      <div className="relative rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
        <div
          ref={(el: HTMLDivElement | null) => {
            containerRef.current = el;
          }}
          className="w-full overflow-x-hidden"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {overlayThreshold != null && Number.isFinite(overlayThreshold) ? (
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-500"
            style={{ top: `${(1 - overlayThreshold) * 100}%`, opacity: 0.65 }}
            aria-hidden
          />
        ) : null}

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
