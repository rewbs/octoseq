"use client";

import { useCallback, useRef, useEffect } from "react";
import { X, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useInterpretationTreeStore,
  INSPECTOR_MIN_HEIGHT,
  INSPECTOR_MAX_HEIGHT,
} from "@/lib/stores/interpretationTreeStore";
import { InspectorContent } from "./InspectorContent";

/**
 * Bottom drawer that displays contextual information and actions
 * for the currently selected tree node.
 */
export function InspectorDrawer() {
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const inspectorHeight = useInterpretationTreeStore((s) => s.inspectorHeight);
  const setInspectorHeight = useInterpretationTreeStore((s) => s.setInspectorHeight);

  // Resize state
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  // Store callbacks in refs to avoid stale closure issues during drag
  const setInspectorHeightRef = useRef(setInspectorHeight);
  setInspectorHeightRef.current = setInspectorHeight;

  // Handle close
  const handleClose = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Handle escape key to close
  useEffect(() => {
    if (!selectedNodeId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, handleClose]);

  // Resize drag handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = inspectorHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        // Dragging up increases height, down decreases
        const deltaY = startYRef.current - moveEvent.clientY;
        const newHeight = startHeightRef.current + deltaY;
        const clampedHeight = Math.max(
          INSPECTOR_MIN_HEIGHT,
          Math.min(INSPECTOR_MAX_HEIGHT, newHeight)
        );
        setInspectorHeightRef.current(clampedHeight);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [inspectorHeight]
  );

  // Don't render if no node is selected
  if (!selectedNodeId) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-10 left-0 right-0 z-40",
        "bg-white dark:bg-zinc-900",
        "border-t border-zinc-200 dark:border-zinc-800",
        "shadow-lg"
      )}
      style={{ height: inspectorHeight }}
    >
      {/* Resize handle */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-2 cursor-ns-resize",
          "flex items-center justify-center",
          "hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        )}
        onMouseDown={handleResizeStart}
      >
        <GripHorizontal className="h-4 w-4 text-zinc-400" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Inspector
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleClose}
          title="Close inspector (Esc)"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto" style={{ height: inspectorHeight - 50 }}>
        <InspectorContent nodeId={selectedNodeId} />
      </div>
    </div>
  );
}
