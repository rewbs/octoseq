export type WaveSurferViewport = {
    /** Visible range start (seconds) */
    startTime: number;
    /** Visible range end (seconds) */
    endTime: number;
    /** Visible container width in pixels */
    containerWidthPx: number;
    /** Total scroll width in pixels (for completeness/debug) */
    totalWidthPx: number;
    /** Current WaveSurfer zoom value (minPxPerSec) */
    minPxPerSec: number;
};
