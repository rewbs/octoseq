/**
 * Monaco Signature Help Provider using the TypeScript API Registry.
 *
 * Provides parameter hints when typing inside function/method calls.
 */

import type { RegistryMethod } from "../registry/types";
import { findCallContext, parseLocalVariableTypes } from "../context";
import { getApiRegistry, resolveChainSegments } from "../registry";

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
 * Create the signature help provider for Rhai scripts.
 */
export function createSignatureHelpProvider(_monaco: MonacoInstance) {
  return {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideSignatureHelp(model: any, position: any) {
      const registry = getApiRegistry();

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
        return null;
      }

      const { methodName, chain, activeParameter } = callContext;
      let methods: RegistryMethod[] = [];

      // Parse local variable types for improved resolution
      const fullText = model.getValue();
      const localVars = parseLocalVariableTypes(fullText);

      if (!chain || chain.length === 0) {
        // Global function call - look in helper functions or namespace methods
        const helperPaths = registry.byKind.get("helper") || [];
        for (const path of helperPaths) {
          const entry = registry.entries.get(path);
          if (entry && entry.name === methodName) {
            methods = entry.methods.filter((m) => m.name === methodName);
            break;
          }
        }

        // Also check namespace methods (e.g., mesh.cube, line.strip)
        if (methods.length === 0) {
          const namespacePaths = registry.byKind.get("namespace") || [];
          for (const path of namespacePaths) {
            const entry = registry.entries.get(path);
            if (entry) {
              const found = entry.methods.filter((m) => m.name === methodName);
              if (found.length > 0) {
                methods = found;
                break;
              }
            }
          }
        }
      } else {
        // Method call on a type - resolve the chain to find the parent type
        const resolution = resolveChainSegments(chain, localVars);
        if (resolution.success && resolution.entry) {
          methods = resolution.entry.methods.filter((m) => m.name === methodName);
        }
      }

      if (methods.length === 0) {
        return null;
      }

      // Build signature information for each overload
      const signatures = methods.map((method) => {
        const params = method.params.map((p) => {
          const paramLabel = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;

          const docParts: string[] = [p.description];
          if (p.default !== undefined) {
            docParts.push(`\n\nDefault: \`${JSON.stringify(p.default)}\``);
          }
          if (p.range) {
            docParts.push(`\nRange: ${p.range.min} – ${p.range.max}`);
          }
          if (p.enumValues) {
            docParts.push(`\nValues: ${p.enumValues.map((v) => `"${v}"`).join(", ")}`);
          }

          return {
            label: paramLabel,
            documentation: {
              value: docParts.join(""),
            },
          };
        });

        const signatureLabel = formatMethodSignature(method);

        const docParts: string[] = [method.description];
        if (method.notes) {
          docParts.push(`\n\n*${method.notes}*`);
        }
        if (method.example) {
          docParts.push(`\n\n**Example:**\n\`\`\`rhai\n${method.example}\n\`\`\``);
        }

        return {
          label: signatureLabel,
          documentation: {
            value: docParts.join(""),
          },
          parameters: params,
        };
      });

      // Determine active signature (prefer the one where activeParameter is in range)
      let activeSignature = 0;
      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i]!;
        if (activeParameter < sig.parameters.length) {
          activeSignature = i;
          break;
        }
      }

      // Clamp activeParameter to the signature's parameter count
      const activeSig = signatures[activeSignature]!;
      const clampedActiveParameter = Math.min(
        activeParameter,
        Math.max(0, activeSig.parameters.length - 1)
      );

      return {
        value: {
          signatures,
          activeSignature,
          activeParameter: clampedActiveParameter,
        },
        dispose: () => {},
      };
    },
  };
}
