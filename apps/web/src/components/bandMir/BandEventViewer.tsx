"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { BandEventsResult, BandEventFunctionId } from "@octoseq/mir";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { getBandColorHex } from "@/lib/bandColors";
import { useBandMirStore, useFrequencyBandStore } from "@/lib/stores";
import { GenericBeatGridOverlay } from "@/components/beatGrid/GenericBeatGridOverlay";

// ----------------------------
// Types
// ----------------------------

export type BandEventViewerProps = {
    /** The band event function to show results for */
    fn: BandEventFunctionId;
    /** Viewport from the main WaveSurfer instance */
    viewport: WaveSurferViewport | null;
    /** Shared mirrored cursor (hover or playhead) to display */
    cursorTimeSec?: number | null;
    /** Notify parent when this view is hovered */
    onCursorTimeChange?: (timeSec: number | null) => void;
    /** Whether to show beat grid overlay (default: false) */
    showBeatGrid?: boolean;
    /** Audio duration in seconds (required if showBeatGrid is true) */
    audioDuration?: number;
};

type BandEventRowProps = {
    result: BandEventsResult;
    bandIndex: number;
    viewport: WaveSurferViewport | null;
    cursorTimeSec?: number | null;
    onCursorTimeChange?: (timeSec: number | null) => void;
    showBeatGrid?: boolean;
    audioDuration?: number;
};

// ----------------------------
// Single Band Event Row
// ----------------------------

const BAND_ROW_HEIGHT = 40;

function BandEventRow({
    result,
    bandIndex,
    viewport,
    cursorTimeSec,
    onCursorTimeChange,
    showBeatGrid = false,
    audioDuration = 0,
}: BandEventRowProps) {
    const color = getBandColorHex(bandIndex);
    const hasWarnings = result.diagnostics.warnings.length > 0;

    // Filter events to visible range
    const visibleEvents = useMemo(() => {
        if (!viewport) return [];
        const { startTime, endTime } = viewport;
        return result.events.filter(
            (e) => e.time >= startTime && e.time <= endTime
        );
    }, [result.events, viewport]);

    const handleMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (!viewport) return;
        const rect = evt.currentTarget.getBoundingClientRect();
        const visibleDuration = viewport.endTime - viewport.startTime;
        if (visibleDuration <= 0 || rect.width <= 0) return;
        const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
        const t = viewport.startTime + (x / rect.width) * visibleDuration;
        onCursorTimeChange?.(Math.max(0, t));
    };

    const handleMouseLeave = () => {
        onCursorTimeChange?.(null);
    };

    const startTime = viewport?.startTime ?? 0;
    const endTime = viewport?.endTime ?? 0;
    const duration = endTime - startTime;

    return (
        <div className="relative border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
            {/* Event markers */}
            <div
                className="w-full relative bg-zinc-50 dark:bg-zinc-900"
                style={{ height: BAND_ROW_HEIGHT }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            >
                {viewport && duration > 0 && (
                    <svg
                        className="absolute inset-0 w-full h-full"
                        preserveAspectRatio="none"
                    >
                        {/* Event markers as vertical lines */}
                        {visibleEvents.map((event, i) => {
                            const xPercent = ((event.time - startTime) / duration) * 100;
                            // Opacity based on event weight (0.3 to 1.0)
                            const opacity = 0.3 + (event.weight ?? 1) * 0.7;
                            return (
                                <line
                                    key={`${result.bandId}-event-${i}`}
                                    x1={`${xPercent}%`}
                                    x2={`${xPercent}%`}
                                    y1={4}
                                    y2={BAND_ROW_HEIGHT - 4}
                                    stroke={color}
                                    strokeWidth={2}
                                    strokeOpacity={opacity}
                                    strokeLinecap="round"
                                />
                            );
                        })}

                        {/* Cursor line */}
                        {cursorTimeSec != null &&
                            cursorTimeSec >= startTime &&
                            cursorTimeSec <= endTime && (
                                <line
                                    x1={`${((cursorTimeSec - startTime) / duration) * 100}%`}
                                    x2={`${((cursorTimeSec - startTime) / duration) * 100}%`}
                                    y1={0}
                                    y2={BAND_ROW_HEIGHT}
                                    stroke="rgba(239, 68, 68, 0.8)"
                                    strokeWidth={1}
                                />
                            )}
                    </svg>
                )}

                {showBeatGrid && audioDuration > 0 && (
                    <GenericBeatGridOverlay
                        viewport={viewport}
                        audioDuration={audioDuration}
                        height={BAND_ROW_HEIGHT}
                    />
                )}
            </div>

            {/* Band label - floating overlay */}
            <div
                className="absolute left-1 top-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium backdrop-blur-sm"
                style={{ backgroundColor: `${color}20`, color }}
            >
                <span className="truncate max-w-20" title={result.bandLabel}>
                    {result.bandLabel}
                </span>
                <span
                    className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium rounded-full"
                    style={{ backgroundColor: `${color}30` }}
                    title={`${result.events.length} events`}
                >
                    {result.events.length}
                </span>
                {hasWarnings && (
                    <span title={result.diagnostics.warnings.join("; ")}>
                        <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    </span>
                )}
            </div>
        </div>
    );
}

