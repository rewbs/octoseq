"use client";

import { useCallback, useEffect, useState } from "react";
import { AutosaveRecoveryDialog } from "./AutosaveRecoveryDialog";
import { RecoveryBanner } from "./RecoveryBanner";
import { useProjectActions } from "@/lib/stores/hooks/useProjectActions";

interface AutosaveProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that handles autosave recovery flow.
 *
 * Wraps the app content and shows:
 * - Recovery dialog when an autosave is detected
 * - Recovery banner after successful recovery
 */
export function AutosaveProvider({ children }: AutosaveProviderProps) {
  const {
    pendingRecovery,
    wasRecovered,
    clearRecovered,
    acceptRecovery,
    dismissRecovery,
  } = useProjectActions();

  // Local state to track dialog visibility (separate from pendingRecovery)
  const [showDialog, setShowDialog] = useState(false);

  // Show dialog when recovery becomes available
  useEffect(() => {
    if (pendingRecovery) {
      setShowDialog(true);
    }
  }, [pendingRecovery]);

  // Handle accept
  const handleAccept = useCallback(async () => {
    setShowDialog(false);
    await acceptRecovery();
  }, [acceptRecovery]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    setShowDialog(false);
    await dismissRecovery();
  }, [dismissRecovery]);

  // Auto-hide recovery banner after a delay
  useEffect(() => {
    if (wasRecovered) {
      const timer = setTimeout(() => {
        clearRecovered();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [wasRecovered, clearRecovered]);

  return (
    <>
      {/* Recovery dialog */}
      <AutosaveRecoveryDialog
        record={pendingRecovery}
        open={showDialog}
        onAccept={handleAccept}
        onDismiss={handleDismiss}
      />

      {/* Recovery banner */}
      <RecoveryBanner
        projectName={pendingRecovery?.project.project.name ?? null}
        visible={wasRecovered}
        onDismiss={clearRecovered}
      />

      {/* App content */}
      {children}
    </>
  );
}
