"use client";

import { useEffect, useRef, useCallback, type MouseEvent } from "react";
import type { FrequencyBandStructure, FrequencyBand, MelConversionConfig } from "@octoseq/mir";
import { frequencyBoundsAt, hzToFeatureIndex, featureIndexToHz, keyframesFromBand } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type FrequencyBandOverlayProps = {
    /** Visible time range in seconds. */
    startTime: number;
    endTime: number;

    /** Canvas dimensions. */
    width: number;
    height: number;

    /** Frequency band structure to render. */
    structure: FrequencyBandStructure | null;

    /** Currently selected band ID. */
    selectedBandId: string | null;

    /** Currently hovered band ID. */
    hoveredBandId: string | null;

    /** Currently hovered keyframe time (for selected band). */
    hoveredKeyframeTime?: number | null;

    /** Mel spectrogram configuration for Hz to Y mapping. */
    melConfig: MelConversionConfig;

    /** Callback when a band is clicked. */
    onBandClick?: (bandId: string) => void;

    /** Callback when mouse hovers over a band. */
    onBandHover?: (bandId: string | null) => void;

    /** Callback when mouse hovers over a keyframe. */
    onKeyframeHover?: (time: number | null) => void;

    /** Callback when double-clicking on the overlay to add a keyframe. */
    onDoubleClick?: (bandId: string, time: number) => void;

    /** Callback when starting to drag an edge, body, or keyframe. */
    onDragStart?: (info: {
        bandId: string;
        mode: "low-edge" | "high-edge" | "body" | "keyframe-time";
        startValue: number;
        clientY: number;
        clientX: number;
    }) => void;
};

// ----------------------------
// Constants
// ----------------------------

/** Distance in pixels from edge to consider it a drag handle. */
const EDGE_HIT_DISTANCE = 8;

/** Keyframe handle radius in pixels. */
const KEYFRAME_HANDLE_RADIUS = 5;

/** Band colors (cycling through for multiple bands). */
const BAND_COLORS = [
    { r: 59, g: 130, b: 246 },   // Blue
    { r: 16, g: 185, b: 129 },   // Green
    { r: 249, g: 115, b: 22 },   // Orange
    { r: 139, g: 92, b: 246 },   // Purple
    { r: 236, g: 72, b: 153 },   // Pink
    { r: 20, g: 184, b: 166 },   // Teal
];

// ----------------------------
// Helpers
// ----------------------------

function getBandColor(index: number): { r: number; g: number; b: number } {
    return BAND_COLORS[index % BAND_COLORS.length] ?? BAND_COLORS[0]!;
}

/**
 * Convert Hz to Y pixel position.
 * Y increases downward, but higher frequencies should be at the top.
 */
function hzToY(hz: number, height: number, melConfig: MelConversionConfig): number {
    const featureIndex = hzToFeatureIndex(hz, melConfig);
    // Feature index 0 = low freq = bottom, feature index nMels-1 = high freq = top
    // Y = 0 is top, Y = height is bottom
    // So we invert: Y = height * (1 - featureIndex / (nMels - 1))
    const normalized = featureIndex / (melConfig.nMels - 1);
    return height * (1 - normalized);
}

/**
 * Convert Y pixel position to Hz.
 */
function yToHz(y: number, height: number, melConfig: MelConversionConfig): number {
    // Invert the hzToY formula
    const normalized = 1 - y / height;
    const featureIndex = normalized * (melConfig.nMels - 1);
    return featureIndexToHz(featureIndex, melConfig);
}

/**
 * Convert time to X pixel position.
 */
function timeToX(time: number, startTime: number, endTime: number, width: number): number {
    if (endTime <= startTime) return 0;
    return ((time - startTime) / (endTime - startTime)) * width;
}

/**
 * Convert X pixel position to time.
 */
function xToTime(x: number, startTime: number, endTime: number, width: number): number {
    if (width <= 0) return startTime;
    return startTime + (x / width) * (endTime - startTime);
}

// ----------------------------
// Component
// ----------------------------

