import { useHotkeys } from "react-hotkeys-hook";

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
 * Uses react-hotkeys-hook which automatically disables shortcuts when:
 * - Focus is in contentEditable elements (like Monaco editor)
 * - Focus is in form elements (input, textarea, select)
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
  // Navigation shortcuts
  useHotkeys("left, j", onPrevCandidate, { preventDefault: true }, [onPrevCandidate]);
  useHotkeys("right, k", onNextCandidate, { preventDefault: true }, [onNextCandidate]);

  // Action shortcuts
  useHotkeys("a", onAccept, { preventDefault: true }, [onAccept]);
  useHotkeys("r", onReject, { preventDefault: true }, [onReject]);
  useHotkeys("space", onTogglePlay, { preventDefault: true }, [onTogglePlay]);
  useHotkeys("q", onPlayQuery, { preventDefault: true }, [onPlayQuery]);
  useHotkeys("m", onToggleAddMissingMode, { preventDefault: true }, [onToggleAddMissingMode]);
  useHotkeys("b", onJumpToBestUnreviewed, { preventDefault: true }, [onJumpToBestUnreviewed]);

  // Conditional delete shortcut
  useHotkeys(
    "delete, backspace",
    onDeleteManual,
    { preventDefault: true, enabled: canDeleteManual },
    [onDeleteManual, canDeleteManual]
  );
}
