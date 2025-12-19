import { useEffect } from "react";
import { isCandidateTextInputTarget } from "@/lib/searchRefinement";

interface KeyboardShortcutCallbacks {
  onPrevCandidate: () => void;
  onNextCandidate: () => void;
  onAccept: () => void;
  onReject: () => void;
  onTogglePlay: () => void;
  onPlayQuery: () => void;
  onToggleAddMissingMode: () => void;
  onDeleteManual: () => void;
  onJumpToBestUnreviewed: () => void;
  canDeleteManual: boolean;
}

/**
 * Hook that handles keyboard shortcuts for the search refinement workflow.
 *
 * Shortcuts:
 * - ArrowLeft/j: Previous candidate
 * - ArrowRight/k: Next candidate
 * - a: Accept active candidate
 * - r: Reject active candidate
 * - Space: Toggle play/pause
 * - q: Play query region
 * - m: Toggle add missing mode
 * - b: Jump to best unreviewed candidate
 * - Delete/Backspace: Delete manual candidate (when applicable)
 */
export function useKeyboardShortcuts({
  onPrevCandidate,
  onNextCandidate,
  onAccept,
  onReject,
  onTogglePlay,
  onPlayQuery,
  onToggleAddMissingMode,
  onDeleteManual,
  onJumpToBestUnreviewed,
  canDeleteManual,
}: KeyboardShortcutCallbacks) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in a text input
      if (isCandidateTextInputTarget(e.target)) return;
      // Skip if modifier keys are held
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      const lower = key.toLowerCase();

      if (key === "ArrowLeft" || lower === "j") {
        e.preventDefault();
        onPrevCandidate();
        return;
      }
      if (key === "ArrowRight" || lower === "k") {
        e.preventDefault();
        onNextCandidate();
        return;
      }
      if (lower === "a") {
        e.preventDefault();
        onAccept();
        return;
      }
      if (lower === "r") {
        e.preventDefault();
        onReject();
        return;
      }
      if (key === " ") {
        e.preventDefault();
        onTogglePlay();
        return;
      }
      if (lower === "q") {
        e.preventDefault();
        onPlayQuery();
        return;
      }
      if (lower === "m") {
        e.preventDefault();
        onToggleAddMissingMode();
        return;
      }
      if (lower === "b") {
        e.preventDefault();
        onJumpToBestUnreviewed();
        return;
      }
      if ((key === "Delete" || key === "Backspace") && canDeleteManual) {
        e.preventDefault();
        onDeleteManual();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onPrevCandidate,
    onNextCandidate,
    onAccept,
    onReject,
    onTogglePlay,
    onPlayQuery,
    onToggleAddMissingMode,
    onDeleteManual,
    onJumpToBestUnreviewed,
    canDeleteManual,
  ]);
}
