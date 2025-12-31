"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { generateBeatTimes } from "@octoseq/mir";
import type { TempoHypothesis, PhaseHypothesis } from "@octoseq/mir";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";

/** Threshold for switching between notch and full line rendering */
const NOTCH_THRESHOLD = 16;

export type GenericBeatGridOverlayProps = {
    /** Viewport for time-to-pixel mapping (time range) */
    viewport: WaveSurferViewport | null;
    /** Audio duration in seconds */
    audioDuration: number;
    /** Container height in pixels */
    height: number;
    /** Additional candidate hypotheses to display (with their computed phase) */
    candidateHypotheses?: Array<{
        hypothesis: TempoHypothesis;
        phase: PhaseHypothesis;
        color: string;
    }>;
};

/**
 * Generic beat grid overlay that can be used in any viewport-synchronized viewer.
 *
 * Renders:
 * - Active beat grid from beatGridStore (green if locked, orange if provisional)
 * - Optional candidate hypothesis grids with custom colors
 *
 * Designed to be positioned absolutely over any visualization container.
 */
export function GenericBeatGridOverlay({
    viewport,
    audioDuration,
    height,
    candidateHypotheses = [],
}: GenericBeatGridOverlayProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // Get active beat grid from store
    const activeBeatGrid = useBeatGridStore((s) => s.activeBeatGrid);
    const isVisible = useBeatGridStore((s) => s.isVisible);

    // Get selected hypothesis for provisional grid when no locked grid
    const selectedHypothesis = useBeatGridStore((s) => s.selectedHypothesis);
    const phaseHypotheses = useBeatGridStore((s) => s.phaseHypotheses);
    const activePhaseIndex = useBeatGridStore((s) => s.activePhaseIndex);
    const userNudge = useBeatGridStore((s) => s.userNudge);
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
        // Initial measurement
        setContainerWidth(host.offsetWidth);

        return () => observer.disconnect();
    }, []);

    // Compute beat times for the active beat grid
    const activeBeatTimes = useMemo(() => {
        if (!activeBeatGrid || audioDuration <= 0) return [];
        return generateBeatTimes(
            activeBeatGrid.bpm,
            activeBeatGrid.phaseOffset,
            activeBeatGrid.userNudge,
            audioDuration
        );
    }, [activeBeatGrid, audioDuration]);

    // Compute beat times for the provisional grid (selected hypothesis without locked grid)
    const provisionalBeatTimes = useMemo(() => {
        // Only compute if we have a selected hypothesis but no locked active grid
        if (activeBeatGrid || !selectedHypothesis || audioDuration <= 0) return [];
        const activePhase = phaseHypotheses[activePhaseIndex];
        if (!activePhase) return [];
        return generateBeatTimes(
            selectedHypothesis.bpm,
            activePhase.phaseOffset,
            userNudge,
            audioDuration
        );
    }, [activeBeatGrid, selectedHypothesis, phaseHypotheses, activePhaseIndex, userNudge, audioDuration]);

    // Compute beat times for candidate hypotheses
    const candidateBeatTimesMap = useMemo(() => {
        const map = new Map<string, number[]>();
        for (const { hypothesis, phase } of candidateHypotheses) {
            if (audioDuration <= 0) continue;
            const times = generateBeatTimes(
                hypothesis.bpm,
                phase.phaseOffset,
                0, // No user nudge for candidates
                audioDuration
            );
            map.set(hypothesis.id, times);
        }
        return map;
    }, [candidateHypotheses, audioDuration]);

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
        const primaryBeatTimes = activeBeatGrid ? activeBeatTimes : provisionalBeatTimes;
        const visibleBeatCount = primaryBeatTimes.filter(
            (t) => t >= viewport.startTime && t <= viewport.endTime
        ).length;
        const useNotches = visibleBeatCount > NOTCH_THRESHOLD;
        const notchHeight = Math.round(height / 6);

        // Helper to render a vertical line (full or notch)
        const renderLine = (
            time: number,
            color: string,
            lineWidth: number,
            opacity: number = 1,
            zIndex: number = 1,
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
                topDiv.style.opacity = String(opacity);
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
                div.style.background = color;
                div.style.opacity = String(opacity);
                div.style.pointerEvents = "none";
                div.style.zIndex = String(zIndex);
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

        // 1. Render candidate hypothesis grids (behind active grid)
        for (const { hypothesis, color } of candidateHypotheses) {
            const times = candidateBeatTimesMap.get(hypothesis.id) ?? [];
            for (const time of times) {
                if (time < visibleStart || time > visibleEnd) continue;
                renderLine(time, color, 1, 0.4, 0, renderMode);
            }
        }

        // 2. Render sub-beats (only when not in notch mode and subBeatDivision > 1)
        if (!useNotches && subBeatDivision > 1) {
            const beatTimesForSubBeats = activeBeatGrid ? activeBeatTimes : provisionalBeatTimes;
            for (let i = 0; i < beatTimesForSubBeats.length - 1; i++) {
                const beatTime = beatTimesForSubBeats[i];
                const nextBeatTime = beatTimesForSubBeats[i + 1];
                if (beatTime === undefined || nextBeatTime === undefined) continue;
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

        // 3. Render active beat grid (on top)
        if (activeBeatGrid && activeBeatTimes.length > 0) {
            for (const time of activeBeatTimes) {
                if (time < visibleStart || time > visibleEnd) continue;

                if (activeBeatGrid.isLocked) {
                    // Locked: solid green line
                    renderLine(time, "rgba(34, 197, 94, 0.8)", 2, 1, 1, renderMode);
                } else {
                    // Provisional: thinner orange line
                    renderLine(time, "rgba(251, 146, 60, 0.7)", 1, 1, 1, renderMode);
                }
            }
        }

        // 4. Render provisional grid (selected hypothesis, not yet locked)
        if (provisionalBeatTimes.length > 0) {
            for (const time of provisionalBeatTimes) {
                if (time < visibleStart || time > visibleEnd) continue;
                // Provisional: thinner orange line
                renderLine(time, "rgba(251, 146, 60, 0.7)", 1, 1, 1, renderMode);
            }
        }
    }, [
        viewport,
        activeBeatTimes,
        provisionalBeatTimes,
        height,
        isVisible,
        activeBeatGrid,
        candidateHypotheses,
        candidateBeatTimesMap,
        containerWidth,
        subBeatDivision,
    ]);

    // Don't render if not visible or no grids to show
    const hasAnyGrid = activeBeatGrid || selectedHypothesis || candidateHypotheses.length > 0;
    if (!isVisible || !hasAnyGrid) {
        return null;
    }

    return (
        <div
            ref={hostRef}
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height }}
        />
    );
}