export function FrequencyBandOverlay({
    startTime,
    endTime,
    width,
    height,
    structure,
    selectedBandId,
    hoveredBandId,
    hoveredKeyframeTime,
    melConfig,
    onBandClick,
    onBandHover,
    onKeyframeHover,
    onDoubleClick,
    onDragStart,
}: FrequencyBandOverlayProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Render bands to canvas
    const renderBands = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (!structure || structure.bands.length === 0) return;

        // Sample time points for rendering band shapes
        const numSamples = Math.max(2, Math.ceil(width / 2));
        const timeStep = (endTime - startTime) / (numSamples - 1);

        // Render each band
        structure.bands.forEach((band, index) => {
            const isSelected = band.id === selectedBandId;
            const isHovered = band.id === hoveredBandId;
            const color = getBandColor(index);

            // Determine visual style
            let fillAlpha = 0.3;
            let strokeWidth = 1;
            let strokeAlpha = 0.8;

            if (!band.enabled) {
                fillAlpha = 0.1;
                strokeAlpha = 0.3;
            } else if (isSelected) {
                fillAlpha = 0.5;
                strokeWidth = 2;
                strokeAlpha = 1.0;
            } else if (isHovered) {
                fillAlpha = 0.4;
                strokeAlpha = 0.9;
            }

            // Build the band shape as a polygon
            const topPoints: { x: number; y: number }[] = [];
            const bottomPoints: { x: number; y: number }[] = [];

            for (let i = 0; i < numSamples; i++) {
                const t = startTime + i * timeStep;
                const bounds = frequencyBoundsAt(band, t);

                if (bounds) {
                    const x = timeToX(t, startTime, endTime, width);
                    const yHigh = hzToY(bounds.highHz, height, melConfig);
                    const yLow = hzToY(bounds.lowHz, height, melConfig);

                    topPoints.push({ x, y: yHigh });
                    bottomPoints.push({ x, y: yLow });
                }
            }

            if (topPoints.length < 2) return;

            // Draw filled polygon
            ctx.beginPath();
            ctx.moveTo(topPoints[0]!.x, topPoints[0]!.y);

            // Top edge (high frequency)
            for (let i = 1; i < topPoints.length; i++) {
                ctx.lineTo(topPoints[i]!.x, topPoints[i]!.y);
            }

            // Bottom edge (low frequency) - reversed
            for (let i = bottomPoints.length - 1; i >= 0; i--) {
                ctx.lineTo(bottomPoints[i]!.x, bottomPoints[i]!.y);
            }

            ctx.closePath();

            // Fill
            ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${fillAlpha})`;
            ctx.fill();

            // Stroke
            ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${strokeAlpha})`;
            ctx.lineWidth = strokeWidth;

            if (!band.enabled) {
                ctx.setLineDash([4, 4]);
            } else {
                ctx.setLineDash([]);
            }

            ctx.stroke();

            // Draw keyframe handles for selected band
            if (isSelected && band.enabled) {
                const keyframes = keyframesFromBand(band);

                keyframes.forEach((kf) => {
                    const x = timeToX(kf.time, startTime, endTime, width);
                    if (x < -KEYFRAME_HANDLE_RADIUS || x > width + KEYFRAME_HANDLE_RADIUS) return;

                    const yHigh = hzToY(kf.highHz, height, melConfig);
                    const yLow = hzToY(kf.lowHz, height, melConfig);

                    const isKeyframeHovered = hoveredKeyframeTime !== null &&
                        hoveredKeyframeTime !== undefined &&
                        Math.abs(kf.time - hoveredKeyframeTime) < 0.001;

                    // Draw keyframe line
                    ctx.beginPath();
                    ctx.moveTo(x, yHigh);
                    ctx.lineTo(x, yLow);
                    ctx.strokeStyle = isKeyframeHovered
                        ? `rgba(255, 255, 255, 1.0)`
                        : `rgba(${color.r}, ${color.g}, ${color.b}, 1.0)`;
                    ctx.lineWidth = isKeyframeHovered ? 3 : 2;
                    ctx.setLineDash([]);
                    ctx.stroke();

                    // Draw handles at top and bottom
                    const handleRadius = isKeyframeHovered ? KEYFRAME_HANDLE_RADIUS + 2 : KEYFRAME_HANDLE_RADIUS;
                    [yHigh, yLow].forEach((y) => {
                        ctx.beginPath();
                        ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
                        ctx.fillStyle = isKeyframeHovered ? `rgba(${color.r}, ${color.g}, ${color.b}, 1.0)` : "white";
                        ctx.fill();
                        ctx.strokeStyle = isKeyframeHovered
                            ? "white"
                            : `rgba(${color.r}, ${color.g}, ${color.b}, 1.0)`;
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    });
                });
            }
        });
    }, [structure, selectedBandId, hoveredBandId, hoveredKeyframeTime, startTime, endTime, width, height, melConfig]);

    // Re-render when dependencies change
    useEffect(() => {
        renderBands();
    }, [renderBands]);

    // Hit test: check if cursor is over a keyframe handle
    const hitTestKeyframe = useCallback(
        (clientX: number, clientY: number): { bandId: string; time: number } | null => {
            const canvas = canvasRef.current;
            if (!canvas || !structure || !selectedBandId) return null;

            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            if (x < 0 || x > width || y < 0 || y > height) return null;

            // Only check keyframes for the selected band
            const selectedBand = structure.bands.find((b) => b.id === selectedBandId);
            if (!selectedBand || !selectedBand.enabled) return null;

            const keyframes = keyframesFromBand(selectedBand);

            for (const kf of keyframes) {
                const kfX = timeToX(kf.time, startTime, endTime, width);
                const yHigh = hzToY(kf.highHz, height, melConfig);
                const yLow = hzToY(kf.lowHz, height, melConfig);

                // Check if within keyframe handle distance (horizontally)
                if (Math.abs(x - kfX) <= KEYFRAME_HANDLE_RADIUS + 3) {
                    // Check if near either the top or bottom handle
                    if (Math.abs(y - yHigh) <= KEYFRAME_HANDLE_RADIUS + 3 ||
                        Math.abs(y - yLow) <= KEYFRAME_HANDLE_RADIUS + 3) {
                        return { bandId: selectedBand.id, time: kf.time };
                    }
                    // Also check if on the keyframe line between handles
                    if (y >= yHigh - KEYFRAME_HANDLE_RADIUS && y <= yLow + KEYFRAME_HANDLE_RADIUS) {
                        return { bandId: selectedBand.id, time: kf.time };
                    }
                }
            }

            return null;
        },
        [structure, selectedBandId, startTime, endTime, width, height, melConfig]
    );

    // Hit test: find which band is under the cursor
    const hitTestBand = useCallback(
        (clientX: number, clientY: number): { bandId: string; edge: "low-edge" | "high-edge" | "body" } | null => {
            const canvas = canvasRef.current;
            if (!canvas || !structure) return null;

            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            if (x < 0 || x > width || y < 0 || y > height) return null;

            const time = xToTime(x, startTime, endTime, width);

            // Check bands in reverse order (top bands first)
            for (let i = structure.bands.length - 1; i >= 0; i--) {
                const band = structure.bands[i];
                if (!band || !band.enabled) continue;

                const bounds = frequencyBoundsAt(band, time);
                if (!bounds) continue;

                const yHigh = hzToY(bounds.highHz, height, melConfig);
                const yLow = hzToY(bounds.lowHz, height, melConfig);

                // Check if within band
                if (y >= yHigh - EDGE_HIT_DISTANCE && y <= yLow + EDGE_HIT_DISTANCE) {
                    // Check which edge
                    if (Math.abs(y - yHigh) <= EDGE_HIT_DISTANCE) {
                        return { bandId: band.id, edge: "high-edge" };
                    }
                    if (Math.abs(y - yLow) <= EDGE_HIT_DISTANCE) {
                        return { bandId: band.id, edge: "low-edge" };
                    }
                    if (y > yHigh && y < yLow) {
                        return { bandId: band.id, edge: "body" };
                    }
                }
            }

            return null;
        },
        [structure, startTime, endTime, width, height, melConfig]
    );

    // Mouse handlers
    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            // Check keyframe hit first (higher priority)
            const keyframeHit = hitTestKeyframe(e.clientX, e.clientY);
            const bandHit = hitTestBand(e.clientX, e.clientY);

            // Update cursor based on hit
            const canvas = canvasRef.current;
            if (canvas) {
                if (keyframeHit) {
                    canvas.style.cursor = "ew-resize"; // Horizontal resize for keyframe time
                } else if (bandHit) {
                    switch (bandHit.edge) {
                        case "high-edge":
                        case "low-edge":
                            canvas.style.cursor = "ns-resize";
                            break;
                        case "body":
                            canvas.style.cursor = "move";
                            break;
                    }
                } else {
                    canvas.style.cursor = "default";
                }
            }

            // Notify hover states
            onKeyframeHover?.(keyframeHit?.time ?? null);
            onBandHover?.(bandHit?.bandId ?? null);
        },
        [hitTestKeyframe, hitTestBand, onBandHover, onKeyframeHover]
    );

    const handleMouseLeave = useCallback(() => {
        onBandHover?.(null);
        onKeyframeHover?.(null);
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.style.cursor = "default";
        }
    }, [onBandHover, onKeyframeHover]);

    const handleMouseDown = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            // Check keyframe hit first (higher priority)
            const keyframeHit = hitTestKeyframe(e.clientX, e.clientY);

            if (keyframeHit) {
                // Prevent text selection during drag
                e.preventDefault();

                // Start keyframe time drag
                if (onDragStart) {
                    onDragStart({
                        bandId: keyframeHit.bandId,
                        mode: "keyframe-time",
                        startValue: keyframeHit.time,
                        clientY: e.clientY,
                        clientX: e.clientX,
                    });
                }
                return;
            }

            const bandHit = hitTestBand(e.clientX, e.clientY);

            if (bandHit) {
                // Prevent text selection during drag
                e.preventDefault();

                // Click to select
                onBandClick?.(bandHit.bandId);

                // Start drag if handler provided
                if (onDragStart) {
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;

                    const y = e.clientY - rect.top;
                    const hz = yToHz(y, height, melConfig);

                    onDragStart({
                        bandId: bandHit.bandId,
                        mode: bandHit.edge,
                        startValue: hz,
                        clientY: e.clientY,
                        clientX: e.clientX,
                    });
                }
            }
        },
        [hitTestKeyframe, hitTestBand, onBandClick, onDragStart, height, melConfig]
    );

    const handleDoubleClick = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            if (!onDoubleClick) return;

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left;
            const time = xToTime(x, startTime, endTime, width);

            // Double-click on a band adds a keyframe to that band
            const bandHit = hitTestBand(e.clientX, e.clientY);
            if (bandHit) {
                onDoubleClick(bandHit.bandId, time);
            }
        },
        [onDoubleClick, hitTestBand, startTime, endTime, width]
    );

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="absolute top-0 left-0 pointer-events-auto"
            style={{ width, height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
        />
    );
}
