/**
 * Monaco Editor language support for Rhai scripting.
 *
 * Provides:
 * - Syntax highlighting via Monarch tokenizer
 * - Hover tooltips for host API items
 * - Autocomplete driven by host-defined Script API metadata
 */

import type { ApiMethod, ApiType, ScriptApiMetadata, ScriptApiIndex } from "./scriptApi";
import { buildScriptApiIndex, formatMethodSignature } from "./scriptApi";
import { getConfigMapSchema } from "./configMapSchema";

// We use 'any' for Monaco types since @monaco-editor/react provides the instance at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

export const RHAI_LANGUAGE_ID = "rhai";

export type AvailableBand = { id: string; label: string };

type MonacoRange = {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
};

type MonacoCompletionItem = {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
  documentation?: string | { value: string };
  range: MonacoRange;
};

type ChainSegment =
  | { kind: "ident"; name: string }
  | { kind: "call"; name: string }
  | { kind: "index"; value: string };

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

function parseStringLiteralBackward(text: string, endIndex: number): { value: string; startIndex: number } | null {
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

// Debug flag for chain parsing - set to true to enable console logging
const DEBUG_CHAIN_PARSING = false;
const DEBUG_SIGNATURE_HELP = false;
const DEBUG_LOCAL_VARS = false;

/**
 * Parse a chain expression starting after '=' in a variable declaration.
 * Returns the chain segments if valid, or null if not parseable.
 */
function parseChainFromExpression(text: string): ChainSegment[] | null {
  // Add a trailing '.' to reuse parseChainBeforeDot
  const withDot = trimRight(text) + ".";
  return parseChainBeforeDot(withDot);
}

/**
 * Parse variable declarations from code and resolve their types.
 * Returns a map of variable name -> type name.
 */
function parseLocalVariableTypes(
  code: string,
  api: ScriptApiIndex
): Map<string, string> {
  const varTypes = new Map<string, string>();

  // Pattern: let varName = expression; or let varName = expression\n
  // We need to be careful about multi-line expressions and nested structures
  const letPattern = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/g;

  let match;
  while ((match = letPattern.exec(code)) !== null) {
    const varName = match[1]!;
    const assignStart = match.index + match[0].length;

    // Find the end of the expression (semicolon or newline, accounting for braces/parens)
    let depth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let i = assignStart;
    let inString = false;
    let stringChar = "";

    while (i < code.length) {
      const ch = code[i]!;

      // Handle string literals
      if (!inString && (ch === '"' || ch === "'")) {
        inString = true;
        stringChar = ch;
        i++;
        continue;
      }
      if (inString) {
        if (ch === stringChar && code[i - 1] !== "\\") {
          inString = false;
        }
        i++;
        continue;
      }

      // Track nesting
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;

      // End of expression
      if (depth === 0 && braceDepth === 0 && bracketDepth === 0) {
        if (ch === ";" || ch === "\n") {
          break;
        }
      }

      i++;
    }

    const expression = code.slice(assignStart, i).trim();
    if (DEBUG_LOCAL_VARS) console.log(`[localVars] ${varName} = ${expression}`);

    // Try to parse the expression as a chain
    const chain = parseChainFromExpression(expression);
    if (chain && chain.length > 0) {
      // Resolve the chain type (using only globals, not recursive local vars)
      const resolvedType = resolveChainTypeWithLocals(chain, api, new Map());
      if (resolvedType) {
        varTypes.set(varName, resolvedType.name);
        if (DEBUG_LOCAL_VARS) console.log(`[localVars] ${varName} -> ${resolvedType.name}`);
      }
    }
  }

  return varTypes;
}

function parseChainBeforeDot(textUntilPosition: string): ChainSegment[] | null {
  const text = trimRight(textUntilPosition);
  if (!text.endsWith(".")) return null;

  let i = text.length - 2; // char before '.'
  while (i >= 0 && isWhitespace(text[i]!)) i--;

  const segmentsReversed: ChainSegment[] = [];
  if (DEBUG_CHAIN_PARSING) console.log("[parseChain] input:", JSON.stringify(text));

  while (i >= 0) {
    const ch = text[i]!;
    if (DEBUG_CHAIN_PARSING) console.log(`[parseChain] i=${i}, ch='${ch}', segments so far:`, JSON.stringify(segmentsReversed));

    if (ch === ")") {
      // Parse a method call segment: `name(...)`
      const openIndex = findMatchingParenBackward(text, i);
      if (openIndex == null) return null;
      i = openIndex - 1; // before '('
      while (i >= 0 && isWhitespace(text[i]!)) i--;

      if (i < 0 || !isIdentChar(text[i]!)) return null;
      const end = i + 1;
      let start = i;
      while (start >= 0 && isIdentChar(text[start]!)) start--;
      const name = text.slice(start + 1, end);
      segmentsReversed.push({ kind: "call", name });
      i = start;
    } else if (ch === "]") {
      // Parse ["..."] style string index.
      i--; // before ]
      while (i >= 0 && isWhitespace(text[i]!)) i--;
      if (DEBUG_CHAIN_PARSING) console.log(`[parseChain] parsing string index, i=${i}, char='${text[i]}'`);
      const str = parseStringLiteralBackward(text, i);
      if (!str) {
        if (DEBUG_CHAIN_PARSING) console.log("[parseChain] parseStringLiteralBackward returned null");
        return null;
      }
      if (DEBUG_CHAIN_PARSING) console.log(`[parseChain] parsed string: "${str.value}", startIndex=${str.startIndex}`);
      i = str.startIndex - 1; // before opening quote
      while (i >= 0 && isWhitespace(text[i]!)) i--;
      if (DEBUG_CHAIN_PARSING) console.log(`[parseChain] looking for '[', i=${i}, char='${text[i]}'`);
      if (i < 0 || text[i] !== "[") {
        if (DEBUG_CHAIN_PARSING) console.log("[parseChain] expected '[' but got:", text[i]);
        return null;
      }
      i--; // before '['
      segmentsReversed.push({ kind: "index", value: str.value });
      // After an index, continue directly to parse the identifier before '[' (e.g., 'bands' in 'bands["..."]')
      // Skip the dot check since '[' connects directly to the identifier
      while (i >= 0 && isWhitespace(text[i]!)) i--;
      if (DEBUG_CHAIN_PARSING) console.log(`[parseChain] after index, continuing at i=${i}, char='${text[i]}'`);
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
    if (DEBUG_CHAIN_PARSING) console.log("[parseChain] no segments found");
    return null;
  }
  const result = segmentsReversed.reverse();
  if (DEBUG_CHAIN_PARSING) console.log("[parseChain] final chain:", JSON.stringify(result));
  return result;
}

/**
 * Information about the current function call context for signature help.
 */
type CallContext = {
  /** The text before the opening paren (used to resolve the method) */
  textBeforeOpen: string;
  /** The index of the opening paren in the original text */
  openParenIndex: number;
  /** Which argument the cursor is on (0-indexed) */
  activeParameter: number;
};

/**
 * Find the opening paren of the innermost unclosed function call and count
 * which argument the cursor is currently on.
 */
function findCallContext(textUntilPosition: string): CallContext | null {
  const text = textUntilPosition;
  let i = text.length - 1;
  let depth = 0;
  let commaCount = 0;

  if (DEBUG_SIGNATURE_HELP) console.log("[findCallContext] input:", JSON.stringify(text));

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
        if (DEBUG_SIGNATURE_HELP) {
          console.log("[findCallContext] found open paren at", i, "commas:", commaCount);
          console.log("[findCallContext] textBeforeOpen:", JSON.stringify(textBeforeOpen));
        }
        return {
          textBeforeOpen,
          openParenIndex: i,
          activeParameter: commaCount,
        };
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

  if (DEBUG_SIGNATURE_HELP) console.log("[findCallContext] no unclosed paren found");
  return null;
}

/**
 * Parse the method name from text ending just before an opening paren.
 * Returns the chain segments and the method name being called.
 */
function parseMethodCall(textBeforeOpen: string): { chain: ChainSegment[]; methodName: string } | null {
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

  // Check if there's a dot before this identifier (method call on a type)
  let j = start;
  while (j >= 0 && isWhitespace(text[j]!)) j--;

  if (j >= 0 && text[j] === ".") {
    // This is a method call: parse the chain before the dot
    const chainText = text.slice(0, j + 1); // include the dot
    const chain = parseChainBeforeDot(chainText);
    if (chain) {
      if (DEBUG_SIGNATURE_HELP) console.log("[parseMethodCall] method:", methodName, "chain:", JSON.stringify(chain));
      return { chain, methodName };
    }
  }

  // Could be a global function call
  if (DEBUG_SIGNATURE_HELP) console.log("[parseMethodCall] global function:", methodName);
  return { chain: [], methodName };
}

function detectBandKeyContext(textUntilPosition: string): { hasQuote: boolean } | null {
  const text = trimRight(textUntilPosition);
  // We accept either `inputs.bands[` or `inputs.bands["` / `inputs.bands['`.
  if (!text.endsWith("[") && !text.endsWith('["') && !text.endsWith("['")) return null;

  const hasQuote = text.endsWith('["') || text.endsWith("['");
  const before = hasQuote ? text.slice(0, -2) : text.slice(0, -1);
  const chain = parseChainBeforeDot(`${before}.`); // parse as if a dot follows to reuse the chain parser
  if (!chain) return null;

  // Expect `inputs.bands`
  const idents = chain.filter((s): s is { kind: "ident"; name: string } => s.kind === "ident");
  if (idents.length !== 2) return null;
  if (idents[0]!.name !== "inputs") return null;
  if (idents[1]!.name !== "bands") return null;

  return { hasQuote };
}

// =============================================================================
// Config-Map Context Detection
// =============================================================================

const DEBUG_CONFIG_MAP = false;

/**
 * Result of detecting config-map context.
 */
export type ConfigMapContext = {
  /** Function path (e.g., "fx.bloom") */
  functionPath: string;
  /** Keys already present in the config map */
  existingKeys: string[];
  /** The key being typed (if cursor is on a key) */
  currentKey?: string;
  /** Whether the cursor is after a colon (in value position) */
  inValue: boolean;
  /** Start index of the config map `#{` in the text */
  mapStartIndex: number;
};

/**
 * Find the nearest unclosed `#{` before the cursor.
 * Returns the index of `#` or -1 if not found.
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
 * Tolerant of incomplete syntax.
 */
function parseConfigMapKeys(mapContent: string): string[] {
  const keys: string[] = [];
  // Match key: at the start of a line or after comma/brace, handling incomplete values
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
 * Returns the function path (e.g., "fx.bloom") or null.
 */
function parseFunctionBeforeConfigMap(textBeforeHash: string): string | null {
  const text = trimRight(textBeforeHash);
  if (!text.endsWith("(")) return null;

  // Find the function name/chain before the `(`
  let i = text.length - 2; // before `(`
  while (i >= 0 && isWhitespace(text[i]!)) i--;

  if (i < 0 || !isIdentChar(text[i]!)) return null;

  // Scan backwards for the identifier
  const end = i + 1;
  while (i >= 0 && isIdentChar(text[i]!)) i--;

  const methodName = text.slice(i + 1, end);

  // Check for a dot before (method call on namespace)
  let j = i;
  while (j >= 0 && isWhitespace(text[j]!)) j--;

  if (j >= 0 && text[j] === ".") {
    // There's a namespace before
    j--; // skip dot
    while (j >= 0 && isWhitespace(text[j]!)) j--;

    if (j >= 0 && isIdentChar(text[j]!)) {
      const nsEnd = j + 1;
      while (j >= 0 && isIdentChar(text[j]!)) j--;
      const namespace = text.slice(j + 1, nsEnd);
      return `${namespace}.${methodName}`;
    }
  }

  // Just a bare function name
  return methodName;
}

/**
 * Detect if the cursor is inside a Rhai config-map literal `#{ ... }`.
 * Returns context about the config map, or null if not inside one.
 */
export function detectConfigMapContext(textUntilPosition: string): ConfigMapContext | null {
  try {
    const mapStartIndex = findUnclosedConfigMapStart(textUntilPosition);
    if (mapStartIndex < 0) return null;

    // Get the text before the `#{`
    const textBeforeHash = textUntilPosition.slice(0, mapStartIndex);
    const functionPath = parseFunctionBeforeConfigMap(textBeforeHash);
    if (!functionPath) return null;

    // Get the content inside the map (from `{` to cursor)
    const mapContent = textUntilPosition.slice(mapStartIndex + 2);

    // Parse existing keys
    const existingKeys = parseConfigMapKeys(mapContent);

    // Determine if we're typing a key or a value
    // Look at the content after the last comma or opening brace
    const lastSeparator = Math.max(mapContent.lastIndexOf(","), 0);
    const contentAfterSeparator = mapContent.slice(lastSeparator);

    // Check if there's a colon after the last key
    const colonIndex = contentAfterSeparator.lastIndexOf(":");
    const inValue = colonIndex >= 0;

    // Try to extract the current key being typed
    let currentKey: string | undefined;
    if (!inValue) {
      // We're typing a key - extract it
      const keyMatch = contentAfterSeparator.match(/^\s*,?\s*([a-zA-Z_][a-zA-Z0-9_]*)?$/);
      if (keyMatch && keyMatch[1]) {
        currentKey = keyMatch[1];
      }
    }

    if (DEBUG_CONFIG_MAP) {
      console.log("[configMap] functionPath:", functionPath);
      console.log("[configMap] existingKeys:", existingKeys);
      console.log("[configMap] currentKey:", currentKey);
      console.log("[configMap] inValue:", inValue);
    }

    return {
      functionPath,
      existingKeys,
      currentKey,
      inValue,
      mapStartIndex,
    };
  } catch {
    // Fail silently - don't break the editor
    return null;
  }
}

function getApiIndex(getApiMetadata: () => ScriptApiMetadata | null): ScriptApiIndex | null {
  const meta = getApiMetadata();
  if (!meta) return null;
  return buildScriptApiIndex(meta);
}

function findTypeNameInRef(typeName: string, typesByName: Map<string, ApiType>): ApiType | null {
  // Prefer exact match, otherwise try the first union arm.
  const direct = typesByName.get(typeName);
  if (direct) return direct;
  const first = typeName.split("|")[0]?.trim();
  if (!first) return null;
  return typesByName.get(first) ?? null;
}

/**
 * Resolve a chain to its final type, optionally using local variable types.
 * @param chain - The parsed chain segments
 * @param api - The API index for type lookups
 * @param localVarTypes - Map of local variable names to type names (optional)
 */
function resolveChainTypeWithLocals(
  chain: ChainSegment[],
  api: ScriptApiIndex,
  localVarTypes: Map<string, string>
): ApiType | null {
  const [root, ...rest] = chain;
  if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] chain:", JSON.stringify(chain));

  if (!root || root.kind !== "ident") {
    if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] root is not an ident:", root);
    return null;
  }

  // First check local variables, then fall back to globals
  let rootTypeName: string | null = null;

  const localType = localVarTypes.get(root.name);
  if (localType) {
    rootTypeName = localType;
    if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] found local var:", root.name, "->", localType);
  } else {
    const global = api.globalsByName.get(root.name);
    if (global) {
      rootTypeName = global.type_name;
      if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] found global:", root.name, "->", global.type_name);
    }
  }

  if (!rootTypeName) {
    if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] root not found in locals or globals:", root.name);
    return null;
  }

  let current = api.typesByName.get(rootTypeName) ?? null;
  if (!current) {
    if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] type not found:", rootTypeName);
    return null;
  }
  if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] initial type:", current.name);

  for (const seg of rest) {
    if (!current) {
      if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] current is null");
      return null;
    }

    if (seg.kind === "index") {
      // Only the Bands namespace supports string indexing (bands["Bass"]).
      if (current.name === "Bands") {
        current = api.typesByName.get("BandSignals") ?? null;
        if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] index on Bands -> BandSignals:", current?.name);
        continue;
      }
      if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] index on non-Bands type:", current.name);
      return null;
    }

    if (seg.kind === "call") {
      const method = current.methods.find((m) => m.name === seg.name);
      if (!method) {
        if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] method not found:", seg.name, "on", current.name);
        return null;
      }
      current = findTypeNameInRef(method.returns, api.typesByName);
      if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] call", seg.name, "->", current?.name);
      continue;
    }

    // Property traversal.
    const prop = current.properties.find((p) => p.name === seg.name);
    if (!prop) {
      if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] property not found:", seg.name, "on", current.name, "available:", current.properties.map(p => p.name));
      return null;
    }
    current = findTypeNameInRef(prop.type_name, api.typesByName);
    if (DEBUG_CHAIN_PARSING) console.log("[resolveChain] property", seg.name, "->", current?.name);
  }

  return current;
}

