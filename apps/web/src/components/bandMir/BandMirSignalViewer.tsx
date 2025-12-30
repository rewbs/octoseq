"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { BandMir1DResult, BandMirDiagnostics } from "@octoseq/mir";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import {
  decimator,
  normalizer,
  renderLine,
  clamp,
  type NormalizationBounds,
  type RenderPoint,
} from "@octoseq/wavesurfer-signalviewer";
import { getBandColorHex } from "@/lib/bandColors";
import { useBandMirStore, useFrequencyBandStore } from "@/lib/stores";
import { BandEventOverlay, BandEventCountBadge } from "./BandEventOverlay";

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
    onReady?: (bandId: string) => void;
};

// ----------------------------
// Single Band Signal Row (Canvas-based)
// ----------------------------

const BAND_ROW_HEIGHT = 60;

function BandSignalRow({
    result,
    bandIndex,
    viewport,
    cursorTimeSec,
    onCursorTimeChange,
    showEvents = true,
    onReady,
}: BandSignalRowProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const boundsRef = useRef<NormalizationBounds | null>(null);
    const hasCalledReady = useRef(false);
    const viewportBoundsRef = useRef<{ min: number; max: number } | null>(null);

    // Hover state for value display
    const [hoverInfo, setHoverInfo] = useState<{
        value: number | null;
        time: number;
        x: number;
        viewportMin: number;
        viewportMax: number;
    } | null>(null);

    const color = getBandColorHex(bandIndex);
    const hasWarnings = result.diagnostics.warnings.length > 0;

    // Get event data for this band
    const eventData = useBandMirStore((s) => s.getEventsCached(result.bandId));
    const isEventVisible = useBandMirStore((s) => s.isBandEventVisible(result.bandId));

    // Create signal from result
    const signal = useMemo(() => {
        return createContinuousSignal(result.times, result.values);
    }, [result.times, result.values]);

    // Compute normalization bounds when signal changes
    useEffect(() => {
        boundsRef.current = normalizer.computeBounds(signal, "global");
    }, [signal]);

    // Get value at a specific time using binary search
    const getValueAtTime = useCallback((time: number): number | null => {
        const { times, values } = signal;
        if (times.length === 0) return null;

        let left = 0;
        let right = times.length - 1;

        if (time <= (times[0] ?? 0)) return values[0] ?? null;
        if (time >= (times[right] ?? 0)) return values[right] ?? null;

        while (left < right - 1) {
            const mid = Math.floor((left + right) / 2);
            const midTime = times[mid] ?? 0;
            if (midTime <= time) {
                left = mid;
            } else {
                right = mid;
            }
        }

        const t0 = times[left] ?? 0;
        const t1 = times[right] ?? 0;
        const v0 = values[left] ?? 0;
        const v1 = values[right] ?? 0;

        if (t1 === t0) return v0;
        const ratio = (time - t0) / (t1 - t0);
        return v0 + ratio * (v1 - v0);
    }, [signal]);

    // Render function
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !viewport) return;

        // Get or initialize context
        if (!ctxRef.current) {
            ctxRef.current = canvas.getContext("2d");
        }
        const ctx = ctxRef.current;
        if (!ctx) return;

        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = BAND_ROW_HEIGHT;

        if (width === 0) return;

        // Resize canvas if needed
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Get bounds
        const bounds = boundsRef.current ?? { min: 0, max: 1 };

        // Calculate visible time range
        const { startTime, endTime } = viewport;
        const visibleDuration = endTime - startTime;
        if (visibleDuration <= 0) return;

        // Calculate actual pixels per second based on container width
        const pxPerSec = width / visibleDuration;

        // Time to X conversion
        const timeToX = (time: number): number => {
            return (time - startTime) * pxPerSec;
        };

        // Get decimated data
        const targetPoints = Math.min(width * 2, 4000);

        // Calculate viewport min/max
        const { times: sigTimes, values: sigValues } = signal;
        let vpMin = Infinity;
        let vpMax = -Infinity;
        for (let i = 0; i < sigTimes.length; i++) {
            const t = sigTimes[i];
            const v = sigValues[i];
            if (t !== undefined && v !== undefined && t >= startTime && t <= endTime) {
                if (v < vpMin) vpMin = v;
                if (v > vpMax) vpMax = v;
            }
        }
        if (vpMin !== Infinity && vpMax !== -Infinity) {
            viewportBoundsRef.current = { min: vpMin, max: vpMax };
        }

        // Render continuous signal
        const { times, values } = signal;
        const canvasHeight = height;

        // Decimate
        const decimated = decimator.decimate(times, values, startTime, endTime, targetPoints);

        // Convert to render points
        const points: RenderPoint[] = [];
        for (let i = 0; i < decimated.times.length; i++) {
            const time = decimated.times[i];
            const value = decimated.values[i];
            if (time === undefined || value === undefined) continue;

            const x = timeToX(time);
            const normalized = normalizer.normalize(value, bounds);

            // Bottom baseline
            const y = canvasHeight * (1 - clamp(normalized, 0, 1));

            points.push({ x, y, value, time });
        }

        // Render filled line
        renderLine(ctx, points, {
            color: {
                stroke: color,
                fill: `${color}4D`, // 30% opacity
                strokeWidth: 1.5,
                opacity: 1,
            },
            baseline: "bottom",
            mode: "filled",
            canvasHeight,
        });

        // Draw cursor
        if (cursorTimeSec != null && cursorTimeSec >= startTime && cursorTimeSec <= endTime) {
            const cursorX = timeToX(cursorTimeSec);
            ctx.save();
            ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cursorX, 0);
            ctx.lineTo(cursorX, height);
            ctx.stroke();
            ctx.restore();
        }

        // Signal ready on first successful render
        if (!hasCalledReady.current && points.length > 0) {
            hasCalledReady.current = true;
            onReady?.(result.bandId);
        }
    }, [viewport, signal, cursorTimeSec, color, result.bandId, onReady]);

    // Re-render when dependencies change
    useEffect(() => {
        render();
    }, [render]);

    // Handle resize observer
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver(() => {
            render();
        });
        resizeObserver.observe(container);

        return () => resizeObserver.disconnect();
    }, [render]);

    // Reset ready state when result changes
    useEffect(() => {
        hasCalledReady.current = false;
    }, [result]);

    const handleMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (!viewport) return;
        const rect = evt.currentTarget.getBoundingClientRect();
        const visibleDuration = viewport.endTime - viewport.startTime;
        if (visibleDuration <= 0 || rect.width <= 0) return;
        const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
        const t = viewport.startTime + (x / rect.width) * visibleDuration;

        onCursorTimeChange?.(Math.max(0, t));

        // Get value at cursor for display
        const value = getValueAtTime(t);
        const vpBounds = viewportBoundsRef.current;
        setHoverInfo({
            value,
            time: t,
            x,
            viewportMin: vpBounds?.min ?? 0,
            viewportMax: vpBounds?.max ?? 0,
        });
    };

    const handleMouseLeave = () => {
        onCursorTimeChange?.(null);
        setHoverInfo(null);
    };

    return (
        <div className="relative border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
            {/* Signal viewer - full width */}
            <div
                ref={containerRef}
                className="w-full relative bg-zinc-50 dark:bg-zinc-900"
                style={{ height: BAND_ROW_HEIGHT }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            >
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
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

            {/* Band label - floating overlay */}
            <div
                className="absolute left-1 top-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium backdrop-blur-sm"
                style={{ backgroundColor: `${color}20`, color }}
            >
                <span className="truncate max-w-20" title={result.bandLabel}>
                    {result.bandLabel}
                </span>
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

            {/* Floating value display on hover */}
            {hoverInfo && hoverInfo.value !== null && (
                <div
                    className="absolute top-1 z-20 pointer-events-none"
                    style={{
                        left: `${Math.min(Math.max(hoverInfo.x, 50), (containerRef.current?.getBoundingClientRect().width ?? 150) - 50)}px`,
                        transform: "translateX(-50%)",
                    }}
                >
                    <div className="bg-zinc-800/90 dark:bg-zinc-200/90 text-zinc-100 dark:text-zinc-900 text-xs px-1.5 py-0.5 rounded shadow-lg backdrop-blur-sm whitespace-nowrap">
                        <span className="font-mono font-medium">{hoverInfo.value.toFixed(3)}</span>
                        <span className="text-tiny opacity-70 ml-1.5">
                            vp: {hoverInfo.viewportMin.toFixed(2)}–{hoverInfo.viewportMax.toFixed(2)}
                        </span>
                    </div>
                </div>
            )}
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
    const handleReady = useCallback((bandId: string) => {
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
                            onReady={handleReady}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
