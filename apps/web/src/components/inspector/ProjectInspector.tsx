"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Save,
  FolderOpen,
  Trash2,
  Plus,
  Edit2,
  Check,
  X,
  Clock,
  Layers,
  Zap,
  Code,
  Music2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProjectActions } from "@/lib/stores/hooks/useProjectActions";

/**
 * Inspector view for the Project node.
 * Shows project metadata, stats, and lifecycle actions.
 */
export function ProjectInspector() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);

  const stats = useMemo(() => {
    if (!activeProject) {
      return {
        bandCount: 0,
        eventStreamCount: 0,
        eventCount: 0,
        scriptCount: 0,
      };
    }

    const eventCount = activeProject.interpretation.authoredEvents.reduce(
      (sum, stream) => sum + stream.events.length,
      0
    );

    return {
      bandCount: activeProject.interpretation.frequencyBands?.bands.length ?? 0,
      eventStreamCount: activeProject.interpretation.authoredEvents.length,
      eventCount,
      scriptCount: activeProject.scripts.scripts.length,
    };
  }, [activeProject]);

  const {
    createProject,
    saveProject,
    loadProjectFromFile,
    resetProject,
    renameProject,
  } = useProjectActions();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = useCallback(() => {
    setEditName(activeProject?.name ?? "");
    setIsEditing(true);
  }, [activeProject?.name]);

  const handleSaveName = useCallback(() => {
    if (editName.trim()) {
      renameProject(editName.trim());
    }
    setIsEditing(false);
  }, [editName, renameProject]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName("");
  }, []);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await loadProjectFromFile(file);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [loadProjectFromFile]
  );

  const handleLoadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const formatDate = (isoString: string | undefined) => {
    if (!isoString) return "—";
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  if (!activeProject) {
    return (
      <div className="p-4 space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No project loaded.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => createProject()}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadClick}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Open Project...
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.octoseq.json"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Horizontal layout for inspector */}
      <div className="flex gap-6">
        {/* Left: Name and timestamps */}
        <div className="flex-1 space-y-3">
          {/* Project Name */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Project
            </label>
            {isEditing ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSaveName}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {activeProject.name}
                  {isDirty && <span className="text-amber-500 ml-1">*</span>}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleStartEdit}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Created: {formatDate(activeProject.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Modified: {formatDate(activeProject.modifiedAt)}</span>
            </div>
          </div>
        </div>

        {/* Center: Stats */}
        <div className="flex gap-4">
          <StatPill icon={<Layers className="h-3 w-3" />} label="Bands" value={stats.bandCount} />
          <StatPill icon={<Zap className="h-3 w-3" />} label="Streams" value={stats.eventStreamCount} />
          <StatPill icon={<Music2 className="h-3 w-3" />} label="Events" value={stats.eventCount} />
          <StatPill icon={<Code className="h-3 w-3" />} label="Scripts" value={stats.scriptCount} />
        </div>

        {/* Right: Actions */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={saveProject}>
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={handleLoadClick}>
            <FolderOpen className="h-4 w-4 mr-1" />
            Open
          </Button>
          <Button variant="outline" size="sm" onClick={() => createProject()}>
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            onClick={resetProject}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.octoseq.json"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}

// Compact stat display for horizontal layout
interface StatPillProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function StatPill({ icon, label, value }: StatPillProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800">
      <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{value}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}
