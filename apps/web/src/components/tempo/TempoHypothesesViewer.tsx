"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { GripHorizontal } from "lucide-react";
import type { TempoHypothesis } from "@octoseq/mir";

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 300;

export type TempoHypothesesViewerProps = {
    hypotheses: TempoHypothesis[];
    inputCandidateCount: number;
    onHypothesisSelect?: (hypothesis: TempoHypothesis) => void;
    selectedHypothesisId?: string | null;
};

/**
 * Generate a consistent hue from a string ID.
 */
function familyIdToHue(familyId: string): number {
    let hash = 0;
    for (let i = 0; i < familyId.length; i++) {
        hash = ((hash << 5) - hash) + familyId.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash) % 360;
}

/**
 * Format harmonic ratio as human-readable label.
 */
function formatHarmonicRatio(ratio: number): string {
    if (ratio === 1.0) return "root";
    if (ratio === 2.0) return "2x";
    if (ratio === 0.5) return "1/2";
    if (ratio === 3.0) return "3x";
    if (ratio === 1.5) return "3/2";
    if (Math.abs(ratio - 1 / 3) < 0.01) return "1/3";
    if (Math.abs(ratio - 2 / 3) < 0.01) return "2/3";
    return `${ratio.toFixed(2)}x`;
}

/**
 * Visual viewer for tempo hypotheses.
 * Displays a list of BPM hypotheses with confidence bars and harmonic family groupings.
 */
export function TempoHypothesesViewer({
    hypotheses,
    inputCandidateCount,
    onHypothesisSelect,
    selectedHypothesisId,
}: TempoHypothesesViewerProps) {
    const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(
        new Set(hypotheses.map((h) => h.familyId))
    );

    // Resizable height state
    const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
    const isResizingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = panelHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }, [panelHeight]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;
            const delta = e.clientY - startYRef.current;
            const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
            setPanelHeight(newHeight);
        };

        const handleMouseUp = () => {
            if (isResizingRef.current) {
                isResizingRef.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const toggleFamily = useCallback((familyId: string) => {
        setExpandedFamilies((prev) => {
            const next = new Set(prev);
            if (next.has(familyId)) {
                next.delete(familyId);
            } else {
                next.add(familyId);
            }
            return next;
        });
    }, []);

    // Group hypotheses by family
    const familyGroups = new Map<string, TempoHypothesis[]>();
    for (const h of hypotheses) {
        const group = familyGroups.get(h.familyId) ?? [];
        group.push(h);
        familyGroups.set(h.familyId, group);
    }

    // Sort families by highest confidence member
    const sortedFamilies = Array.from(familyGroups.entries()).sort((a, b) => {
        const maxA = Math.max(...a[1].map((h) => h.confidence));
        const maxB = Math.max(...b[1].map((h) => h.confidence));
        return maxB - maxA;
    });

    if (hypotheses.length === 0) {
        return (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
                <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
                    No tempo hypotheses found. Try adjusting the beat candidate parameters or
                    ensure the audio has clear rhythmic content.
                    <div className="mt-2 text-xs">
                        Input: {inputCandidateCount} beat candidates
                    </div>
                </div>
                {/* Resize Handle */}
                <div
                    onMouseDown={handleResizeStart}
                    className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group border-t border-zinc-200 dark:border-zinc-800"
                >
                    <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
            <div
                className="p-2 space-y-3 overflow-y-auto"
                style={{ height: panelHeight }}
            >
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {hypotheses.length} hypotheses from {inputCandidateCount} beat candidates
                </div>

                {sortedFamilies.map(([familyId, members]) => {
                const isExpanded = expandedFamilies.has(familyId);
                const hue = familyIdToHue(familyId);
                const familyColor = `hsl(${hue}, 60%, 50%)`;
                const rootHyp = members.find((h) => h.harmonicRatio === 1.0) ?? members[0]!;

                return (
                    <div
                        key={familyId}
                        className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden"
                    >
                        {/* Family header */}
                        <button
                            type="button"
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 cursor-pointer w-full text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                            onClick={() => toggleFamily(familyId)}
                        >
                            <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: familyColor }}
                            />
                            <span className="font-medium text-sm">
                                ~{rootHyp.bpm.toFixed(1)} BPM family
                            </span>
                            <span className="text-xs text-zinc-500 ml-auto">
                                {members.length} hypothesis{members.length > 1 ? "es" : ""}
                            </span>
                            <span className="text-xs text-zinc-400">
                                {isExpanded ? "\u25BC" : "\u25B6"}
                            </span>
                        </button>

                        {/* Family members */}
                        {isExpanded && (
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                {members
                                    .sort((a, b) => b.confidence - a.confidence)
                                    .map((hyp) => (
                                        <button
                                            type="button"
                                            key={hyp.id}
                                            className={`px-3 py-2 cursor-pointer transition-colors w-full text-left ${
                                                selectedHypothesisId === hyp.id
                                                    ? "bg-blue-50 dark:bg-blue-900/30"
                                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                            }`}
                                            onClick={() => onHypothesisSelect?.(hyp)}
                                        >
                                            <div className="flex items-center gap-3">
                                                {/* BPM value */}
                                                <div className="font-mono text-lg font-semibold w-20 text-right">
                                                    {hyp.bpm.toFixed(1)}
                                                </div>
                                                <span className="text-xs text-zinc-500">BPM</span>

                                                {/* Harmonic ratio badge */}
                                                <span
                                                    className="text-xs px-1.5 py-0.5 rounded"
                                                    style={{
                                                        backgroundColor: `${familyColor}20`,
                                                        color: familyColor,
                                                    }}
                                                >
                                                    {formatHarmonicRatio(hyp.harmonicRatio)}
                                                </span>

                                                {/* Confidence bar */}
                                                <div className="flex-1 ml-2">
                                                    <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden">
                                                        <div
                                                            className="h-full transition-all"
                                                            style={{
                                                                width: `${hyp.confidence * 100}%`,
                                                                backgroundColor: familyColor,
                                                                opacity: 0.7 + 0.3 * hyp.confidence,
                                                            }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Confidence value */}
                                                <span className="text-xs text-zinc-500 w-12 text-right">
                                                    {(hyp.confidence * 100).toFixed(0)}%
                                                </span>
                                            </div>

                                            {/* Evidence details */}
                                            <div className="mt-1 text-xs text-zinc-400 flex gap-4">
                                                <span>
                                                    {hyp.evidence.supportingIntervalCount} intervals
                                                </span>
                                                <span>
                                                    {hyp.evidence.binRange[0].toFixed(0)}-
                                                    {hyp.evidence.binRange[1].toFixed(0)} BPM range
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>
                );
            })}
            </div>
            {/* Resize Handle */}
            <div
                onMouseDown={handleResizeStart}
                className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group border-t border-zinc-200 dark:border-zinc-800"
            >
                <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
            </div>
        </div>
    );
}
