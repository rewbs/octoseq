"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Colors for stems (matching the band colors pattern)
const STEM_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-orange-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-yellow-500",
  "bg-red-500",
];

export interface StemListItemProps {
  stemId: string;
  label: string;
  colorIndex: number;
  isSelected: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onRename: (newLabel: string) => void;
  onDelete: () => void;
}

export function StemListItem({
  stemId,
  label,
  colorIndex,
  isSelected,
  isDeleting,
  onSelect,
  onRename,
  onDelete,
}: StemListItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDoubleClick = () => {
    setEditValue(label);
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue.trim() && editValue !== label) {
      onRename(editValue.trim());
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

  const colorClass = STEM_COLORS[colorIndex % STEM_COLORS.length];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
        isSelected
          ? "bg-zinc-200 dark:bg-zinc-700"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        isDragging && "shadow-lg z-10",
        isDeleting && "opacity-50"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        type="button"
        className={cn(
          "touch-none cursor-grab active:cursor-grabbing",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Color indicator */}
      <div className={cn("w-3 h-3 rounded-full shrink-0", colorClass)} />

      {/* Label */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="h-6 py-0 px-1 text-sm w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-sm truncate block"
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleDoubleClick();
            }}
          >
            {label}
          </span>
        )}
      </div>

      {/* Delete button */}
      <div
        className={cn(
          "flex items-center gap-0.5",
          "opacity-0 group-hover:opacity-100",
          isSelected && "opacity-100"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6",
            isDeleting
              ? "text-red-600 bg-red-500/20"
              : "text-red-500 hover:text-red-600 hover:bg-red-500/10"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={isDeleting ? "Click again to confirm" : "Delete stem"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