function collectMemberCompletions(
  monaco: MonacoInstance,
  type: ApiType,
  range: MonacoRange
): MonacoCompletionItem[] {
  const suggestions: MonacoCompletionItem[] = [];

  for (const prop of type.properties) {
    suggestions.push({
      label: prop.name,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText: prop.name,
      detail: prop.type_name,
      documentation: {
        value: [`**${prop.name}**: \`${prop.type_name}\``, "", prop.description].join("\n"),
      },
      range,
    });
  }

  // Methods: include overload signatures as separate suggestions for clarity.
  for (const method of type.methods) {
    const signature = formatMethodSignature(method);
    const label = method.overload_id ? `${method.name} (${method.overload_id})` : method.name;
    const paramsDoc = method.params
      .map((p) => `- \`${p.name}: ${p.type_name}\` — ${p.description}`)
      .join("\n");
    suggestions.push({
      label,
      kind: monaco.languages.CompletionItemKind.Method,
      insertText: `${method.name}(`,
      detail: signature,
      documentation: {
        value: [`**${signature}**`, "", method.description, paramsDoc ? `\n\n${paramsDoc}` : ""]
          .filter(Boolean)
          .join("\n"),
      },
      range,
    });
  }

  return suggestions;
}

/**
 * Monarch tokenizer definition for Rhai syntax highlighting.
 * Highlights keywords, numbers, strings, comments, and identifiers.
 */
