"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { minMax, normaliseForWaveform } from "@octoseq/mir";
import type { BandMir1DResult, BandMirDiagnostics } from "@octoseq/mir";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { getBandColorHex } from "@/lib/bandColors";
import { useBandMirStore, useFrequencyBandStore } from "@/lib/stores";
import { BandEventOverlay, BandEventCountBadge } from "./BandEventOverlay";

const getScrollContainer = (ws: WaveSurfer | null) => {
    const wrapper = ws?.getWrapper?.();
    return wrapper?.parentElement ?? null;
};

// ----------------------------
// Types
// ----------------------------

export type BandMirSignalViewerProps = {
    /** The band MIR function to show results for (e.g., "bandOnsetStrength") */
    fn: "bandOnsetStrength" | "bandSpectralFlux" | "bandAmplitudeEnvelope";
    /** Viewport from the main WaveSurfer instance */
    viewport: WaveSurferViewport | null;
    /** Shared mirrored cursor (hover or playhead) to display */
    cursorTimeSec?: number | null;
    /** Notify parent when this view is hovered */
    onCursorTimeChange?: (timeSec: number | null) => void;
    /** Notify parent of waveform readiness progress */
    onWaveformsReadyChange?: (status: { ready: number; total: number }) => void;
};

type BandSignalRowProps = {
    result: BandMir1DResult;
    bandIndex: number;
    viewport: WaveSurferViewport | null;
    cursorTimeSec?: number | null;
    onCursorTimeChange?: (timeSec: number | null) => void;
    /** Whether to show event overlay */
    showEvents?: boolean;
    onWaveformReady?: (bandId: string) => void;
};

// ----------------------------
// Single Band Signal Row
// ----------------------------

const BAND_ROW_HEIGHT = 60;

