"use client";

import { useRef, useCallback, useMemo, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { TimeAlignedHeatmapPixi, type TimeAlignedHeatmapData, type HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { FrequencyBandOverlay } from "./FrequencyBandOverlay";
import { BeatGridOverlay } from "@/components/wavesurfer/BeatGridOverlay";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useElementSize } from "@/lib/useElementSize";
import { useBandInteraction } from "@/lib/hooks/useBandInteraction";
import { splitBandSegmentAt, type MelConversionConfig, type BeatGrid, type MusicalTimeSegment } from "@octoseq/mir";

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

    // Beat grid overlay props
    /** Audio duration for beat grid overlay. */
    audioDuration?: number;

    /** Beat grid to display. */
    beatGrid?: BeatGrid | null;

    /** Whether beat grid overlay is visible. */
    beatGridVisible?: boolean;

    /** Musical time segments for beat grid overlay. */
    musicalTimeSegments?: MusicalTimeSegment[];

    /** Selected segment ID for highlighting. */
    selectedSegmentId?: string | null;

    /** Playhead/cursor time for position indicator. */
    playheadTimeSec?: number | null;

    /** Audio source ID to filter bands by. If not provided, shows all bands. */
    sourceId?: string;
};

// Default mel config (matches typical spectrogram settings)
const DEFAULT_MEL_CONFIG: MelConversionConfig = {
    nMels: 128,
    fMin: 0,
    fMax: 8000, // Default to 8kHz as typical for web audio
};

// ----------------------------
// Layout Constants
// ----------------------------

// These values must match TimeAlignedHeatmapPixi's layout:
// - 1px border (top + bottom = 2px)
// - p-1 padding (4px top + 4px bottom = 8px)
// - h-2 resize handle (8px)
// Total non-canvas height = 18px
const HEATMAP_NON_CANVAS_HEIGHT = 18;

// Offset from top of container to canvas = border (1px) + padding (4px)
const HEATMAP_CANVAS_TOP_OFFSET = 5;

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
    audioDuration = 0,
    beatGrid = null,
    beatGridVisible = true,
    musicalTimeSegments = [],
    selectedSegmentId = null,
    playheadTimeSec = null,
    sourceId,
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
        getBandsForSource,
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
            getBandsForSource: s.getBandsForSource,
        }))
    );

    // Filter bands by sourceId if provided
    const filteredStructure = useMemo(() => {
        if (!structure) return null;
        if (!sourceId) return structure; // No filter, show all bands

        const filteredBands = getBandsForSource(sourceId);
        return {
            ...structure,
            bands: filteredBands,
        };
    }, [structure, sourceId, getBandsForSource]);

    // Get the actual rendered height from the container
    // The heatmap manages its own height, so we track it
    const overlayHeight = containerSize?.height || initialHeight;

    // Create a viewport object for the beat grid overlay
    const viewport: WaveSurferViewport | null = useMemo(() => {
        if (width <= 0) return null;
        const span = endTime - startTime;
        return {
            startTime,
            endTime,
            containerWidthPx: width,
            totalWidthPx: width,
            minPxPerSec: span > 0 ? width / span : 100,
        };
    }, [startTime, endTime, width]);

    // Calculate the actual canvas height (total height minus non-canvas elements)
    const canvasHeight = overlayHeight - HEATMAP_NON_CANVAS_HEIGHT;

    // Set up drag interaction
    const { handleDragStart } = useBandInteraction({
        containerRef: overlayContainerRef,
        startTime,
        endTime,
        width,
        height: canvasHeight,
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
            {filteredStructure && filteredStructure.bands.length > 0 && (
                <div
                    ref={overlayContainerRef}
                    className="absolute top-0 left-0"
                    style={{ padding: `${HEATMAP_CANVAS_TOP_OFFSET}px` }}
                >
                    <FrequencyBandOverlay
                        startTime={startTime}
                        endTime={endTime}
                        width={width}
                        height={canvasHeight}
                        structure={filteredStructure}
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

            {/* Beat grid overlay positioned on top of heatmap */}
            {viewport && audioDuration > 0 && (
                <div
                    className="absolute inset-x-0 top-0 z-10"
                    style={{ padding: `${HEATMAP_CANVAS_TOP_OFFSET}px` }}
                >
                    <BeatGridOverlay
                        viewport={viewport}
                        beatGrid={beatGrid}
                        audioDuration={audioDuration}
                        height={canvasHeight}
                        isVisible={beatGridVisible}
                        musicalTimeSegments={musicalTimeSegments}
                        selectedSegmentId={selectedSegmentId}
                    />
                </div>
            )}

            {/* Playhead/cursor overlay */}
            {viewport && (
                <div
                    className="absolute inset-x-0 top-0 pointer-events-none z-10"
                    style={{ padding: `${HEATMAP_CANVAS_TOP_OFFSET}px` }}
                >
                    <HeatmapPlayheadOverlay
                        viewport={viewport}
                        timeSec={playheadTimeSec}
                        height={canvasHeight}
                        widthPx={width}
                    />
                </div>
            )}
        </div>
    );
}
