"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Application, Graphics, Container } from "pixi.js";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import { useComposedSignalActions } from "@/lib/stores/hooks/useComposedSignalActions";
import { generateCurvePoints } from "@/lib/composedSignal/interpolate";
import type { ComposedSignalNode, InterpolationType } from "@/lib/stores/types/composedSignal";

const NODE_RADIUS = 6;
const NODE_HOVER_RADIUS = 8;
const GRID_COLOR = 0x3f3f46; // zinc-700
const GRID_COLOR_MAJOR = 0x52525b; // zinc-600
const CURVE_COLOR = 0x3b82f6; // blue-500
const NODE_COLOR = 0x3b82f6; // blue-500
const NODE_SELECTED_COLOR = 0xfbbf24; // amber-400
const NODE_HOVER_COLOR = 0x60a5fa; // blue-400
const PLAYHEAD_COLOR = 0xef4444; // red-500

interface EnvelopeCanvasProps {
  signalId: string;
  bpm: number;
  durationBeats: number;
  playheadBeats?: number | null;
  /** Viewport start time in seconds (from main waveform) */
  viewportStartSec: number;
  /** Viewport end time in seconds (from main waveform) */
  viewportEndSec: number;
  width: number;
  height: number;
}

interface DragState {
  nodeId: string;
  startBeat: number;
  startValue: number;
  offsetX: number;
  offsetY: number;
}

/** Local node position during drag (not yet committed to store) */
interface DraggedNodePosition {
  nodeId: string;
  time_beats: number;
  value: number;
}

/**
 * PixiJS-based envelope editor canvas.
 * Renders beat grid, interpolation curves, and draggable node handles.
 */
