"use client";

import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useDerivedSignalActions } from "@/lib/stores/hooks/useDerivedSignalActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, Trash2, RefreshCw, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useCallback } from "react";
import {
  getSourceDescription,
  getTransformDescription,
  SOURCE_KIND_LABELS,
  STABILIZATION_MODE_LABELS,
  ENVELOPE_MODE_LABELS,
  TRANSFORM_LABELS,
} from "@/lib/stores/types/derivedSignal";

interface DerivedSignalsInspectorProps {
  nodeId: string;
}

/**
 * Derived Signals Inspector - shows signal details in the inspector panel.
 *
 * Handles both the section node (derived-signals) and individual
 * signal nodes (derived-signals:{id}).
 */
export function DerivedSignalsInspector({ nodeId }: DerivedSignalsInspectorProps) {
  const { addSignal, removeSignal, recomputeSignal, updateSignal } = useDerivedSignalActions();
  const getSignalById = useDerivedSignalStore((s) => s.getSignalById);
  const getSignalResult = useDerivedSignalStore((s) => s.getSignalResult);
  const selectSignal = useDerivedSignalStore((s) => s.selectSignal);
  const computingSignalId = useDerivedSignalStore((s) => s.computingSignalId);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["source", "output"]));

  // Parse node ID to determine if it's a specific signal or the section
  const isSection = nodeId === "derived-signals";
  const signalId = isSection ? null : nodeId.replace("derived-signals:", "");
  const signal = signalId ? getSignalById(signalId) : null;
  const result = signalId ? getSignalResult(signalId) : null;
  const isComputing = signalId === computingSignalId;

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleRename = useCallback(() => {
    if (signal && editName.trim() && editName !== signal.name) {
      updateSignal(signal.id, { name: editName.trim() });
    }
    setIsEditing(false);
  }, [signal, editName, updateSignal]);

  const startEditing = useCallback(() => {
    if (signal) {
      setEditName(signal.name);
      setIsEditing(true);
    }
  }, [signal]);

  // Section view
  if (isSection) {
    return (
      <div className="space-y-3 p-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            const id = addSignal();
            if (id) selectSignal(id);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Signal
        </Button>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Create signals from 2D spectral data, 1D MIR outputs, or event streams.
          Derived signals can be used in scripts via{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            inputs.customSignals[&quot;name&quot;]
          </code>
          .
        </p>
      </div>
    );
  }

  // No signal found
  if (!signal) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-4">
        <Activity className="h-12 w-12 text-zinc-400 dark:text-zinc-600" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Signal not found</p>
      </div>
    );
  }

  // Signal detail view
  return (
    <div className="space-y-3 p-2">
      {/* Header with name and actions */}
      <div className="flex items-center justify-between gap-2">
        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            className="h-8 text-sm font-semibold"
            autoFocus
          />
        ) : (
          <h3
            className="cursor-pointer truncate font-semibold hover:text-blue-600"
            onClick={startEditing}
            title="Click to rename"
          >
            {signal.name}
          </h3>
        )}
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => recomputeSignal(signal.id)}
            title="Recompute signal"
            disabled={isComputing}
          >
            <RefreshCw className={`h-4 w-4 ${isComputing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-red-500 hover:text-red-600"
            onClick={() => removeSignal(signal.id)}
            title="Delete signal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between">
        <label htmlFor="enabled" className="text-sm">Enabled</label>
        <input
          type="checkbox"
          id="enabled"
          checked={signal.enabled}
          onChange={(e) => updateSignal(signal.id, { enabled: e.target.checked })}
          className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
        />
      </div>

      {/* Source Section */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <button
          className="flex w-full items-center justify-between p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          onClick={() => toggleSection("source")}
        >
          <span>Source</span>
          {expandedSections.has("source") ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        {expandedSections.has("source") && (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Type: </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {SOURCE_KIND_LABELS[signal.source.kind]}
                </span>
              </div>
              <div>
                <span className="font-medium">Details: </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {getSourceDescription(signal.source)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transforms Section */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <button
          className="flex w-full items-center justify-between p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          onClick={() => toggleSection("transforms")}
        >
          <span>Transforms ({signal.transforms.length})</span>
          {expandedSections.has("transforms") ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        {expandedSections.has("transforms") && (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
            {signal.transforms.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No transforms configured
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {signal.transforms.map((t, i) => (
                  <li key={i} className="text-zinc-600 dark:text-zinc-400">
                    {i + 1}. {TRANSFORM_LABELS[t.kind]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Output Section */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <button
          className="flex w-full items-center justify-between p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          onClick={() => toggleSection("output")}
        >
          <span>Output Settings</span>
          {expandedSections.has("output") ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        {expandedSections.has("output") && (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Stabilization: </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {STABILIZATION_MODE_LABELS[signal.stabilization.mode]}
                </span>
              </div>
              <div>
                <span className="font-medium">Envelope: </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {ENVELOPE_MODE_LABELS[signal.stabilization.envelopeMode]}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Section */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <button
          className="flex w-full items-center justify-between p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          onClick={() => toggleSection("status")}
        >
          <span>Status</span>
          {expandedSections.has("status") ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        {expandedSections.has("status") && (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
            {result ? (
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">Status: </span>
                  <span
                    className={`${
                      result.status === "computed"
                        ? "text-green-600 dark:text-green-400"
                        : result.status === "error"
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {result.status}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Range: </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {result.valueRange.min.toFixed(3)} – {result.valueRange.max.toFixed(3)}
                  </span>
                </div>
                {result.percentileRange && (
                  <div>
                    <span className="font-medium">P5-P95: </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {result.percentileRange.p5.toFixed(3)} – {result.percentileRange.p95.toFixed(3)}
                    </span>
                  </div>
                )}
                {result.computedAt && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Computed: {new Date(result.computedAt).toLocaleString()}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Not yet computed
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
