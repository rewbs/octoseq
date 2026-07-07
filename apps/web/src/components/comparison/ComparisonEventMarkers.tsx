"use client";

import { useMemo } from "react";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { DisplayEvent } from "@/lib/streams";

export type ComparisonEventMarkersProps = {
  /** Uniform event list (from toDisplayEvents). */
  events: DisplayEvent[];
  /** Marker color (hex). */
  color: string;
  viewport: WaveSurferViewport | null;
  /** Row height in CSS pixels. */
  height: number;
};

/**
 * Vertical event markers for one events-shaped analysis result, following
 * BandEventOverlay: semi-transparent lines whose opacity scales with event
 * strength (0.2–0.9).
 */
export function ComparisonEventMarkers({
  events,
  color,
  viewport,
  height,
}: ComparisonEventMarkersProps) {
  const visibleEvents = useMemo(() => {
    if (!viewport) return [];
    const { startTime, endTime } = viewport;
    return events.filter((e) => e.time >= startTime && e.time <= endTime);
  }, [events, viewport]);

  if (!viewport || visibleEvents.length === 0) {
    return null;
  }

  const { startTime, endTime } = viewport;
  const duration = endTime - startTime;
  if (duration <= 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ width: "100%", height }}
      preserveAspectRatio="none"
    >
      {visibleEvents.map((event) => {
        const xPercent = ((event.time - startTime) / duration) * 100;
        const strength = Math.max(0, Math.min(1, event.strength));
        const opacity = 0.2 + strength * 0.7;

        return (
          <line
            key={event.index}
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
