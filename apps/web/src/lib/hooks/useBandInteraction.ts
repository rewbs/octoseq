"use client";

import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFrequencyBandStore, type BandDragState } from "@/lib/stores/frequencyBandStore";
import { frequencyBoundsAt, moveKeyframeTime, type MelConversionConfig } from "@octoseq/mir";
import { hzToFeatureIndex, featureIndexToHz } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type UseBandInteractionOptions = {
    /** Container element for coordinate calculations. */
    containerRef: React.RefObject<HTMLElement | null>;

    /** Visible time range. */
    startTime: number;
    endTime: number;

    /** Container dimensions. */
    width: number;
    height: number;

    /** Mel configuration for Hz <-> Y conversion. */
    melConfig: MelConversionConfig;

    /** Minimum band width in Hz to enforce. */
    minBandWidthHz?: number;

    /** Optional snap function for keyframe time snapping. */
    snapTime?: (time: number, toleranceSec: number) => number;

    /** Snap tolerance in pixels. */
    snapTolerancePx?: number;
};

// ----------------------------
// Helpers
// ----------------------------

function yToHz(y: number, height: number, melConfig: MelConversionConfig): number {
    const normalized = 1 - y / height;
    const featureIndex = normalized * (melConfig.nMels - 1);
    return featureIndexToHz(featureIndex, melConfig);
}

function hzToY(hz: number, height: number, melConfig: MelConversionConfig): number {
    const featureIndex = hzToFeatureIndex(hz, melConfig);
    const normalized = featureIndex / (melConfig.nMels - 1);
    return height * (1 - normalized);
}

function xToTime(x: number, width: number, startTime: number, endTime: number): number {
    if (width <= 0) return startTime;
    return startTime + (x / width) * (endTime - startTime);
}

// ----------------------------
// Hook
// ----------------------------

export function useBandInteraction({
    containerRef,
    startTime,
    endTime,
    width,
    height,
    melConfig,
    minBandWidthHz = 20,
    snapTime,
    snapTolerancePx = 8,
}: UseBandInteractionOptions) {
    const dragStartRef = useRef<{
        initialLowHz: number;
        initialHighHz: number;
        initialY: number;
        initialX: number;
        initialKeyframeTime: number;
        time: number;
    } | null>(null);

    const {
        structure,
        dragState,
        startDrag,
        endDrag,
        updateBand,
        getBandById,
    } = useFrequencyBandStore(useShallow((s) => ({
        structure: s.structure,
        dragState: s.dragState,
        startDrag: s.startDrag,
        endDrag: s.endDrag,
        updateBand: s.updateBand,
        getBandById: s.getBandById,
    })));

    // Handle drag start from overlay
    const handleDragStart = useCallback(
        (info: {
            bandId: string;
            mode: "low-edge" | "high-edge" | "body" | "keyframe-time";
            startValue: number;
            clientY: number;
            clientX: number;
        }) => {
            const band = getBandById(info.bandId);
            if (!band) return;

            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const y = info.clientY - rect.top;
            const x = info.clientX - rect.left;

            // Get current frequency bounds at the center of visible range
            const time = (startTime + endTime) / 2;
            const bounds = frequencyBoundsAt(band, time);
            if (!bounds) return;

            dragStartRef.current = {
                initialLowHz: bounds.lowHz,
                initialHighHz: bounds.highHz,
                initialY: y,
                initialX: x,
                initialKeyframeTime: info.mode === "keyframe-time" ? info.startValue : 0,
                time,
            };

            startDrag({
                bandId: info.bandId,
                mode: info.mode,
                startValue: info.startValue,
                startPosition: info.mode === "keyframe-time" ? info.clientX : info.clientY,
            });
        },
        [containerRef, startTime, endTime, getBandById, startDrag]
    );

    // Handle mouse move during drag
    useEffect(() => {
        if (!dragState) return;

        const handleMouseMove = (e: MouseEvent) => {
            const container = containerRef.current;
            if (!container || !dragStartRef.current) return;

            const rect = container.getBoundingClientRect();
            const y = e.clientY - rect.top;

            const band = getBandById(dragState.bandId);
            if (!band) return;

            const { initialLowHz, initialHighHz, initialY, time } = dragStartRef.current;

            // Convert Y delta to Hz delta
            const currentHz = yToHz(y, height, melConfig);
            const initialHz = yToHz(initialY, height, melConfig);
            const deltaHz = currentHz - initialHz;

            let newLowHz = initialLowHz;
            let newHighHz = initialHighHz;

            switch (dragState.mode) {
                case "low-edge":
                    // Dragging lower edge
                    newLowHz = Math.max(
                        melConfig.fMin,
                        Math.min(initialHighHz - minBandWidthHz, initialLowHz + deltaHz)
                    );
                    break;

                case "high-edge":
                    // Dragging upper edge
                    newHighHz = Math.min(
                        melConfig.fMax,
                        Math.max(initialLowHz + minBandWidthHz, initialHighHz + deltaHz)
                    );
                    break;

                case "body":
                    // Dragging the whole band (shift vertically)
                    const bandWidth = initialHighHz - initialLowHz;
                    newLowHz = initialLowHz + deltaHz;
                    newHighHz = initialHighHz + deltaHz;

                    // Clamp to valid range
                    if (newLowHz < melConfig.fMin) {
                        newLowHz = melConfig.fMin;
                        newHighHz = melConfig.fMin + bandWidth;
                    }
                    if (newHighHz > melConfig.fMax) {
                        newHighHz = melConfig.fMax;
                        newLowHz = melConfig.fMax - bandWidth;
                    }
                    break;

                case "keyframe-time": {
                    // Drag keyframe horizontally in time
                    const rect = container.getBoundingClientRect();
                    const currentX = e.clientX - rect.left;
                    let newTime = xToTime(currentX, width, startTime, endTime);

                    // Clamp to valid time range (within audio duration)
                    newTime = Math.max(0, newTime);

                    // Apply snapping if available
                    if (snapTime) {
                        // Convert pixel tolerance to time tolerance
                        const timeRange = endTime - startTime;
                        const toleranceSec = width > 0 ? (snapTolerancePx / width) * timeRange : 0;
                        newTime = snapTime(newTime, toleranceSec);
                    }

                    // Use moveKeyframeTime to update the band
                    const updatedBand = moveKeyframeTime(
                        band,
                        dragStartRef.current.initialKeyframeTime,
                        newTime
                    );

                    // Update the initial keyframe time so subsequent moves work correctly
                    dragStartRef.current.initialKeyframeTime = newTime;

                    updateBand(band.id, { frequencyShape: updatedBand.frequencyShape });
                    return;
                }
            }

            // Update all segments uniformly for now (constant bands)
            // For time-varying bands, we'd need more sophisticated logic
            const newSegments = band.frequencyShape.map((seg) => ({
                ...seg,
                lowHzStart: newLowHz,
                lowHzEnd: newLowHz,
                highHzStart: newHighHz,
                highHzEnd: newHighHz,
            }));

            updateBand(band.id, { frequencyShape: newSegments });
        };

        const handleMouseUp = () => {
            dragStartRef.current = null;
            endDrag();
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [
        dragState,
        containerRef,
        width,
        height,
        startTime,
        endTime,
        melConfig,
        minBandWidthHz,
        snapTime,
        snapTolerancePx,
        getBandById,
        updateBand,
        endDrag,
    ]);

    return {
        handleDragStart,
        isDragging: dragState !== null,
    };
}
