"use client";

import { useEffect, useRef } from "react";

import type { WaveSurferViewport } from "./types";

export type OverlayEvent = {
    time: number;
    strength?: number;
};

export type OverlayMarkerVariant = "onset" | "beatCandidate";

export type ViewportOverlayMarkersProps = {
    viewport: WaveSurferViewport | null;
    events: OverlayEvent[];
    height?: number;
    /** Visual variant. "onset" = gold markers, "beatCandidate" = cyan markers with strength-based opacity. */
    variant?: OverlayMarkerVariant;
};

/**
 * Minimal marker overlay aligned to the WaveSurfer viewport mapping.
 *
 * Rendering model:
 * - Parent should position this absolutely over the waveform container.
 * - We convert event time -> x pixel via the same mapping as WaveSurfer:
 *     x = (time - viewport.startTime) * viewport.minPxPerSec
 */
export function ViewportOverlayMarkers({ viewport, events, height = 128, variant = "onset" }: ViewportOverlayMarkersProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);

    // Avoid reflow churn by updating via DOM style mutations.
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Clear.
        host.replaceChildren();

        if (!viewport || events.length === 0) return;

        const span = viewport.endTime - viewport.startTime;
        const width = viewport.containerWidthPx;
        const pxPerSec = span > 0 && width > 0 ? width / span : viewport.minPxPerSec;
        if (!pxPerSec || pxPerSec <= 0) return;

        for (const e of events) {
            const x = (e.time - viewport.startTime) * pxPerSec;
            if (x < 0 || x > width) continue;

            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = `${x}px`;
            div.style.top = "0px";
            div.style.width = "2px";
            div.style.height = `${height}px`;
            div.style.pointerEvents = "none";

            if (variant === "beatCandidate") {
                // Cyan/teal color for beat candidates with strength-based opacity.
                // Strength is expected to be in [0, 1] range.
                const opacity = e.strength !== undefined
                    ? 0.4 + 0.5 * Math.min(1, Math.max(0, e.strength))
                    : 0.8;
                div.style.background = `rgba(0, 188, 212, ${opacity})`; // cyan
            } else {
                // Gold color for onset peaks (default).
                div.style.background = "rgba(212, 175, 55, 0.9)";
            }

            host.appendChild(div);
        }
    }, [viewport, events, height, variant]);

    return (
        <div
            ref={hostRef}
            className="pointer-events-none absolute left-0 top-0"
            style={{ width: viewport?.containerWidthPx ?? 0, height }}
        />
    );
}
