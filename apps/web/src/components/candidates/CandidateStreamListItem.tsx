"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CandidateStream } from "@/lib/stores/candidateEventStore";

export interface CandidateStreamListItemProps {
  stream: CandidateStream;
  isInspected: boolean;
  onInspect: () => void;
  onToggleVisibility: () => void;
  onClear: () => void;
}

/**
 * Get human-readable label for an event type.
 */
function getEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "onset":
      return "Onsets";
    case "beat":
      return "Beats";
    case "flux":
      return "Flux";
    default:
      return eventType;
  }
}

export function CandidateStreamListItem({
  stream,
  isInspected,
  onInspect,
  onToggleVisibility,
  onClear,
}: CandidateStreamListItemProps) {
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
      {/* Color indicator - dashed border to indicate candidate nature */}
      <div
        className="w-3 h-3 rounded-full shrink-0 border-2 border-dashed"
        style={{ borderColor: stream.color.stroke }}
      />

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">
          <span className="font-medium">{stream.sourceLabel}</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {" - "}
            {getEventTypeLabel(stream.eventType)}
          </span>
        </div>
        {/* Badge showing count */}
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {stream.events.length} events
        </div>
      </div>

      {/* Controls */}
      <div
        className={cn(
          "flex items-center gap-0.5",
          "opacity-0 group-hover:opacity-100",
          (isInspected || !stream.isVisible) && "opacity-100"
        )}
      >
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

        {/* Clear button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-zinc-500 hover:text-zinc-600 hover:bg-zinc-500/10"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title="Clear this stream"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
