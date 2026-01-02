"use client";

import { History, FileWarning, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { formatAutosaveTimestamp } from "@/lib/persistence/autosave";
import type { AutosaveRecord } from "@/lib/persistence/types";

interface AutosaveRecoveryDialogProps {
  /** The autosave record to recover */
  record: AutosaveRecord | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when recovery is accepted */
  onAccept: () => void;
  /** Callback when recovery is dismissed */
  onDismiss: () => void;
}

/**
 * Dialog prompting user to recover from an autosave.
 * Shows when an autosave is detected on app startup.
 */
export function AutosaveRecoveryDialog({
  record,
  open,
  onAccept,
  onDismiss,
}: AutosaveRecoveryDialogProps) {
  if (!record) return null;

  const projectName = record.project.project.name;
  const timestamp = formatAutosaveTimestamp(record.savedAt);

  return (
    <Modal
      title="Recover Unsaved Work"
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          // X button, clicking outside, or pressing Escape triggers discard
          onDismiss();
        }
      }}
    >
      <div className="flex flex-col gap-4">
        {/* Icon and message */}
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-full bg-amber-100 p-2 dark:bg-amber-900/30">
            <FileWarning className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              An unsaved version of your project was found. This may have been
              saved automatically before a crash or unexpected close.
            </p>
          </div>
        </div>

        {/* Project details */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-zinc-500" />
            <span className="font-medium">{projectName}</span>
            <span className="text-zinc-500">saved {timestamp}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onDismiss}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Discard & Start Fresh
          </Button>
          <Button onClick={onAccept} className="gap-2">
            <History className="h-4 w-4" />
            Recover Project
          </Button>
        </div>
      </div>
    </Modal>
  );
}
