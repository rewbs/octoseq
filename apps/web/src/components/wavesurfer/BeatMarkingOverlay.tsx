"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { X, Check, RotateCcw, MousePointerClick } from "lucide-react";

export type BeatMarkingOverlayProps = {
  /** Whether beat marking mode is active */
  isActive: boolean;
  /** Current viewport for time-to-pixel conversion */
  viewport: { startSec: number; endSec: number } | null;
  /** Beat 1 time in seconds */
  beat1TimeSec: number | null;
  /** Beat 2 time in seconds */
  beat2TimeSec: number | null;
  /** Audio duration in seconds */
  audioDuration: number;
  /** Callback when user clicks to place a beat */
  onBeatClick: (timeSec: number) => void;
  /** Callback when user drags a beat marker */
  onBeatDrag: (beatIndex: 1 | 2, timeSec: number) => void;
  /** Callback to apply the marked tempo */
  onApply: () => void;
  /** Callback to reset the markers */
  onReset: () => void;
  /** Callback to cancel beat marking mode */
  onCancel: () => void;
};

/**
 * Convert time in seconds to pixel position within the viewport.
 */
function timeToPixel(
  timeSec: number,
  viewport: { startSec: number; endSec: number },
  containerWidth: number
): number {
  const viewDuration = viewport.endSec - viewport.startSec;
  if (viewDuration <= 0) return 0;
  const fraction = (timeSec - viewport.startSec) / viewDuration;
  return fraction * containerWidth;
}

/**
 * Convert pixel position to time in seconds.
 */
function pixelToTime(
  pixelX: number,
  viewport: { startSec: number; endSec: number },
  containerWidth: number
): number {
  if (containerWidth <= 0) return viewport.startSec;
  const fraction = pixelX / containerWidth;
  const viewDuration = viewport.endSec - viewport.startSec;
  return viewport.startSec + fraction * viewDuration;
}

/**
 * Calculate BPM from two beat times.
 */
function calculateBpm(beat1Sec: number, beat2Sec: number): number {
  const intervalSec = Math.abs(beat2Sec - beat1Sec);
  if (intervalSec <= 0) return 0;
  return 60 / intervalSec;
}

/**
 * Overlay component for marking two beats on the waveform to set tempo.
 * Provides a delightful, tactile interface for precise tempo entry.
 */
