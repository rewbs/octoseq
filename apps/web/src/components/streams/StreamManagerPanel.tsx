"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown, Info, Plus, X } from "lucide-react";
import type { AudioBufferLike } from "@octoseq/mir";
import { createConstantBand } from "@octoseq/mir";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import {
  addBand,
  audioCache,
  isAudioStream,
  isBandStream,
  removeStreamCascade,
  useStreamStore,
  useViewStore,
  type AudioStream,
  type BandStream,
  type Stream,
  type StreamId,
} from "@/lib/streams";
import { StreamRow } from "./StreamRow";
import { BandRow } from "./BandRow";
import { useStemImport } from "./useStemImport";

interface PendingRemoval {
  removed: Stream[];
  /** PCM snapshots of removed audio streams, captured BEFORE removal for undo. */
  buffers: Array<[StreamId, AudioBufferLike]>;
  label: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Stream Manager (Phase 2, milestone S3): one mixer-style main-column card for
 * ALL streams — mixdown, stems, and their bands. See docs/design/phase2-ui-shell.md.
 */
export function StreamManagerPanel() {
  const open = useViewStore((s) => s.streamManagerOpen);
  const setStreamManagerOpen = useViewStore((s) => s.setStreamManagerOpen);

  const streams = useStreamStore((s) => s.streams);
  const reorderStreams = useStreamStore((s) => s.reorderStreams);
  const restoreStreams = useStreamStore((s) => s.restoreStreams);
  const selectStream = useStreamStore((s) => s.selectStream);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { importStemFiles } = useStemImport();
  const [deleted, setDeleted] = useState<PendingRemoval | null>(null);

  // Rows: mixdown first, stems by sortOrder, bands grouped under their parent.
  const { mixdown, stems, bandsByParent } = useMemo(() => {
    let mixdownStream: AudioStream | null = null;
    const stemStreams: AudioStream[] = [];
    const bands = new Map<StreamId, BandStream[]>();
    for (const stream of streams.values()) {
      if (isBandStream(stream)) {
        const group = bands.get(stream.parentId);
        if (group) group.push(stream);
        else bands.set(stream.parentId, [stream]);
      } else if (stream.kind === "mixdown") {
        mixdownStream = stream;
      } else {
        stemStreams.push(stream);
      }
    }
    stemStreams.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const group of bands.values()) group.sort((a, b) => a.sortOrder - b.sortOrder);
    return { mixdown: mixdownStream, stems: stemStreams, bandsByParent: bands };
  }, [streams]);

  const audioStreams = useMemo(() => (mixdown ? [mixdown, ...stems] : stems), [mixdown, stems]);

