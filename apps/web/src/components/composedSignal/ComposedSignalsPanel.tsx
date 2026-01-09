"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Plus,
  Trash2,
  Music,
  Spline,
  Grid2X2,
  Magnet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import { useComposedSignalActions } from "@/lib/stores/hooks/useComposedSignalActions";
import { useBeatGridStore, SUB_BEAT_DIVISIONS } from "@/lib/stores/beatGridStore";
import { useInterpretationTreeStore } from "@/lib/stores/interpretationTreeStore";
import { getInspectorNodeType } from "@/lib/nodeTypes";
import { NodeGridEditor } from "./NodeGridEditor";
import { EnvelopeCanvas } from "./EnvelopeCanvas";
import { usePlaybackStore } from "@/lib/stores/playbackStore";
import { cn } from "@/lib/utils";

/**
 * Composed Signals Panel - main interface for creating and editing composed signals.
 * Shows when a composed signal node is selected in the tree.
 */
export function ComposedSignalsPanel() {
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectedNodeType = useMemo(
    () => getInspectorNodeType(selectedNodeId),
    [selectedNodeId]
  );

  // Only show when composed signals section or signal is selected
  const isVisible =
    selectedNodeType === "composed-signals-section" ||
    selectedNodeType === "composed-signal";

  const bpm = useBeatGridStore((s) => s.selectedHypothesis?.bpm ?? null);

  const {
    structure,
    selectedSignalId,
    snapEnabled,
    snapSubdivision,
    addSignal,
    removeSignal,
    updateSignal,
    selectSignal,
    setSnapEnabled,
    setSnapSubdivision,
  } = useComposedSignalStore(
    useShallow((s) => ({
      structure: s.structure,
      selectedSignalId: s.selectedSignalId,
      snapEnabled: s.snapEnabled,
      snapSubdivision: s.snapSubdivision,
      addSignal: s.addSignal,
      removeSignal: s.removeSignal,
      updateSignal: s.updateSignal,
      selectSignal: s.selectSignal,
      setSnapEnabled: s.setSnapEnabled,
      setSnapSubdivision: s.setSnapSubdivision,
    }))
  );

  const { isBpmAvailable, getDurationBeats, secondsToBeatsCurrent } = useComposedSignalActions();

  // Playback position and viewport from main waveform
  const { playheadTimeSec, viewport } = usePlaybackStore(
    useShallow((s) => ({
      playheadTimeSec: s.playheadTimeSec,
      viewport: s.viewport,
    }))
  );
  const playheadBeats = useMemo(() => {
    return secondsToBeatsCurrent(playheadTimeSec);
  }, [playheadTimeSec, secondsToBeatsCurrent]);

  // Canvas container ref and dimensions
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 200 });

  // Track canvas container size
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    // Initial measurement
    const rect = container.getBoundingClientRect();
    if (rect.width > 0) {
      setCanvasDimensions({
        width: rect.width,
        height: Math.max(150, rect.height),
      });
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setCanvasDimensions({
          width: entry.contentRect.width,
          height: Math.max(150, entry.contentRect.height),
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedSignalId]); // Re-run when signal selection changes, as the container may now be mounted

  const signals = structure?.signals ?? [];
  const selectedSignal = selectedSignalId
    ? signals.find((s) => s.id === selectedSignalId)
    : null;
  const durationBeats = getDurationBeats();

  const handleAddSignal = useCallback(() => {
    const id = addSignal({ name: `Signal ${signals.length + 1}` });
    selectSignal(id);
  }, [addSignal, selectSignal, signals.length]);

  const handleDeleteSignal = useCallback(() => {
    if (selectedSignalId) {
      removeSignal(selectedSignalId);
    }
  }, [selectedSignalId, removeSignal]);

  const handleNameChange = useCallback(
    (name: string) => {
      if (selectedSignalId) {
        updateSignal(selectedSignalId, { name });
      }
    },
    [selectedSignalId, updateSignal]
  );

  if (!isVisible) {
    return null;
  }

  // BPM not available
  if (!isBpmAvailable) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 rounded-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">Composed Signals</h2>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <Music className="h-12 w-12 text-zinc-400 dark:text-zinc-600 mb-4" />
          <p className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            Beat grid required
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
            Select a tempo hypothesis to enable composed signal editing.
            Composed signals are defined in beats, not seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">Composed Signals</h2>
        <div className="flex items-center gap-2">
          {/* Snap controls */}
          <div className="flex items-center gap-1 mr-2">
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs",
                snapEnabled
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              )}
              title="Toggle snap to grid"
            >
              <Magnet className="h-3 w-3" />
              Snap
            </button>
            {snapEnabled && (
              <select
                value={snapSubdivision}
                onChange={(e) =>
                  setSnapSubdivision(Number(e.target.value) as typeof snapSubdivision)
                }
                className="h-6 rounded border border-zinc-200 bg-white px-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              >
                {SUB_BEAT_DIVISIONS.map((div) => (
                  <option key={div.value} value={div.value}>
                    {div.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleAddSignal} title="Add signal">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Signal List (left panel) */}
        <div className="w-full border-b border-zinc-200 lg:w-48 lg:border-b-0 lg:border-r dark:border-zinc-700">
          <div className="max-h-48 overflow-y-auto lg:max-h-none lg:h-full p-2">
            {signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                <Spline className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No signals yet
                </p>
                <Button size="sm" onClick={handleAddSignal}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {signals.map((signal) => (
                  <button
                    key={signal.id}
                    onClick={() => selectSignal(signal.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left",
                      selectedSignalId === signal.id
                        ? "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    )}
                  >
                    <Spline
                      className={cn(
                        "h-4 w-4 shrink-0",
                        signal.enabled
                          ? "text-blue-500"
                          : "text-zinc-400 dark:text-zinc-600"
                      )}
                    />
                    <span className="truncate">{signal.name}</span>
                    <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                      {signal.nodes.length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Editor (right panel) */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedSignal ? (
            <>
              {/* Signal header */}
              <div className="flex items-center gap-2 p-3 border-b border-zinc-200 dark:border-zinc-700">
                <Input
                  value={selectedSignal.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="h-8 max-w-xs"
                />
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {selectedSignal.nodes.length} nodes
                  </span>
                  {durationBeats !== null && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      • {durationBeats.toFixed(1)} beats
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDeleteSignal}
                    className="text-red-600 hover:text-red-700 dark:text-red-400"
                    title="Delete signal"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Envelope Canvas */}
              <div
                ref={canvasContainerRef}
                className="h-48 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-900"
              >
                {canvasDimensions.width > 0 ? (
                  <EnvelopeCanvas
                    signalId={selectedSignal.id}
                    bpm={bpm!}
                    durationBeats={durationBeats ?? 0}
                    playheadBeats={playheadBeats}
                    viewportStartSec={viewport?.startTime ?? 0}
                    viewportEndSec={viewport?.endTime ?? ((durationBeats ?? 16) * 60) / bpm!}
                    width={canvasDimensions.width}
                    height={192}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                    Measuring canvas... (width: {canvasDimensions.width})
                  </div>
                )}
              </div>

              {/* Node Grid Editor */}
              <div className="flex-1 overflow-auto p-3">
                <NodeGridEditor
                  signalId={selectedSignal.id}
                  bpm={bpm!}
                  durationBeats={durationBeats ?? 0}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Grid2X2 className="h-10 w-10 text-zinc-400 dark:text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Select a signal to edit or create a new one.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
