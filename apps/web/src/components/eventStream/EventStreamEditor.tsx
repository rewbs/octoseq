"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { GripHorizontal } from "lucide-react";
import { generateBeatTimes } from "@octoseq/mir";
import { GenericBeatGridOverlay } from "@/components/beatGrid/GenericBeatGridOverlay";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import type { AuthoredEvent } from "@/lib/stores/types/authoredEvent";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 300;
const DEFAULT_HEIGHT = 120;

// Visual constants
const EVENT_MARKER_WIDTH = 4;
const EVENT_MARKER_MIN_HEIGHT = 8;
const SELECTION_BOX_COLOR = "rgba(59, 130, 246, 0.2)";
const SELECTION_BOX_BORDER = "rgba(59, 130, 246, 0.6)";
const HOVER_HIGHLIGHT_COLOR = "rgba(255, 255, 255, 0.3)";

export interface EventStreamEditorProps {
  /** Stream ID to edit */
  streamId: string;
  /** Viewport from the main WaveSurfer instance */
  viewport: WaveSurferViewport | null;
  /** Shared cursor time (playhead or hover) */
  cursorTimeSec?: number | null;
  /** Notify parent when hovering to sync cursor */
  onCursorTimeChange?: (timeSec: number | null) => void;
  /** Audio duration in seconds */
  audioDuration: number;
  /** Show beat grid overlay */
  showBeatGrid?: boolean;
}

interface DragState {
  mode: "select-box" | "move-events";
  startX: number;
  startY: number;
  startTime: number;
  currentX: number;
  currentY: number;
  /** For move-events: original times of selected events */
  originalTimes?: Map<string, number>;
}

/**
 * Canvas-based timeline editor for a single authored event stream.
 * Supports selection, drag-to-move, delete, and click-to-add.
 */
