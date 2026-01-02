"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/lib/stores/projectStore";

interface MissingAudioBannerProps {
  onReattach: () => void;
}

/**
 * Inline banner shown when audio files are missing from a loaded project.
 * Displays the count of missing files and a button to open the re-attachment modal.
 */
export function MissingAudioBanner({ onReattach }: MissingAudioBannerProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const audioLoadStatus = useProjectStore((s) => s.audioLoadStatus);

  // Count missing audio files
  // Only count as missing if status is explicitly "pending" or "failed"
  // Undefined status means audio was loaded directly (not through project import)
  let missingCount = 0;

  if (activeProject?.audio.mixdown) {
    const status = audioLoadStatus.get(activeProject.audio.mixdown.id);
    if (status === "pending" || status === "failed") {
      missingCount++;
    }
  }

  for (const stem of activeProject?.audio.stems ?? []) {
    const status = audioLoadStatus.get(stem.id);
    if (status === "pending" || status === "failed") {
      missingCount++;
    }
  }

  if (missingCount === 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-sm text-amber-800 dark:text-amber-200 flex-1">
        {missingCount} audio file{missingCount > 1 ? "s" : ""} could not be loaded
      </span>
      <Button size="sm" variant="outline" onClick={onReattach}>
        Re-attach
      </Button>
    </div>
  );
}
