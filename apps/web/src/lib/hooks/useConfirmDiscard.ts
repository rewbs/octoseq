"use client";

import { useState, useCallback } from "react";
import { useProjectStore } from "@/lib/stores/projectStore";

/**
 * Type of action that might require confirmation if there are unsaved changes.
 */
export type DiscardActionType = "new" | "open" | "reset";

interface PendingAction {
  type: DiscardActionType;
  callback?: () => void | Promise<void>;
}

/**
 * Hook for managing unsaved changes confirmation flow.
 *
 * Use this hook to wrap destructive actions (New, Open, Reset) that would
 * discard unsaved changes. The hook tracks pending actions and provides
 * state for rendering a confirmation dialog.
 *
 * @example
 * ```tsx
 * const { showConfirm, requireConfirm, handleConfirm, handleCancel, setShowConfirm } = useConfirmDiscard();
 *
 * const handleNew = () => {
 *   requireConfirm("new", () => createProject());
 * };
 *
 * return (
 *   <>
 *     <Button onClick={handleNew}>New Project</Button>
 *     <ConfirmDialog
 *       open={showConfirm}
 *       onOpenChange={setShowConfirm}
 *       title="Unsaved Changes"
 *       message="You have unsaved changes. Are you sure you want to continue?"
 *       onConfirm={handleConfirm}
 *       onCancel={handleCancel}
 *     />
 *   </>
 * );
 * ```
 */
export function useConfirmDiscard() {
  const isDirty = useProjectStore((s) => s.isDirty);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  /**
   * Check if the action requires confirmation due to unsaved changes.
   * If confirmation is required, shows the dialog and stores the pending action.
   * If not required, executes the callback immediately.
   *
   * @param actionType - The type of action being performed
   * @param callback - The callback to execute if confirmed (or immediately if not dirty)
   * @returns true if confirmation dialog was shown, false if action was executed immediately
   */
  const requireConfirm = useCallback(
    (actionType: DiscardActionType, callback?: () => void | Promise<void>): boolean => {
      if (isDirty) {
        setPendingAction({ type: actionType, callback });
        setShowConfirm(true);
        return true; // Confirmation required
      }
      // No unsaved changes, execute immediately
      callback?.();
      return false; // No confirmation needed
    },
    [isDirty]
  );

  /**
   * Handle confirmation - execute the pending action.
   */
  const handleConfirm = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    setShowConfirm(false);
    action?.callback?.();
  }, [pendingAction]);

  /**
   * Handle cancellation - discard the pending action.
   */
  const handleCancel = useCallback(() => {
    setPendingAction(null);
    setShowConfirm(false);
  }, []);

  return {
    /** Whether the confirmation dialog should be shown */
    showConfirm,
    /** The pending action waiting for confirmation */
    pendingAction,
    /** Request confirmation for an action that might discard changes */
    requireConfirm,
    /** Handle user confirming the action */
    handleConfirm,
    /** Handle user cancelling the action */
    handleCancel,
    /** Directly control dialog visibility */
    setShowConfirm,
  };
}