export function EventStreamEditor({
  streamId,
  viewport,
  cursorTimeSec,
  onCursorTimeChange,
  audioDuration,
  showBeatGrid = true,
}: EventStreamEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Panel height (resizable)
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);

  // Hover state
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  // Drag state
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Get stream and selection from store
  const { stream, selectedEventIds } = useAuthoredEventStore(
    useShallow((s) => ({
      stream: s.streams.get(streamId),
      selectedEventIds: s.selectedEventIds,
    }))
  );

  const {
    addEventAtTime,
    deleteSelectedEvents,
    moveSelectedEvents,
  } = useAuthoredEventActions();

  const selectEvent = useAuthoredEventStore((s) => s.selectEvent);
  const selectEvents = useAuthoredEventStore((s) => s.selectEvents);
  const toggleEventSelection = useAuthoredEventStore((s) => s.toggleEventSelection);
  const clearSelection = useAuthoredEventStore((s) => s.clearSelection);

  // Beat grid for snapping
  const activeBeatGrid = useBeatGridStore((s) => s.activeBeatGrid);
  const beatGridVisible = useBeatGridStore((s) => s.isVisible);

  // Compute beat times from the active beat grid
  const beatTimes = useMemo(() => {
    if (!activeBeatGrid || audioDuration <= 0) return [];
    return generateBeatTimes(
      activeBeatGrid.bpm,
      activeBeatGrid.phaseOffset,
      activeBeatGrid.userNudge,
      audioDuration
    );
  }, [activeBeatGrid, audioDuration]);

  // Convert X position to time
  const xToTime = useCallback(
    (x: number, width: number): number => {
      if (!viewport || width <= 0) return 0;
      const fraction = x / width;
      return viewport.startTime + fraction * (viewport.endTime - viewport.startTime);
    },
    [viewport]
  );

  // Convert time to X position
  const timeToX = useCallback(
    (time: number, width: number): number => {
      if (!viewport) return 0;
      const visibleDuration = viewport.endTime - viewport.startTime;
      if (visibleDuration <= 0) return 0;
      return ((time - viewport.startTime) / visibleDuration) * width;
    },
    [viewport]
  );

  // Snap time to beat grid if enabled (when beat grid is visible)
  const snapTime = useCallback(
    (time: number): number => {
      if (!beatGridVisible || beatTimes.length === 0) return time;

      // Find closest beat
      let closest = beatTimes[0]!;
      let closestDist = Math.abs(time - closest);

      for (const beatTime of beatTimes) {
        const dist = Math.abs(time - beatTime);
        if (dist < closestDist) {
          closest = beatTime;
          closestDist = dist;
        }
      }

      // Snap if within threshold (0.05 seconds)
      const threshold = 0.05;
      if (closestDist < threshold) {
        return closest;
      }

      return time;
    },
    [beatGridVisible, beatTimes]
  );

  // Find event at position
  const findEventAtPosition = useCallback(
    (x: number, width: number): AuthoredEvent | null => {
      if (!stream || !viewport) return null;

      const clickTime = xToTime(x, width);
      const tolerance = (viewport.endTime - viewport.startTime) * 0.01; // 1% of visible range

      for (const event of stream.events) {
        if (Math.abs(event.time - clickTime) < tolerance) {
          return event;
        }
      }

      return null;
    },
    [stream, viewport, xToTime]
  );

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !viewport || !stream) return;

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext("2d");
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) return;

    // Handle device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw events
    const { startTime, endTime } = viewport;

    for (const event of stream.events) {
      // Skip events outside viewport (with margin)
      if (event.time < startTime - 1 || event.time > endTime + 1) continue;

      const x = timeToX(event.time, width);
      const markerHeight = Math.max(
        EVENT_MARKER_MIN_HEIGHT,
        height * 0.8 * event.weight
      );
      const y = height - markerHeight;

      const isSelected = selectedEventIds.has(event.id);
      const isHovered = event.id === hoveredEventId;

      // Draw marker
      ctx.save();

      // Shadow for selected events
      if (isSelected) {
        ctx.shadowColor = stream.color.stroke;
        ctx.shadowBlur = 8;
      }

      // Fill
      ctx.fillStyle = isSelected ? stream.color.stroke : stream.color.fill;
      ctx.globalAlpha = isHovered ? 1 : 0.8;

      // Draw rounded rect
      const markerX = x - EVENT_MARKER_WIDTH / 2;
      ctx.beginPath();
      ctx.roundRect(markerX, y, EVENT_MARKER_WIDTH, markerHeight, 2);
      ctx.fill();

      // Stroke
      ctx.strokeStyle = stream.color.stroke;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Hover highlight
      if (isHovered) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = HOVER_HIGHLIGHT_COLOR;
        ctx.fill();
      }

      ctx.restore();
    }

    // Draw selection box if in box-select mode
    if (dragState?.mode === "select-box") {
      const boxX = Math.min(dragState.startX, dragState.currentX);
      const boxY = Math.min(dragState.startY, dragState.currentY);
      const boxW = Math.abs(dragState.currentX - dragState.startX);
      const boxH = Math.abs(dragState.currentY - dragState.startY);

      ctx.save();
      ctx.fillStyle = SELECTION_BOX_COLOR;
      ctx.strokeStyle = SELECTION_BOX_BORDER;
      ctx.lineWidth = 1;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.restore();
    }

    // Draw cursor
    if (cursorTimeSec != null && cursorTimeSec >= startTime && cursorTimeSec <= endTime) {
      const cursorX = timeToX(cursorTimeSec, width);
      ctx.save();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, height);
      ctx.stroke();
      ctx.restore();
    }
  }, [viewport, stream, selectedEventIds, hoveredEventId, dragState, cursorTimeSec, timeToX]);

  // Re-render when deps change
  useEffect(() => {
    render();
  }, [render]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      render();
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [render]);

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!viewport) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;

      const time = xToTime(x, width);
      onCursorTimeChange?.(time);

      // Update drag state
      if (dragState) {
        setDragState((prev) => prev ? { ...prev, currentX: x, currentY: y } : null);
        return;
      }

      // Update hover
      const hoveredEvent = findEventAtPosition(x, width);
      setHoveredEventId(hoveredEvent?.id ?? null);
    },
    [viewport, xToTime, onCursorTimeChange, dragState, findEventAtPosition]
  );

  // Mouse leave handler
  const handleMouseLeave = useCallback(() => {
    onCursorTimeChange?.(null);
    setHoveredEventId(null);
  }, [onCursorTimeChange]);

  // Mouse down handler
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!viewport || !stream) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;
      const time = xToTime(x, width);

      const clickedEvent = findEventAtPosition(x, width);

      if (clickedEvent) {
        // Clicked on an event
        if (e.shiftKey) {
          // Shift+click: toggle selection
          toggleEventSelection(clickedEvent.id);
        } else if (!selectedEventIds.has(clickedEvent.id)) {
          // Click on unselected: select only this one
          selectEvent(clickedEvent.id);
        }

        // Start move drag if event is now selected
        if (selectedEventIds.has(clickedEvent.id) || !e.shiftKey) {
          const originalTimes = new Map<string, number>();
          const idsToMove = e.shiftKey
            ? new Set([...selectedEventIds, clickedEvent.id])
            : selectedEventIds.has(clickedEvent.id)
              ? selectedEventIds
              : new Set([clickedEvent.id]);

          for (const event of stream.events) {
            if (idsToMove.has(event.id)) {
              originalTimes.set(event.id, event.time);
            }
          }

          setDragState({
            mode: "move-events",
            startX: x,
            startY: y,
            startTime: time,
            currentX: x,
            currentY: y,
            originalTimes,
          });
        }
      } else {
        // Clicked on empty space
        if (e.shiftKey) {
          // Shift+click on empty: start box selection
          setDragState({
            mode: "select-box",
            startX: x,
            startY: y,
            startTime: time,
            currentX: x,
            currentY: y,
          });
        } else {
          // Regular click on empty: add event
          const snappedTime = snapTime(time);
          const clampedTime = Math.max(0, Math.min(audioDuration, snappedTime));
          addEventAtTime(streamId, clampedTime);
          clearSelection();
        }
      }
    },
    [
      viewport,
      stream,
      streamId,
      selectedEventIds,
      xToTime,
      findEventAtPosition,
      toggleEventSelection,
      selectEvent,
      clearSelection,
      addEventAtTime,
      snapTime,
      audioDuration,
    ]
  );

  // Mouse up handler
  const handleMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!dragState || !stream) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const width = rect.width;

      if (dragState.mode === "select-box") {
        // Complete box selection
        const startTime = xToTime(Math.min(dragState.startX, dragState.currentX), width);
        const endTime = xToTime(Math.max(dragState.startX, dragState.currentX), width);

        const eventsInBox = stream.events.filter(
          (event) => event.time >= startTime && event.time <= endTime
        );

        if (eventsInBox.length > 0) {
          selectEvents(eventsInBox.map((e) => e.id));
        }
      } else if (dragState.mode === "move-events" && dragState.originalTimes) {
        // Complete move
        const deltaTime = xToTime(dragState.currentX, width) - dragState.startTime;

        if (Math.abs(deltaTime) > 0.001) {
          // Only move if significant
          const snappedDelta = snapTime(dragState.startTime + deltaTime) - dragState.startTime;
          moveSelectedEvents(streamId, selectedEventIds, snappedDelta);
        }
      }

      setDragState(null);
    },
    [dragState, stream, streamId, selectedEventIds, xToTime, selectEvents, moveSelectedEvents, snapTime]
  );

  // Key down handler
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEventIds.size > 0) {
          e.preventDefault();
          deleteSelectedEvents(streamId, selectedEventIds);
        }
      } else if (e.key === "Escape") {
        clearSelection();
        setDragState(null);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        // Select all
        e.preventDefault();
        if (stream) {
          selectEvents(stream.events.map((event) => event.id));
        }
      }
    },
    [selectedEventIds, streamId, deleteSelectedEvents, clearSelection, stream, selectEvents]
  );

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartYRef.current = e.clientY;
      resizeStartHeightRef.current = panelHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [panelHeight]
  );

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dy = e.clientY - resizeStartYRef.current;
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, resizeStartHeightRef.current + dy)
      );
      setPanelHeight(newHeight);
    };

    const handleResizeEnd = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, []);

  if (!stream) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Stream not found.
      </div>
    );
  }

  return (
    <div className="relative bg-zinc-100 dark:bg-zinc-900 rounded overflow-hidden">
      {/* Stream label */}
      <div className="absolute top-1 left-2 z-10">
        <span
          className="text-xs font-medium px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60 backdrop-blur-sm"
          style={{ color: stream.color.stroke }}
        >
          {stream.name}
        </span>
        <span className="ml-2 text-xs text-zinc-400">
          {stream.events.length} events
          {selectedEventIds.size > 0 && ` (${selectedEventIds.size} selected)`}
        </span>
      </div>

      {/* Hint */}
      <div className="absolute top-1 right-2 z-10">
        <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800/60 backdrop-blur-sm">
          Click to add • Drag to move • Delete to remove
        </span>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="relative w-full focus:outline-none"
        style={{ height: `${panelHeight}px` }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Beat grid overlay */}
        {showBeatGrid && audioDuration > 0 && (
          <GenericBeatGridOverlay
            viewport={viewport}
            audioDuration={audioDuration}
            height={panelHeight}
          />
        )}
      </div>

      {/* Resize grip */}
      <div
        className="absolute bottom-0 left-0 right-0 h-4 flex items-center justify-center cursor-ns-resize bg-gradient-to-t from-zinc-200/50 dark:from-zinc-800/50 to-transparent hover:from-zinc-300/70 dark:hover:from-zinc-700/70 transition-colors"
        onMouseDown={handleResizeStart}
      >
        <GripHorizontal className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
      </div>
    </div>
  );
}