export function EnvelopeCanvas({
  signalId,
  bpm,
  durationBeats,
  playheadBeats,
  viewportStartSec,
  viewportEndSec,
  width,
  height,
}: EnvelopeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const gridLayerRef = useRef<Graphics | null>(null);
  const curveLayerRef = useRef<Graphics | null>(null);
  const nodesLayerRef = useRef<Container | null>(null);
  const playheadLayerRef = useRef<Graphics | null>(null);
  const aliveRef = useRef(true);
  const initDoneRef = useRef(false);

  // Use state to track init completion so we can trigger re-renders
  const [isInitialized, setIsInitialized] = useState(false);

  // Convert viewport from seconds to beats
  const viewportStart = useMemo(() => (viewportStartSec * bpm) / 60, [viewportStartSec, bpm]);
  const viewportEnd = useMemo(() => (viewportEndSec * bpm) / 60, [viewportEndSec, bpm]);

  // Hover and drag state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Local position during drag (not committed to store until drag ends)
  const [draggedPosition, setDraggedPosition] = useState<DraggedNodePosition | null>(null);

  // Store state - subscribe directly to signal nodes for reactivity
  const {
    nodes,
    selectedNodeIds,
    selectNode,
    selectNodes,
    clearNodeSelection,
    updateNode,
    addNode,
    removeNodes,
  } = useComposedSignalStore(
    useShallow((s) => {
      const signal = s.structure?.signals.find((sig) => sig.id === signalId);
      return {
        nodes: signal?.nodes ?? [],
        selectedNodeIds: s.selectedNodeIds,
        selectNode: s.selectNode,
        selectNodes: s.selectNodes,
        clearNodeSelection: s.clearNodeSelection,
        updateNode: s.updateNode,
        addNode: s.addNode,
        removeNodes: s.removeNodes,
      };
    })
  );

  const { snapBeatToGrid } = useComposedSignalActions();

  // Coordinate transforms
  const beatToX = useCallback(
    (beat: number): number => {
      const range = viewportEnd - viewportStart;
      if (range <= 0) return 0;
      return ((beat - viewportStart) / range) * width;
    },
    [viewportStart, viewportEnd, width]
  );

  const xToBeat = useCallback(
    (x: number): number => {
      const range = viewportEnd - viewportStart;
      return viewportStart + (x / width) * range;
    },
    [viewportStart, viewportEnd, width]
  );

  const valueToY = useCallback(
    (value: number): number => {
      // 0 at bottom, 1 at top
      const padding = NODE_RADIUS + 2;
      const usableHeight = height - padding * 2;
      return padding + (1 - value) * usableHeight;
    },
    [height]
  );

  const yToValue = useCallback(
    (y: number): number => {
      const padding = NODE_RADIUS + 2;
      const usableHeight = height - padding * 2;
      const value = 1 - (y - padding) / usableHeight;
      return Math.max(0, Math.min(1, value));
    },
    [height]
  );

  // Keep refs in sync
  const nodesRef = useRef(nodes);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const hoveredNodeIdRef = useRef(hoveredNodeId);
  const viewportStartRef = useRef(viewportStart);
  const viewportEndRef = useRef(viewportEnd);
  const playheadBeatsRef = useRef(playheadBeats);
  const beatToXRef = useRef(beatToX);
  const valueToYRef = useRef(valueToY);
  const draggedPositionRef = useRef(draggedPosition);

  useEffect(() => {
    nodesRef.current = nodes;
    selectedNodeIdsRef.current = selectedNodeIds;
    hoveredNodeIdRef.current = hoveredNodeId;
    viewportStartRef.current = viewportStart;
    viewportEndRef.current = viewportEnd;
    playheadBeatsRef.current = playheadBeats;
    beatToXRef.current = beatToX;
    valueToYRef.current = valueToY;
    draggedPositionRef.current = draggedPosition;
  }, [nodes, selectedNodeIds, hoveredNodeId, viewportStart, viewportEnd, playheadBeats, beatToX, valueToY, draggedPosition]);

  // Draw beat grid
  const drawGrid = useCallback(() => {
    const g = gridLayerRef.current;
    if (!g) return;

    g.clear();

    const vStart = viewportStartRef.current;
    const vEnd = viewportEndRef.current;
    const toX = beatToXRef.current;
    const toY = valueToYRef.current;

    // Draw background rect so we can see something
    g.rect(0, 0, width, height);
    g.fill({ color: 0x18181b, alpha: 1 }); // zinc-900

    // Determine grid subdivision based on viewport width
    const beatsVisible = vEnd - vStart;
    let subdivision = 1;
    if (beatsVisible > 64) subdivision = 4;
    else if (beatsVisible > 32) subdivision = 2;
    else if (beatsVisible > 8) subdivision = 1;
    else subdivision = 0.25;

    const startBeat = Math.floor(vStart / subdivision) * subdivision;

    // Draw vertical beat lines
    for (let beat = startBeat; beat <= vEnd; beat += subdivision) {
      const x = toX(beat);
      if (x < 0 || x > width) continue;

      const isMajor = beat % 4 === 0;
      const color = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR;
      const lineAlpha = isMajor ? 0.8 : 0.4;
      const lineWidth = isMajor ? 1.5 : 0.5;

      g.moveTo(x, 0);
      g.lineTo(x, height);
      g.stroke({ color, alpha: lineAlpha, width: lineWidth });
    }

    // Horizontal guide lines at 0, 0.5, 1
    for (const v of [0, 0.5, 1]) {
      const y = toY(v);
      g.moveTo(0, y);
      g.lineTo(width, y);
      g.stroke({ color: GRID_COLOR, alpha: 0.4, width: v === 0.5 ? 1 : 0.5 });
    }
  }, [width, height]);

  // Draw interpolation curves
  const drawCurves = useCallback(() => {
    const g = curveLayerRef.current;
    if (!g) return;

    g.clear();

    const curNodes = nodesRef.current;
    if (curNodes.length < 2) {
      return;
    }

    const toX = beatToXRef.current;
    const toY = valueToYRef.current;
    const dragPos = draggedPositionRef.current;

    // Apply dragged position to nodes for rendering
    const nodesWithDrag = curNodes.map((node) => {
      if (dragPos && dragPos.nodeId === node.id) {
        return { ...node, time_beats: dragPos.time_beats, value: dragPos.value };
      }
      return node;
    });

    // Sort nodes by time
    const sorted = [...nodesWithDrag].sort((a, b) => a.time_beats - b.time_beats);

    g.moveTo(toX(sorted[0]!.time_beats), toY(sorted[0]!.value));

    for (let i = 0; i < sorted.length - 1; i++) {
      const n1 = sorted[i]!;
      const n2 = sorted[i + 1]!;

      // Generate curve points based on interpolation type
      const points = generateCurvePoints(n1, n2, 20);

      for (const p of points) {
        g.lineTo(toX(p.beat), toY(p.value));
      }
      g.lineTo(toX(n2.time_beats), toY(n2.value));
    }

    g.stroke({ color: CURVE_COLOR, alpha: 0.9, width: 2 });
  }, []);

  // Draw nodes
  const drawNodes = useCallback(() => {
    const container = nodesLayerRef.current;
    if (!container) return;

    // Clear existing node graphics
    container.removeChildren();

    const curNodes = nodesRef.current;
    const selected = selectedNodeIdsRef.current;
    const hovered = hoveredNodeIdRef.current;
    const toX = beatToXRef.current;
    const toY = valueToYRef.current;
    const dragPos = draggedPositionRef.current;

    for (const node of curNodes) {
      // Use dragged position if this node is being dragged
      const isDragging = dragPos && dragPos.nodeId === node.id;
      const time_beats = isDragging ? dragPos.time_beats : node.time_beats;
      const value = isDragging ? dragPos.value : node.value;

      const x = toX(time_beats);
      const y = toY(value);

      const isSelected = selected.has(node.id);
      const isHovered = hovered === node.id;
      const radius = isHovered || isDragging ? NODE_HOVER_RADIUS : NODE_RADIUS;
      const color = isSelected ? NODE_SELECTED_COLOR : isHovered ? NODE_HOVER_COLOR : NODE_COLOR;

      const g = new Graphics();
      g.circle(0, 0, radius);
      g.fill({ color, alpha: 1 });
      g.stroke({ color: 0xffffff, alpha: 0.8, width: 1.5 });

      g.x = x;
      g.y = y;
      g.eventMode = "static";
      g.cursor = "pointer";

      // Store node id for event handling
      (g as Graphics & { nodeId: string }).nodeId = node.id;

      container.addChild(g);
    }
  }, []);

  // Draw playhead
  const drawPlayhead = useCallback(() => {
    const g = playheadLayerRef.current;
    if (!g) return;

    g.clear();

    const beats = playheadBeatsRef.current;
    if (beats === null || beats === undefined) return;

    const x = beatToXRef.current(beats);
    if (x < 0 || x > width) return;

    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke({ color: PLAYHEAD_COLOR, alpha: 0.8, width: 2 });
  }, [width, height]);

  // Main render function
  const render = useCallback(() => {
    drawGrid();
    drawCurves();
    drawNodes();
    drawPlayhead();
  }, [drawGrid, drawCurves, drawNodes, drawPlayhead]);

  // RAF-based render scheduling
  const rafIdRef = useRef<number | null>(null);
  const scheduleRender = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      render();
    });
  }, [render]);

  // Store initial dimensions for PixiJS init
  const initialWidthRef = useRef(width);
  const initialHeightRef = useRef(height);

  // Initialize PixiJS (only once)
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    aliveRef.current = true;
    let destroyed = false;

    const app = new Application();
    appRef.current = app;

    const initPromise = (async () => {
      try {
        await app.init({
          width: initialWidthRef.current,
          height: initialHeightRef.current,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          autoStart: false,
        });

        if (destroyed) return;

        host.appendChild(app.canvas);

        // Create layers
        const gridLayer = new Graphics();
        const curveLayer = new Graphics();
        const nodesLayer = new Container();
        const playheadLayer = new Graphics();

        gridLayerRef.current = gridLayer;
        curveLayerRef.current = curveLayer;
        nodesLayerRef.current = nodesLayer;
        playheadLayerRef.current = playheadLayer;

        app.stage.addChild(gridLayer);
        app.stage.addChild(curveLayer);
        app.stage.addChild(nodesLayer);
        app.stage.addChild(playheadLayer);

        // Make stage interactive for background clicks
        app.stage.eventMode = "static";
        app.stage.hitArea = { contains: () => true };

        initDoneRef.current = true;
        setIsInitialized(true);
        app.start();
      } catch (err) {
        console.error("[EnvelopeCanvas] PixiJS init failed:", err);
      }
    })();

    return () => {
      destroyed = true;
      aliveRef.current = false;
      initDoneRef.current = false;
      setIsInitialized(false);

      gridLayerRef.current = null;
      curveLayerRef.current = null;
      nodesLayerRef.current = null;
      playheadLayerRef.current = null;

      const toDestroy = appRef.current;
      appRef.current = null;

      void initPromise.finally(() => {
        try {
          toDestroy?.stop();
          const canvas = toDestroy?.canvas;
          if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
          toDestroy?.destroy(true);
        } catch {
          // ignore
        }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger initial render after init completes (with fresh callbacks)
  useEffect(() => {
    if (isInitialized) {
      scheduleRender();
    }
  }, [isInitialized, scheduleRender]);

  // Handle resize
  useEffect(() => {
    const app = appRef.current;
    if (!app || !initDoneRef.current) return;

    app.renderer.resize(width, height);
    scheduleRender();
  }, [width, height, scheduleRender]);

  // Re-render on data changes
  useEffect(() => {
    if (!initDoneRef.current) return;
    scheduleRender();
  }, [nodes, selectedNodeIds, hoveredNodeId, viewportStart, viewportEnd, playheadBeats, draggedPosition, scheduleRender]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Mouse event handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on a node
      const toX = beatToXRef.current;
      const toY = valueToYRef.current;

      for (const node of nodesRef.current) {
        const nx = toX(node.time_beats);
        const ny = toY(node.value);
        const dist = Math.sqrt((x - nx) ** 2 + (y - ny) ** 2);

        if (dist <= NODE_HOVER_RADIUS) {
          // Clicked on node
          if (e.shiftKey) {
            // Multi-select
            if (selectedNodeIdsRef.current.has(node.id)) {
              const newSet = new Set(selectedNodeIdsRef.current);
              newSet.delete(node.id);
              selectNodes(newSet);
            } else {
              const newSet = new Set(selectedNodeIdsRef.current);
              newSet.add(node.id);
              selectNodes(newSet);
            }
          } else {
            // Single select and start drag
            if (!selectedNodeIdsRef.current.has(node.id)) {
              selectNode(node.id);
            }
            setDragState({
              nodeId: node.id,
              startBeat: node.time_beats,
              startValue: node.value,
              offsetX: x - nx,
              offsetY: y - ny,
            });
          }
          return;
        }
      }

      // Clicked on empty space - add a new node
      if (!e.shiftKey) {
        const beat = xToBeat(x);
        const value = yToValue(y);
        const snappedBeat = snapBeatToGrid(beat);

        const nodeId = addNode(signalId, {
          time_beats: Math.max(0, snappedBeat),
          value: Math.max(0, Math.min(1, value)),
          interp_to_next: "linear" as InterpolationType,
        });

        if (nodeId) {
          selectNode(nodeId);
        }
      } else {
        // Shift-click on empty - clear selection
        clearNodeSelection();
      }
    },
    [signalId, xToBeat, yToValue, snapBeatToGrid, addNode, selectNode, selectNodes, clearNodeSelection]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Handle drag - use local state for smooth dragging, commit on release
      if (dragState) {
        const newValue = Math.max(0, Math.min(1, yToValue(y)));
        const newBeat = Math.max(0, snapBeatToGrid(xToBeat(x)));

        setDraggedPosition({
          nodeId: dragState.nodeId,
          time_beats: newBeat,
          value: newValue,
        });
        return;
      }

      // Update hover state
      const toX = beatToXRef.current;
      const toY = valueToYRef.current;
      let newHovered: string | null = null;

      for (const node of nodesRef.current) {
        const nx = toX(node.time_beats);
        const ny = toY(node.value);
        const dist = Math.sqrt((x - nx) ** 2 + (y - ny) ** 2);

        if (dist <= NODE_HOVER_RADIUS) {
          newHovered = node.id;
          break;
        }
      }

      if (newHovered !== hoveredNodeId) {
        setHoveredNodeId(newHovered);
      }
    },
    [dragState, xToBeat, yToValue, snapBeatToGrid, hoveredNodeId]
  );

  const handlePointerUp = useCallback(() => {
    // Commit dragged position to store
    if (dragState && draggedPosition) {
      updateNode(signalId, dragState.nodeId, {
        time_beats: draggedPosition.time_beats,
        value: draggedPosition.value,
      });
    }
    setDragState(null);
    setDraggedPosition(null);
  }, [signalId, dragState, draggedPosition, updateNode]);

  const handlePointerLeave = useCallback(() => {
    // Cancel drag without committing
    setDragState(null);
    setDraggedPosition(null);
    setHoveredNodeId(null);
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeIds.size > 0) {
          removeNodes(signalId, selectedNodeIds);
        }
        e.preventDefault();
      } else if (e.key === "Escape") {
        clearNodeSelection();
        e.preventDefault();
      }
    },
    [signalId, selectedNodeIds, removeNodes, clearNodeSelection]
  );

  return (
    <div
      ref={containerRef}
      className="relative cursor-crosshair"
      style={{ width, height }}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    />
  );
}
