"use client";

import { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Headphones, Volume2, VolumeX, Waves, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBandColorHex } from "@/lib/bandColors";
import { useBandEditingStore, useStreamStore, useViewStore, type BandStream } from "@/lib/streams";
import { AnalysisStatusChip } from "./AnalysisStatusChip";
import { InlineRenameLabel } from "./InlineRenameLabel";

function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.round(hz)}`;
}

/** Overall min–max frequency range across all shape segments, e.g. "20–250Hz". */
function frequencyRangeSummary(band: BandStream): string {
  let min = Infinity;
  let max = -Infinity;
  for (const segment of band.frequencyShape) {
    min = Math.min(min, segment.lowHzStart, segment.lowHzEnd);
    max = Math.max(max, segment.highHzStart, segment.highHzEnd);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "—";
  return `${formatHz(min)}–${formatHz(max)}Hz`;
}

export interface BandRowProps {
  band: BandStream;
  /** Index within the parent's band group; drives the default palette color. */
  colorIndex: number;
  onSelect: () => void;
  onRemove: () => void;
}

/**
 * Row for a band stream, indented under its parent audio stream: color swatch,
 * inline rename, frequency range, solo/mute, analysis status, compare toggle.
 */
export function BandRow({ band, colorIndex, onSelect, onRemove }: BandRowProps) {
  const isSelected = useStreamStore((s) => s.selectedStreamId === band.id);
  const renameStream = useStreamStore((s) => s.renameStream);
  const setStreamEnabled = useStreamStore((s) => s.setStreamEnabled);
  const setBandColor = useStreamStore((s) => s.setBandColor);
  const isCompared = useViewStore((s) => s.comparedStreamIds.has(band.id));
  const toggleCompared = useViewStore((s) => s.toggleCompared);
  const isSoloed = useBandEditingStore((s) => s.soloedBandId === band.id);
  const isMuted = useBandEditingStore((s) => s.mutedBandIds.has(band.id));
  const setSoloedBand = useBandEditingStore((s) => s.setSoloedBand);
  const toggleMutedBand = useBandEditingStore((s) => s.toggleMutedBand);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: band.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const color = band.color ?? getBandColorHex(colorIndex);
  const rangeSummary = useMemo(() => frequencyRangeSummary(band), [band]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex h-8 cursor-pointer items-center gap-1.5 rounded-md py-0 pr-2 pl-8 transition-colors",
        isSelected
          ? "bg-zinc-200 dark:bg-zinc-700"
          : isCompared
            ? "bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        isDragging && "z-10 shadow-lg",
        !band.enabled && "opacity-60"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:text-zinc-300"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Kind glyph */}
      <Waves className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />

      {/* Color swatch — click opens the native color picker */}
      <label
        className="relative h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm ring-1 ring-black/10 dark:ring-white/10"
        style={{ backgroundColor: color }}
        title="Band color"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => setBandColor(band.id, e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>

      {/* Enable/disable */}
      <input
        type="checkbox"
        checked={band.enabled}
        onChange={(e) => setStreamEnabled(band.id, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 accent-blue-600"
        title={band.enabled ? "Disable band" : "Enable band"}
      />

      {/* Label */}
      <div className="min-w-0 flex-1">
        <InlineRenameLabel
          label={band.label}
          onRename={(newLabel) => renameStream(band.id, newLabel)}
        />
      </div>

      {/* Frequency range */}
      <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {rangeSummary}
      </span>

      {/* Solo */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-6 w-6 shrink-0",
          isSoloed && "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
        )}
        onClick={(e) => {
          e.stopPropagation();
          setSoloedBand(isSoloed ? null : band.id);
        }}
        title="Solo (audition this band only)"
      >
        <Headphones className="h-3.5 w-3.5" />
      </Button>

      {/* Mute */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-6 w-6 shrink-0",
          isMuted && "bg-red-500/20 text-red-600 dark:text-red-400"
        )}
        onClick={(e) => {
          e.stopPropagation();
          toggleMutedBand(band.id);
        }}
        title="Mute (hide from overlay)"
      >
        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </Button>

      {/* Analysis status */}
      <AnalysisStatusChip streamId={band.id} />

      {/* Compare */}
      <input
        type="checkbox"
        checked={isCompared}
        onChange={() => toggleCompared(band.id)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 accent-blue-600"
        title="Show in comparison panel"
      />

      {/* Remove */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove band"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
