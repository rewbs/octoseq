"use client";

import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Plus,
  Trash2,
  Copy,
  Music,
  Spline,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";
import { getComposedSignalId } from "@/lib/nodeTypes";
import { TREE_NODE_IDS } from "@/lib/stores/interpretationTreeStore";

interface ComposedSignalInspectorProps {
  nodeId: string;
}

/**
 * Inspector panel for composed signals.
 * Shows list view when at section level, detail view when signal selected.
 */
export function ComposedSignalInspector({ nodeId }: ComposedSignalInspectorProps) {
  const bpm = useBeatGridStore((s) => s.selectedHypothesis?.bpm ?? null);

  const {
    structure,
    selectedSignalId,
    addSignal,
    removeSignal,
    updateSignal,
    setSignalEnabled,
    duplicateSignal,
    selectSignal,
  } = useComposedSignalStore(
    useShallow((s) => ({
      structure: s.structure,
      selectedSignalId: s.selectedSignalId,
      addSignal: s.addSignal,
      removeSignal: s.removeSignal,
      updateSignal: s.updateSignal,
      setSignalEnabled: s.setSignalEnabled,
      duplicateSignal: s.duplicateSignal,
      selectSignal: s.selectSignal,
    }))
  );

  const signals = structure?.signals ?? [];

  // Determine if we're at section level or signal level
  const isSection = nodeId === TREE_NODE_IDS.COMPOSED_SIGNALS;
  const signalId = isSection ? null : getComposedSignalId(nodeId);
  const signal = signalId ? signals.find((s) => s.id === signalId) : null;

  // Select signal when navigating to it (must be in useEffect, not during render)
  useEffect(() => {
    if (signalId && selectedSignalId !== signalId) {
      selectSignal(signalId);
    }
  }, [signalId, selectedSignalId, selectSignal]);

  // BPM not available - show message
  if (!bpm) {
    return <BpmRequiredMessage />;
  }

  // Section view - show list of signals
  if (isSection) {
    return (
      <SectionView
        signals={signals}
        onAddSignal={addSignal}
        onSelectSignal={selectSignal}
      />
    );
  }

  // Signal not found
  if (!signal) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Signal not found.
      </div>
    );
  }

  // Signal detail view
  return (
    <SignalDetailView
      signal={signal}
      onUpdate={(updates) => updateSignal(signal.id, updates)}
      onDelete={() => removeSignal(signal.id)}
      onDuplicate={() => duplicateSignal(signal.id)}
      onToggleEnabled={() => setSignalEnabled(signal.id, !signal.enabled)}
    />
  );
}

/**
 * Message shown when BPM is not set.
 */
function BpmRequiredMessage() {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <Music className="h-10 w-10 text-zinc-400 dark:text-zinc-600 mb-3" />
      <p className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">
        Beat grid required
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
        Select a tempo hypothesis to enable composed signal editing.
      </p>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Composed signals are defined in beats, not seconds.
      </p>
    </div>
  );
}

/**
 * Section view showing list of composed signals.
 */
function SectionView({
  signals,
  onAddSignal,
  onSelectSignal,
}: {
  signals: Array<{ id: string; name: string; enabled: boolean; nodes: unknown[] }>;
  onAddSignal: () => string;
  onSelectSignal: (id: string | null) => void;
}) {
  const handleAdd = useCallback(() => {
    const id = onAddSignal();
    onSelectSignal(id);
  }, [onAddSignal, onSelectSignal]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Composed Signals
        </div>
        <Button variant="ghost" size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {signals.length === 0 ? (
        <div className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">
          <Spline className="h-8 w-8 mx-auto mb-2 text-zinc-400 dark:text-zinc-600" />
          <p>No composed signals yet.</p>
          <p className="text-xs mt-1">
            Create interpretation curves to express intensity, tension, or emotion.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {signals.map((signal) => (
            <button
              key={signal.id}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => onSelectSignal(signal.id)}
            >
              <Spline
                className={`h-4 w-4 ${
                  signal.enabled
                    ? "text-blue-500"
                    : "text-zinc-400 dark:text-zinc-600"
                }`}
              />
              <span
                className={
                  signal.enabled
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-500 dark:text-zinc-400"
                }
              >
                {signal.name}
              </span>
              <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                {(signal.nodes as unknown[]).length} nodes
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Composed signals are human-authored interpretation curves. They define
          subjective qualities like intensity or emotion over musical time (beats).
        </p>
      </div>
    </div>
  );
}

/**
 * Detail view for a single composed signal.
 */
function SignalDetailView({
  signal,
  onUpdate,
  onDelete,
  onDuplicate,
  onToggleEnabled,
}: {
  signal: {
    id: string;
    name: string;
    enabled: boolean;
    nodes: unknown[];
    valueMin: number;
    valueMax: number;
  };
  onUpdate: (updates: { name?: string; valueMin?: number; valueMax?: number }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleEnabled: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(signal.name);

  const handleSaveName = useCallback(() => {
    if (editName.trim() && editName !== signal.name) {
      onUpdate({ name: editName.trim() });
    }
    setIsEditing(false);
  }, [editName, signal.name, onUpdate]);

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Spline
            className={`h-5 w-5 ${
              signal.enabled ? "text-blue-500" : "text-zinc-400"
            }`}
          />
          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") {
                  setEditName(signal.name);
                  setIsEditing(false);
                }
              }}
              className="h-7 text-sm"
              autoFocus
            />
          ) : (
            <button
              className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400"
              onClick={() => setIsEditing(true)}
            >
              {signal.name}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {signal.enabled ? (
              <>
                <ToggleRight className="h-4 w-4 text-blue-500" />
                Enabled
              </>
            ) : (
              <>
                <ToggleLeft className="h-4 w-4" />
                Disabled
              </>
            )}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Info
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Nodes</span>
            <span className="text-zinc-900 dark:text-zinc-100">
              {(signal.nodes as unknown[]).length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Value range</span>
            <span className="text-zinc-900 dark:text-zinc-100">
              {signal.valueMin} - {signal.valueMax}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Domain</span>
            <span className="text-zinc-900 dark:text-zinc-100">Beats</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Actions
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy className="h-4 w-4 mr-1" />
            Duplicate
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Help */}
      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This signal can be accessed in scripts via{" "}
          <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
            inputs.composedSignals[&quot;{signal.name}&quot;]
          </code>
        </p>
      </div>
    </div>
  );
}
