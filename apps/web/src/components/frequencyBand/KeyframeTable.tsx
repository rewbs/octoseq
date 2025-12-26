"use client";

import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FrequencyBand, FrequencyKeyframe } from "@octoseq/mir";
import { keyframesFromBand, updateKeyframe, removeKeyframe, splitBandSegmentAt } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type KeyframeTableProps = {
    /** The selected band to edit. */
    band: FrequencyBand;

    /** Currently hovered keyframe time. */
    hoveredKeyframeTime: number | null;

    /** Audio duration for validation. */
    audioDuration: number;

    /** Callback when band is updated. */
    onBandUpdate: (updates: Partial<FrequencyBand>) => void;

    /** Callback when keyframe is hovered. */
    onKeyframeHover?: (time: number | null) => void;
};

type EditingCell = {
    keyframeIndex: number;
    field: "time" | "lowHz" | "highHz";
};

// ----------------------------
// Helpers
// ----------------------------

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
}

function parseTime(input: string): number | null {
    // Try to parse MM:SS.ss format
    const match = input.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (match) {
        const mins = parseInt(match[1]!, 10);
        const secs = parseFloat(match[2]!);
        return mins * 60 + secs;
    }
    // Try to parse as plain seconds
    const num = parseFloat(input);
    return isNaN(num) ? null : num;
}

function formatHz(hz: number): string {
    return hz >= 1000 ? `${(hz / 1000).toFixed(2)}k` : hz.toFixed(0);
}

function parseHz(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.endsWith("k")) {
        const num = parseFloat(trimmed.slice(0, -1));
        return isNaN(num) ? null : num * 1000;
    }
    const num = parseFloat(trimmed);
    return isNaN(num) ? null : num;
}

// ----------------------------
// Component
// ----------------------------

