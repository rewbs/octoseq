/**
 * Monaco Hover Provider using the TypeScript API Registry.
 *
 * Provides hover tooltips for:
 * - Global namespaces (mesh, line, scene, etc.)
 * - Type properties and methods
 * - Config-map keys
 * - Local variables (with inferred types)
 */

import type { RegistryEntry, RegistryMethod, RegistryProperty } from "../registry/types";
import { parseChainBeforeDot, parseLocalVariableTypes } from "../context";
import { getApiRegistry, resolveChainSegments, getConfigMapEntry, findMethodsByName } from "../registry";

// Monaco types (provided at runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

/**
 * Format a method signature for display.
 */
function formatMethodSignature(method: RegistryMethod): string {
  const params = method.params
    .map((p) => {
      const opt = p.optional ? "?" : "";
      return `${p.name}${opt}: ${p.type}`;
    })
    .join(", ");
  return `${method.name}(${params}) -> ${method.returns}`;
}

/**
 * Format property documentation for hover.
 */
function formatPropertyHover(prop: RegistryProperty, parentName?: string): string {
  const parts: string[] = [];

  if (parentName) {
    parts.push(`**${parentName}.${prop.name}**: \`${prop.type}\``);
  } else {
    parts.push(`**${prop.name}**: \`${prop.type}\``);
  }

  parts.push("", prop.description);

  if (prop.readonly) {
    parts.push("", "*Read-only*");
  }
  if (prop.range) {
    parts.push("", `Range: ${prop.range.min} – ${prop.range.max}`);
  }
  if (prop.enumValues) {
    parts.push("", `Values: ${prop.enumValues.map((v) => `"${v}"`).join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Format method documentation for hover.
 */
function formatMethodHover(method: RegistryMethod, parentName?: string): string {
  const signature = formatMethodSignature(method);
  const parts: string[] = [];

  if (parentName) {
    parts.push(`**${parentName}.${method.name}**`);
  } else {
    parts.push(`**${method.name}**`);
  }

  parts.push("", `\`${signature}\``, "", method.description);

  if (method.params.length > 0) {
    parts.push("", "**Parameters:**");
    for (const p of method.params) {
      const opt = p.optional ? " *(optional)*" : "";
      const defaultVal = p.default !== undefined ? ` (default: \`${JSON.stringify(p.default)}\`)` : "";
      parts.push(`- \`${p.name}: ${p.type}\`${opt}${defaultVal} — ${p.description}`);
    }
  }

  if (method.notes) {
    parts.push("", `*${method.notes}*`);
  }

  if (method.example) {
    parts.push("", "**Example:**", "```rhai", method.example, "```");
  }

  return parts.join("\n");
}

/**
 * Format entry documentation for hover.
 */
function formatEntryHover(entry: RegistryEntry): string {
  const parts: string[] = [`**${entry.name}**`, "", entry.description];

  if (entry.properties.length > 0) {
    parts.push("", "**Properties:**");
    for (const prop of entry.properties.slice(0, 5)) {
      parts.push(`- \`${prop.name}\`: ${prop.type}`);
    }
    if (entry.properties.length > 5) {
      parts.push(`- ... and ${entry.properties.length - 5} more`);
    }
  }

  if (entry.methods.length > 0) {
    parts.push("", "**Methods:**");
    const uniqueMethods = new Set(entry.methods.map((m) => m.name));
    const methodNames = Array.from(uniqueMethods).slice(0, 5);
    for (const name of methodNames) {
      parts.push(`- \`${name}()\``);
    }
    if (uniqueMethods.size > 5) {
      parts.push(`- ... and ${uniqueMethods.size - 5} more`);
    }
  }

  if (entry.example) {
    parts.push("", "**Example:**", "```rhai", entry.example, "```");
  }

  return parts.join("\n");
}

/**
 * Format config-map key documentation for hover.
 */
function formatConfigMapKeyHover(
  key: string,
  param: { name: string; type: string; description: string; default?: unknown; range?: { min: number; max: number }; enumValues?: string[] },
  functionPath: string
): string {
  const parts: string[] = [
    `**${functionPath}** config key: \`${key}\``,
    "",
    `Type: \`${param.type}\``,
    "",
    param.description,
  ];

  if (param.default !== undefined) {
    const defaultStr = typeof param.default === "object" ? JSON.stringify(param.default) : String(param.default);
    parts.push("", `Default: \`${defaultStr}\``);
  }
  if (param.range) {
    parts.push(`Range: ${param.range.min} – ${param.range.max}`);
  }
  if (param.enumValues) {
    parts.push(`Values: ${param.enumValues.map((v) => `"${v}"`).join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Detect if we're inside a config-map and return the function path and key.
 */
function detectConfigMapKeyAtPosition(textUntilWord: string, word: string): { functionPath: string; key: string } | null {
  // Pattern: look for `functionPath(#{` before cursor and check if word is a key
  // We need to find the most recent #{ and the function before it

  let braceDepth = 0;
  let i = textUntilWord.length - 1;

  // Walk backwards to find #{
  while (i >= 0) {
    const ch = textUntilWord[i];

    if (ch === "}" && textUntilWord[i - 1] !== "#") {
      braceDepth++;
    } else if (ch === "{" && textUntilWord[i - 1] === "#") {
      if (braceDepth === 0) {
        // Found the opening #{
        // Now find the function call before it
        const beforeHashBrace = textUntilWord.slice(0, i - 1).trimEnd();

        // Should end with (
        if (!beforeHashBrace.endsWith("(")) {
          return null;
        }

        // Find the function name before (
        const beforeParen = beforeHashBrace.slice(0, -1).trimEnd();
        const funcMatch = beforeParen.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\s*$/);
        if (funcMatch) {
          return { functionPath: funcMatch[1]!, key: word };
        }
        return null;
      }
      braceDepth--;
    }

    i--;
  }

  return null;
}

/**
 * Create the hover provider for Rhai scripts.
 */
export function createHoverProvider(monaco: MonacoInstance) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideHover(model: any, position: any) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const wordText = word.word;
      const registry = getApiRegistry();

      // Get text until the word for context analysis
      const textUntilWord = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      });

      // Get full text for local variable parsing
      const fullText = model.getValue();

      // Check for config-map key hover
      const configMapKey = detectConfigMapKeyAtPosition(textUntilWord, wordText);
      if (configMapKey) {
        const configEntry = getConfigMapEntry(configMapKey.functionPath);
        if (configEntry?.configMapKeys) {
          const param = configEntry.configMapKeys.find((k) => k.name === configMapKey.key);
          if (param) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              ),
              contents: [{ value: formatConfigMapKeyHover(configMapKey.key, param, configMapKey.functionPath) }],
            };
          }
        }
      }

      // Check for global namespace/type
      const paths = registry.byName.get(wordText);
      if (paths && paths.length > 0) {
        const firstPath = paths[0];
        if (firstPath) {
          const entry = registry.entries.get(firstPath);
          if (entry && (entry.kind === "namespace" || entry.kind === "type" || entry.kind === "helper" || entry.kind === "lifecycle")) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              ),
              contents: [{ value: formatEntryHover(entry) }],
            };
          }
        }
      }

      // Check if this is a member access (word preceded by a dot)
      const lineText = model.getLineContent(position.lineNumber);
      const textBeforeWord = lineText.slice(0, word.startColumn - 1);
      const isDotAccess = textBeforeWord.trimEnd().endsWith(".");

      if (isDotAccess) {
        // Parse the chain before the dot
        const chainResult = parseChainBeforeDot(textUntilWord);
        if (chainResult.valid && chainResult.segments.length > 0) {
          // Parse local variables for type resolution
          const localVars = parseLocalVariableTypes(fullText);

          // Resolve the chain (without the current word)
          const resolution = resolveChainSegments(chainResult.segments, localVars);
          if (resolution.success && resolution.entry) {
            const entry = resolution.entry;

            // Look for property
            const prop = entry.properties.find((p) => p.name === wordText);
            if (prop) {
              return {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents: [{ value: formatPropertyHover(prop, entry.name) }],
              };
            }

            // Look for method
            const methods = entry.methods.filter((m) => m.name === wordText);
            if (methods.length > 0) {
              // If multiple overloads, show all
              const contents = methods.map((m) => ({ value: formatMethodHover(m, entry.name) }));
              return {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents,
              };
            }
          }
        }
      }

      // Check if word is a local variable
      const localVars = parseLocalVariableTypes(fullText);
      const localVarType = localVars.get(wordText);
      if (localVarType) {
        const typeEntry = registry.entries.get(localVarType);
        const typeInfo = typeEntry ? `\n\nType: \`${typeEntry.name}\`` : `\n\nType: \`${localVarType}\``;

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [{ value: `**${wordText}** (local variable)${typeInfo}` }],
        };
      }

      // Check if word is a standalone method name (global lookup)
      const methodMatches = findMethodsByName(wordText);
      if (methodMatches.length > 0) {
        const contents = methodMatches.slice(0, 3).map(({ entry, method }) => ({
          value: formatMethodHover(method, entry.name),
        }));
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents,
        };
      }

      return null;
    },
  };
}
