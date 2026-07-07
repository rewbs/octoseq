"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AudioLines, Disc3, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { audioCache, useStreamStore, useViewStore, type AudioStream } from "@/lib/streams";
import { AnalysisStatusChip } from "./AnalysisStatusChip";
import { InlineRenameLabel } from "./InlineRenameLabel";

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export interface StreamRowProps {
  stream: AudioStream;
  /** Stems are sortable among themselves; the mixdown is fixed first. */
  sortable: boolean;
  onSelect: () => void;
  /** Absent for the mixdown (it cannot be removed). */
  onRemove?: () => void;
}

/**
 * Row for an audio-backed stream (mixdown or stem): kind glyph, enable checkbox,
 * inline rename, file info, decoded-PCM indicator, analysis status, compare toggle.
 */
export function StreamRow({ stream, sortable, onSelect, onRemove }: StreamRowProps) {
  const isSelected = useStreamStore((s) => s.selectedStreamId === stream.id);
  const renameStream = useStreamStore((s) => s.renameStream);
  const setStreamEnabled = useStreamStore((s) => s.setStreamEnabled);
  const isCompared = useViewStore((s) => s.comparedStreamIds.has(stream.id));
  const toggleCompared = useViewStore((s) => s.toggleCompared);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stream.id,
    disabled: !sortable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const KindIcon = stream.kind === "mixdown" ? Disc3 : AudioLines;
  const fileName = stream.audio.fileName ?? stream.label;
  const hasPcm = audioCache.has(stream.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 transition-colors",
        isSelected
          ? "bg-zinc-200 dark:bg-zinc-700"
          : isCompared
            ? "bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        isDragging && "z-10 shadow-lg",
        !stream.enabled && "opacity-60"
      )}
      onClick={onSelect}
    >
      {/* Drag handle (stems only) */}
      {sortable ? (
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:text-zinc-300"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}

      {/* Kind glyph */}
      <KindIcon className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />

      {/* Enable/disable */}
      <input
        type="checkbox"
        checked={stream.enabled}
        onChange={(e) => setStreamEnabled(stream.id, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 accent-blue-600"
        title={stream.enabled ? "Disable stream" : "Enable stream"}
      />

      {/* Label */}
      <div className="min-w-0 flex-1">
        <InlineRenameLabel
          label={stream.label}
          onRename={(newLabel) => renameStream(stream.id, newLabel)}
          className="font-medium"
        />
      </div>

      {/* File name + duration */}
      <span
        className="max-w-40 shrink-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
        title={fileName}
      >
        {fileName} · {formatDuration(stream.audio.durationSec)}
      </span>

      {/* Decoded-PCM presence */}
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          hasPcm ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
        )}
        title={hasPcm ? "PCM decoded" : "PCM not loaded"}
      />

      {/* Analysis status */}
      <AnalysisStatusChip streamId={stream.id} />

      {/* Compare */}
      <input
        type="checkbox"
        checked={isCompared}
        onChange={() => toggleCompared(stream.id)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 accent-blue-600"
        title="Show in comparison panel"
      />

      {/* Remove */}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove stream"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
    </div>
  );
}
