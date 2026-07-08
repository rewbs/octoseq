"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface InlineRenameLabelProps {
  label: string;
  /** Called with the trimmed new label; never called with an empty string. */
  onRename: (newLabel: string) => void;
  className?: string;
}

/**
 * Double-click-to-rename label (same interaction as StemListItem / BandListItem):
 * Enter or blur commits, Escape reverts, empty input reverts silently.
 */
export function InlineRenameLabel({ label, onRename, className }: InlineRenameLabelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);

  const handleDoubleClick = () => {
    setEditValue(label);
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== label) {
      onRename(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setEditValue(label);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-6 w-full rounded border border-zinc-300 bg-white px-1 py-0 text-sm dark:border-zinc-600 dark:bg-zinc-800",
          className
        )}
        autoFocus
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={cn("block truncate text-sm", className)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        handleDoubleClick();
      }}
      title={label}
    >
      {label}
    </span>
  );
}
