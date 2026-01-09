"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useDerivedSignalStore, useDerivedSignals } from "@/lib/stores/derivedSignalStore";
import { useDerivedSignalActions } from "@/lib/stores/hooks/useDerivedSignalActions";
import { useInterpretationTreeStore } from "@/lib/stores/interpretationTreeStore";
import { getInspectorNodeType } from "@/lib/nodeTypes";
import { Button } from "@/components/ui/button";
import { Plus, Activity, RefreshCw, Trash2, Grid3X3, TrendingUp, Zap } from "lucide-react";
import { Source2DSelector } from "./Source2DSelector";
import { Source1DSelector } from "./Source1DSelector";
import { SourceEventSelector } from "./SourceEventSelector";
import { TransformChainEditor } from "./TransformChainEditor";
import {
  SOURCE_KIND_LABELS,
  STABILIZATION_MODE_LABELS,
  ENVELOPE_MODE_LABELS,
  createDefault2DSignal,
  createDefault1DSignal,
  createDefaultEventSignal,
  type DerivedSignalSource,
  type StabilizationMode,
  type EnvelopeMode,
} from "@/lib/stores/types/derivedSignal";

/**
 * Derived Signals Panel - main interface for creating and editing derived signals.
 * Shows when a derived signal node is selected in the tree.
 */
