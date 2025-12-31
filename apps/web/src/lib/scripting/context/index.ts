/**
 * Unified Context Detection for Monaco IDE Support
 *
 * This module provides a single entry point for detecting cursor context,
 * used by all IDE providers (completion, hover, signature help, diagnostics).
 *
 * Design principles:
 * - Never throws - returns "unknown" context on failure
 * - Tolerates incomplete/invalid syntax
 * - Cheap to run synchronously
 */

import type {
  CursorContext,
  CursorContextKind,
  ChainSegment,
  ChainParseResult,
  CallContext,
  ConfigMapContext,
} from "./types";
import { getApiRegistry, resolveChain } from "../registry";

// Re-export types
export * from "./types";

// =============================================================================
// Utility Functions
// =============================================================================

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function trimRight(text: string): string {
  let end = text.length;
  while (end > 0 && isWhitespace(text[end - 1]!)) end--;
  return text.slice(0, end);
}

/**
 * Parse a string literal backwards from the closing quote.
 */
function parseStringLiteralBackward(
  text: string,
  endIndex: number
): { value: string; startIndex: number } | null {
  const quote = text[endIndex];
  if (quote !== '"' && quote !== "'") return null;
  let i = endIndex - 1;
  let valueReversed = "";

  while (i >= 0) {
    const ch = text[i]!;
    if (ch === quote) {
      // Check escaping: count backslashes immediately preceding.
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === "\\") {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        // Unescaped quote.
        return { value: valueReversed.split("").reverse().join(""), startIndex: i };
      }
    }
    valueReversed += ch;
    i--;
  }

  return null;
}

/**
 * Find the matching opening paren for a closing paren.
 */
function findMatchingParenBackward(text: string, closeIndex: number): number | null {
  if (text[closeIndex] !== ")") return null;
  let depth = 1;
  let i = closeIndex - 1;

  while (i >= 0) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const str = parseStringLiteralBackward(text, i);
      if (str) {
        i = str.startIndex - 1;
        continue;
      }
    }

    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      depth--;
      if (depth === 0) return i;
    }
    i--;
  }

  return null;
}

// =============================================================================
// Chain Parsing
// =============================================================================

/**
 * Parse a chain expression ending with a dot.
 * Returns the chain segments leading to the cursor.
 */
export function parseChainBeforeDot(textUntilPosition: string): ChainParseResult {
  try {
    const text = trimRight(textUntilPosition);
    if (!text.endsWith(".")) {
      return { segments: [], valid: false, error: "Text does not end with dot" };
    }

    let i = text.length - 2; // char before '.'
    while (i >= 0 && isWhitespace(text[i]!)) i--;

    const segmentsReversed: ChainSegment[] = [];

    while (i >= 0) {
      const ch = text[i]!;

      if (ch === ")") {
        // Parse a method call segment: `name(...)`
        const openIndex = findMatchingParenBackward(text, i);
        if (openIndex == null) {
          return { segments: segmentsReversed.reverse(), valid: false, error: "Unmatched paren" };
        }
        i = openIndex - 1;
        while (i >= 0 && isWhitespace(text[i]!)) i--;

        if (i < 0 || !isIdentChar(text[i]!)) {
          return { segments: segmentsReversed.reverse(), valid: false, error: "Expected identifier before paren" };
        }
        const end = i + 1;
        let start = i;
        while (start >= 0 && isIdentChar(text[start]!)) start--;
        const name = text.slice(start + 1, end);
        segmentsReversed.push({ kind: "call", name });
        i = start;
      } else if (ch === "]") {
        // Parse ["..."] style string index
        i--;
        while (i >= 0 && isWhitespace(text[i]!)) i--;
        const str = parseStringLiteralBackward(text, i);
        if (!str) {
          return { segments: segmentsReversed.reverse(), valid: false, error: "Invalid string in bracket" };
        }
        i = str.startIndex - 1;
        while (i >= 0 && isWhitespace(text[i]!)) i--;
        if (i < 0 || text[i] !== "[") {
          return { segments: segmentsReversed.reverse(), valid: false, error: "Expected '['" };
        }
        i--;
        segmentsReversed.push({ kind: "index", value: str.value });
        while (i >= 0 && isWhitespace(text[i]!)) i--;
        continue;
      } else if (isIdentChar(ch)) {
        const end = i + 1;
        let start = i;
        while (start >= 0 && isIdentChar(text[start]!)) start--;
        const name = text.slice(start + 1, end);
        segmentsReversed.push({ kind: "ident", name });
        i = start;
      } else {
        break;
      }

      while (i >= 0 && isWhitespace(text[i]!)) i--;
      if (i >= 0 && text[i] === ".") {
        i--;
        while (i >= 0 && isWhitespace(text[i]!)) i--;
        continue;
      }
      break;
    }

    if (segmentsReversed.length === 0) {
      return { segments: [], valid: false, error: "No segments found" };
    }
    return { segments: segmentsReversed.reverse(), valid: true };
  } catch {
    return { segments: [], valid: false, error: "Parse error" };
  }
}

