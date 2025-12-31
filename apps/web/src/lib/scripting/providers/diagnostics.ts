/**
 * Monaco Diagnostics Provider using the TypeScript API Registry.
 *
 * Provides gentle validation (advisory, not errors):
 * - Unknown config-map keys
 * - Misspelled method names (with suggestions)
 *
 * Never blocks execution - these are hints to help the user.
 */

import { getApiRegistry, getConfigMapEntry } from "../registry";

// Monaco types (provided at runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

interface Diagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number; // 1=Error, 2=Warning, 4=Info, 8=Hint
  source: string;
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Find similar names for a misspelled identifier.
 */
function findSimilarNames(name: string, candidates: string[], maxDistance = 2): string[] {
  const matches: Array<{ name: string; distance: number }> = [];

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance <= maxDistance && distance > 0) {
      matches.push({ name: candidate, distance });
    }
  }

  return matches
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((m) => m.name);
}

/**
 * Parse config-map contexts from code and validate keys.
 */
function validateConfigMapKeys(
  code: string,
  monaco: MonacoInstance
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Pattern to find config-map usages: functionPath(#{ key: value, ... })
  // This is a simplified regex - won't handle all edge cases but catches common patterns
  const configMapPattern = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(\s*#\{([^}]*)\}/g;

  let match;
  while ((match = configMapPattern.exec(code)) !== null) {
    const functionPath = match[1]!;
    const keysContent = match[2]!;
    const configMapStart = match.index + functionPath.length;

    // Get the config-map schema
    const configEntry = getConfigMapEntry(functionPath);
    if (!configEntry?.configMapKeys) continue;

    const validKeys = new Set(configEntry.configMapKeys.map((k) => k.name));

    // Parse keys from the config-map content
    // Pattern: identifier followed by :
    const keyPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g;
    let keyMatch;

    while ((keyMatch = keyPattern.exec(keysContent)) !== null) {
      const key = keyMatch[1]!;

      if (!validKeys.has(key)) {
        // Calculate position
        const keyOffset = configMapStart + 2 + keyMatch.index; // +2 for #{
        const position = getLineColumnFromOffset(code, keyOffset);

        // Find similar keys for suggestion
        const similarKeys = findSimilarNames(key, Array.from(validKeys));
        const suggestion = similarKeys.length > 0
          ? ` Did you mean: ${similarKeys.map((k) => `"${k}"`).join(", ")}?`
          : "";

        diagnostics.push({
          startLineNumber: position.line,
          startColumn: position.column,
          endLineNumber: position.line,
          endColumn: position.column + key.length,
          message: `Unknown config key "${key}" for ${functionPath}.${suggestion}`,
          severity: monaco.MarkerSeverity.Warning,
          source: "rhai",
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Convert a character offset to line and column numbers.
 */
function getLineColumnFromOffset(
  code: string,
  offset: number
): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return { line, column };
}

/**
 * Validate method calls on known types.
 */
function validateMethodCalls(
  code: string,
  monaco: MonacoInstance
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const registry = getApiRegistry();

  // Pattern to find method calls: identifier.method(
  // This is a simplified approach - won't catch all cases but helps with common ones
  const methodCallPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

  let match;
  while ((match = methodCallPattern.exec(code)) !== null) {
    const objectName = match[1]!;
    const methodName = match[2]!;
    const methodOffset = match.index + match[0].indexOf(methodName);

    // Try to resolve the object type
    const paths = registry.byName.get(objectName);
    if (!paths || paths.length === 0) continue;

    const firstPath = paths[0];
    if (!firstPath) continue;

    const entry = registry.entries.get(firstPath);
    if (!entry) continue;

    // Check if method exists on this type
    const methodExists = entry.methods.some((m) => m.name === methodName);
    const propExists = entry.properties.some((p) => p.name === methodName);

    if (!methodExists && !propExists) {
      // Find similar method names
      const allMethods = entry.methods.map((m) => m.name);
      const allProps = entry.properties.map((p) => p.name);
      const similarNames = findSimilarNames(methodName, [...allMethods, ...allProps]);

      const position = getLineColumnFromOffset(code, methodOffset);
      const suggestion = similarNames.length > 0
        ? ` Did you mean: ${similarNames.map((n) => `"${n}"`).join(", ")}?`
        : "";

      diagnostics.push({
        startLineNumber: position.line,
        startColumn: position.column,
        endLineNumber: position.line,
        endColumn: position.column + methodName.length,
        message: `Unknown method "${methodName}" on ${entry.name}.${suggestion}`,
        severity: monaco.MarkerSeverity.Info, // Use Info level - very gentle
        source: "rhai",
      });
    }
  }

  return diagnostics;
}

/**
 * Run all diagnostics on the code.
 */
export function runDiagnostics(
  code: string,
  monaco: MonacoInstance
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    diagnostics.push(...validateConfigMapKeys(code, monaco));
    diagnostics.push(...validateMethodCalls(code, monaco));
  } catch {
    // Never throw - diagnostics are advisory only
  }

  return diagnostics;
}

/**
 * Create a diagnostics provider that updates markers on model changes.
 */
export function createDiagnosticsProvider(monaco: MonacoInstance) {
  const DEBOUNCE_MS = 500;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    /**
     * Attach diagnostics to a model.
     * Returns a dispose function to clean up.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachToModel(model: any): () => void {
      const updateDiagnostics = () => {
        const code = model.getValue();
        const diagnostics = runDiagnostics(code, monaco);

        monaco.editor.setModelMarkers(
          model,
          "rhai",
          diagnostics.map((d) => ({
            startLineNumber: d.startLineNumber,
            startColumn: d.startColumn,
            endLineNumber: d.endLineNumber,
            endColumn: d.endColumn,
            message: d.message,
            severity: d.severity,
            source: d.source,
          }))
        );
      };

      // Initial run
      updateDiagnostics();

      // Listen for changes
      const disposable = model.onDidChangeContent(() => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(updateDiagnostics, DEBOUNCE_MS);
      });

      return () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        disposable.dispose();
        monaco.editor.setModelMarkers(model, "rhai", []);
      };
    },
  };
}