  // DnD (same setup as StemManagementContent)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      // Reordering is only meaningful within one sibling group: stems among
      // stems, bands among bands of the same parent. Cross-group drops no-op.
      const siblingGroups: StreamId[][] = [
        stems.map((s) => s.id),
        ...[...bandsByParent.values()].map((group) => group.map((b) => b.id)),
      ];
      const group = siblingGroups.find((ids) => ids.includes(activeId));
      if (!group) return;
      const oldIndex = group.indexOf(activeId);
      const newIndex = group.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderStreams(arrayMove(group, oldIndex, newIndex));
    },
    [stems, bandsByParent, reorderStreams]
  );

  // Remove with 5s undo (StemManagementContent's pattern: PCM snapshot before
  // removal, restoreStreams + audioCache re-seed on undo).
  const handleRemove = useCallback(
    (id: StreamId) => {
      const state = useStreamStore.getState();
      const target = state.getStream(id);
      if (!target || target.kind === "mixdown") return;

      const willRemove: Stream[] = [target, ...state.getBands(id)];
      const buffers: Array<[StreamId, AudioBufferLike]> = [];
      for (const stream of willRemove) {
        if (isAudioStream(stream)) {
          const buffer = audioCache.get(stream.id);
          if (buffer) buffers.push([stream.id, buffer]);
        }
      }

      const removed = removeStreamCascade(id);
      if (removed.length === 0) return;

      // Candidate events sourced from the removed streams are stale now
      for (const stream of removed) {
        useCandidateEventStore.getState().clearForSource(stream.id);
      }

      if (deleted) clearTimeout(deleted.timeoutId);
      const timeoutId = setTimeout(() => setDeleted(null), 5000);
      setDeleted({ removed, buffers, label: target.label, timeoutId });
    },
    [deleted]
  );

  const handleUndoRemove = useCallback(() => {
    if (!deleted) return;
    clearTimeout(deleted.timeoutId);
    for (const [id, buffer] of deleted.buffers) audioCache.set(id, buffer);
    restoreStreams(deleted.removed);
    setDeleted(null);
  }, [deleted, restoreStreams]);

  const handleDismissUndo = useCallback(() => {
    if (!deleted) return;
    clearTimeout(deleted.timeoutId);
    setDeleted(null);
  }, [deleted]);

  // Header actions
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (files.length > 0) void importStemFiles(files);
    },
    [importStemFiles]
  );

  const handleAddBand = useCallback(() => {
    const state = useStreamStore.getState();
    const selected = state.selectedStreamId ? state.getStream(state.selectedStreamId) : null;
    // Bands go under the selected audio stream; mixdown when none/a band is selected.
    const parent = selected && isAudioStream(selected) ? selected : state.getMixdown();
    if (!parent) return;
    const duration = parent.audio.durationSec;
    if (duration <= 0) return;
    const siblingCount = state.getBands(parent.id).length;
    // Same constant-band defaults as FrequencyBandContent's "Add Band"
    const template = createConstantBand(`Band ${siblingCount + 1}`, 200, 2000, duration, {
      sortOrder: siblingCount,
      sourceId: parent.id,
    });
    const newId = addBand({
      parentId: parent.id,
      label: template.label,
      frequencyShape: template.frequencyShape,
      timeScope: template.timeScope,
      provenance: template.provenance,
    });
    state.selectStream(newId);
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between p-3",
          open && "border-b border-zinc-200 dark:border-zinc-700"
        )}
      >
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setStreamManagerOpen(!open)}
          title={open ? "Collapse" : "Expand"}
        >
          <ChevronDown
            className={cn("h-4 w-4 text-zinc-400 transition-transform", !open && "-rotate-90")}
          />
          <h2 className="text-lg font-semibold">Streams</h2>
        </button>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={!mixdown}
            title="Import stem audio files"
          >
            <Plus className="mr-1 h-4 w-4" />
            Stem
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddBand}
            disabled={!mixdown}
            title="Add a band under the selected audio stream"
          >
            <Plus className="mr-1 h-4 w-4" />
            Band
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Body (header only when collapsed) */}
      {open && (
        <div className="p-2">
          {audioStreams.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              <Info className="h-4 w-4 shrink-0" />
              Load audio to get started
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={stems.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5">
                  {audioStreams.map((audio) => (
                    <Fragment key={audio.id}>
                      <StreamRow
                        stream={audio}
                        sortable={audio.kind === "stem"}
                        onSelect={() => selectStream(audio.id)}
                        onRemove={audio.kind === "stem" ? () => handleRemove(audio.id) : undefined}
                      />
                      <BandGroup
                        bands={bandsByParent.get(audio.id) ?? []}
                        onSelect={selectStream}
                        onRemove={handleRemove}
                      />
                    </Fragment>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Undo toast */}
          {deleted && (
            <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-100 px-2 py-1.5 dark:bg-zinc-800">
                <span className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                  Removed &quot;{deleted.label}&quot;
                  {deleted.removed.length > 1 &&
                    ` (+${deleted.removed.length - 1} band${
                      deleted.removed.length > 2 ? "s" : ""
                    })`}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                    onClick={handleUndoRemove}
                  >
                    Undo
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-400 hover:text-zinc-600"
                    onClick={handleDismissUndo}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A parent's bands as their own sortable sibling group, indented under the parent. */
function BandGroup({
  bands,
  onSelect,
  onRemove,
}: {
  bands: BandStream[];
  onSelect: (id: StreamId) => void;
  onRemove: (id: StreamId) => void;
}) {
  if (bands.length === 0) return null;
  return (
    <SortableContext items={bands.map((b) => b.id)} strategy={verticalListSortingStrategy}>
      {bands.map((band, index) => (
        <BandRow
          key={band.id}
          band={band}
          colorIndex={index}
          onSelect={() => onSelect(band.id)}
          onRemove={() => onRemove(band.id)}
        />
      ))}
    </SortableContext>
  );
}