export const rhaiTokensProvider = {
  defaultToken: "source",

  keywords: [
    "fn",
    "let",
    "const",
    "if",
    "else",
    "for",
    "in",
    "while",
    "loop",
    "break",
    "continue",
    "return",
    "throw",
    "try",
    "catch",
    "true",
    "false",
    "null",
    "this",
    "switch",
    "case",
    "default",
    "do",
    "until",
    "import",
    "export",
    "as",
    "private",
    "type_of",
    "print",
    "debug",
  ],

  operators: [
    "=",
    ">",
    "<",
    "!",
    "~",
    "?",
    ":",
    "==",
    "<=",
    ">=",
    "!=",
    "&&",
    "||",
    "++",
    "--",
    "+",
    "-",
    "*",
    "/",
    "&",
    "|",
    "^",
    "%",
    "<<",
    ">>",
    "+=",
    "-=",
    "*=",
    "/=",
    "&=",
    "|=",
    "^=",
    "%=",
    "<<=",
    ">>=",
    "=>",
    "??",
    "?.",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // Identifiers and keywords
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@default": "identifier",
          },
        },
      ],

      // Whitespace
      { include: "@whitespace" },

      // Delimiters and operators
      [/[{}()[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],
      [
        /@symbols/,
        {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        },
      ],

      // Numbers
      [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/0[oO][0-7]+/, "number.octal"],
      [/0[bB][01]+/, "number.binary"],
      [/\d+/, "number"],

      // Delimiter: after number because of .\d floats
      [/[;,.]/, "delimiter"],

      // Strings
      [/"([^"\\]|\\.)*$/, "string.invalid"], // non-terminated string
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
      [/'([^'\\]|\\.)*$/, "string.invalid"], // non-terminated string
      [/'/, { token: "string.quote", bracket: "@open", next: "@stringSingle" }],
    ],

    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, "comment", "@push"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],

    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],

    stringSingle: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
  },
};

