"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import {
  INTERPOLATION_TYPES,
  INTERPOLATION_LABELS,
  DEFAULT_INTERPOLATION,
  type InterpolationType,
} from "@/lib/stores/types/composedSignal";
import { cn } from "@/lib/utils";

interface NodeGridEditorProps {
  signalId: string;
  bpm: number;
  durationBeats: number;
}

/**
 * Spreadsheet-style editor for composed signal nodes.
 * Each row represents a keyframe node with time, value, and interpolation.
 */
export function NodeGridEditor({ signalId, bpm, durationBeats }: NodeGridEditorProps) {
  // Subscribe directly to signal nodes for reactivity
  const {
    nodes,
    addNode,
    updateNode,
    removeNode,
    removeNodes,
    selectedNodeIds,
    selectNode,
    selectNodes,
    toggleNodeSelection,
    clearNodeSelection,
    snapEnabled,
    snapSubdivision,
  } = useComposedSignalStore(
    useShallow((s) => {
      const signal = s.structure?.signals.find((sig) => sig.id === signalId);
      return {
        nodes: signal?.nodes ?? [],
        addNode: s.addNode,
        updateNode: s.updateNode,
        removeNode: s.removeNode,
        removeNodes: s.removeNodes,
        selectedNodeIds: s.selectedNodeIds,
        selectNode: s.selectNode,
        selectNodes: s.selectNodes,
        toggleNodeSelection: s.toggleNodeSelection,
        clearNodeSelection: s.clearNodeSelection,
        snapEnabled: s.snapEnabled,
        snapSubdivision: s.snapSubdivision,
      };
    })
  );

  // Sort nodes by time for display
  const sortedNodes = [...nodes].sort((a, b) => a.time_beats - b.time_beats);

  const handleAddNode = useCallback(() => {
    // Add a new node at the end, or at beat 0 if no nodes
    const lastNode = sortedNodes[sortedNodes.length - 1];
    let newBeat = lastNode ? lastNode.time_beats + 1 : 0;

    // Snap to grid if enabled
    if (snapEnabled) {
      const gridSize = 1 / snapSubdivision;
      newBeat = Math.round(newBeat / gridSize) * gridSize;
    }

    const nodeId = addNode(signalId, {
      time_beats: newBeat,
      value: 0.5,
      interp_to_next: DEFAULT_INTERPOLATION,
    });

    if (nodeId) {
      selectNode(nodeId);
    }
  }, [signalId, sortedNodes, snapEnabled, snapSubdivision, addNode, selectNode]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.size > 0) {
      removeNodes(signalId, selectedNodeIds);
    }
  }, [signalId, selectedNodeIds, removeNodes]);

  const handleRowClick = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        toggleNodeSelection(nodeId);
      } else if (e.metaKey || e.ctrlKey) {
        toggleNodeSelection(nodeId);
      } else {
        selectNode(nodeId);
      }
    },
    [selectNode, toggleNodeSelection]
  );

  const handleTimeChange = useCallback(
    (nodeId: string, value: string) => {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && parsed >= 0) {
        updateNode(signalId, nodeId, { time_beats: parsed });
      }
    },
    [signalId, updateNode]
  );

  const handleValueChange = useCallback(
    (nodeId: string, value: string) => {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        // Clamp to 0-1
        const clamped = Math.max(0, Math.min(1, parsed));
        updateNode(signalId, nodeId, { value: clamped });
      }
    },
    [signalId, updateNode]
  );

  const handleInterpChange = useCallback(
    (nodeId: string, interp: InterpolationType) => {
      updateNode(signalId, nodeId, { interp_to_next: interp });
    },
    [signalId, updateNode]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      removeNode(signalId, nodeId);
    },
    [signalId, removeNode]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key === "Escape") {
        clearNodeSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        selectNodes(new Set(nodes.map((n) => n.id)));
      }
    },
    [selectedNodeIds, nodes, handleDeleteSelected, clearNodeSelection, selectNodes]
  );

  return (
    <div
      className="space-y-3"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Keyframe Nodes
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={handleAddNode}>
            <Plus className="h-4 w-4 mr-1" />
            Add Node
          </Button>
          {selectedNodeIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeleteSelected}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete ({selectedNodeIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      {sortedNodes.length === 0 ? (
        <div className="text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
          <p>No keyframes yet.</p>
          <p className="text-xs mt-1">
            Click &quot;Add Node&quot; to create your first keyframe.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[24px_1fr_1fr_1fr_40px] gap-2 px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <div></div>
            <div>Beat</div>
            <div>Value</div>
            <div>Interpolation</div>
            <div></div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sortedNodes.map((node, index) => (
              <NodeRow
                key={node.id}
                node={node}
                index={index}
                isSelected={selectedNodeIds.has(node.id)}
                onRowClick={handleRowClick}
                onTimeChange={handleTimeChange}
                onValueChange={handleValueChange}
                onInterpChange={handleInterpChange}
                onDelete={handleDeleteNode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="text-xs text-zinc-400 dark:text-zinc-500">
        <p>
          Shift+click or Ctrl/Cmd+click for multi-select. Delete key to remove
          selected. Ctrl/Cmd+A to select all.
        </p>
      </div>
    </div>
  );
}

/**
 * Single row in the node grid.
 */
function NodeRow({
  node,
  index,
  isSelected,
  onRowClick,
  onTimeChange,
  onValueChange,
  onInterpChange,
  onDelete,
}: {
  node: {
    id: string;
    time_beats: number;
    value: number;
    interp_to_next: InterpolationType;
  };
  index: number;
  isSelected: boolean;
  onRowClick: (nodeId: string, e: React.MouseEvent) => void;
  onTimeChange: (nodeId: string, value: string) => void;
  onValueChange: (nodeId: string, value: string) => void;
  onInterpChange: (nodeId: string, interp: InterpolationType) => void;
  onDelete: (nodeId: string) => void;
}) {
  const [editingField, setEditingField] = useState<"time" | "value" | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleStartEdit = (field: "time" | "value") => {
    setEditingField(field);
    setEditValue(field === "time" ? node.time_beats.toString() : node.value.toString());
  };

  const handleEndEdit = () => {
    if (editingField === "time") {
      onTimeChange(node.id, editValue);
    } else if (editingField === "value") {
      onValueChange(node.id, editValue);
    }
    setEditingField(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleEndEdit();
    } else if (e.key === "Escape") {
      setEditingField(null);
    }
    e.stopPropagation();
  };

  return (
    <div
      className={cn(
        "grid grid-cols-[24px_1fr_1fr_1fr_40px] gap-2 px-2 py-1.5 items-center cursor-pointer",
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/30"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      )}
      onClick={(e) => onRowClick(node.id, e)}
    >
      {/* Grip handle */}
      <div className="text-zinc-400 dark:text-zinc-600">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Beat time */}
      <div onClick={(e) => e.stopPropagation()}>
        {editingField === "time" ? (
          <Input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEndEdit}
            onKeyDown={handleKeyDown}
            className="h-7 text-sm"
            step="0.25"
            min="0"
            autoFocus
          />
        ) : (
          <button
            className="w-full text-left px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm"
            onClick={() => handleStartEdit("time")}
          >
            {node.time_beats.toFixed(2)}
          </button>
        )}
      </div>

      {/* Value */}
      <div onClick={(e) => e.stopPropagation()}>
        {editingField === "value" ? (
          <Input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEndEdit}
            onKeyDown={handleKeyDown}
            className="h-7 text-sm"
            step="0.05"
            min="0"
            max="1"
            autoFocus
          />
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="text-left px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-sm"
              onClick={() => handleStartEdit("value")}
            >
              {node.value.toFixed(2)}
            </button>
            {/* Mini progress bar */}
            <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${node.value * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Interpolation */}
      <div onClick={(e) => e.stopPropagation()}>
        <select
          value={node.interp_to_next}
          onChange={(e) => onInterpChange(node.id, e.target.value as InterpolationType)}
          className="w-full h-7 rounded border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          {INTERPOLATION_TYPES.map((interp) => (
            <option key={interp} value={interp}>
              {INTERPOLATION_LABELS[interp]}
            </option>
          ))}
        </select>
      </div>

      {/* Delete button */}
      <div onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(node.id)}
          className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600 dark:text-zinc-600 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