export function KeyframeTable({
    band,
    hoveredKeyframeTime,
    audioDuration,
    onBandUpdate,
    onKeyframeHover,
}: KeyframeTableProps) {
    const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
    const [editValue, setEditValue] = useState("");

    const keyframes = keyframesFromBand(band);

    const handleStartEdit = useCallback(
        (keyframeIndex: number, field: "time" | "lowHz" | "highHz", currentValue: number) => {
            setEditingCell({ keyframeIndex, field });
            if (field === "time") {
                setEditValue(formatTime(currentValue));
            } else {
                setEditValue(formatHz(currentValue));
            }
        },
        []
    );

    const handleCancelEdit = useCallback(() => {
        setEditingCell(null);
        setEditValue("");
    }, []);

    const handleCommitEdit = useCallback(() => {
        if (!editingCell) return;

        const keyframe = keyframes[editingCell.keyframeIndex];
        if (!keyframe) {
            handleCancelEdit();
            return;
        }

        let parsedValue: number | null = null;

        if (editingCell.field === "time") {
            parsedValue = parseTime(editValue);
            if (parsedValue !== null && (parsedValue < 0 || parsedValue > audioDuration)) {
                parsedValue = null; // Invalid time
            }
        } else {
            parsedValue = parseHz(editValue);
            if (parsedValue !== null && parsedValue < 0) {
                parsedValue = null; // Invalid Hz
            }
        }

        if (parsedValue === null) {
            handleCancelEdit();
            return;
        }

        // Update the keyframe
        let updatedBand: FrequencyBand;

        if (editingCell.field === "time") {
            // Moving keyframe time is complex - not implemented via table editing for now
            // Just cancel and show a message could be added
            handleCancelEdit();
            return;
        } else if (editingCell.field === "lowHz") {
            updatedBand = updateKeyframe(band, keyframe.time, parsedValue, undefined);
        } else {
            updatedBand = updateKeyframe(band, keyframe.time, undefined, parsedValue);
        }

        onBandUpdate({ frequencyShape: updatedBand.frequencyShape });
        handleCancelEdit();
    }, [editingCell, editValue, keyframes, band, audioDuration, onBandUpdate, handleCancelEdit]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                handleCommitEdit();
            } else if (e.key === "Escape") {
                handleCancelEdit();
            }
        },
        [handleCommitEdit, handleCancelEdit]
    );

    const handleAddKeyframe = useCallback(() => {
        // Add a keyframe at the midpoint of the band duration
        const midTime = audioDuration / 2;
        const updatedBand = splitBandSegmentAt(band, midTime);
        onBandUpdate({ frequencyShape: updatedBand.frequencyShape });
    }, [band, audioDuration, onBandUpdate]);

    const handleDeleteKeyframe = useCallback(
        (time: number) => {
            const updatedBand = removeKeyframe(band, time);
            onBandUpdate({ frequencyShape: updatedBand.frequencyShape });
        },
        [band, onBandUpdate]
    );

    const canDeleteKeyframe = (kf: FrequencyKeyframe) => {
        // Can't delete first or last keyframe (need at least 2 to define a band)
        return kf.edge !== "start" || keyframes.length > 2;
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-200 dark:border-zinc-700">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Keyframes
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleAddKeyframe}
                    title="Add keyframe"
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800">
                        <tr className="text-zinc-500 dark:text-zinc-400">
                            <th className="px-2 py-1 text-left font-medium">Time</th>
                            <th className="px-2 py-1 text-right font-medium">Low Hz</th>
                            <th className="px-2 py-1 text-right font-medium">High Hz</th>
                            <th className="px-2 py-1 w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {keyframes.map((kf, index) => {
                            const isHovered =
                                hoveredKeyframeTime !== null &&
                                Math.abs(kf.time - hoveredKeyframeTime) < 0.001;

                            return (
                                <tr
                                    key={`${kf.time}-${kf.edge}`}
                                    className={cn(
                                        "hover:bg-zinc-100 dark:hover:bg-zinc-700",
                                        isHovered && "bg-blue-50 dark:bg-blue-900/30"
                                    )}
                                    onMouseEnter={() => onKeyframeHover?.(kf.time)}
                                    onMouseLeave={() => onKeyframeHover?.(null)}
                                >
                                    {/* Time cell */}
                                    <td className="px-2 py-1">
                                        {editingCell?.keyframeIndex === index &&
                                        editingCell?.field === "time" ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                    setEditValue(e.target.value)
                                                }
                                                onBlur={handleCommitEdit}
                                                onKeyDown={handleKeyDown}
                                                className="w-full px-1 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                                autoFocus
                                            />
                                        ) : (
                                            <span
                                                className="cursor-text"
                                                onDoubleClick={() =>
                                                    handleStartEdit(index, "time", kf.time)
                                                }
                                            >
                                                {formatTime(kf.time)}
                                            </span>
                                        )}
                                    </td>

                                    {/* Low Hz cell */}
                                    <td className="px-2 py-1 text-right">
                                        {editingCell?.keyframeIndex === index &&
                                        editingCell?.field === "lowHz" ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                    setEditValue(e.target.value)
                                                }
                                                onBlur={handleCommitEdit}
                                                onKeyDown={handleKeyDown}
                                                className="w-full px-1 py-0.5 text-xs text-right rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                                autoFocus
                                            />
                                        ) : (
                                            <span
                                                className="cursor-text"
                                                onDoubleClick={() =>
                                                    handleStartEdit(index, "lowHz", kf.lowHz)
                                                }
                                            >
                                                {formatHz(kf.lowHz)}
                                            </span>
                                        )}
                                    </td>

                                    {/* High Hz cell */}
                                    <td className="px-2 py-1 text-right">
                                        {editingCell?.keyframeIndex === index &&
                                        editingCell?.field === "highHz" ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                    setEditValue(e.target.value)
                                                }
                                                onBlur={handleCommitEdit}
                                                onKeyDown={handleKeyDown}
                                                className="w-full px-1 py-0.5 text-xs text-right rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                                autoFocus
                                            />
                                        ) : (
                                            <span
                                                className="cursor-text"
                                                onDoubleClick={() =>
                                                    handleStartEdit(index, "highHz", kf.highHz)
                                                }
                                            >
                                                {formatHz(kf.highHz)}
                                            </span>
                                        )}
                                    </td>

                                    {/* Delete button */}
                                    <td className="px-1 py-1">
                                        {canDeleteKeyframe(kf) && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                onClick={() => handleDeleteKeyframe(kf.time)}
                                                title="Delete keyframe"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {keyframes.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
                    No keyframes
                </div>
            )}
        </div>
    );
}