// ----------------------------
// Function Label Helper
// ----------------------------

function getFunctionLabel(fn: BandEventFunctionId): string {
    switch (fn) {
        case "bandOnsetPeaks":
            return "Onset Peaks";
        case "bandBeatCandidates":
            return "Beat Candidates";
        default:
            return fn;
    }
}

// ----------------------------
// Main Component
// ----------------------------

export function BandEventViewer({
    fn,
    viewport,
    cursorTimeSec,
    onCursorTimeChange,
    showBeatGrid = false,
    audioDuration = 0,
}: BandEventViewerProps) {
    const typedEventExpanded = useBandMirStore((s) => s.typedEventsExpanded);
    const setTypedEventExpanded = useBandMirStore((s) => s.setTypedEventsExpanded);
    const typedEventCache = useBandMirStore((s) => s.typedEventCache);

    const structure = useFrequencyBandStore((s) => s.structure);

    // Get results for this function
    const results = useMemo(() => {
        const entries: BandEventsResult[] = [];
        for (const [key, result] of typedEventCache.entries()) {
            if (key.endsWith(`:${fn}`)) {
                entries.push(result);
            }
        }
        return entries;
    }, [typedEventCache, fn]);

    // Sort by band sortOrder
    const sortedResults = useMemo(() => {
        return [...results].sort((a, b) => {
            const bandA = structure?.bands.find((band) => band.id === a.bandId);
            const bandB = structure?.bands.find((band) => band.id === b.bandId);
            return (bandA?.sortOrder ?? 0) - (bandB?.sortOrder ?? 0);
        });
    }, [results, structure]);

    // Get band indices for coloring
    const bandIndexMap = new Map<string, number>();
    structure?.bands.forEach((band, index) => {
        bandIndexMap.set(band.id, index);
    });

    // Total event count across all bands
    const totalEvents = useMemo(() => {
        return sortedResults.reduce((sum, r) => sum + r.events.length, 0);
    }, [sortedResults]);

    if (sortedResults.length === 0) {
        return null;
    }

    return (
        <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 mt-2 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setTypedEventExpanded(!typedEventExpanded)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
                {typedEventExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                ) : (
                    <ChevronRight className="w-4 h-4" />
                )}
                <span>
                    Band {getFunctionLabel(fn)} ({sortedResults.length} bands, {totalEvents} events)
                </span>
            </button>

            {/* Band events */}
            {typedEventExpanded && (
                <div className="border-t border-zinc-200 dark:border-zinc-800">
                    {sortedResults.map((result) => (
                        <BandEventRow
                            key={`${result.bandId}:${result.fn}`}
                            result={result}
                            bandIndex={bandIndexMap.get(result.bandId) ?? 0}
                            viewport={viewport}
                            cursorTimeSec={cursorTimeSec}
                            onCursorTimeChange={onCursorTimeChange}
                            showBeatGrid={showBeatGrid}
                            audioDuration={audioDuration}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
