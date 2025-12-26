"use client";

import { useRef, useCallback, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { TimeAlignedHeatmapPixi, type TimeAlignedHeatmapData, type HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { FrequencyBandOverlay } from "./FrequencyBandOverlay";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useElementSize } from "@/lib/useElementSize";
import { useBandInteraction } from "@/lib/hooks/useBandInteraction";
import { splitBandSegmentAt, type MelConversionConfig } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type HeatmapWithBandOverlayProps = {
    /** Heatmap input data. */
    input: TimeAlignedHeatmapData | null;

    /** Visible time range in seconds. */
    startTime: number;
    endTime: number;

    /** Width in pixels. */
    width: number;

    /** Initial height for the heatmap. */
    initialHeight?: number;

    /** Optional fixed value range. */
    valueRange?: { min: number; max: number };

    /** Y axis label. */
    yLabel?: string;

    /** Color scheme for the heatmap. */
    colorScheme?: HeatmapColorScheme;

    /** Mel configuration for frequency mapping. */
    melConfig?: MelConversionConfig;

    /** Mouse move handler for cursor tracking. */
    onMouseMove?: (e: MouseEvent<HTMLElement>) => void;

    /** Mouse leave handler. */
    onMouseLeave?: () => void;
};

// Default mel config (matches typical spectrogram settings)
const DEFAULT_MEL_CONFIG: MelConversionConfig = {
    nMels: 128,
    fMin: 0,
    fMax: 8000, // Default to 8kHz as typical for web audio
};

// ----------------------------
// Component
// ----------------------------

export function HeatmapWithBandOverlay({
    input,
    startTime,
    endTime,
    width,
    initialHeight = 150,
    valueRange,
    yLabel,
    colorScheme = "grayscale",
    melConfig = DEFAULT_MEL_CONFIG,
    onMouseMove,
    onMouseLeave,
}: HeatmapWithBandOverlayProps) {
    const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
    const overlayContainerRef = useRef<HTMLDivElement>(null);

    // Get band store state
    const {
        structure,
        selectedBandId,
        hoveredBandId,
        hoveredKeyframeTime,
        selectBand,
        setHoveredBandId,
        setHoveredKeyframeTime,
        updateBand,
        getBandById,
    } = useFrequencyBandStore(
        useShallow((s) => ({
            structure: s.structure,
            selectedBandId: s.selectedBandId,
            hoveredBandId: s.hoveredBandId,
            hoveredKeyframeTime: s.hoveredKeyframeTime,
            selectBand: s.selectBand,
            setHoveredBandId: s.setHoveredBandId,
            setHoveredKeyframeTime: s.setHoveredKeyframeTime,
            updateBand: s.updateBand,
            getBandById: s.getBandById,
        }))
    );

    // Get the actual rendered height from the container
    // The heatmap manages its own height, so we track it
    const overlayHeight = containerSize?.height || initialHeight;

    // Set up drag interaction
    const { handleDragStart } = useBandInteraction({
        containerRef: overlayContainerRef,
        startTime,
        endTime,
        width,
        height: overlayHeight - 16,
        melConfig,
    });

    // Handle double-click to add a keyframe (split segment)
    const handleDoubleClick = useCallback(
        (bandId: string, time: number) => {
            const band = getBandById(bandId);
            if (!band) return;

            // Split the segment at the given time
            const updatedBand = splitBandSegmentAt(band, time);

            // Update the band in the store
            updateBand(bandId, { frequencyShape: updatedBand.frequencyShape });

            // Select the band if not already selected
            if (selectedBandId !== bandId) {
                selectBand(bandId);
            }
        },
        [getBandById, updateBand, selectedBandId, selectBand]
    );

    return (
        <div
            ref={containerRef}
            className="relative"
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
        >
            <TimeAlignedHeatmapPixi
                input={input}
                startTime={startTime}
                endTime={endTime}
                width={width}
                initialHeight={initialHeight}
                valueRange={valueRange}
                yLabel={yLabel}
                colorScheme={colorScheme}
            />

            {/* Band overlay positioned on top of heatmap */}
            {structure && structure.bands.length > 0 && (
                <div
                    ref={overlayContainerRef}
                    className="absolute top-0 left-0"
                    style={{ padding: "4px" }}
                >
                    <FrequencyBandOverlay
                        startTime={startTime}
                        endTime={endTime}
                        width={width}
                        height={overlayHeight - 16} // Account for padding and resize handle
                        structure={structure}
                        selectedBandId={selectedBandId}
                        hoveredBandId={hoveredBandId}
                        hoveredKeyframeTime={hoveredKeyframeTime}
                        melConfig={melConfig}
                        onBandClick={(bandId) => selectBand(bandId)}
                        onBandHover={(bandId) => setHoveredBandId(bandId)}
                        onKeyframeHover={(time) => setHoveredKeyframeTime(time)}
                        onDoubleClick={handleDoubleClick}
                        onDragStart={handleDragStart}
                    />
                </div>
            )}
        </div>
    );
}
