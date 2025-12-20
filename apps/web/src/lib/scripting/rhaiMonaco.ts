/**
 * Monaco Editor language support for Rhai scripting.
 *
 * Provides:
 * - Syntax highlighting via Monarch tokenizer
 * - Hover tooltips for inputs and cube
 * - Autocomplete for inputs, cube, and their properties
 */

import {
  SIGNAL_METADATA_MAP,
  CUBE_PROPERTIES,
  CUBE_PROPERTY_MAP,
  TOP_LEVEL_IDENTIFIERS,
  type SignalMetadata,
} from "./signalMetadata";

// We use 'any' for Monaco types since @monaco-editor/react provides the instance at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

export const RHAI_LANGUAGE_ID = "rhai";

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
 * - `cube` object
 * - `cube.<property>` properties
 */
export function createRhaiHoverProvider(
  monaco: MonacoInstance,
  getAvailableSignals: () => SignalMetadata[]
) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideHover(model: any, position: any) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const lineContent = model.getLineContent(position.lineNumber);
      const wordText = word.word;

      // Check if this is a property access: inputs.xxx or cube.xxx
      const beforeWord = lineContent.substring(0, word.startColumn - 1);
      const dotMatch = beforeWord.match(/(inputs|cube)\s*\.\s*$/);

      if (dotMatch) {
        const objectName = dotMatch[1];

        if (objectName === "inputs") {
          // Look up signal metadata
          const signal = SIGNAL_METADATA_MAP.get(wordText);
          if (signal) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              ),
              contents: [
                { value: `**inputs.${signal.name}**` },
                {
                  value: [
                    signal.description,
                    "",
                    `Type: \`${signal.type}\``,
                    signal.range ? `Range: ${signal.range}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
            };
          }
        } else if (objectName === "cube") {
          // Look up cube property metadata
          const prop = CUBE_PROPERTY_MAP.get(wordText);
          if (prop) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              ),
              contents: [
                { value: `**cube.${prop.name}**` },
                {
                  value: [
                    prop.description,
                    "",
                    `Type: \`${prop.type}\``,
                    prop.range ? `Range: ${prop.range}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
            };
          }
        }
      }

      // Check for top-level identifiers
      if (wordText === "inputs") {
        const availableSignals = getAvailableSignals();
        const signalList = availableSignals.map((s) => `- \`${s.name}\``).join("\n");

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [
            { value: "**inputs**" },
            {
              value: [
                "Read-only structure containing frame-aligned audio & MIR signals.",
                "",
                "**Available properties:**",
                signalList || "*(no signals currently available)*",
              ].join("\n"),
            },
          ],
        };
      }

      if (wordText === "cube") {
        const propList = CUBE_PROPERTIES.map((p) => `- \`${p.name}\`: ${p.description}`).join("\n");

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [
            { value: "**cube**" },
            {
              value: [
                "Mutable cube state object. Set these properties to control the visualisation.",
                "",
                "**Properties:**",
                propList,
              ].join("\n"),
            },
          ],
        };
      }

      if (wordText === "dt") {
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [
            { value: "**dt**" },
            {
              value: "Delta time since last frame in seconds.\n\nUse for frame-rate independent animations: `phase += dt * speed`",
            },
          ],
        };
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
 */
export function createRhaiCompletionProvider(
  monaco: MonacoInstance,
  getAvailableSignals: () => SignalMetadata[]
) {
  return {
    triggerCharacters: ["."],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems(model: any, position: any) {
      const lineContent = model.getLineContent(position.lineNumber);
      const textUntilPosition = lineContent.substring(0, position.column - 1);

      // Check if we're completing after `inputs.`
      if (/inputs\s*\.\s*$/.test(textUntilPosition)) {
        const availableSignals = getAvailableSignals();
        const wordInfo = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endColumn: wordInfo.endColumn,
        };

        return {
          suggestions: availableSignals.map((signal) => ({
            label: signal.name,
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: signal.name,
            detail: signal.range ?? signal.type,
            documentation: {
              value: [
                signal.description,
                "",
                `Type: \`${signal.type}\``,
                signal.range ? `Range: ${signal.range}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
            range,
          })),
        };
      }

      // Check if we're completing after `cube.`
      if (/cube\s*\.\s*$/.test(textUntilPosition)) {
        const wordInfo = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endColumn: wordInfo.endColumn,
        };

        return {
          suggestions: CUBE_PROPERTIES.map((prop) => ({
            label: prop.name,
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: prop.name,
            detail: prop.range ?? prop.type,
            documentation: {
              value: [prop.description, "", `Type: \`${prop.type}\``, prop.range ? `Range: ${prop.range}` : ""]
                .filter(Boolean)
                .join("\n"),
            },
            range,
          })),
        };
      }

      // Top-level completions (only when not after a dot)
      if (!textUntilPosition.match(/\.\s*$/)) {
        const wordInfo = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endColumn: wordInfo.endColumn,
        };

        return {
          suggestions: TOP_LEVEL_IDENTIFIERS.map((id) => ({
            label: id.name,
            kind:
              id.kind === "object"
                ? monaco.languages.CompletionItemKind.Module
                : monaco.languages.CompletionItemKind.Variable,
            insertText: id.name,
            detail: id.kind,
            documentation: id.description,
            range,
          })),
        };
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
 * @returns Disposables for cleanup
 */
export function registerRhaiLanguage(
  monaco: MonacoInstance,
  getAvailableSignals: () => SignalMetadata[]
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
      createRhaiHoverProvider(monaco, getAvailableSignals)
    )
  );

  // Register completion provider
  disposables.push(
    monaco.languages.registerCompletionItemProvider(
      RHAI_LANGUAGE_ID,
      createRhaiCompletionProvider(monaco, getAvailableSignals)
    )
  );

  return disposables;
}
