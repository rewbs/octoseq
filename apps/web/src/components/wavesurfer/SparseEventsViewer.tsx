"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { GripHorizontal } from "lucide-react";

import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { ViewportOverlayMarkers, type OverlayEvent, type OverlayMarkerVariant } from "./ViewportOverlayMarkers";
import { GenericBeatGridOverlay } from "@/components/beatGrid/GenericBeatGridOverlay";
import type { WaveSurferViewport } from "./types";

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 150;

export type SparseEventsViewerProps = {
  /** Array of discrete events to display as vertical markers. */
  events: OverlayEvent[];

  /** Viewport from the main WaveSurfer instance (source-of-truth). */
  viewport: WaveSurferViewport | null;

  /** Initial height (defaults to DEFAULT_HEIGHT). Component manages its own height state for resizing. */
  initialHeight?: number;

  /** Shared mirrored cursor (hover or playhead) to display. */
  cursorTimeSec?: number | null;

  /** Notify parent when this view is hovered so other views can mirror cursor. */
  onCursorTimeChange?: (timeSec: number | null) => void;

  /** Visual variant for markers. Defaults to "onset". */
  variant?: OverlayMarkerVariant;

  /** Whether to show beat grid overlay (default: false) */
  showBeatGrid?: boolean;
  /** Audio duration in seconds (required if showBeatGrid is true) */
  audioDuration?: number;
};

/**
 * Resizable viewer for sparse/discrete events (e.g. onset peaks).
 *
 * Renders vertical markers at event times within a contained viewport,
 * matching the structure of other signal viewers (SyncedWaveSurferSignal).
 */
export function SparseEventsViewer({
  events,
  viewport,
  initialHeight = DEFAULT_HEIGHT,
  cursorTimeSec,
  onCursorTimeChange,
  variant,
  showBeatGrid = false,
  audioDuration = 0,
}: SparseEventsViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = panelHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [panelHeight]
  );

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
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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

  // Track container width for playhead overlay
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    // Initial measurement
    setContainerWidth(container.offsetWidth);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full">
      <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div
          ref={containerRef}
          className="relative overflow-hidden"
          style={{ height: panelHeight }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <ViewportOverlayMarkers viewport={viewport} events={events} height={panelHeight} variant={variant} />
          {showBeatGrid && audioDuration > 0 && (
            <GenericBeatGridOverlay
              viewport={viewport}
              audioDuration={audioDuration}
              height={panelHeight}
            />
          )}
          <HeatmapPlayheadOverlay
            viewport={viewport}
            timeSec={cursorTimeSec ?? null}
            height={panelHeight}
            widthPx={containerWidth}
          />
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