/**
 * Parse a chain from an expression (not necessarily ending with a dot).
 */
export function parseChainFromExpression(text: string): ChainParseResult {
  const withDot = trimRight(text) + ".";
  return parseChainBeforeDot(withDot);
}

// =============================================================================
// Call Context Detection (for Signature Help)
// =============================================================================

/**
 * Find the opening paren of the innermost unclosed function call
 * and count which argument the cursor is on.
 */
export function findCallContext(textUntilPosition: string): CallContext | null {
  try {
    const text = textUntilPosition;
    let i = text.length - 1;
    let depth = 0;
    let commaCount = 0;

    while (i >= 0) {
      const ch = text[i]!;

      // Skip string literals
      if (ch === '"' || ch === "'") {
        const str = parseStringLiteralBackward(text, i);
        if (str) {
          i = str.startIndex - 1;
          continue;
        }
      }

      if (ch === ")") {
        depth++;
        i--;
        continue;
      }

      if (ch === "]") {
        // Skip bracket pairs
        let bracketDepth = 1;
        i--;
        while (i >= 0 && bracketDepth > 0) {
          const bc = text[i]!;
          if (bc === '"' || bc === "'") {
            const str = parseStringLiteralBackward(text, i);
            if (str) {
              i = str.startIndex - 1;
              continue;
            }
          }
          if (bc === "]") bracketDepth++;
          else if (bc === "[") bracketDepth--;
          i--;
        }
        continue;
      }

      if (ch === "(") {
        if (depth === 0) {
          // Found the opening paren of our call
          const textBeforeOpen = text.slice(0, i);
          const result = parseMethodFromTextBeforeOpen(textBeforeOpen);
          if (result) {
            return {
              methodName: result.methodName,
              chain: result.chain.length > 0 ? result.chain : undefined,
              ownerType: result.ownerType,
              activeParameter: commaCount,
              openParenOffset: i,
            };
          }
          return null;
        }
        depth--;
        i--;
        continue;
      }

      if (ch === "," && depth === 0) {
        commaCount++;
      }

      i--;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse the method name and chain from text ending just before an opening paren.
 */
function parseMethodFromTextBeforeOpen(
  textBeforeOpen: string
): { chain: ChainSegment[]; methodName: string; ownerType?: string } | null {
  const text = trimRight(textBeforeOpen);
  if (text.length === 0) return null;

  // Extract the identifier immediately before the paren
  let i = text.length - 1;
  while (i >= 0 && isWhitespace(text[i]!)) i--;
  if (i < 0 || !isIdentChar(text[i]!)) return null;

  const end = i + 1;
  let start = i;
  while (start >= 0 && isIdentChar(text[start]!)) start--;
  const methodName = text.slice(start + 1, end);

  // Check if there's a dot before this identifier
  let j = start;
  while (j >= 0 && isWhitespace(text[j]!)) j--;

  if (j >= 0 && text[j] === ".") {
    // This is a method call: parse the chain before the dot
    const chainText = text.slice(0, j + 1);
    const chainResult = parseChainBeforeDot(chainText);
    if (chainResult.valid && chainResult.segments.length > 0) {
      // Try to resolve the owner type
      const resolution = resolveChain(chainResult.segments.map((s) => s.kind === "ident" ? s.name : s.kind === "call" ? s.name : ""));
      return {
        chain: chainResult.segments,
        methodName,
        ownerType: resolution.success ? resolution.nextType : undefined,
      };
    }
  }

  // Global function call
  return { chain: [], methodName };
}

// =============================================================================
// Config-Map Context Detection
// =============================================================================

/**
 * Find the nearest unclosed `#{` before the cursor.
 */
function findUnclosedConfigMapStart(text: string): number {
  let braceDepth = 0;
  let i = text.length - 1;

  while (i >= 0) {
    const ch = text[i]!;

    // Skip string literals
    if (ch === '"' || ch === "'") {
      const str = parseStringLiteralBackward(text, i);
      if (str) {
        i = str.startIndex - 1;
        continue;
      }
    }

    if (ch === "}") {
      braceDepth++;
    } else if (ch === "{") {
      braceDepth--;
      if (braceDepth < 0) {
        // Check if this is a `#{` config map literal
        if (i > 0 && text[i - 1] === "#") {
          return i - 1;
        }
        // Regular brace, reset depth
        braceDepth = 0;
      }
    }
    i--;
  }

  return -1;
}

/**
 * Extract keys already defined in a partial config-map.
 */
function parseConfigMapKeys(mapContent: string): string[] {
  const keys: string[] = [];
  const keyPattern = /(?:^|[,{])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
  let match;
  while ((match = keyPattern.exec(mapContent)) !== null) {
    if (match[1]) {
      keys.push(match[1]);
    }
  }
  return keys;
}

/**
 * Parse the function call before a config-map opening `#{`.
 */
function parseFunctionBeforeConfigMap(textBeforeHash: string): string | null {
  const text = trimRight(textBeforeHash);
  if (!text.endsWith("(")) return null;

  let i = text.length - 2;
  while (i >= 0 && isWhitespace(text[i]!)) i--;

  if (i < 0 || !isIdentChar(text[i]!)) return null;

  const end = i + 1;
  while (i >= 0 && isIdentChar(text[i]!)) i--;
  const methodName = text.slice(i + 1, end);

  let j = i;
  while (j >= 0 && isWhitespace(text[j]!)) j--;

  if (j >= 0 && text[j] === ".") {
    j--;
    while (j >= 0 && isWhitespace(text[j]!)) j--;

    if (j >= 0 && isIdentChar(text[j]!)) {
      const nsEnd = j + 1;
      while (j >= 0 && isIdentChar(text[j]!)) j--;
      const namespace = text.slice(j + 1, nsEnd);
      return `${namespace}.${methodName}`;
    }
  }

  return methodName;
}

/**
 * Detect if the cursor is inside a config-map literal `#{ ... }`.
 */
export function detectConfigMapContext(textUntilPosition: string): ConfigMapContext | null {
  try {
    const mapStartIndex = findUnclosedConfigMapStart(textUntilPosition);
    if (mapStartIndex < 0) return null;

    const textBeforeHash = textUntilPosition.slice(0, mapStartIndex);
    const functionPath = parseFunctionBeforeConfigMap(textBeforeHash);
    if (!functionPath) return null;

    const mapContent = textUntilPosition.slice(mapStartIndex + 2);
    const existingKeys = parseConfigMapKeys(mapContent);

    const lastSeparator = Math.max(mapContent.lastIndexOf(","), 0);
    const contentAfterSeparator = mapContent.slice(lastSeparator);
    const colonIndex = contentAfterSeparator.lastIndexOf(":");
    const position: "key" | "value" = colonIndex >= 0 ? "value" : "key";

    let partialKey: string | undefined;
    if (position === "key") {
      const keyMatch = contentAfterSeparator.match(/^\s*,?\s*([a-zA-Z_][a-zA-Z0-9_]*)?$/);
      if (keyMatch?.[1]) {
        partialKey = keyMatch[1];
      }
    }

    return {
      functionPath,
      existingKeys,
      position,
      partialKey,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Band Key Context Detection
// =============================================================================

/**
 * Detect if the cursor is inside `inputs.bands[...]`.
 */
export function detectBandKeyContext(
  textUntilPosition: string
): { hasQuote: boolean; partialKey?: string } | null {
  try {
    const text = trimRight(textUntilPosition);

    // Check for inputs.bands[" or inputs.bands['
    const quoteMatch = text.match(/inputs\s*\.\s*bands\s*\[\s*(["'])([^"']*)?$/);
    if (quoteMatch) {
      return {
        hasQuote: true,
        partialKey: quoteMatch[2] || "",
      };
    }

    // Check for inputs.bands[
    if (/inputs\s*\.\s*bands\s*\[$/.test(text)) {
      return { hasQuote: false };
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Local Variable Type Inference
// =============================================================================

/**
 * Parse variable declarations and infer their types.
 */
export function parseLocalVariableTypes(code: string): Map<string, string> {
  const varTypes = new Map<string, string>();

  try {
    const letPattern = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/g;
    let match;

    while ((match = letPattern.exec(code)) !== null) {
      const varName = match[1]!;
      const assignStart = match.index + match[0].length;

      // Find the end of the expression
      let depth = 0;
      let braceDepth = 0;
      let bracketDepth = 0;
      let i = assignStart;

      while (i < code.length) {
        const ch = code[i]!;

        if (ch === '"' || ch === "'") {
          // Skip string
          i++;
          while (i < code.length && code[i] !== ch) {
            if (code[i] === "\\") i++;
            i++;
          }
          i++;
          continue;
        }

        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;

        if (depth === 0 && braceDepth === 0 && bracketDepth === 0) {
          if (ch === ";" || ch === "\n") break;
        }

        i++;
      }

      const exprText = code.slice(assignStart, i).trim();
      const chainResult = parseChainFromExpression(exprText);

      if (chainResult.valid && chainResult.segments.length > 0) {
        const segments = chainResult.segments.map((s) =>
          s.kind === "ident" ? s.name : s.kind === "call" ? s.name : ""
        );
        const resolution = resolveChain(segments);
        if (resolution.success && resolution.nextType) {
          varTypes.set(varName, resolution.nextType);
        }
      }
    }
  } catch {
    // Ignore errors in local variable parsing
  }

  return varTypes;
}

// =============================================================================
// Main Context Detection
// =============================================================================

/**
 * Get the cursor context for a given position in text.
 * This is the main entry point for context detection.
 *
 * @param textUntilCursor - All text from the start of the document to the cursor
 * @returns The detected cursor context
 */
export function getCursorContext(textUntilCursor: string): CursorContext {
  try {
    // Check for band key context first (most specific)
    const bandKeyContext = detectBandKeyContext(textUntilCursor);
    if (bandKeyContext) {
      return {
        kind: "in-band-key",
        bandKeyHasQuotes: bandKeyContext.hasQuote,
        partialBandKey: bandKeyContext.partialKey,
      };
    }

    // Check for config-map context
    const configMapContext = detectConfigMapContext(textUntilCursor);
    if (configMapContext) {
      return {
        kind: "in-config-map",
        configMapFunction: configMapContext.functionPath,
        existingKeys: configMapContext.existingKeys,
        configMapPosition: configMapContext.position,
        prefix: configMapContext.partialKey,
      };
    }

    // Check for function call context (for signature help)
    const callContext = findCallContext(textUntilCursor);
    if (callContext) {
      return {
        kind: "in-call",
        calledMethod: callContext.methodName,
        chain: callContext.chain,
        resolvedType: callContext.ownerType,
        activeParameter: callContext.activeParameter,
      };
    }

    // Check for member completion (after dot)
    const text = trimRight(textUntilCursor);
    if (text.endsWith(".")) {
      const chainResult = parseChainBeforeDot(textUntilCursor);
      if (chainResult.valid && chainResult.segments.length > 0) {
        const segments = chainResult.segments.map((s) =>
          s.kind === "ident" ? s.name : s.kind === "call" ? s.name : ""
        );
        const resolution = resolveChain(segments);
        return {
          kind: "after-dot",
          chain: chainResult.segments,
          resolvedType: resolution.success ? resolution.nextType : undefined,
        };
      }
      return { kind: "after-dot" };
    }

    // Check for string context
    const lastQuote = Math.max(text.lastIndexOf('"'), text.lastIndexOf("'"));
    if (lastQuote >= 0) {
      const quoteChar = text[lastQuote];
      let quoteCount = 0;
      for (let i = lastQuote; i < text.length; i++) {
        if (text[i] === quoteChar && (i === 0 || text[i - 1] !== "\\")) {
          quoteCount++;
        }
      }
      if (quoteCount % 2 === 1) {
        return { kind: "in-string" };
      }
    }

    // Extract prefix for top-level completion
    let prefix = "";
    let i = text.length - 1;
    while (i >= 0 && isIdentChar(text[i]!)) {
      prefix = text[i] + prefix;
      i--;
    }

    // Parse local variables for type inference
    const localVariables = parseLocalVariableTypes(textUntilCursor);

    return {
      kind: "top-level",
      prefix: prefix || undefined,
      localVariables: localVariables.size > 0 ? localVariables : undefined,
    };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Get the token at a specific position for hover support.
 */
export function getTokenAtPosition(
  text: string,
  offset: number
): { token: string; start: number; end: number } | null {
  try {
    if (offset < 0 || offset >= text.length) return null;

    let start = offset;
    let end = offset;

    // Expand to find the full identifier
    while (start > 0 && isIdentChar(text[start - 1]!)) start--;
    while (end < text.length && isIdentChar(text[end]!)) end++;

    if (start === end) return null;

    return {
      token: text.slice(start, end),
      start,
      end,
    };
  } catch {
    return null;
  }
}
