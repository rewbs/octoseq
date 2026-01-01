"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Trash2, Eye, EyeOff, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAuthoredStreamId } from "@/lib/nodeTypes";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";
import { cn } from "@/lib/utils";

interface AuthoredStreamInspectorProps {
  nodeId: string;
}

/**
 * Inspector view for an individual authored event stream.
 * Shows stream properties, actions, and provenance info.
 */
export function AuthoredStreamInspector({ nodeId }: AuthoredStreamInspectorProps) {
  const streamId = getAuthoredStreamId(nodeId);
  const stream = useAuthoredEventStore(
    useShallow((s) => (streamId ? s.streams.get(streamId) : undefined))
  );

  const { deleteStream, renameStream, toggleStreamVisibility, inspectStream } =
    useAuthoredEventActions();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const handleStartEdit = useCallback(() => {
    if (stream) {
      setEditName(stream.name);
      setIsEditing(true);
    }
  }, [stream]);

  const handleSaveEdit = useCallback(() => {
    if (streamId && editName.trim()) {
      renameStream(streamId, editName.trim());
    }
    setIsEditing(false);
  }, [streamId, editName, renameStream]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName("");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSaveEdit();
      } else if (e.key === "Escape") {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit]
  );

  const handleDelete = useCallback(() => {
    if (streamId) {
      deleteStream(streamId);
    }
  }, [streamId, deleteStream]);

  const handleToggleVisibility = useCallback(() => {
    if (streamId) {
      toggleStreamVisibility(streamId);
    }
  }, [streamId, toggleStreamVisibility]);

  if (!stream || !streamId) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Stream not found.
      </div>
    );
  }

  // Get source info for display
  const getSourceInfo = () => {
    switch (stream.source.kind) {
      case "manual":
        return {
          label: "Manual",
          description: stream.source.description || "Created manually",
        };
      case "promoted":
        return {
          label: "Promoted",
          description: `From ${stream.source.eventType} candidates`,
        };
      case "mixed":
        return {
          label: "Mixed",
          description: "Events from multiple sources",
        };
      default:
        return {
          label: "Unknown",
          description: "",
        };
    }
  };

  const sourceInfo = getSourceInfo();

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="p-2 space-y-4">
      {/* Stream Name */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Stream Name
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Input
              type="text"
              value={editName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditName(e.target.value)
              }
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleSaveEdit}
              disabled={!editName.trim()}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCancelEdit}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span
              className="text-sm font-medium"
              style={{ color: stream.color.stroke }}
            >
              {stream.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Stream Stats */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Stats
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Events</span>
            <span>{stream.events.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Source</span>
            <span>{sourceInfo.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Visible</span>
            <span>{stream.isVisible ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>

      {/* Provenance */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Provenance
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
          <div>{sourceInfo.description}</div>
          <div>Created: {formatDate(stream.createdAt)}</div>
          <div>Modified: {formatDate(stream.modifiedAt)}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Actions
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleToggleVisibility}
          >
            {stream.isVisible ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide Stream
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Show Stream
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full justify-start",
              "border-red-300 dark:border-red-700",
              "text-red-600 dark:text-red-400",
              "hover:bg-red-50 dark:hover:bg-red-900/20"
            )}
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Stream
          </Button>
        </div>
      </div>

      {/* Usage hint */}
      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">
          Access in scripts via{" "}
          <code className="font-mono">inputs.authored[&quot;{stream.name}&quot;]</code>
        </div>
      </div>
    </div>
  );
}