export function DerivedSignalsPanel() {
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectedNodeType = useMemo(
    () => getInspectorNodeType(selectedNodeId),
    [selectedNodeId]
  );

  // Only show when derived signals section or signal is selected
  const isVisible =
    selectedNodeType === "derived-signals-section" ||
    selectedNodeType === "derived-signal";

  const signals = useDerivedSignals();
  const selectedSignalId = useDerivedSignalStore((s) => s.selectedSignalId);
  const selectSignal = useDerivedSignalStore((s) => s.selectSignal);
  const getSignalById = useDerivedSignalStore((s) => s.getSignalById);
  const getSignalResult = useDerivedSignalStore((s) => s.getSignalResult);
  const computingSignalId = useDerivedSignalStore((s) => s.computingSignalId);
  const { addSignal, updateSignal, removeSignal, recomputeSignal } = useDerivedSignalActions();

  const selectedSignal = selectedSignalId ? getSignalById(selectedSignalId) : null;
  const selectedResult = selectedSignalId ? getSignalResult(selectedSignalId) : null;
  const isComputing = selectedSignalId === computingSignalId;

  // Tab state for source type
  const [activeTab, setActiveTab] = useState<"2d" | "1d" | "events">(
    selectedSignal?.source.kind ?? "2d"
  );

  // Sync tab with selected signal source type
  useEffect(() => {
    if (selectedSignal) {
      setActiveTab(selectedSignal.source.kind);
    }
  }, [selectedSignal]);

  const handleAddSignal = (kind: "2d" | "1d" | "events") => {
    let defaults;
    switch (kind) {
      case "2d":
        defaults = createDefault2DSignal();
        break;
      case "1d":
        defaults = createDefault1DSignal();
        break;
      case "events":
        defaults = createDefaultEventSignal();
        break;
    }
    const newId = addSignal(defaults);
    if (newId) {
      selectSignal(newId);
      setActiveTab(kind);
    }
  };

  const handleSourceChange = useCallback(
    (newSource: DerivedSignalSource) => {
      if (selectedSignal) {
        updateSignal(selectedSignal.id, { source: newSource });
      }
    },
    [selectedSignal, updateSignal]
  );

  const handleStabilizationChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (selectedSignal) {
        updateSignal(selectedSignal.id, {
          stabilization: { ...selectedSignal.stabilization, mode: e.target.value as StabilizationMode },
        });
      }
    },
    [selectedSignal, updateSignal]
  );

  const handleEnvelopeModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (selectedSignal) {
        updateSignal(selectedSignal.id, {
          stabilization: { ...selectedSignal.stabilization, envelopeMode: e.target.value as EnvelopeMode },
        });
      }
    },
    [selectedSignal, updateSignal]
  );

  const handleAutoRecomputeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (selectedSignal) {
        updateSignal(selectedSignal.id, { autoRecompute: e.target.checked });
      }
    },
    [selectedSignal, updateSignal]
  );

  const handleTabChange = (kind: "2d" | "1d" | "events") => {
    setActiveTab(kind);
    // Create new source when switching types - use updateSignal directly to avoid stale callback
    if (selectedSignal && selectedSignal.source.kind !== kind) {
      let newSource: DerivedSignalSource;
      switch (kind) {
        case "2d":
          newSource = createDefault2DSignal().source;
          break;
        case "1d":
          newSource = createDefault1DSignal().source;
          break;
        case "events":
          newSource = createDefaultEventSignal().source;
          break;
      }
      // Use updateSignal directly with the ID to ensure synchronous update
      updateSignal(selectedSignal.id, { source: newSource });
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">Derived Signals</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAddSignal("2d")}
            title="Add 2D signal"
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAddSignal("1d")}
            title="Add 1D signal"
          >
            <TrendingUp className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAddSignal("events")}
            title="Add event signal"
          >
            <Zap className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Signal List (left panel) */}
        <div className="w-full border-b border-zinc-200 lg:w-48 lg:border-b-0 lg:border-r dark:border-zinc-700">
          <div className="max-h-48 overflow-y-auto lg:max-h-none lg:h-full p-2">
            {signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                <Activity className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No signals yet
                </p>
                <Button size="sm" onClick={() => handleAddSignal("2d")}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {signals.map((signal) => {
                  const result = getSignalResult(signal.id);
                  const isSelected = selectedSignalId === signal.id;
                  const isSignalComputing = computingSignalId === signal.id;

                  return (
                    <div
                      key={signal.id}
                      className={`cursor-pointer rounded-md border p-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${isSelected
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                        : "border-zinc-200 dark:border-zinc-700"
                        } ${!signal.enabled ? "opacity-50" : ""}`}
                      onClick={() => selectSignal(signal.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium">{signal.name}</span>
                        <span
                          className={`ml-1 flex h-2 w-2 shrink-0 rounded-full ${isSignalComputing
                            ? "animate-pulse bg-yellow-500"
                            : result?.status === "computed"
                              ? "bg-green-500"
                              : result?.status === "error"
                                ? "bg-red-500"
                                : "bg-zinc-400"
                            }`}
                        />
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {SOURCE_KIND_LABELS[signal.source.kind]}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Editor (right panel) */}
        <div className="flex-1 overflow-y-auto p-3">
          {!selectedSignal ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Activity className="h-12 w-12 text-zinc-400 dark:text-zinc-600" />
              <div>
                <p className="font-medium">Select a signal to edit</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Or create a new one using the buttons above
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Signal header with actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{selectedSignal.name}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {SOURCE_KIND_LABELS[selectedSignal.source.kind]}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => recomputeSignal(selectedSignal.id)}
                    disabled={isComputing}
                    title="Recompute"
                  >
                    <RefreshCw className={`h-4 w-4 ${isComputing ? "animate-spin" : ""}`} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-500 hover:text-red-600"
                    onClick={() => removeSignal(selectedSignal.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Source Type Tabs */}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
                  <button
                    className={`flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors ${activeTab === "2d"
                      ? "bg-white shadow dark:bg-zinc-700"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    onClick={() => handleTabChange("2d")}
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                    2D
                  </button>
                  <button
                    className={`flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors ${activeTab === "1d"
                      ? "bg-white shadow dark:bg-zinc-700"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    onClick={() => handleTabChange("1d")}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    1D
                  </button>
                  <button
                    className={`flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors ${activeTab === "events"
                      ? "bg-white shadow dark:bg-zinc-700"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    onClick={() => handleTabChange("events")}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Events
                  </button>
                </div>

                <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                  {selectedSignal.source.kind === "2d" && (
                    <Source2DSelector source={selectedSignal.source} onChange={handleSourceChange} />
                  )}
                  {selectedSignal.source.kind === "1d" && (
                    <Source1DSelector source={selectedSignal.source} onChange={handleSourceChange} />
                  )}
                  {selectedSignal.source.kind === "events" && (
                    <SourceEventSelector source={selectedSignal.source} onChange={handleSourceChange} />
                  )}
                </div>
              </div>

              {/* Transform Chain */}
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                <TransformChainEditor
                  transforms={selectedSignal.transforms}
                  onChange={(transforms) => updateSignal(selectedSignal.id, { transforms })}
                />
              </div>

              {/* Output Settings */}
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                <h4 className="mb-3 text-sm font-medium">Output Settings</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="stabilization" className="text-sm">
                      Stabilization
                    </label>
                    <select
                      id="stabilization"
                      value={selectedSignal.stabilization.mode}
                      onChange={handleStabilizationChange}
                      className="w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    >
                      {(Object.keys(STABILIZATION_MODE_LABELS) as StabilizationMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {STABILIZATION_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <label htmlFor="envelope" className="text-sm">
                      Envelope
                    </label>
                    <select
                      id="envelope"
                      value={selectedSignal.stabilization.envelopeMode}
                      onChange={handleEnvelopeModeChange}
                      className="w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    >
                      {(Object.keys(ENVELOPE_MODE_LABELS) as EnvelopeMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {ENVELOPE_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <label htmlFor="auto-recompute" className="text-sm">
                      Auto-recompute
                    </label>
                    <input
                      type="checkbox"
                      id="auto-recompute"
                      checked={selectedSignal.autoRecompute}
                      onChange={handleAutoRecomputeChange}
                      className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
                    />
                  </div>
                </div>
              </div>

              {/* Status */}
              {selectedResult && (
                <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                  <h4 className="mb-2 text-sm font-medium">Status</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">Status</span>
                      <span
                        className={
                          selectedResult.status === "computed"
                            ? "text-green-600 dark:text-green-400"
                            : selectedResult.status === "error"
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }
                      >
                        {selectedResult.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">Range</span>
                      <span>
                        {selectedResult.valueRange.min.toFixed(3)} – {selectedResult.valueRange.max.toFixed(3)}
                      </span>
                    </div>
                    {selectedResult.percentileRange && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">P5–P95</span>
                        <span>
                          {selectedResult.percentileRange.p5.toFixed(3)} – {selectedResult.percentileRange.p95.toFixed(3)}
                        </span>
                      </div>
                    )}
                    {selectedResult.computeTimeMs && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">Compute time</span>
                        <span>{selectedResult.computeTimeMs.toFixed(0)}ms</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
