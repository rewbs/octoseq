"use client";

import { useState, useCallback } from "react";
import { Eye, EyeOff, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AuthoredEventStream } from "@/lib/stores/types/authoredEvent";

export interface AuthoredStreamListItemProps {
  stream: AuthoredEventStream;
  isInspected: boolean;
  onInspect: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

/**
 * Get source description for display.
 */
function getSourceDescription(stream: AuthoredEventStream): string {
  switch (stream.source.kind) {
    case "promoted":
      return `Promoted from ${stream.source.eventType}`;
    case "manual":
      return "Manual";
    case "mixed":
      return "Mixed sources";
    default:
      return "";
  }
}

export function AuthoredStreamListItem({
  stream,
  isInspected,
  onInspect,
  onToggleVisibility,
  onDelete,
  onRename,
}: AuthoredStreamListItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(stream.name);

  const handleStartRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(stream.name);
    setIsRenaming(true);
  }, [stream.name]);

  const handleConfirmRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (editName.trim() && editName.trim() !== stream.name) {
      onRename(editName.trim());
    }
    setIsRenaming(false);
  }, [editName, stream.name, onRename]);

  const handleCancelRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(stream.name);
    setIsRenaming(false);
  }, [stream.name]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      if (editName.trim() && editName.trim() !== stream.name) {
        onRename(editName.trim());
      }
      setIsRenaming(false);
    } else if (e.key === "Escape") {
      setEditName(stream.name);
      setIsRenaming(false);
    }
  }, [editName, stream.name, onRename]);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
        isInspected
          ? "bg-zinc-200 dark:bg-zinc-700"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        !stream.isVisible && "opacity-50"
      )}
      onClick={onInspect}
    >
      {/* Color indicator - solid border to indicate authoritative nature */}
      <div
        className="w-3 h-3 rounded-full shrink-0 border-2"
        style={{
          borderColor: stream.color.stroke,
          backgroundColor: stream.color.fill,
        }}
      />

      {/* Label */}
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Input
              type="text"
              value={editName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-6 text-sm px-1"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleConfirmRename}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleCancelRename}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <div className="text-sm truncate font-medium">{stream.name}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {stream.events.length} events
              {stream.source.kind !== "manual" && (
                <span className="ml-1">
                  &middot; {getSourceDescription(stream)}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      {!isRenaming && (
        <div
          className={cn(
            "flex items-center gap-0.5",
            "opacity-0 group-hover:opacity-100",
            (isInspected || !stream.isVisible) && "opacity-100"
          )}
        >
          {/* Rename button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleStartRename}
            title="Rename stream"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          {/* Visibility toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={stream.isVisible ? "Hide from overlay" : "Show on overlay"}
          >
            {stream.isVisible ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Delete button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-red-600 hover:bg-red-500/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete this stream"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
