"use client";

import { CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RecoveryBannerProps {
  /** Name of the recovered project */
  projectName: string | null;
  /** Whether the banner is visible */
  visible: boolean;
  /** Callback when banner is dismissed */
  onDismiss: () => void;
}

/**
 * Banner indicating a project was recovered from autosave.
 * Shows briefly after successful recovery.
 */
export function RecoveryBanner({
  projectName,
  visible,
  onDismiss,
}: RecoveryBannerProps) {
  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-emerald-600 px-4 py-2 text-white shadow-lg">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5" />
        <span className="text-sm font-medium">
          {projectName ? (
            <>Project &ldquo;{projectName}&rdquo; recovered from autosave</>
          ) : (
            <>Project recovered from autosave</>
          )}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        className="h-6 w-6 text-white hover:bg-emerald-500"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
