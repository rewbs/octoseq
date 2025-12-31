/**
 * Cursor Detection for Signal Explorer
 *
 * Detects if the cursor is positioned on a signal symbol in the Monaco editor.
 */

import type { CursorContext, ScriptSignalInfo } from "./types";

/** Minimal Monaco position interface */
interface MonacoPosition {
  lineNumber: number;
  column: number;
}

/** Minimal Monaco word info interface */
interface MonacoWordAtPosition {
  word: string;
  startColumn: number;
  endColumn: number;
}

/** Minimal Monaco text model interface for cursor detection */
interface MonacoTextModel {
  getWordAtPosition(position: MonacoPosition): MonacoWordAtPosition | null;
  getLineContent(lineNumber: number): string;
}

/**
 * Detect if cursor is on a signal symbol.
 *
 * Uses the word at cursor position and checks against known signal variables.
 * For chain expressions (e.g., `smoothed.normalise`), finds the root identifier.
 */
export function detectSignalAtCursor(
  model: MonacoTextModel,
  position: MonacoPosition,
  scriptSignals: ScriptSignalInfo[]
): CursorContext {
  const word = model.getWordAtPosition(position);

  if (!word) {
    return {
      signalName: null,
      line: position.lineNumber,
      column: position.column,
    };
  }

  const wordText = word.word;

  // Check if this word is a known signal variable
  const signal = scriptSignals.find((s) => s.name === wordText);
  if (signal) {
    return {
      signalName: wordText,
      line: position.lineNumber,
      column: position.column,
    };
  }

  // Also check for chain expressions like `smoothed.normalise`
  // The signal would be the root of the chain
  const lineContent = model.getLineContent(position.lineNumber);
  const textUntilPosition = lineContent.substring(0, word.startColumn - 1);

  // Parse backward to find the root identifier
  const rootName = parseRootIdentifier(textUntilPosition, wordText);
  if (rootName && scriptSignals.find((s) => s.name === rootName)) {
    return {
      signalName: rootName,
      line: position.lineNumber,
      column: position.column,
    };
  }

  return {
    signalName: null,
    line: position.lineNumber,
    column: position.column,
  };
}

/**
 * Parse backward through the text to find the root identifier of a chain expression.
 *
 * Given text like "smoothed.normalise" with cursor on "normalise",
 * this function walks backward to find "smoothed" as the root.
 */
function parseRootIdentifier(
  textBefore: string,
  currentWord: string
): string | null {
  const trimmed = textBefore.trimEnd();
  if (!trimmed) return null;

  // Check if the text ends with a dot (indicating method chain)
  if (!trimmed.endsWith(".")) {
    return null;
  }

  // Walk backward through dots and parentheses to find root
  let i = trimmed.length - 2; // Skip the trailing dot
  let depth = 0;

  while (i >= 0) {
    const ch = trimmed.charAt(i);
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (ch === "." && depth === 0) {
      // Found another dot, continue backward
    } else if (depth === 0 && !/[a-zA-Z0-9_]/.test(ch)) {
      break;
    }
    i--;
  }

  // Extract the root identifier
  const start = i + 1;
  const rest = trimmed.slice(start);
  const match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  return match?.[1] ?? null;
}

/**
 * Check if cursor moved to a different signal than before.
 * Used to avoid redundant analysis when cursor moves within the same signal.
 */
export function cursorChangedSignal(
  prevCursor: CursorContext | null,
  newCursor: CursorContext
): boolean {
  if (!prevCursor) return newCursor.signalName !== null;
  return prevCursor.signalName !== newCursor.signalName;
}
