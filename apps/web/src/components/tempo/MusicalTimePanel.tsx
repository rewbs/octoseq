"use client";

import { useCallback } from "react";
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
}: MusicalTimePanelProps) {
    const segments = structure?.segments ?? [];
    const hasSegments = segments.length > 0;

    const handleSplitAtMidpoint = useCallback(
        (segment: MusicalTimeSegment) => {
            const midpoint = (segment.startTime + segment.endTime) / 2;
            onSplitSegment?.(segment.id, midpoint);
        },
        [onSplitSegment]
    );

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

            {/* Coverage indicator */}
            <div className="p-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    Coverage: {calculateCoverage(segments, audioDuration).toFixed(1)}%
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden">
                    {segments.map((segment) => {
                        const left = (segment.startTime / audioDuration) * 100;
                        const width = ((segment.endTime - segment.startTime) / audioDuration) * 100;
                        const isSelected = segment.id === selectedSegmentId;
                        return (
                            <div
                                key={segment.id}
                                className="absolute h-1.5 rounded"
                                style={{
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    backgroundColor: isSelected
                                        ? "rgba(59, 130, 246, 0.9)"
                                        : "rgba(34, 197, 94, 0.7)",
                                }}
                            />
                        );
                    })}
                </div>
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
