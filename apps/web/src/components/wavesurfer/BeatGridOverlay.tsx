"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { WaveSurferViewport } from "./types";
import { generateBeatTimes, generateSegmentBeatTimes } from "@octoseq/mir";
import type { BeatGrid, MusicalTimeSegment } from "@octoseq/mir";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";

/** Threshold for switching between notch and full line rendering */
const NOTCH_THRESHOLD = 16;

export type BeatGridOverlayProps = {
    viewport: WaveSurferViewport | null;
    beatGrid: BeatGrid | null;
    audioDuration: number;
    height?: number;
    isVisible?: boolean;
    /** Musical time segments for rendering section boundaries and committed beat grids. */
    musicalTimeSegments?: MusicalTimeSegment[];
    /** Currently selected segment ID (for highlighting). */
    selectedSegmentId?: string | null;
};

/**
 * Renders vertical beat grid lines over the waveform viewport.
 *
 * Uses the same coordinate mapping as ViewportOverlayMarkers:
 *   x = (time - viewport.startTime) * pxPerSec
 *
 * Visual styles:
 * - Locked grids: solid green lines (2px)
 * - Provisional grids: dashed orange lines (1px)
 */
export function BeatGridOverlay({
    viewport,
    beatGrid,
    audioDuration,
    height = 128,
    isVisible = true,
    musicalTimeSegments = [],
    selectedSegmentId,
}: BeatGridOverlayProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // Get sub-beat division from store
    const subBeatDivision = useBeatGridStore((s) => s.subBeatDivision);

    // Measure actual container width
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(host);
        setContainerWidth(host.offsetWidth);

        return () => observer.disconnect();
    }, []);

    // Compute beat times for the provisional beat grid
    const provisionalBeatTimes = useMemo(() => {
        if (!beatGrid || audioDuration <= 0) return [];
        return generateBeatTimes(
            beatGrid.bpm,
            beatGrid.phaseOffset,
            beatGrid.userNudge,
            audioDuration
        );
    }, [beatGrid, audioDuration]);

    // Compute beat times for committed musical time segments
    const committedBeatTimesMap = useMemo(() => {
        const map = new Map<string, number[]>();
        for (const segment of musicalTimeSegments) {
            map.set(segment.id, generateSegmentBeatTimes(segment));
        }
        return map;
    }, [musicalTimeSegments]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Clear existing lines
        host.replaceChildren();

        if (!viewport || !isVisible) return;

        const span = viewport.endTime - viewport.startTime;
        // Use measured containerWidth if available, otherwise fall back to viewport.containerWidthPx
        const width = containerWidth > 0 ? containerWidth : viewport.containerWidthPx;
        if (width <= 0) return;
        const pxPerSec = span > 0 && width > 0 ? width / span : viewport.minPxPerSec;
        if (!pxPerSec || pxPerSec <= 0) return;

        // Only render within the visible viewport (with small margin)
        const margin = span * 0.1;
        const visibleStart = viewport.startTime - margin;
        const visibleEnd = viewport.endTime + margin;

        // Count visible beats to determine rendering mode
        const visibleBeatCount = provisionalBeatTimes.filter(
            (t) => t >= viewport.startTime && t <= viewport.endTime
        ).length;
        const useNotches = visibleBeatCount > NOTCH_THRESHOLD;
        const notchHeight = Math.round(height / 6);

        // Helper to render a vertical line (full or notch)
        const renderLine = (
            time: number,
            color: string,
            lineWidth: number,
            isDashed = false,
            zIndex = 1,
            mode: "full" | "notch" = "full"
        ) => {
            const x = (time - viewport.startTime) * pxPerSec;
            if (x < -10 || x > width + 10) return;

            if (mode === "notch") {
                // Render top notch only
                const topDiv = document.createElement("div");
                topDiv.style.position = "absolute";
                topDiv.style.left = `${x}px`;
                topDiv.style.top = "0px";
                topDiv.style.height = `${notchHeight}px`;
                topDiv.style.width = `${lineWidth}px`;
                topDiv.style.background = color;
                topDiv.style.pointerEvents = "none";
                topDiv.style.zIndex = String(zIndex);
                host.appendChild(topDiv);
            } else {
                const div = document.createElement("div");
                div.style.position = "absolute";
                div.style.left = `${x}px`;
                div.style.top = "0px";
                div.style.height = `${height}px`;
                div.style.width = `${lineWidth}px`;
                div.style.background = isDashed ? "transparent" : color;
                div.style.pointerEvents = "none";
                div.style.zIndex = String(zIndex);

                if (isDashed) {
                    div.style.borderLeft = `${lineWidth}px dashed ${color}`;
                }

                host.appendChild(div);
            }
        };

        // Helper to render sub-beat lines (dotted)
        const renderSubBeatLine = (time: number, zIndex: number = 0) => {
            const x = (time - viewport.startTime) * pxPerSec;
            if (x < -10 || x > width + 10) return;

            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = `${x}px`;
            div.style.top = "0px";
            div.style.height = `${height}px`;
            div.style.width = "1px";
            div.style.background = "repeating-linear-gradient(to bottom, rgba(156, 163, 175, 0.5) 0px, rgba(156, 163, 175, 0.5) 2px, transparent 2px, transparent 6px)";
            div.style.pointerEvents = "none";
            div.style.zIndex = String(zIndex);
            host.appendChild(div);
        };

        const renderMode = useNotches ? "notch" : "full";

        // Helper to render a segment boundary marker
        const renderSegmentBoundary = (
            time: number,
            isSelected: boolean,
            isStart: boolean
        ) => {
            const x = (time - viewport.startTime) * pxPerSec;
            if (x < -10 || x > width + 10) return;

            // Boundary line
            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = `${x}px`;
            div.style.top = "0px";
            div.style.height = `${height}px`;
            div.style.width = isSelected ? "3px" : "2px";
            div.style.background = isSelected
                ? "rgba(59, 130, 246, 0.9)" // blue-500
                : "rgba(139, 92, 246, 0.7)"; // violet-500
            div.style.pointerEvents = "none";
            div.style.zIndex = "10";

            host.appendChild(div);

            // Small marker triangle at the top
            const marker = document.createElement("div");
            marker.style.position = "absolute";
            marker.style.left = isStart ? `${x}px` : `${x - 6}px`;
            marker.style.top = "0px";
            marker.style.width = "0";
            marker.style.height = "0";
            marker.style.borderTop = "8px solid " + (isSelected
                ? "rgba(59, 130, 246, 0.9)"
                : "rgba(139, 92, 246, 0.7)");
            marker.style.borderLeft = isStart ? "0" : "6px solid transparent";
            marker.style.borderRight = isStart ? "6px solid transparent" : "0";
            marker.style.pointerEvents = "none";
            marker.style.zIndex = "11";

            host.appendChild(marker);
        };

        // 1. Render sub-beats (only when not in notch mode and subBeatDivision > 1)
        if (!useNotches && subBeatDivision > 1 && beatGrid && provisionalBeatTimes.length > 0) {
            for (let i = 0; i < provisionalBeatTimes.length - 1; i++) {
                const beatTime = provisionalBeatTimes[i];
                const nextBeatTime = provisionalBeatTimes[i + 1];
                if (beatTime === undefined || nextBeatTime === undefined) continue;

                // Skip if this beat falls within a committed segment
                const inCommittedSegment = musicalTimeSegments.some(
                    seg => beatTime >= seg.startTime && beatTime < seg.endTime
                );
                if (inCommittedSegment) continue;

                const beatInterval = nextBeatTime - beatTime;
                const subBeatInterval = beatInterval / subBeatDivision;

                // Render sub-beats between this beat and the next
                for (let j = 1; j < subBeatDivision; j++) {
                    const subBeatTime = beatTime + j * subBeatInterval;
                    if (subBeatTime < visibleStart || subBeatTime > visibleEnd) continue;
                    renderSubBeatLine(subBeatTime, 0);
                }
            }
        }

        // 2. Render committed segment boundaries and beats
        for (const segment of musicalTimeSegments) {
            const isSelected = segment.id === selectedSegmentId;

            // Render segment boundaries if visible
            if (segment.startTime >= visibleStart && segment.startTime <= visibleEnd) {
                renderSegmentBoundary(segment.startTime, isSelected, true);
            }
            if (segment.endTime >= visibleStart && segment.endTime <= visibleEnd) {
                renderSegmentBoundary(segment.endTime, isSelected, false);
            }

            // Render committed beats for this segment
            const beatTimes = committedBeatTimesMap.get(segment.id) ?? [];
            for (const time of beatTimes) {
                if (time < visibleStart || time > visibleEnd) continue;
                // Committed beats: solid blue-ish green lines
                renderLine(
                    time,
                    isSelected
                        ? "rgba(34, 197, 94, 1)" // green-500 solid
                        : "rgba(34, 197, 94, 0.6)", // green-500 semi-transparent
                    isSelected ? 2 : 1,
                    false,
                    2,
                    renderMode
                );
            }
        }

        // 3. Render provisional beat grid (if any and not overlapping committed segments)
        if (beatGrid && provisionalBeatTimes.length > 0) {
            for (const time of provisionalBeatTimes) {
                if (time < visibleStart || time > visibleEnd) continue;

                // Skip if this time falls within a committed segment
                const inCommittedSegment = musicalTimeSegments.some(
                    seg => time >= seg.startTime && time < seg.endTime
                );
                if (inCommittedSegment) continue;

                // Color based on locked status
                if (beatGrid.isLocked) {
                    // Locked: solid green line
                    renderLine(time, "rgba(34, 197, 94, 0.8)", 2, false, 1, renderMode);
                } else {
                    // Provisional: thinner orange line
                    renderLine(time, "rgba(251, 146, 60, 0.7)", 1, false, 1, renderMode);
                }
            }
        }
    }, [
        viewport,
        provisionalBeatTimes,
        height,
        isVisible,
        beatGrid,
        musicalTimeSegments,
        committedBeatTimesMap,
        selectedSegmentId,
        containerWidth,
        subBeatDivision,
    ]);

    // Show if visible and either have a beat grid or musical time segments
    if (!isVisible || (!beatGrid && musicalTimeSegments.length === 0)) return null;

    return (
        <div
            ref={hostRef}
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height }}
        />
    );
}
