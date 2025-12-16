"use client";

import { useEffect, useRef } from "react";

import type { WaveSurferViewport } from "./types";

export type SearchCandidateOverlayEvent = {
    timeSec: number;
    score: number; // [0,1]
    windowStartSec: number;
    windowEndSec: number;
    explain?: {
        groupLogit?: {
            logit: number;
            bias: number;
            mel: number;
            melForeground: number;
            melContrast?: number;
            onset: number;
            onsetForeground: number;
            onsetContrast?: number;
            mfcc?: number;
            mfccForeground?: number;
            mfccContrast?: number;
        };
    };
};

export type ViewportOverlaySearchCandidatesProps = {
    viewport: WaveSurferViewport | null;
    events: SearchCandidateOverlayEvent[];
    height?: number;

    selection?: { t0: number; t1: number } | null;

    onSelect?: (e: SearchCandidateOverlayEvent | null) => void;
    selectedTimeSec?: number | null;
};

function clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
}

/**
 * Candidate marker overlay with hover tooltip and click-to-select.
 *
 * We keep it DOM-based (like ViewportOverlayMarkers) to avoid coupling to WaveSurfer internals.
 */
export function ViewportOverlaySearchCandidates({
    viewport,
    events,
    height = 128,
    selection,
    onSelect,
    selectedTimeSec,
}: ViewportOverlaySearchCandidatesProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        host.replaceChildren();

        if (!viewport || events.length === 0) return;

        const span = viewport.endTime - viewport.startTime;
        const width = viewport.containerWidthPx;
        const pxPerSec = span > 0 && width > 0 ? width / span : viewport.minPxPerSec;
        if (!pxPerSec || pxPerSec <= 0) return;

        for (const e of events) {
            const x = (e.timeSec - viewport.startTime) * pxPerSec;
            if (x < 0 || x > width) continue;

            const score = clamp01(e.score);
            const opacity = 0.2 + 0.8 * score;

            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = `${x}px`;
            div.style.top = "0px";
            div.style.width = "3px";
            div.style.height = `${height}px`;
            div.style.background = `rgba(34, 197, 94, ${opacity.toFixed(3)})`; // green-500
            div.style.cursor = "pointer";
            div.style.pointerEvents = "auto";

            const isSelected = selectedTimeSec != null && Math.abs(selectedTimeSec - e.timeSec) < 1e-6;
            if (isSelected) {
                div.style.boxShadow = "0 0 0 2px rgba(34,197,94,0.35)";
            }

            // Tooltip
            const delta = selection ? e.timeSec - Math.min(selection.t0, selection.t1) : 0;
            div.title = `Score: ${score.toFixed(3)}\nTime: ${e.timeSec.toFixed(3)}s\nOffset: ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}s`;

            div.addEventListener("click", (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                onSelect?.(e);
            });

            host.appendChild(div);
        }
    }, [viewport, events, height, onSelect, selectedTimeSec, selection]);

    return (
        <div
            ref={hostRef}
            className="absolute left-0 top-0"
            style={{ width: viewport?.containerWidthPx ?? 0, height, pointerEvents: "none" }}
        />
    );
}
