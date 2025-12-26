import { useHotkeys } from "react-hotkeys-hook";
import { HOTKEY_SCOPE_APP } from "@/lib/hotkeys";

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
 * Uses react-hotkeys-hook + scopes so shortcuts can be disabled when the script editor is focused.
 * (Form fields/contentEditable are also ignored by default.)
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
  const baseOptions = { preventDefault: true, scopes: [HOTKEY_SCOPE_APP] as const };

  // Navigation shortcuts
  useHotkeys("left, j", onPrevCandidate, baseOptions, [onPrevCandidate]);
  useHotkeys("right, k", onNextCandidate, baseOptions, [onNextCandidate]);

  // Action shortcuts
  useHotkeys("a", onAccept, baseOptions, [onAccept]);
  useHotkeys("r", onReject, baseOptions, [onReject]);
  useHotkeys("space", onTogglePlay, baseOptions, [onTogglePlay]);
  useHotkeys("q", onPlayQuery, baseOptions, [onPlayQuery]);
  useHotkeys("m", onToggleAddMissingMode, baseOptions, [onToggleAddMissingMode]);
  useHotkeys("b", onJumpToBestUnreviewed, baseOptions, [onJumpToBestUnreviewed]);

  // Conditional delete shortcut
  useHotkeys(
    "delete, backspace",
    onDeleteManual,
    { ...baseOptions, enabled: canDeleteManual },
    [onDeleteManual, canDeleteManual]
  );
}