/**
 * Language configuration for bracket matching, auto-closing, etc.
 */
export const rhaiLanguageConfig = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"] as [string, string],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ] as [string, string][],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  folding: {
    markers: {
      start: /^\s*\/\/\s*#?region\b/,
      end: /^\s*\/\/\s*#?endregion\b/,
    },
  },
};

/**
 * Create a hover provider for Rhai that shows tooltips for:
 * - `inputs` object
 * - `inputs.<signal>` properties
 * - `inputs.bands` and band features
 * - `cube` object
 * - `cube.<property>` properties
 */
export function createRhaiHoverProvider(
  monaco: MonacoInstance,
  getApiMetadata: () => ScriptApiMetadata | null
) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideHover(model: any, position: any) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const wordText = word.word;
      const api = getApiIndex(getApiMetadata);
      if (!api) return null;

      // Global hover (mesh/line/scene/log/dbg/gen/inputs/describe/help/doc)
      const global = api.globalsByName.get(wordText);
      if (global) {
        const type = api.typesByName.get(global.type_name);
        const title = `**${global.name}**`;
        const extra = type ? `\n\nType: \`${type.name}\`` : "";
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: [title, "", global.description, extra].join("\n") }],
        };
      }

      // Config-map key hover: fx.bloom(#{ threshold: ... })
      const textUntilWord = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      });
      const configMapCtx = detectConfigMapContext(textUntilWord);
      if (configMapCtx) {
        const schema = getConfigMapSchema(configMapCtx.functionPath);
        if (schema) {
          const param = schema.params.find((p) => p.key === wordText);
          if (param) {
            const docParts: string[] = [`**${param.key}**: \`${param.type}\``, "", param.description];
            if (param.default !== undefined) {
              const defaultStr = typeof param.default === "object"
                ? JSON.stringify(param.default)
                : String(param.default);
              docParts.push("", `Default: \`${defaultStr}\``);
            }
            if (param.range) {
              docParts.push(`Range: ${param.range.min} – ${param.range.max}`);
            }
            if (param.enumValues) {
              docParts.push(`Values: ${param.enumValues.map(v => `"${v}"`).join(", ")}`);
            }
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [{ value: docParts.join("\n") }],
            };
          }
        }
      }

      // Member hover: if the token is preceded by `.` then resolve the parent type via metadata.
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeWord = lineContent.substring(0, word.startColumn - 1);
      const beforeTrimmed = trimRight(beforeWord);
      if (beforeTrimmed.endsWith(".")) {
        // Get all text up to cursor for local variable parsing
        const textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const localVarTypes = parseLocalVariableTypes(textUntilPosition, api);

        const chain = parseChainBeforeDot(beforeTrimmed);
        if (chain) {
          const parentType = resolveChainTypeWithLocals(chain, api, localVarTypes);
          if (parentType) {
            const prop = parentType.properties.find((p) => p.name === wordText);
            if (prop) {
              return {
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                contents: [
                  { value: `**${wordText}**: \`${prop.type_name}\`` },
                  { value: prop.description },
                ],
              };
            }

            const overloads = parentType.methods.filter((m) => m.name === wordText);
            if (overloads.length > 0) {
              const signatures = overloads
                .map((m) => `- \`${formatMethodSignature(m)}\``)
                .join("\n");
              const docs = overloads
                .map((m) => m.description)
                .filter(Boolean)
                .join("\n\n");
              return {
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                contents: [
                  { value: `**${wordText}**` },
                  { value: [signatures, "", docs].filter(Boolean).join("\n") },
                ],
              };
            }
          }
        }
      }

      return null;
    },
  };
}

