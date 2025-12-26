"use client";

import { useMemo } from "react";
import type { BandEventData } from "@/lib/stores/bandMirStore";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";

export type BandEventOverlayProps = {
    /** Event data for this band */
    eventData: BandEventData | null;
    /** Color for the event markers */
    color: string;
    /** Whether events are visible */
    visible: boolean;
    /** Viewport from the main WaveSurfer instance */
    viewport: WaveSurferViewport | null;
    /** Height of the overlay container */
    height: number;
};

/**
 * Renders event markers as vertical lines overlaid on band signal visualizations.
 *
 * Events are rendered as semi-transparent vertical lines with opacity based
 * on the event weight (stronger events are more visible).
 */
export function BandEventOverlay({
    eventData,
    color,
    visible,
    viewport,
    height,
}: BandEventOverlayProps) {
    // Filter events to visible time range
    const visibleEvents = useMemo(() => {
        if (!visible || !eventData || !viewport) return [];

        const { startTime, endTime } = viewport;
        return eventData.events.filter(
            (e) => e.time >= startTime && e.time <= endTime
        );
    }, [visible, eventData, viewport]);

    if (!visible || !viewport || visibleEvents.length === 0) {
        return null;
    }

    const { startTime, endTime } = viewport;
    const duration = endTime - startTime;

    if (duration <= 0) return null;

    return (
        <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: "100%", height }}
            preserveAspectRatio="none"
        >
            {visibleEvents.map((event, i) => {
                // Calculate x position as percentage
                const xPercent = ((event.time - startTime) / duration) * 100;

                // Opacity based on event weight (0.2 to 0.9)
                const opacity = 0.2 + event.weight * 0.7;

                return (
                    <line
                        key={`${eventData!.bandId}-event-${i}`}
                        x1={`${xPercent}%`}
                        x2={`${xPercent}%`}
                        y1={0}
                        y2={height}
                        stroke={color}
                        strokeWidth={2}
                        strokeOpacity={opacity}
                    />
                );
            })}
        </svg>
    );
}

/**
 * Compact event count badge for display in band labels.
 */
export function BandEventCountBadge({
    eventData,
    color,
    visible,
}: {
    eventData: BandEventData | null;
    color: string;
    visible: boolean;
}) {
    if (!visible || !eventData || eventData.events.length === 0) {
        return null;
    }

    return (
        <span
            className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium rounded-full"
            style={{
                backgroundColor: `${color}20`,
                color: color,
            }}
            title={`${eventData.events.length} events extracted`}
        >
            {eventData.events.length}
        </span>
    );
}
