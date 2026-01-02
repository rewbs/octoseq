"use client";

import { useCallback, useState } from "react";
import { Edit2, Check, X, Trash2, Clock, FileCode, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectStore } from "@/lib/stores/projectStore";
import { getScriptId } from "@/lib/nodeTypes";

interface ScriptInspectorProps {
  nodeId: string;
}

/**
 * Inspector view for individual Script nodes.
 * Shows script metadata and management actions.
 */
export function ScriptInspector({ nodeId }: ScriptInspectorProps) {
  const scriptId = getScriptId(nodeId);

  const script = useProjectStore((s) => {
    if (!scriptId || !s.activeProject) return null;
    return s.activeProject.scripts.scripts.find((sc) => sc.id === scriptId) ?? null;
  });

  const isActiveScript = useProjectStore((s) => {
    if (!scriptId || !s.activeProject) return false;
    return s.activeProject.scripts.activeScriptId === scriptId;
  });

  const renameScript = useProjectStore((s) => s.renameScript);
  const removeScript = useProjectStore((s) => s.removeScript);
  const setActiveScript = useProjectStore((s) => s.setActiveScript);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleStartEdit = useCallback(() => {
    setEditName(script?.name ?? "");
    setIsEditing(true);
  }, [script?.name]);

  const handleSaveName = useCallback(() => {
    if (editName.trim() && scriptId) {
      renameScript(scriptId, editName.trim());
    }
    setIsEditing(false);
  }, [editName, scriptId, renameScript]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName("");
  }, []);

  const handleDelete = useCallback(() => {
    if (scriptId) {
      removeScript(scriptId);
      setIsConfirmingDelete(false);
    }
  }, [scriptId, removeScript]);

  const handleActivate = useCallback(() => {
    if (scriptId) {
      setActiveScript(scriptId);
    }
  }, [scriptId, setActiveScript]);

  const formatDate = (isoString: string | undefined) => {
    if (!isoString) return "—";
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  if (!script) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Script not found.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-4">
      {/* Script Name */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Script
        </label>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-8 text-sm flex-1 min-w-0"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") handleCancelEdit();
              }}
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveName}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-zinc-400 shrink-0" />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {script.name}
            </span>
            {isActiveScript && (
              <span className="px-1.5 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded shrink-0">
                Active
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 ml-auto"
              onClick={handleStartEdit}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Timestamps
        </label>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-0.5">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">Created: {formatDate(script.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">Modified: {formatDate(script.modifiedAt)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Actions
        </label>
        <div className="flex flex-col gap-1">
          {!isActiveScript && (
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleActivate}>
              <Play className="h-4 w-4 mr-2" />
              Activate Script
            </Button>
          )}
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600 dark:text-red-400 mr-2">Delete this script?</span>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                onClick={handleDelete}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConfirmingDelete(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              onClick={() => setIsConfirmingDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Script
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
