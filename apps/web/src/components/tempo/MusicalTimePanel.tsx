"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type { MusicalTimeSegment, MusicalTimeStructure } from "@octoseq/mir";

export type MusicalTimePanelProps = {
    /** The musical time structure (null if not yet authored). */
    structure: MusicalTimeStructure | null;
    /** Currently selected segment ID. */
    selectedSegmentId: string | null;
    /** Audio duration in seconds. */
    audioDuration: number;
    /** Callbacks */
    onSelectSegment?: (id: string | null) => void;
    onRemoveSegment?: (id: string) => void;
    onSplitSegment?: (id: string, splitTime: number) => void;
    onClearAll?: () => void;
    /** Called when a segment boundary is dragged. Updates endTime of segment and startTime of next segment. */
    onUpdateBoundary?: (segmentId: string, newEndTime: number) => void;
};

/**
 * Format time in seconds to MM:SS.mmm format.
 */
function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
}

/**
 * Panel for viewing and managing authored musical time segments.
 *
 * Shows:
 * - List of segments with BPM and time range
 * - Segment selection
 * - Actions: Remove, Split (future), Clear All
 */
export function MusicalTimePanel({
    structure,
    selectedSegmentId,
    audioDuration,
    onSelectSegment,
    onRemoveSegment,
    onSplitSegment,
    onClearAll,
    onUpdateBoundary,
}: MusicalTimePanelProps) {
    const segments = structure?.segments ?? [];
    const hasSegments = segments.length > 0;

    // Drag state for segment boundaries
    const coverageBarRef = useRef<HTMLDivElement>(null);
    const [draggingBoundaryIndex, setDraggingBoundaryIndex] = useState<number | null>(null);
    const [dragPreviewTime, setDragPreviewTime] = useState<number | null>(null);

    const handleSplitAtMidpoint = useCallback(
        (segment: MusicalTimeSegment) => {
            const midpoint = (segment.startTime + segment.endTime) / 2;
            onSplitSegment?.(segment.id, midpoint);
        },
        [onSplitSegment]
    );

    // Convert mouse position to time
    const getTimeFromMouseEvent = useCallback(
        (clientX: number): number => {
            const bar = coverageBarRef.current;
            if (!bar || audioDuration <= 0) return 0;
            const rect = bar.getBoundingClientRect();
            const x = clientX - rect.left;
            const fraction = Math.max(0, Math.min(1, x / rect.width));
            return fraction * audioDuration;
        },
        [audioDuration]
    );

    // Handle boundary drag start
    const handleBoundaryDragStart = useCallback(
        (e: React.MouseEvent, boundaryIndex: number) => {
            e.preventDefault();
            e.stopPropagation();
            setDraggingBoundaryIndex(boundaryIndex);
            setDragPreviewTime(getTimeFromMouseEvent(e.clientX));
        },
        [getTimeFromMouseEvent]
    );

    // Handle mouse move during drag
    useEffect(() => {
        if (draggingBoundaryIndex === null) return;

        const handleMouseMove = (e: MouseEvent) => {
            const newTime = getTimeFromMouseEvent(e.clientX);
            // Constrain to valid range (between prev segment start and next segment end)
            const segment = segments[draggingBoundaryIndex];
            const nextSegment = segments[draggingBoundaryIndex + 1];
            if (!segment || !nextSegment) return;

            // Minimum segment duration of 0.5 seconds
            const minDuration = 0.5;
            const minTime = segment.startTime + minDuration;
            const maxTime = nextSegment.endTime - minDuration;
            const constrainedTime = Math.max(minTime, Math.min(maxTime, newTime));
            setDragPreviewTime(constrainedTime);
        };

        const handleMouseUp = () => {
            if (draggingBoundaryIndex !== null && dragPreviewTime !== null) {
                const segment = segments[draggingBoundaryIndex];
                if (segment && onUpdateBoundary) {
                    onUpdateBoundary(segment.id, dragPreviewTime);
                }
            }
            setDraggingBoundaryIndex(null);
            setDragPreviewTime(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [draggingBoundaryIndex, dragPreviewTime, segments, getTimeFromMouseEvent, onUpdateBoundary]);

    // Compute display positions (use preview during drag)
    const getDisplaySegments = useCallback(() => {
        if (draggingBoundaryIndex === null || dragPreviewTime === null) {
            return segments;
        }
        // Create modified segments for display during drag
        return segments.map((seg, idx) => {
            if (idx === draggingBoundaryIndex) {
                return { ...seg, endTime: dragPreviewTime };
            }
            if (idx === draggingBoundaryIndex + 1) {
                return { ...seg, startTime: dragPreviewTime };
            }
            return seg;
        });
    }, [segments, draggingBoundaryIndex, dragPreviewTime]);

    if (!hasSegments) {
        return (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="text-sm font-medium mb-2">Musical Time</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    No musical time authored yet.
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                    Lock a beat grid and promote it to author musical time.
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                <div className="text-sm font-medium">
                    Musical Time
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-2">
                        {segments.length} segment{segments.length !== 1 ? "s" : ""}
                    </span>
                </div>
                {hasSegments && (
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-xs text-red-500 hover:text-red-600 hover:underline transition-colors"
                    >
                        Clear All
                    </button>
                )}
            </div>

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-48 overflow-y-auto">
                {segments.map((segment) => {
                    const isSelected = segment.id === selectedSegmentId;
                    const duration = segment.endTime - segment.startTime;
                    const beatCount = Math.floor(duration / (60 / segment.bpm));

                    return (
                        <button
                            type="button"
                            key={segment.id}
                            className={`w-full text-left px-3 py-2 transition-colors ${
                                isSelected
                                    ? "bg-blue-50 dark:bg-blue-900/30"
                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                            }`}
                            onClick={() => onSelectSegment?.(isSelected ? null : segment.id)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {/* BPM badge */}
                                    <div className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">
                                        {segment.bpm.toFixed(1)}
                                        <span className="text-xs font-normal ml-0.5">BPM</span>
                                    </div>

                                    {/* Time range */}
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                                    </div>

                                    {/* Beat count */}
                                    <div className="text-xs text-zinc-400 dark:text-zinc-500">
                                        ~{beatCount} beats
                                    </div>
                                </div>

                                {/* Confidence */}
                                {segment.confidence !== undefined && (
                                    <div className="text-xs text-zinc-400">
                                        {(segment.confidence * 100).toFixed(0)}%
                                    </div>
                                )}
                            </div>

                            {/* Actions (shown when selected) */}
                            {isSelected && (
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSplitAtMidpoint(segment);
                                        }}
                                        className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                    >
                                        Split at midpoint
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveSegment?.(segment.id);
                                        }}
                                        className="px-2 py-0.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                    >
                                        Remove
                                    </button>
                                    <div className="text-xs text-zinc-400 ml-auto">
                                        {segment.provenance.source === "promoted_from_hypothesis"
                                            ? "Promoted from hypothesis"
                                            : segment.provenance.source}
                                    </div>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Coverage indicator with draggable boundaries */}
            <div className="p-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    Coverage: {calculateCoverage(segments, audioDuration).toFixed(1)}%
                    {draggingBoundaryIndex !== null && dragPreviewTime !== null && (
                        <span className="ml-2 text-blue-500">
                            Boundary: {formatTime(dragPreviewTime)}
                        </span>
                    )}
                </div>
                <div
                    ref={coverageBarRef}
                    className="relative h-4 bg-zinc-200 dark:bg-zinc-700 rounded cursor-default select-none"
                >
                    {/* Segment fills */}
                    {getDisplaySegments().map((segment, idx) => {
                        const left = (segment.startTime / audioDuration) * 100;
                        const width = ((segment.endTime - segment.startTime) / audioDuration) * 100;
                        const isSelected = segment.id === selectedSegmentId;
                        return (
                            <div
                                key={segment.id}
                                className="absolute h-full transition-all duration-75"
                                style={{
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    backgroundColor: isSelected
                                        ? "rgba(59, 130, 246, 0.7)"
                                        : "rgba(34, 197, 94, 0.5)",
                                }}
                                onClick={() => onSelectSegment?.(isSelected ? null : segment.id)}
                            />
                        );
                    })}

                    {/* Draggable boundary handles (between segments, not at start/end) */}
                    {segments.length > 1 &&
                        segments.slice(0, -1).map((segment, idx) => {
                            const boundaryTime =
                                draggingBoundaryIndex === idx && dragPreviewTime !== null
                                    ? dragPreviewTime
                                    : segment.endTime;
                            const position = (boundaryTime / audioDuration) * 100;
                            const isDragging = draggingBoundaryIndex === idx;

                            return (
                                <div
                                    key={`boundary-${segment.id}`}
                                    className={`absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize z-10 group ${
                                        isDragging ? "z-20" : ""
                                    }`}
                                    style={{ left: `${position}%` }}
                                    onMouseDown={(e) => handleBoundaryDragStart(e, idx)}
                                >
                                    {/* Visual handle */}
                                    <div
                                        className={`absolute top-0 left-1/2 -translate-x-1/2 h-full w-1 transition-all ${
                                            isDragging
                                                ? "bg-blue-500 w-1.5"
                                                : "bg-zinc-400 dark:bg-zinc-500 group-hover:bg-blue-400 group-hover:w-1.5"
                                        }`}
                                    />
                                    {/* Wider hit area indicator on hover */}
                                    <div
                                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-opacity ${
                                            isDragging
                                                ? "bg-blue-500 opacity-100"
                                                : "bg-blue-400 opacity-0 group-hover:opacity-100"
                                        }`}
                                    />
                                </div>
                            );
                        })}
                </div>
                {segments.length > 1 && (
                    <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                        Drag boundaries to adjust segment timing
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Calculate the percentage of audio duration covered by segments.
 */
function calculateCoverage(segments: MusicalTimeSegment[], audioDuration: number): number {
    if (audioDuration <= 0 || segments.length === 0) return 0;

    let coveredDuration = 0;
    for (const segment of segments) {
        coveredDuration += segment.endTime - segment.startTime;
    }

    return (coveredDuration / audioDuration) * 100;
}
