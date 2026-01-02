"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCustomSignalStore } from "@/lib/stores/customSignalStore";
import { useCustomSignalActions } from "@/lib/stores/hooks/useCustomSignalActions";
import { getCustomSignalId } from "@/lib/nodeTypes";
import { useInterpretationTreeStore } from "@/lib/stores/interpretationTreeStore";
import { CustomSignalEditor } from "./CustomSignalEditor";
import {
  SOURCE_2D_LABELS,
  REDUCTION_ALGORITHM_LABELS,
} from "@/lib/stores/types/customSignal";

interface CustomSignalsInspectorProps {
  nodeId: string;
}

/**
 * Inspector for the Custom Signals section.
 * Shows list of custom signals and allows creating/editing them.
 */
export function CustomSignalsInspector({ nodeId }: CustomSignalsInspectorProps) {
  const structure = useCustomSignalStore((s) => s.structure);
  const selectedSignalId = useCustomSignalStore((s) => s.selectedSignalId);
  const selectSignal = useCustomSignalStore((s) => s.selectSignal);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const { addSignal } = useCustomSignalActions();

  // Check if we're viewing a specific signal or the section
  const signalId = getCustomSignalId(nodeId);
  const isSection = signalId === null;

  const signals = structure?.signals ?? [];

  const handleAddSignal = () => {
    const newId = addSignal({ name: `Signal ${signals.length + 1}` });
    // Select the new signal in the tree
    selectNode(`custom-signals:${newId}`);
    selectSignal(newId);
  };

  if (isSection) {
    // Section view - show all signals with add button
    return (
      <div className="p-2 space-y-3">
        <Button size="sm" variant="outline" className="w-full" onClick={handleAddSignal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Signal
        </Button>

        {signals.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No custom signals defined. Custom signals let you extract 1D signals
            from 2D spectral data (mel spectrogram, HPSS, MFCC) with configurable
            frequency ranges and reduction algorithms.
          </p>
        ) : (
          <div className="space-y-2">
            {signals.map((signal) => (
              <button
                key={signal.id}
                type="button"
                onClick={() => {
                  selectNode(`custom-signals:${signal.id}`);
                  selectSignal(signal.id);
                }}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  selectedSignalId === signal.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                    : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                } ${!signal.enabled ? "opacity-50" : ""}`}
              >
                <div className="text-sm font-medium">{signal.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {SOURCE_2D_LABELS[signal.source2DFunction]} → {REDUCTION_ALGORITHM_LABELS[signal.reductionAlgorithm]}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Individual signal view - show full editor
  const signal = signals.find((s) => s.id === signalId);

  if (!signal) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Signal not found.
      </div>
    );
  }

  return (
    <div className="p-2">
      <CustomSignalEditor signal={signal} />
    </div>
  );
}
