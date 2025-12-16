"use client";

import type { WaveSurferViewport } from "@/components/wavesurfer/types";

export type HeatmapPlayheadOverlayProps = {
    viewport: WaveSurferViewport | null;
    timeSec: number | null;
    height: number;
    /** Optional: use the actual view width to compute px/sec. Falls back to viewport widths/minPxPerSec. */
    widthPx?: number;
};

/**
 * Minimal playhead overlay for 2D heatmaps.
 *
 * Uses the same mapping as WaveSurfer:
 *   x = (t - viewport.startTime) * pxPerSec
 */
export function HeatmapPlayheadOverlay({ viewport, timeSec, height, widthPx }: HeatmapPlayheadOverlayProps) {
    if (!viewport || timeSec == null) return null;

    const span = viewport.endTime - viewport.startTime;
    const pxPerSec =
        span > 0
            ? widthPx && widthPx > 0
                ? widthPx / span
                : viewport.containerWidthPx > 0
                    ? viewport.containerWidthPx / span
                    : viewport.minPxPerSec
            : viewport.minPxPerSec;
    if (!pxPerSec || pxPerSec <= 0) return null;

    const x = (timeSec - viewport.startTime) * pxPerSec;
    if (!Number.isFinite(x)) return null;

    return (
        <div
            className="pointer-events-none absolute top-0"
            style={{
                left: `${x}px`,
                height,
                width: 2,
                background: "rgba(212, 175, 55, 0.95)",
            }}
        />
    );
}
