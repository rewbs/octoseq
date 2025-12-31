"use client";

import type { ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNodeProps {
  /** Unique identifier for this node. */
  id: string;
  /** Display label for the node. */
  label: string;
  /** Optional icon to display before the label. */
  icon?: ReactNode;
  /** Whether this node has children (shows expand/collapse chevron). */
  hasChildren?: boolean;
  /** Whether this node is expanded (only relevant if hasChildren). */
  isExpanded?: boolean;
  /** Whether this node is currently selected. */
  isSelected?: boolean;
  /** Whether this node is disabled (grayed out, not interactive). */
  isDisabled?: boolean;
  /** Indentation level (0 = root). */
  level?: number;
  /** Callback when the expand/collapse chevron is clicked. */
  onToggleExpand?: () => void;
  /** Callback when the node is clicked (selection). */
  onSelect?: () => void;
  /** Optional badge to show after the label. */
  badge?: ReactNode;
  /** Children nodes to render when expanded. */
  children?: ReactNode;
}

/**
 * A generic tree node component for the interpretation tree.
 * Supports expand/collapse, selection, and nesting.
 */
export function TreeNode({
  id,
  label,
  icon,
  hasChildren = false,
  isExpanded = false,
  isSelected = false,
  isDisabled = false,
  level = 0,
  onToggleExpand,
  onSelect,
  badge,
  children,
}: TreeNodeProps) {
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.();
  };

  const handleNodeClick = () => {
    if (isDisabled) return;
    onSelect?.();
  };

  return (
    <div>
      {/* Node row */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors text-sm",
          isSelected
            ? "bg-zinc-200 dark:bg-zinc-700"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
          isDisabled && "opacity-50 cursor-not-allowed"
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={handleNodeClick}
        data-node-id={id}
      >
        {/* Expand/collapse chevron */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={handleChevronClick}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600"
              disabled={isDisabled}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </div>

        {/* Icon */}
        {icon && (
          <div className="w-4 h-4 flex items-center justify-center shrink-0 text-zinc-500 dark:text-zinc-400">
            {icon}
          </div>
        )}

        {/* Label */}
        <span className="flex-1 truncate">{label}</span>

        {/* Badge */}
        {badge && (
          <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
            {badge}
          </div>
        )}
      </div>

      {/* Children (when expanded) */}
      {hasChildren && isExpanded && children && (
        <div className="relative">
          {children}
        </div>
      )}
    </div>
  );
}
