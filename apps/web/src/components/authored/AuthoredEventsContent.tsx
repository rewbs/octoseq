"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Trash2, Info, Undo2, Redo2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";
import { AuthoredStreamListItem } from "./AuthoredStreamListItem";

export interface AuthoredEventsContentProps {
  audioDuration: number;
}

/**
 * Content panel for managing authored event streams.
 * Rendered when the "Authored" tree node is expanded.
 */
export function AuthoredEventsContent({ audioDuration }: AuthoredEventsContentProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");

  const { streams, inspectedStreamId, undoStack, redoStack } = useAuthoredEventStore(
    useShallow((s) => ({
      streams: s.streams,
      inspectedStreamId: s.inspectedStreamId,
      undoStack: s.undoStack,
      redoStack: s.redoStack,
    }))
  );

  const selectedCandidateIds = useCandidateEventStore((s) => s.selectedCandidateIds);
  const candidateStreams = useCandidateEventStore((s) => s.streams);

  const {
    createManualStream,
    deleteStream,
    toggleStreamVisibility,
    inspectStream,
    renameStream,
    promoteSelectedEvents,
    undo,
    redo,
  } = useAuthoredEventActions();

  const streamArray = Array.from(streams.values());
  const totalEventCount = streamArray.reduce((sum, s) => sum + s.events.length, 0);

  // Find which candidate stream has selected events
  const candidateStreamWithSelection = (() => {
    if (selectedCandidateIds.size === 0) return null;
    for (const [streamId, stream] of candidateStreams) {
      if (stream.events.some((e) => selectedCandidateIds.has(e.id))) {
        return { streamId, stream };
      }
    }
    return null;
  })();

  const handleCreateStream = useCallback(() => {
    if (newStreamName.trim()) {
      createManualStream(newStreamName.trim());
      setNewStreamName("");
      setIsCreating(false);
    }
  }, [newStreamName, createManualStream]);

  const handleCancelCreate = useCallback(() => {
    setNewStreamName("");
    setIsCreating(false);
  }, []);

  const handlePromoteSelected = useCallback(() => {
    if (candidateStreamWithSelection) {
      promoteSelectedEvents(
        candidateStreamWithSelection.streamId,
        selectedCandidateIds
      );
      // Clear candidate selection after promotion
      useCandidateEventStore.getState().clearCandidateSelection();
    }
  }, [candidateStreamWithSelection, selectedCandidateIds, promoteSelectedEvents]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleCreateStream();
      } else if (e.key === "Escape") {
        handleCancelCreate();
      }
    },
    [handleCreateStream, handleCancelCreate]
  );

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <div className="flex flex-col">
      {/* Action buttons */}
      <div className="p-2 space-y-2">
        {/* Create new stream */}
        {isCreating ? (
          <div className="flex items-center gap-1">
            <Input
              type="text"
              placeholder="Stream name..."
              value={newStreamName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewStreamName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={handleCreateStream}
              disabled={!newStreamName.trim()}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full",
              "border-emerald-300 dark:border-emerald-700",
              "text-emerald-600 dark:text-emerald-400",
              "hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
            )}
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Stream
          </Button>
        )}

        {/* Promote selected candidates */}
        {candidateStreamWithSelection && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full",
              "border-amber-300 dark:border-amber-700",
              "text-amber-600 dark:text-amber-400",
              "hover:bg-amber-50 dark:hover:bg-amber-900/20"
            )}
            onClick={handlePromoteSelected}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Promote {selectedCandidateIds.size} Selected
          </Button>
        )}

        {/* Quick actions row */}
        {streamArray.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {totalEventCount} events in {streamArray.length} streams
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6",
                  !canUndo && "opacity-50 cursor-not-allowed"
                )}
                onClick={undo}
                disabled={!canUndo}
                title="Undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6",
                  !canRedo && "opacity-50 cursor-not-allowed"
                )}
                onClick={redo}
                disabled={!canRedo}
                title="Redo"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Stream List */}
      <div className="px-2 space-y-1">
        {streamArray.length === 0 ? (
          <div className="flex items-start gap-2 px-1 py-4 text-xs text-zinc-500 dark:text-zinc-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <p>No authored event streams yet.</p>
              <p className="mt-1">
                Create a new stream to add events manually, or promote candidate events.
              </p>
              <p className="mt-2 text-emerald-600 dark:text-emerald-400 italic">
                Authored events represent your interpretation.
              </p>
            </div>
          </div>
        ) : (
          streamArray.map((stream) => (
            <AuthoredStreamListItem
              key={stream.id}
              stream={stream}
              isInspected={stream.id === inspectedStreamId}
              onInspect={() =>
                inspectStream(stream.id === inspectedStreamId ? null : stream.id)
              }
              onToggleVisibility={() => toggleStreamVisibility(stream.id)}
              onDelete={() => deleteStream(stream.id)}
              onRename={(name) => renameStream(stream.id, name)}
            />
          ))
        )}
      </div>

      {/* Guidance footer */}
      {streamArray.length > 0 && (
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 mt-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 italic text-center">
            Authored events persist until you remove them.
            <br />
            Access via <code className="font-mono">inputs.authored[&quot;name&quot;]</code> in scripts.
          </div>
        </div>
      )}
    </div>
  );
}