/**
 * Create a completion provider for Rhai that suggests:
 * - Top-level identifiers (inputs, cube, dt)
 * - Signal properties after `inputs.`
 * - Cube properties after `cube.`
 * - Band IDs/labels after `inputs.bands[`
 * - Band features after `inputs.bands["..."].`
 */
export function createRhaiCompletionProvider(
  monaco: MonacoInstance,
  getApiMetadata: () => ScriptApiMetadata | null,
  getAvailableBands?: () => AvailableBand[]
) {
  // Cache index building because Monaco calls this frequently.
  let cachedMeta: ScriptApiMetadata | null = null;
  let cachedIndex: ScriptApiIndex | null = null;

  const getIndex = (): ScriptApiIndex | null => {
    const meta = getApiMetadata();
    if (!meta) return null;
    if (cachedMeta !== meta) {
      cachedMeta = meta;
      cachedIndex = buildScriptApiIndex(meta);
    }
    return cachedIndex;
  };

  return {
    triggerCharacters: [".", "[", '"', "'", ","],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems(model: any, position: any) {
      // Get all text up to cursor to support multi-line chains
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const api = getIndex();

      const wordInfo = model.getWordUntilPosition(position);
      const range: MonacoRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      };

      // Band key completion: inputs.bands[ ... ]
      const bandKeyCtx = detectBandKeyContext(textUntilPosition);
      if (bandKeyCtx && getAvailableBands) {
        const bands = getAvailableBands();
        const hasQuote = bandKeyCtx.hasQuote;
        const quoteChar = textUntilPosition.trimEnd().endsWith("['") ? "'" : '"';
        const suggestions: MonacoCompletionItem[] = bands.flatMap((band) => {
          const closing = quoteChar === "'" ? "']" : '"]';
          const labelInsert = hasQuote ? `${band.label}${closing}` : `${quoteChar}${band.label}${quoteChar}]`;
          const idInsert = hasQuote ? `${band.id}${closing}` : `${quoteChar}${band.id}${quoteChar}]`;
          const out: MonacoCompletionItem[] = [
            {
              label: band.label,
              kind: monaco.languages.CompletionItemKind.Value,
              insertText: labelInsert,
              detail: "Band label",
              documentation: `inputs.bands["${band.label}"]`,
              range,
            },
          ];
          if (band.id !== band.label) {
            out.push({
              label: band.id,
              kind: monaco.languages.CompletionItemKind.Value,
              insertText: idInsert,
              detail: "Band ID",
              documentation: `inputs.bands["${band.id}"]`,
              range,
            });
          }
          return out;
        });
        return { suggestions };
      }

      // Config-map key completion: fx.bloom(#{ ... })
      const configMapCtx = detectConfigMapContext(textUntilPosition);
      if (configMapCtx && !configMapCtx.inValue) {
        const schema = getConfigMapSchema(configMapCtx.functionPath);
        if (schema) {
          const suggestions: MonacoCompletionItem[] = schema.params
            .filter((param) => !configMapCtx.existingKeys.includes(param.key))
            .map((param) => {
              // Build documentation with default and range info
              const docParts: string[] = [`**${param.key}**: \`${param.type}\``, "", param.description];
              if (param.default !== undefined) {
                const defaultStr = typeof param.default === "object"
                  ? JSON.stringify(param.default)
                  : String(param.default);
                docParts.push("", `Default: \`${defaultStr}\``);
              }
              if (param.range) {
                docParts.push(`Range: ${param.range.min} – ${param.range.max}`);
              }
              if (param.enumValues) {
                docParts.push(`Values: ${param.enumValues.map(v => `"${v}"`).join(", ")}`);
              }

              return {
                label: param.key,
                kind: monaco.languages.CompletionItemKind.Property,
                insertText: `${param.key}: `,
                detail: param.type,
                documentation: { value: docParts.join("\n") },
                range,
              };
            });
          return { suggestions };
        }
      }

      // Parse local variable types from code up to cursor
      const localVarTypes = api ? parseLocalVariableTypes(textUntilPosition, api) : new Map<string, string>();
      if (DEBUG_LOCAL_VARS && localVarTypes.size > 0) {
        console.log("[completions] local vars:", Object.fromEntries(localVarTypes));
      }

      // Member completion after a dot.
      const chain = parseChainBeforeDot(textUntilPosition);
      if (chain && api) {
        const resolved = resolveChainTypeWithLocals(chain, api, localVarTypes);
        if (resolved) {
          return { suggestions: collectMemberCompletions(monaco, resolved, range) };
        }

        // Unknown root (e.g. `cube.`). Offer common entity members as a pragmatic fallback.
        const meshEntity = api.typesByName.get("MeshEntity");
        const lineEntity = api.typesByName.get("LineStripEntity");
        const merged: ApiType | null =
          meshEntity && lineEntity
            ? {
                name: "Entity",
                kind: "opaque",
                description: "Common scene entity members.",
                properties: [...meshEntity.properties, ...lineEntity.properties].filter(
                  (p, idx, arr) => arr.findIndex((x) => x.name === p.name) === idx
                ),
                methods: [...meshEntity.methods, ...lineEntity.methods],
              }
            : null;
        if (merged) {
          return { suggestions: collectMemberCompletions(monaco, merged, range) };
        }
      }

      // Top-level completions (only when not after a dot)
      if (!textUntilPosition.match(/\.\s*$/)) {
        if (!api) return { suggestions: [] };
        const suggestions = api.meta.globals.map((g) => ({
          label: g.name,
          kind: g.kind === "function" ? monaco.languages.CompletionItemKind.Function : monaco.languages.CompletionItemKind.Module,
          insertText: g.kind === "function" ? `${g.name}(` : g.name,
          detail: g.type_name,
          documentation: g.description,
          range,
        }));
        return { suggestions };
      }

      return { suggestions: [] };
    },
  };
}