export function BeatMarkingOverlay({
  isActive,
  viewport,
  beat1TimeSec,
  beat2TimeSec,
  audioDuration,
  onBeatClick,
  onBeatDrag,
  onApply,
  onReset,
  onCancel,
}: BeatMarkingOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width using ResizeObserver
  useEffect(() => {
    if (!overlayRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(overlayRef.current);
    // Initial measurement
    setContainerWidth(overlayRef.current.clientWidth);

    return () => observer.disconnect();
  }, [isActive]);

  // Calculate BPM from current marks
  const calculatedBpm = useMemo(() => {
    if (beat1TimeSec === null || beat2TimeSec === null) return null;
    const bpm = calculateBpm(beat1TimeSec, beat2TimeSec);
    // Reasonable BPM range check
    if (bpm < 20 || bpm > 400) return null;
    return bpm;
  }, [beat1TimeSec, beat2TimeSec]);

  // Calculate beat preview positions (extend grid from the marks)
  const beatPreviews = useMemo(() => {
    if (beat1TimeSec === null || beat2TimeSec === null || !calculatedBpm || !viewport) return [];

    const interval = Math.abs(beat2TimeSec - beat1TimeSec);
    if (interval <= 0) return [];

    const firstBeat = Math.min(beat1TimeSec, beat2TimeSec);
    const previews: number[] = [];

    // Extend backwards
    let t = firstBeat - interval;
    while (t >= 0 && previews.length < 100) {
      previews.push(t);
      t -= interval;
    }

    // Extend forwards
    t = firstBeat;
    while (t <= audioDuration && previews.length < 200) {
      previews.push(t);
      t += interval;
    }

    return previews
      .filter((time) => time >= viewport.startSec && time <= viewport.endSec)
      .map((time) => timeToPixel(time, viewport, containerWidth));
  }, [beat1TimeSec, beat2TimeSec, calculatedBpm, viewport, containerWidth, audioDuration]);

  // Handle mouse move for hover preview and dragging
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!overlayRef.current || !viewport) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (dragging) {
        const timeSec = pixelToTime(x, viewport, containerWidth);
        const clampedTime = Math.max(0, Math.min(audioDuration, timeSec));
        onBeatDrag(dragging, clampedTime);
      } else {
        setHoverX(x);
      }
    },
    [dragging, viewport, containerWidth, audioDuration, onBeatDrag]
  );

  // Handle mouse down - either start dragging or place a beat
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!overlayRef.current || !viewport) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Check if clicking near an existing marker (within 10px)
      const beat1Px = beat1TimeSec !== null ? timeToPixel(beat1TimeSec, viewport, containerWidth) : null;
      const beat2Px = beat2TimeSec !== null ? timeToPixel(beat2TimeSec, viewport, containerWidth) : null;

      if (beat1Px !== null && Math.abs(x - beat1Px) < 10) {
        setDragging(1);
        e.preventDefault();
        return;
      }
      if (beat2Px !== null && Math.abs(x - beat2Px) < 10) {
        setDragging(2);
        e.preventDefault();
        return;
      }

      // Otherwise, place a new beat
      const timeSec = pixelToTime(x, viewport, containerWidth);
      const clampedTime = Math.max(0, Math.min(audioDuration, timeSec));
      onBeatClick(clampedTime);
    },
    [viewport, containerWidth, beat1TimeSec, beat2TimeSec, audioDuration, onBeatClick]
  );

  // Handle mouse up - stop dragging
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Handle mouse leave - clear hover and stop dragging
  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
    setDragging(null);
  }, []);

  // Global mouse up to handle drag release outside overlay
  useEffect(() => {
    const handleGlobalMouseUp = () => setDragging(null);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  if (!isActive) return null;

  const beat1Px = beat1TimeSec !== null && viewport ? timeToPixel(beat1TimeSec, viewport, containerWidth) : null;
  const beat2Px = beat2TimeSec !== null && viewport ? timeToPixel(beat2TimeSec, viewport, containerWidth) : null;

  // Determine instruction text based on state
  let instructionText: string;
  let instructionIcon: React.ReactNode;

  if (beat1TimeSec === null) {
    instructionText = "Click on the waveform to mark the first beat";
    instructionIcon = <MousePointerClick className="w-5 h-5" />;
  } else if (beat2TimeSec === null) {
    instructionText = "Click on the waveform to mark the second beat";
    instructionIcon = <MousePointerClick className="w-5 h-5" />;
  } else {
    instructionText = "Drag markers to adjust, then apply";
    instructionIcon = null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: dragging ? "ew-resize" : "crosshair" }}
    >
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />

      {/* Beat preview lines (faded grid preview) */}
      {beatPreviews.map((px, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-blue-400/30 pointer-events-none"
          style={{ left: px }}
        />
      ))}

      {/* Hover preview line */}
      {hoverX !== null && !dragging && (beat1TimeSec === null || beat2TimeSec === null) && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-blue-400/50 pointer-events-none"
          style={{ left: hoverX }}
        />
      )}

      {/* Beat 1 marker */}
      {beat1Px !== null && beat1TimeSec !== null && (
        <div
          className={`absolute top-0 bottom-0 w-1 transition-colors ${
            dragging === 1 ? "bg-emerald-400" : "bg-emerald-500 hover:bg-emerald-400"
          }`}
          style={{ left: beat1Px - 2, cursor: "ew-resize" }}
        >
          {/* Label */}
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-1">
            <div className="bg-emerald-500 text-white text-xs font-medium px-2 py-0.5 rounded-t whitespace-nowrap">
              Beat 1
            </div>
          </div>
          {/* Time display */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full mt-1">
            <div className="bg-emerald-500/90 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap font-mono">
              {beat1TimeSec.toFixed(3)}s
            </div>
          </div>
        </div>
      )}

      {/* Beat 2 marker */}
      {beat2Px !== null && beat2TimeSec !== null && (
        <div
          className={`absolute top-0 bottom-0 w-1 transition-colors ${
            dragging === 2 ? "bg-orange-400" : "bg-orange-500 hover:bg-orange-400"
          }`}
          style={{ left: beat2Px - 2, cursor: "ew-resize" }}
        >
          {/* Label */}
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-1">
            <div className="bg-orange-500 text-white text-xs font-medium px-2 py-0.5 rounded-t whitespace-nowrap">
              Beat 2
            </div>
          </div>
          {/* Time display */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full mt-1">
            <div className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap font-mono">
              {beat2TimeSec.toFixed(3)}s
            </div>
          </div>
        </div>
      )}

      {/* Interval indicator between beats */}
      {beat1Px !== null && beat2Px !== null && (
        <div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: Math.min(beat1Px, beat2Px),
            width: Math.abs(beat2Px - beat1Px),
          }}
        >
          <div className="h-0.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-orange-500 opacity-50" />
        </div>
      )}

      {/* Top bar with instructions and controls */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-zinc-900/90 to-transparent pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Instructions */}
        <div className="flex items-center gap-2 text-white">
          {instructionIcon}
          <span className="text-sm font-medium">{instructionText}</span>
        </div>

        {/* BPM display */}
        {calculatedBpm !== null && (
          <div className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded-full">
            <span className="text-sm font-medium">Calculated:</span>
            <span className="text-lg font-bold font-mono">{calculatedBpm.toFixed(1)}</span>
            <span className="text-sm">BPM</span>
          </div>
        )}

        {/* Control buttons */}
        <div className="flex items-center gap-2">
          {(beat1TimeSec !== null || beat2TimeSec !== null) && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          {calculatedBpm !== null && (
            <button
              type="button"
              onClick={onApply}
              className="flex items-center gap-1 px-4 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded font-medium transition-colors"
            >
              <Check className="w-4 h-4" />
              Apply {calculatedBpm.toFixed(1)} BPM
            </button>
          )}
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="absolute bottom-2 left-2 text-xs text-white/70 bg-zinc-900/70 px-2 py-1 rounded pointer-events-none">
        <span className="opacity-70">Drag markers to fine-tune</span>
        <span className="mx-2 opacity-50">|</span>
        <span className="opacity-70">Phase will be set to Beat 1 position</span>
      </div>
    </div>
  );
}
