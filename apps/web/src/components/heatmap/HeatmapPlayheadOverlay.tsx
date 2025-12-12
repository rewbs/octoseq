"use client";

import type { WaveSurferViewport } from "@/components/wavesurfer/types";

export type HeatmapPlayheadOverlayProps = {
    viewport: WaveSurferViewport | null;
    playheadTimeSec: number;
    height: number;
};

/**
 * Minimal playhead overlay for 2D heatmaps.
 *
 * Uses the same mapping as WaveSurfer:
 *   x = (t - viewport.startTime) * viewport.minPxPerSec
 */
export function HeatmapPlayheadOverlay({ viewport, playheadTimeSec, height }: HeatmapPlayheadOverlayProps) {
    if (!viewport || viewport.minPxPerSec <= 0) return null;

    const x = (playheadTimeSec - viewport.startTime) * viewport.minPxPerSec;
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