/**
 * Create a signature help provider for Rhai that shows parameter hints
 * when typing inside function/method calls.
 */
export function createRhaiSignatureHelpProvider(
  _monaco: MonacoInstance,
  getApiMetadata: () => ScriptApiMetadata | null
) {
  // Cache index building because Monaco calls this frequently.
  let cachedMeta: ScriptApiMetadata | null = null;
  let cachedIndex: ScriptApiIndex | null = null;

  const getIndex = (): ScriptApiIndex | null => {
    const meta = getApiMetadata();
    if (!meta) return null;
    if (cachedMeta !== meta) {
      cachedMeta = meta;
      cachedIndex = buildScriptApiIndex(meta);
    }
    return cachedIndex;
  };

  return {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideSignatureHelp(model: any, position: any) {
      const api = getIndex();
      if (!api) return null;

      // Get all text up to cursor position
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      // Find the current call context
      const callContext = findCallContext(textUntilPosition);
      if (!callContext) {
        if (DEBUG_SIGNATURE_HELP) console.log("[signatureHelp] no call context");
        return null;
      }

      // Parse what method is being called
      const methodCall = parseMethodCall(callContext.textBeforeOpen);
      if (!methodCall) {
        if (DEBUG_SIGNATURE_HELP) console.log("[signatureHelp] could not parse method call");
        return null;
      }

      // Parse local variable types for improved resolution
      const localVarTypes = parseLocalVariableTypes(textUntilPosition, api);

      const { chain, methodName } = methodCall;
      let methods: ApiMethod[] = [];

      if (chain.length === 0) {
        // Global function call - look for functions in globals
        const global = api.globalsByName.get(methodName);
        if (global && global.kind === "function") {
          // Find the type that represents this function
          const funcType = api.typesByName.get(global.type_name);
          if (funcType) {
            // The function itself might be represented as a method on a namespace
            methods = funcType.methods.filter((m) => m.name === methodName);
          }
          // If no methods found on type, create a synthetic one from global
          if (methods.length === 0) {
            // Check if there's a dedicated function type with a "call" or matching method
            const allTypes = Array.from(api.typesByName.values());
            for (const t of allTypes) {
              const found = t.methods.filter((m) => m.name === methodName);
              if (found.length > 0) {
                methods = found;
                break;
              }
            }
          }
        }
      } else {
        // Method call on a type - resolve the chain to find the type (using local vars)
        const parentType = resolveChainTypeWithLocals(chain, api, localVarTypes);
        if (parentType) {
          methods = parentType.methods.filter((m) => m.name === methodName);
          if (DEBUG_SIGNATURE_HELP) {
            console.log("[signatureHelp] parent type:", parentType.name, "methods found:", methods.length);
          }
        }
      }

      if (methods.length === 0) {
        if (DEBUG_SIGNATURE_HELP) console.log("[signatureHelp] no methods found for:", methodName);
        return null;
      }

      // Build signature information for each overload
      const signatures = methods.map((method: ApiMethod) => {
        const params = method.params.map((p) => {
          const paramLabel = p.optional
            ? `${p.name}?: ${p.type_name}`
            : `${p.name}: ${p.type_name}`;
          return {
            label: paramLabel,
            documentation: {
              value: p.description + (p.default !== undefined ? `\n\nDefault: \`${JSON.stringify(p.default)}\`` : ""),
            },
          };
        });

        const paramLabels = params.map((p: { label: string }) => p.label).join(", ");
        const signatureLabel = `${method.name}(${paramLabels}) -> ${method.returns}`;

        return {
          label: signatureLabel,
          documentation: {
            value: [
              method.description,
              method.notes ? `\n\n*${method.notes}*` : "",
              method.example ? `\n\n**Example:**\n\`\`\`rhai\n${method.example}\n\`\`\`` : "",
            ]
              .filter(Boolean)
              .join(""),
          },
          parameters: params,
        };
      });

      // Determine active signature (prefer the one where activeParameter is in range)
      let activeSignature = 0;
      for (let i = 0; i < signatures.length; i++) {
        if (callContext.activeParameter < signatures[i]!.parameters.length) {
          activeSignature = i;
          break;
        }
      }

      // Clamp activeParameter to the signature's parameter count
      const activeParameter = Math.min(
        callContext.activeParameter,
        Math.max(0, signatures[activeSignature]!.parameters.length - 1)
      );

      if (DEBUG_SIGNATURE_HELP) {
        console.log("[signatureHelp] returning", signatures.length, "signatures, active:", activeSignature, "param:", activeParameter);
      }

      return {
        value: {
          signatures,
          activeSignature,
          activeParameter,
        },
        dispose: () => {},
      };
    },
  };
}

