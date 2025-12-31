/**
 * Registry Validation Utilities
 *
 * Validates the API registry for completeness and consistency.
 * Run in development builds to catch issues early.
 */

import { getApiRegistry } from "./index";
import type { RegistryEntry, RegistryMethod, RegistryProperty } from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

/**
 * Validate that all type references in the registry can be resolved.
 */
function validateTypeReferences(issues: ValidationIssue[]): void {
  const registry = getApiRegistry();
  const allTypeNames = new Set<string>();

  // Collect all known type names
  for (const entry of registry.entries.values()) {
    allTypeNames.add(entry.name);
  }

  // Also add primitive types that don't have entries
  const primitiveTypes = [
    "float",
    "f32",
    "f64",
    "int",
    "i32",
    "i64",
    "bool",
    "string",
    "void",
    "any",
    "Self",
    "Map",
    "()",
    "Map | void",
  ];
  for (const t of primitiveTypes) {
    allTypeNames.add(t);
  }

  // Check each entry
  for (const entry of registry.entries.values()) {
    // Check property types
    for (const prop of entry.properties) {
      const types = parseTypeUnion(prop.type);
      for (const t of types) {
        if (!allTypeNames.has(t) && !t.includes("(") && !t.includes("[")) {
          issues.push({
            severity: "warning",
            path: `${entry.path}.${prop.name}`,
            message: `Unknown type reference: ${t}`,
          });
        }
      }
    }

    // Check method return types and parameter types
    for (const method of entry.methods) {
      // Check return type
      const returnTypes = parseTypeUnion(method.returns);
      for (const t of returnTypes) {
        if (!allTypeNames.has(t) && !t.includes("(") && !t.includes("[")) {
          issues.push({
            severity: "warning",
            path: `${entry.path}.${method.name}`,
            message: `Unknown return type: ${t}`,
          });
        }
      }

      // Check chainsTo
      if (method.chainsTo && !allTypeNames.has(method.chainsTo)) {
        issues.push({
          severity: "warning",
          path: `${entry.path}.${method.name}`,
          message: `Unknown chainsTo type: ${method.chainsTo}`,
        });
      }

      // Check parameter types
      for (const param of method.params) {
        const paramTypes = parseTypeUnion(param.type);
        for (const t of paramTypes) {
          if (!allTypeNames.has(t) && !t.includes("(") && !t.includes("[")) {
            issues.push({
              severity: "warning",
              path: `${entry.path}.${method.name}.${param.name}`,
              message: `Unknown parameter type: ${t}`,
            });
          }
        }
      }
    }
  }
}

/**
 * Parse a type string that may contain unions (e.g., "float | Signal").
 */
function parseTypeUnion(typeStr: string): string[] {
  return typeStr
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Validate that all entries have descriptions.
 */
function validateDescriptions(issues: ValidationIssue[]): void {
  const registry = getApiRegistry();

  for (const entry of registry.entries.values()) {
    if (!entry.description || entry.description.trim().length === 0) {
      issues.push({
        severity: "warning",
        path: entry.path,
        message: "Missing description",
      });
    }

    for (const prop of entry.properties) {
      if (!prop.description || prop.description.trim().length === 0) {
        issues.push({
          severity: "warning",
          path: `${entry.path}.${prop.name}`,
          message: "Property missing description",
        });
      }
    }

    for (const method of entry.methods) {
      if (!method.description || method.description.trim().length === 0) {
        issues.push({
          severity: "warning",
          path: `${entry.path}.${method.name}`,
          message: "Method missing description",
        });
      }

      for (const param of method.params) {
        if (!param.description || param.description.trim().length === 0) {
          issues.push({
            severity: "warning",
            path: `${entry.path}.${method.name}.${param.name}`,
            message: "Parameter missing description",
          });
        }
      }
    }
  }
}

/**
 * Validate that config-map entries have keys defined.
 */
function validateConfigMaps(issues: ValidationIssue[]): void {
  const registry = getApiRegistry();
  const configMapPaths = registry.byKind.get("config-map") || [];

  for (const path of configMapPaths) {
    const entry = registry.entries.get(path);
    if (!entry) continue;

    if (!entry.configMapKeys || entry.configMapKeys.length === 0) {
      issues.push({
        severity: "error",
        path: entry.path,
        message: "Config-map entry has no keys defined",
      });
    }
  }
}

/**
 * Validate the entire registry.
 * @returns Array of validation issues
 */
export function validateRegistry(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  validateTypeReferences(issues);
  validateDescriptions(issues);
  validateConfigMaps(issues);

  return issues;
}

/**
 * Run validation and log results to console.
 * Useful for development debugging.
 */
export function logValidationResults(): void {
  const issues = validateRegistry();

  if (issues.length === 0) {
    console.log("[Registry] Validation passed - no issues found");
    return;
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  console.group(`[Registry] Validation found ${issues.length} issues`);

  if (errors.length > 0) {
    console.group(`Errors (${errors.length})`);
    for (const issue of errors) {
      console.error(`${issue.path}: ${issue.message}`);
    }
    console.groupEnd();
  }

  if (warnings.length > 0) {
    console.group(`Warnings (${warnings.length})`);
    for (const issue of warnings) {
      console.warn(`${issue.path}: ${issue.message}`);
    }
    console.groupEnd();
  }

  console.groupEnd();
}

/**
 * Get registry statistics.
 */
export function getRegistryStats(): {
  totalEntries: number;
  byKind: Record<string, number>;
  totalProperties: number;
  totalMethods: number;
  totalConfigMapKeys: number;
} {
  const registry = getApiRegistry();
  let totalProperties = 0;
  let totalMethods = 0;
  let totalConfigMapKeys = 0;

  const byKind: Record<string, number> = {};

  for (const entry of registry.entries.values()) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    totalProperties += entry.properties.length;
    totalMethods += entry.methods.length;
    if (entry.configMapKeys) {
      totalConfigMapKeys += entry.configMapKeys.length;
    }
  }

  return {
    totalEntries: registry.entries.size,
    byKind,
    totalProperties,
    totalMethods,
    totalConfigMapKeys,
  };
}
