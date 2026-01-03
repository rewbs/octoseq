/**
 * Monaco Completion Provider using the TypeScript API Registry.
 *
 * Provides context-aware autocomplete for Rhai scripts:
 * - Top-level: global namespaces + lifecycle functions
 * - After-dot: properties + methods of resolved type
 * - In-config-map: valid keys (minus existing)
 * - In-band-key: available band IDs/labels
 * - In-stem-key: available stem names
 * - Unknown: common entity members (graceful fallback)
 */

import type { AvailableBand, AvailableStem } from "../rhaiMonaco";
import type { CursorContext } from "../context/types";
import type { RegistryEntry, RegistryMethod, RegistryProperty } from "../registry/types";
import { getCursorContext } from "../context";
import { getApiRegistry, resolveChainSegments, getConfigMapEntry } from "../registry";

// Monaco types (provided at runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

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
  sortText?: string;
};

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
 * Collect member completions (properties + methods) for a type.
 */
function collectMemberCompletions(
  monaco: MonacoInstance,
  entry: RegistryEntry,
  range: MonacoRange,
  prefix?: string
): MonacoCompletionItem[] {
  const suggestions: MonacoCompletionItem[] = [];
  const lowerPrefix = prefix?.toLowerCase();

  // Properties
  for (const prop of entry.properties) {
    if (lowerPrefix && !prop.name.toLowerCase().startsWith(lowerPrefix)) continue;

    suggestions.push({
      label: prop.name,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText: prop.name,
      detail: prop.type,
      documentation: {
        value: formatPropertyDoc(prop),
      },
      range,
    });
  }

  // Methods - group overloads
  const methodsByName = new Map<string, RegistryMethod[]>();
  for (const method of entry.methods) {
    if (lowerPrefix && !method.name.toLowerCase().startsWith(lowerPrefix)) continue;
    const existing = methodsByName.get(method.name) || [];
    existing.push(method);
    methodsByName.set(method.name, existing);
  }

  for (const [name, overloads] of methodsByName) {
    if (overloads.length === 1) {
      const method = overloads[0]!;
      suggestions.push({
        label: name,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText: `${name}(`,
        detail: formatMethodSignature(method),
        documentation: {
          value: formatMethodDoc(method),
        },
        range,
      });
    } else {
      // Multiple overloads - show each with overload ID
      for (const method of overloads) {
        const label = method.overloadId ? `${name} (${method.overloadId})` : name;
        suggestions.push({
          label,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: `${name}(`,
          detail: formatMethodSignature(method),
          documentation: {
            value: formatMethodDoc(method),
          },
          range,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Format property documentation.
 */
function formatPropertyDoc(prop: RegistryProperty): string {
  const parts: string[] = [`**${prop.name}**: \`${prop.type}\``, "", prop.description];

  if (prop.readonly) {
    parts.push("", "*Read-only*");
  }
  if (prop.range) {
    parts.push(`Range: ${prop.range.min} – ${prop.range.max}`);
  }
  if (prop.enumValues) {
    parts.push(`Values: ${prop.enumValues.map((v) => `"${v}"`).join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Format method documentation.
 */
function formatMethodDoc(method: RegistryMethod): string {
  const signature = formatMethodSignature(method);
  const parts: string[] = [`**${signature}**`, "", method.description];

  if (method.params.length > 0) {
    parts.push("");
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
 * Get top-level completions (namespaces, lifecycle functions, helpers).
 */
function getTopLevelCompletions(
  monaco: MonacoInstance,
  range: MonacoRange,
  prefix?: string
): MonacoCompletionItem[] {
  const registry = getApiRegistry();
  const suggestions: MonacoCompletionItem[] = [];
  const lowerPrefix = prefix?.toLowerCase();

  // Namespaces
  const namespacePaths = registry.byKind.get("namespace") || [];
  for (const path of namespacePaths) {
    const entry = registry.entries.get(path);
    if (!entry) continue;
    if (lowerPrefix && !entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

    suggestions.push({
      label: entry.name,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: entry.name,
      detail: "namespace",
      documentation: { value: entry.description },
      range,
      sortText: `0_${entry.name}`, // Sort namespaces first
    });
  }

  // Lifecycle functions (init, update)
  const lifecyclePaths = registry.byKind.get("lifecycle") || [];
  for (const path of lifecyclePaths) {
    const entry = registry.entries.get(path);
    if (!entry) continue;
    if (lowerPrefix && !entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

    // Only show init/update as completions
    if (entry.name === "init" || entry.name === "update") {
      suggestions.push({
        label: entry.name,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: entry.name,
        detail: "lifecycle",
        documentation: { value: entry.description },
        range,
        sortText: `1_${entry.name}`, // Sort after namespaces
      });
    }
  }

  // Helper functions (help, doc, describe)
  const helperPaths = registry.byKind.get("helper") || [];
  for (const path of helperPaths) {
    const entry = registry.entries.get(path);
    if (!entry) continue;
    if (lowerPrefix && !entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

    suggestions.push({
      label: entry.name,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: `${entry.name}(`,
      detail: "helper",
      documentation: { value: entry.description },
      range,
      sortText: `2_${entry.name}`, // Sort after lifecycle
    });
  }

  return suggestions;
}

/**
 * Get band key completions for inputs.bands[...].
 */
function getBandKeyCompletions(
  monaco: MonacoInstance,
  range: MonacoRange,
  context: CursorContext,
  getAvailableBands?: () => AvailableBand[]
): MonacoCompletionItem[] {
  if (!getAvailableBands) return [];

  const bands = getAvailableBands();
  const hasQuote = context.bandKeyHasQuotes ?? false;
  const partialKey = context.partialBandKey?.toLowerCase() ?? "";
  const quoteChar = hasQuote ? '"' : '"'; // Default to double quote

  const suggestions: MonacoCompletionItem[] = [];

  for (const band of bands) {
    // Filter by partial key if present
    if (
      partialKey &&
      !band.label.toLowerCase().includes(partialKey) &&
      !band.id.toLowerCase().includes(partialKey)
    ) {
      continue;
    }

    const closing = hasQuote ? '"]' : `${quoteChar}]`;
    const labelInsert = hasQuote ? `${band.label}${closing}` : `${quoteChar}${band.label}${quoteChar}]`;

    suggestions.push({
      label: band.label,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: labelInsert,
      detail: "Band label",
      documentation: `inputs.bands["${band.label}"]`,
      range,
    });

    // Also offer ID if different from label
    if (band.id !== band.label) {
      const idInsert = hasQuote ? `${band.id}${closing}` : `${quoteChar}${band.id}${quoteChar}]`;
      suggestions.push({
        label: band.id,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: idInsert,
        detail: "Band ID",
        documentation: `inputs.bands["${band.id}"]`,
        range,
      });
    }
  }

  return suggestions;
}

/**
 * Get stem key completions for inputs.stems[...].
 */
function getStemKeyCompletions(
  monaco: MonacoInstance,
  range: MonacoRange,
  context: CursorContext,
  getAvailableStems?: () => AvailableStem[]
): MonacoCompletionItem[] {
  if (!getAvailableStems) return [];

  const stems = getAvailableStems();
  const hasQuote = context.stemKeyHasQuotes ?? false;
  const partialKey = context.partialStemKey?.toLowerCase() ?? "";
  const quoteChar = hasQuote ? '"' : '"'; // Default to double quote

  const suggestions: MonacoCompletionItem[] = [];

  for (const stem of stems) {
    // Filter by partial key if present
    if (
      partialKey &&
      !stem.label.toLowerCase().includes(partialKey) &&
      !stem.id.toLowerCase().includes(partialKey)
    ) {
      continue;
    }

    const closing = hasQuote ? '"]' : `${quoteChar}]`;
    const labelInsert = hasQuote ? `${stem.label}${closing}` : `${quoteChar}${stem.label}${quoteChar}]`;

    suggestions.push({
      label: stem.label,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: labelInsert,
      detail: "Stem name",
      documentation: `inputs.stems["${stem.label}"]`,
      range,
    });

    // Also offer ID if different from label
    if (stem.id !== stem.label) {
      const idInsert = hasQuote ? `${stem.id}${closing}` : `${quoteChar}${stem.id}${quoteChar}]`;
      suggestions.push({
        label: stem.id,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: idInsert,
        detail: "Stem ID",
        documentation: `inputs.stems["${stem.id}"]`,
        range,
      });
    }
  }

  return suggestions;
}

/**
 * Get config-map key completions.
 */
function getConfigMapKeyCompletions(
  monaco: MonacoInstance,
  range: MonacoRange,
  context: CursorContext
): MonacoCompletionItem[] {
  if (!context.configMapFunction) return [];

  const configEntry = getConfigMapEntry(context.configMapFunction);
  if (!configEntry?.configMapKeys) return [];

  const existingKeys = context.existingKeys || [];
  const suggestions: MonacoCompletionItem[] = [];

  for (const param of configEntry.configMapKeys) {
    // Skip keys already present
    if (existingKeys.includes(param.name)) continue;

    // Build documentation
    const docParts: string[] = [`**${param.name}**: \`${param.type}\``, "", param.description];

    if (param.default !== undefined) {
      const defaultStr =
        typeof param.default === "object" ? JSON.stringify(param.default) : String(param.default);
      docParts.push("", `Default: \`${defaultStr}\``);
    }
    if (param.range) {
      docParts.push(`Range: ${param.range.min} – ${param.range.max}`);
    }
    if (param.enumValues) {
      docParts.push(`Values: ${param.enumValues.map((v) => `"${v}"`).join(", ")}`);
    }

    suggestions.push({
      label: param.name,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText: `${param.name}: `,
      detail: param.type,
      documentation: { value: docParts.join("\n") },
      range,
    });
  }

  return suggestions;
}

/**
 * Get fallback completions for unknown context.
 * Provides common entity members to assist when type resolution fails.
 */
function getFallbackEntityCompletions(
  monaco: MonacoInstance,
  range: MonacoRange
): MonacoCompletionItem[] {
  const registry = getApiRegistry();

  // Merge properties/methods from MeshEntity and LineStripEntity
  const meshEntity = registry.entries.get("MeshEntity");
  const lineEntity = registry.entries.get("LineStripEntity");

  if (!meshEntity && !lineEntity) return [];

  // Collect unique properties
  const seenProps = new Set<string>();
  const properties: RegistryProperty[] = [];

  for (const entry of [meshEntity, lineEntity]) {
    if (!entry) continue;
    for (const prop of entry.properties) {
      if (!seenProps.has(prop.name)) {
        seenProps.add(prop.name);
        properties.push(prop);
      }
    }
  }

  // Collect unique methods
  const seenMethods = new Set<string>();
  const methods: RegistryMethod[] = [];

  for (const entry of [meshEntity, lineEntity]) {
    if (!entry) continue;
    for (const method of entry.methods) {
      if (!seenMethods.has(method.name)) {
        seenMethods.add(method.name);
        methods.push(method);
      }
    }
  }

  // Create merged entry for completion
  const mergedEntry: RegistryEntry = {
    kind: "type",
    name: "Entity",
    path: "Entity",
    description: "Common scene entity members.",
    properties,
    methods,
  };

  return collectMemberCompletions(monaco, mergedEntry, range);
}

/**
 * Create the completion provider for Rhai scripts.
 */
export function createCompletionProvider(
  monaco: MonacoInstance,
  options: {
    getAvailableBands?: () => AvailableBand[];
    getAvailableStems?: () => AvailableStem[];
  } = {}
) {
  const { getAvailableBands, getAvailableStems } = options;

  return {
    triggerCharacters: [".", "[", '"', "'", ",", "#"],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems(model: any, position: any) {
      // Get all text up to cursor
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const wordInfo = model.getWordUntilPosition(position);
      const range: MonacoRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      };

      // Detect cursor context
      const context = getCursorContext(textUntilPosition);

      switch (context.kind) {
        case "in-band-key":
          return {
            suggestions: getBandKeyCompletions(monaco, range, context, getAvailableBands),
          };

        case "in-stem-key":
          return {
            suggestions: getStemKeyCompletions(monaco, range, context, getAvailableStems),
          };

        case "in-config-map":
          if (context.configMapPosition === "key") {
            return {
              suggestions: getConfigMapKeyCompletions(monaco, range, context),
            };
          }
          // In value position - fall through to normal completion
          break;

        case "after-dot": {
          const registry = getApiRegistry();

          // Try to resolve the chain to a type
          if (context.chain && context.chain.length > 0) {
            const resolution = resolveChainSegments(context.chain, context.localVariables);
            if (resolution.success && resolution.entry) {
              return {
                suggestions: collectMemberCompletions(
                  monaco,
                  resolution.entry,
                  range,
                  context.prefix
                ),
              };
            }
          }

          // Check if we have a resolved type directly
          if (context.resolvedType) {
            const entry = registry.entries.get(context.resolvedType);
            if (entry) {
              return {
                suggestions: collectMemberCompletions(monaco, entry, range, context.prefix),
              };
            }
          }

          // Fallback: common entity members
          return {
            suggestions: getFallbackEntityCompletions(monaco, range),
          };
        }

        case "in-call":
          // Inside function call - could show parameter hints, but signature help handles this
          // Fall through to type-specific completions if we can resolve the expected type
          break;

        case "in-string":
          // Inside string literal - no completions
          return { suggestions: [] };

        case "top-level":
          return {
            suggestions: getTopLevelCompletions(monaco, range, context.prefix),
          };

        case "unknown":
        default:
          // Check if we're after a dot even if context detection was uncertain
          if (textUntilPosition.trimEnd().endsWith(".")) {
            return {
              suggestions: getFallbackEntityCompletions(monaco, range),
            };
          }

          // Default to top-level completions
          return {
            suggestions: getTopLevelCompletions(monaco, range, context.prefix),
          };
      }

      // Default: top-level completions
      return {
        suggestions: getTopLevelCompletions(monaco, range, context.prefix),
      };
    },
  };
}