function BandSignalRow({
    result,
    bandIndex,
    viewport,
    cursorTimeSec,
    onCursorTimeChange,
    showEvents = true,
    onWaveformReady,
}: BandSignalRowProps) {
    const wsRef = useRef<WaveSurfer | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const readyRef = useRef(false);
    const loadTokenRef = useRef(0);
    const viewportRef = useRef<WaveSurferViewport | null>(viewport);

    const color = getBandColorHex(bandIndex);
    const hasWarnings = result.diagnostics.warnings.length > 0;

    // Get event data for this band
    const eventData = useBandMirStore((s) => s.getEventsCached(result.bandId));
    const isEventVisible = useBandMirStore((s) => s.isBandEventVisible(result.bandId));

    // Track viewport in ref
    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    // Initialize WaveSurfer
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ws = WaveSurfer.create({
            container,
            height: BAND_ROW_HEIGHT,
            waveColor: color,
            progressColor: `${color}66`, // 40% opacity
            cursorColor: "#d4af37",
            normalize: false,
            autoScroll: true,
            autoCenter: false,
            interact: false,
            dragToSeek: false,
            minPxPerSec: 0,
        });

        wsRef.current = ws;

        ws.on("ready", () => {
            readyRef.current = true;
            const vp = viewportRef.current;
            const scrollContainer = getScrollContainer(ws);
            if (scrollContainer && vp?.minPxPerSec) {
                ws.zoom(vp.minPxPerSec);
                scrollContainer.scrollLeft = Math.max(0, vp.startTime * vp.minPxPerSec);
            }
        });

        return () => {
            readyRef.current = false;
            ws.destroy();
            wsRef.current = null;
        };
    }, [color]);

    // Load data
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws) return;

        const { times, values } = result;
        if (values.length === 0 || times.length === 0) return;

        // Normalize values for display
        const normalized = normaliseForWaveform(values, { center: false });

        // Upsample to display sample rate
        const duration = Math.max(0, times[times.length - 1] ?? 0);
        const displaySampleRate = 3000;
        const displayLength = Math.max(1, Math.ceil(duration * displaySampleRate));
        const out = new Float32Array(displayLength);

        let frame = 0;
        for (let i = 0; i < displayLength; i++) {
            const t = i / displaySampleRate;
            while (frame + 1 < times.length && (times[frame + 1] ?? 0) <= t) frame++;
            out[i] = normalized[frame] ?? 0;
        }

        readyRef.current = false;
        loadTokenRef.current += 1;
        const loadToken = loadTokenRef.current;
        const peaks: Array<Float32Array> = [out];
        const dummyBlob = new Blob([], { type: "application/octet-stream" });

        void ws
            .loadBlob(dummyBlob, peaks, duration)
            .then(() => {
                if (loadToken !== loadTokenRef.current) return;
                readyRef.current = true;
                const vp = viewportRef.current;
                if (vp) {
                    try {
                        if (vp.minPxPerSec > 0) ws.zoom(vp.minPxPerSec);
                    } catch (e) {
                        // Ignore
                    }
                    const scrollContainer = getScrollContainer(ws);
                    if (scrollContainer && vp.minPxPerSec > 0) {
                        scrollContainer.scrollLeft = Math.max(0, vp.startTime * vp.minPxPerSec);
                    }
                }
            })
            .catch((err) => {
                if (loadToken !== loadTokenRef.current) return;
                console.error("[Band MIR] wavesurfer load failed", err);
            })
            .finally(() => {
                if (loadToken !== loadTokenRef.current) return;
                onWaveformReady?.(result.bandId);
            });
    }, [result, onWaveformReady]);

    // Sync viewport
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !viewport || !readyRef.current) return;

        try {
            ws.zoom(viewport.minPxPerSec);
        } catch (e) {
            return;
        }

        const scrollContainer = getScrollContainer(ws);
        if (scrollContainer && viewport.minPxPerSec > 0) {
            scrollContainer.scrollLeft = Math.max(0, viewport.startTime * viewport.minPxPerSec);
        }
    }, [viewport]);

    // Sync cursor
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !readyRef.current || cursorTimeSec == null) return;

        const duration = ws.getDuration();
        if (duration > 0) {
            ws.setTime(Math.min(duration, Math.max(0, cursorTimeSec)));
        }
    }, [cursorTimeSec]);

    const handleMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (!onCursorTimeChange || !viewport) return;
        const rect = evt.currentTarget.getBoundingClientRect();
        const span = viewport.endTime - viewport.startTime;
        if (span <= 0) return;
        const pxPerSec = rect.width > 0 ? rect.width / span : viewport.minPxPerSec;
        if (!pxPerSec || pxPerSec <= 0) return;
        const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
        const t = viewport.startTime + x / pxPerSec;
        onCursorTimeChange(Math.max(0, t));
    };

    const handleMouseLeave = () => {
        onCursorTimeChange?.(null);
    };

    return (
        <div className="flex items-stretch min-w-0 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
            {/* Band label */}
            <div
                className="flex items-center justify-between gap-1 px-2 py-1 text-xs font-medium shrink-0 border-r border-zinc-200 dark:border-zinc-800"
                style={{ width: 100, backgroundColor: `${color}15` }}
            >
                <span
                    className="truncate"
                    style={{ color }}
                    title={result.bandLabel}
                >
                    {result.bandLabel}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                    {showEvents && (
                        <BandEventCountBadge
                            eventData={eventData}
                            color={color}
                            visible={isEventVisible}
                        />
                    )}
                    {hasWarnings && (
                        <span title={result.diagnostics.warnings.join("; ")}>
                            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                        </span>
                    )}
                </div>
            </div>

            {/* Waveform with event overlay */}
            <div className="flex-1 min-w-0 relative">
                <div
                    ref={containerRef}
                    className="w-full overflow-x-hidden"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                />
                {showEvents && (
                    <BandEventOverlay
                        eventData={eventData}
                        color={color}
                        visible={isEventVisible}
                        viewport={viewport}
                        height={BAND_ROW_HEIGHT}
                    />
                )}
            </div>
        </div>
    );
}

// ----------------------------
// Diagnostics Panel
// ----------------------------

