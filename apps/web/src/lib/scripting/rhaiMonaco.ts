/**
 * Monaco Editor language support for Rhai scripting.
 *
 * Provides:
 * - Syntax highlighting via Monarch tokenizer
 * - Hover tooltips for host API items
 * - Autocomplete driven by host-defined Script API metadata
 */

import type { ApiType, ScriptApiMetadata, ScriptApiIndex } from "./scriptApi";
import { buildScriptApiIndex, formatMethodSignature } from "./scriptApi";

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

function parseChainBeforeDot(textUntilPosition: string): ChainSegment[] | null {
  const text = trimRight(textUntilPosition);
  if (!text.endsWith(".")) return null;

  let i = text.length - 2; // char before '.'
  while (i >= 0 && isWhitespace(text[i]!)) i--;

  const segmentsReversed: ChainSegment[] = [];

  while (i >= 0) {
    const ch = text[i]!;

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
      const str = parseStringLiteralBackward(text, i);
      if (!str) return null;
      i = str.startIndex - 1; // before opening quote
      while (i >= 0 && isWhitespace(text[i]!)) i--;
      if (i < 0 || text[i] !== "[") return null;
      i--; // before '['
      segmentsReversed.push({ kind: "index", value: str.value });
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

  if (segmentsReversed.length === 0) return null;
  return segmentsReversed.reverse();
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

function resolveChainType(chain: ChainSegment[], api: ScriptApiIndex): ApiType | null {
  const [root, ...rest] = chain;
  if (!root || root.kind !== "ident") return null;

  const global = api.globalsByName.get(root.name);
  if (!global) return null;
  let current = api.typesByName.get(global.type_name) ?? null;
  if (!current) return null;

  for (const seg of rest) {
    if (!current) return null;

    if (seg.kind === "index") {
      // Only the Bands namespace supports string indexing (bands["Bass"]).
      if (current.name === "Bands") {
        current = api.typesByName.get("BandSignals") ?? null;
        continue;
      }
      return null;
    }

    if (seg.kind === "call") {
      const method = current.methods.find((m) => m.name === seg.name);
      if (!method) return null;
      current = findTypeNameInRef(method.returns, api.typesByName);
      continue;
    }

    // Property traversal.
    const prop = current.properties.find((p) => p.name === seg.name);
    if (!prop) return null;
    current = findTypeNameInRef(prop.type_name, api.typesByName);
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

      // Member hover: if the token is preceded by `.` then resolve the parent type via metadata.
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeWord = lineContent.substring(0, word.startColumn - 1);
      const beforeTrimmed = trimRight(beforeWord);
      if (beforeTrimmed.endsWith(".")) {
        const chain = parseChainBeforeDot(beforeTrimmed);
        if (chain) {
          const parentType = resolveChainType(chain, api);
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
    triggerCharacters: [".", "[", '"', "'"],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems(model: any, position: any) {
      const lineContent = model.getLineContent(position.lineNumber);
      const textUntilPosition = lineContent.substring(0, position.column - 1);
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

      // Member completion after a dot.
      const chain = parseChainBeforeDot(textUntilPosition);
      if (chain && api) {
        const resolved = resolveChainType(chain, api);
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

  return disposables;
}