// =============================================================================
// Config-Map Validation Diagnostics
// =============================================================================

/**
 * A diagnostic marker for config-map validation issues.
 */
export interface ConfigMapDiagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: "warning" | "info";
}

/**
 * Validate config-maps in Rhai code and return diagnostics for unknown keys.
 * This is a gentle validation - it only warns about unknown keys, not type mismatches.
 */
export function validateConfigMaps(code: string): ConfigMapDiagnostic[] {
  const diagnostics: ConfigMapDiagnostic[] = [];

  try {
    // Pattern to match function calls with config maps: fn(#{ ... })
    // This regex finds the function path and the opening of the config map
    const configMapPattern = /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\(\s*#\{/g;
    let match;

    while ((match = configMapPattern.exec(code)) !== null) {
      const functionPath = match[1]!;
      const mapStartIndex = match.index + match[0].length - 2; // Position of `#{`

      // Get the schema for this function
      const schema = getConfigMapSchema(functionPath);
      if (!schema) continue; // Unknown function, skip

      // Find the matching closing brace
      let braceDepth = 1;
      let i = mapStartIndex + 2; // After `#{`
      let inString = false;
      let stringChar = "";

      while (i < code.length && braceDepth > 0) {
        const ch = code[i]!;

        // Handle string literals
        if (!inString && (ch === '"' || ch === "'")) {
          inString = true;
          stringChar = ch;
        } else if (inString && ch === stringChar && code[i - 1] !== "\\") {
          inString = false;
        } else if (!inString) {
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
        }
        i++;
      }

      if (braceDepth !== 0) continue; // Unclosed brace, skip

      // Extract the map content
      const mapContent = code.slice(mapStartIndex + 2, i - 1);

      // Find all keys in the map content
      const keyPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g;
      let keyMatch;

      while ((keyMatch = keyPattern.exec(mapContent)) !== null) {
        const key = keyMatch[1]!;
        const keyStartInMap = keyMatch.index;

        // Check if this key is valid for the schema
        const validKeys = schema.params.map((p) => p.key);
        if (!validKeys.includes(key)) {
          // Calculate line and column from the offset
          const absoluteOffset = mapStartIndex + 2 + keyStartInMap;
          const linesBefore = code.slice(0, absoluteOffset).split("\n");
          const lineNumber = linesBefore.length;
          const column = linesBefore[linesBefore.length - 1]!.length + 1;

          diagnostics.push({
            startLineNumber: lineNumber,
            startColumn: column,
            endLineNumber: lineNumber,
            endColumn: column + key.length,
            message: `Unknown key "${key}" in ${functionPath}(). Valid keys: ${validKeys.join(", ")}`,
            severity: "warning",
          });
        }
      }
    }
  } catch {
    // Fail silently - don't break the editor
  }

  return diagnostics;
}

/**
 * Register the Rhai language with Monaco.
 * Call this once when Monaco is initialized.
 *
 * @param monaco - The Monaco module from @monaco-editor/react beforeMount
 * @param getAvailableSignals - Function that returns currently available signals
 * @param getAvailableBands - Optional function that returns available frequency bands
 * @returns Disposables for cleanup
 */
export function registerRhaiLanguage(
  monaco: MonacoInstance,
  getApiMetadata: () => ScriptApiMetadata | null,
  getAvailableBands?: () => AvailableBand[]
): Array<{ dispose: () => void }> {
  const disposables: Array<{ dispose: () => void }> = [];

  // Register the language
  monaco.languages.register({ id: RHAI_LANGUAGE_ID });

  // Register the tokenizer
  disposables.push(monaco.languages.setMonarchTokensProvider(RHAI_LANGUAGE_ID, rhaiTokensProvider));

  // Register language configuration
  disposables.push(monaco.languages.setLanguageConfiguration(RHAI_LANGUAGE_ID, rhaiLanguageConfig));

  // Register hover provider
  disposables.push(
    monaco.languages.registerHoverProvider(
      RHAI_LANGUAGE_ID,
      createRhaiHoverProvider(monaco, getApiMetadata)
    )
  );

  // Register completion provider
  disposables.push(
    monaco.languages.registerCompletionItemProvider(
      RHAI_LANGUAGE_ID,
      createRhaiCompletionProvider(monaco, getApiMetadata, getAvailableBands)
    )
  );

  // Register signature help provider for parameter hints
  disposables.push(
    monaco.languages.registerSignatureHelpProvider(
      RHAI_LANGUAGE_ID,
      createRhaiSignatureHelpProvider(monaco, getApiMetadata)
    )
  );

  return disposables;
}