function DiagnosticsTooltip({ diagnostics }: { diagnostics: BandMirDiagnostics }) {
    if (diagnostics.warnings.length === 0 && diagnostics.meanEnergyRetained > 0.1) {
        return null;
    }

    return (
        <div className="text-xs text-amber-600 dark:text-amber-400 px-2 py-1">
            {diagnostics.warnings.map((w, i) => (
                <div key={i}>{w}</div>
            ))}
            <div className="text-zinc-500">
                Energy retained: {(diagnostics.meanEnergyRetained * 100).toFixed(1)}%
            </div>
        </div>
    );
}

// ----------------------------
// Main Component
// ----------------------------

export function BandMirSignalViewer({
    fn,
    viewport,
    cursorTimeSec,
    onCursorTimeChange,
    onWaveformsReadyChange,
}: BandMirSignalViewerProps) {
    const expanded = useBandMirStore((s) => s.expanded);
    const setExpanded = useBandMirStore((s) => s.setExpanded);
    const cache = useBandMirStore((s) => s.cache);

    const structure = useFrequencyBandStore((s) => s.structure);

    // Get results for this function
    const results = useMemo(() => {
        const entries: BandMir1DResult[] = [];
        for (const [key, result] of cache.entries()) {
            if (key.endsWith(`:${fn}`)) {
                entries.push(result);
            }
        }
        return entries;
    }, [cache, fn]);

    // Sort by band sortOrder
    const sortedResults = useMemo(() => {
        return [...results].sort((a, b) => {
            const bandA = structure?.bands.find((band) => band.id === a.bandId);
            const bandB = structure?.bands.find((band) => band.id === b.bandId);
            return (bandA?.sortOrder ?? 0) - (bandB?.sortOrder ?? 0);
        });
    }, [results, structure]);

    const [readyBandIds, setReadyBandIds] = useState<Set<string>>(new Set());
    const handleWaveformReady = useCallback((bandId: string) => {
        setReadyBandIds((prev) => {
            if (prev.has(bandId)) return prev;
            const next = new Set(prev);
            next.add(bandId);
            return next;
        });
    }, []);

    const resultsKey = useMemo(() => {
        return sortedResults
            .map((result) => {
                const totalMs = result.meta?.timings?.totalMs ?? 0;
                return `${result.bandId}:${result.fn}:${result.values.length}:${result.times.length}:${totalMs}`;
            })
            .join("|");
    }, [sortedResults]);

    useEffect(() => {
        setReadyBandIds(new Set());
        onWaveformsReadyChange?.({ ready: 0, total: sortedResults.length });
    }, [resultsKey, onWaveformsReadyChange, sortedResults.length]);

    const readyCount = readyBandIds.size;
    useEffect(() => {
        onWaveformsReadyChange?.({ ready: readyCount, total: sortedResults.length });
    }, [readyCount, onWaveformsReadyChange, sortedResults.length]);

    useEffect(() => {
        return () => {
            onWaveformsReadyChange?.({ ready: 0, total: 0 });
        };
    }, [onWaveformsReadyChange]);

    // Get band indices for coloring
    const bandIndexMap = new Map<string, number>();
    structure?.bands.forEach((band, index) => {
        bandIndexMap.set(band.id, index);
    });

    if (sortedResults.length === 0) {
        return null;
    }

    return (
        <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 mt-2 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="w-4 h-4" />
                ) : (
                    <ChevronRight className="w-4 h-4" />
                )}
                <span>Band Analysis ({sortedResults.length} bands)</span>
            </button>

            {/* Band signals */}
            {expanded && (
                <div className="border-t border-zinc-200 dark:border-zinc-800">
                    {sortedResults.map((result) => (
                        <BandSignalRow
                            key={`${result.bandId}:${result.fn}`}
                            result={result}
                            bandIndex={bandIndexMap.get(result.bandId) ?? 0}
                            viewport={viewport}
                            cursorTimeSec={cursorTimeSec}
                            onCursorTimeChange={onCursorTimeChange}
                            onWaveformReady={handleWaveformReady}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
