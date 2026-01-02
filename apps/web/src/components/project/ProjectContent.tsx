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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AutosaveIndicator } from "@/components/project";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProjectActions } from "@/lib/stores/hooks/useProjectActions";
import { useConfirmDiscard } from "@/lib/hooks/useConfirmDiscard";

/**
 * Content panel displayed when the Project node is selected.
 * Shows project metadata, stats, and lifecycle actions.
 */
export function ProjectContent() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);

  // Compute stats from activeProject using useMemo to avoid creating new objects
  // on every render. This prevents infinite re-render loops when combined with
  // subscriptions that update activeProject.modifiedAt.
  const stats = useMemo(() => {
    if (!activeProject) {
      return {
        bandCount: 0,
        eventStreamCount: 0,
        eventCount: 0,
        scriptCount: 0,
        hasMusicalTime: false,
        hasBeatGrid: false,
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
      hasMusicalTime: (activeProject.interpretation.musicalTime?.segments.length ?? 0) > 0,
      hasBeatGrid: activeProject.interpretation.beatGrid?.activeBeatGrid !== null,
    };
  }, [activeProject]);

  const {
    createProject,
    saveProject,
    loadProjectFromFile,
    resetProject,
    renameProject,
  } = useProjectActions();

  const {
    showConfirm,
    requireConfirm,
    handleConfirm,
    handleCancel,
    setShowConfirm,
  } = useConfirmDiscard();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Start editing name
  const handleStartEdit = useCallback(() => {
    setEditName(activeProject?.name ?? "");
    setIsEditing(true);
  }, [activeProject?.name]);

  // Save name edit
  const handleSaveName = useCallback(() => {
    if (editName.trim()) {
      renameProject(editName.trim());
    }
    setIsEditing(false);
  }, [editName, renameProject]);

  // Cancel name edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName("");
  }, []);

  // Handle file selection for load - with confirmation if dirty
  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Check if we need confirmation (file is captured in closure)
      requireConfirm("open", async () => {
        await loadProjectFromFile(file);
      });

      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [loadProjectFromFile, requireConfirm]
  );

  // Trigger file input
  const handleLoadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle New Project with confirmation
  const handleNewProject = useCallback(() => {
    requireConfirm("new", () => {
      createProject();
    });
  }, [requireConfirm, createProject]);

  // Handle Reset with confirmation
  const handleResetProject = useCallback(() => {
    requireConfirm("reset", resetProject);
  }, [requireConfirm, resetProject]);

  // Format date for display
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
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={handleNewProject}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
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
        <ConfirmDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title="Unsaved Changes"
          message="You have unsaved changes. Are you sure you want to continue? Your changes will be lost."
          confirmLabel="Discard Changes"
          cancelLabel="Cancel"
          variant="destructive"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
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
            <AutosaveIndicator />
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
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Clock className="h-3 w-3" />
          <span>Created: {formatDate(activeProject.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Clock className="h-3 w-3" />
          <span>Modified: {formatDate(activeProject.modifiedAt)}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={<Layers className="h-4 w-4" />} label="Bands" value={stats.bandCount} />
        <StatCard icon={<Zap className="h-4 w-4" />} label="Event Streams" value={stats.eventStreamCount} />
        <StatCard icon={<Music2 className="h-4 w-4" />} label="Events" value={stats.eventCount} />
        <StatCard icon={<Code className="h-4 w-4" />} label="Scripts" value={stats.scriptCount} />
      </div>

      {/* Actions */}
      <div className="pt-2 space-y-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={saveProject}
          >
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleLoadClick}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Open
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleNewProject}
          >
            <Plus className="h-4 w-4 mr-2" />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950"
            onClick={handleResetProject}
          >
            <Trash2 className="h-4 w-4 mr-2" />
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

      {/* Confirmation dialog for unsaved changes */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to continue? Your changes will be lost."
        confirmLabel="Discard Changes"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

// ----------------------------
// Stat Card Component
// ----------------------------

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-zinc-50 dark:bg-zinc-800/50">
      <div className="text-zinc-400 dark:text-zinc-500">{icon}</div>
      <div>
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {value}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      </div>
    </div>
  );
}
