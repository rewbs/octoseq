/**
 * API Registry Builder and Accessor
 *
 * This module builds and provides access to the TypeScript API registry,
 * which is the single source of truth for all Monaco IDE features.
 */

import type {
  ApiRegistry,
  RegistryEntry,
  RegistryEntryKind,
  RegistryMethod,
  RegistryProperty,
  ChainResolution,
} from "./types";
import type { ChainSegment } from "../context/types";

// Import entry definitions
import { NAMESPACE_ENTRIES } from "./entries/namespaces";
import { SIGNAL_ENTRIES } from "./entries/signals";
import { CONFIG_MAP_ENTRIES } from "./entries/config-maps";
import { ENTITY_ENTRIES } from "./entries/entities";
import { BUILDER_ENTRIES } from "./entries/builders";
import { PRIMITIVE_ENTRIES } from "./entries/primitives";
import { LIFECYCLE_ENTRIES } from "./entries/lifecycle";

// Re-export types
export * from "./types";

/** Registry version - bump when making breaking changes */
const REGISTRY_VERSION = "1.0.0";

/** Singleton registry instance */
let _registry: ApiRegistry | null = null;

/**
 * Build the API registry from all entry definitions.
 * Called once on first access.
 */
function buildRegistry(): ApiRegistry {
  const entries = new Map<string, RegistryEntry>();
  const byName = new Map<string, string[]>();
  const byKind = new Map<RegistryEntryKind, string[]>();

  // Helper to add an entry
  const addEntry = (entry: RegistryEntry) => {
    // Add to main entries map
    entries.set(entry.path, entry);

    // Add to byName index
    const existingPaths = byName.get(entry.name) || [];
    existingPaths.push(entry.path);
    byName.set(entry.name, existingPaths);

    // Add to byKind index
    const existingKindPaths = byKind.get(entry.kind) || [];
    existingKindPaths.push(entry.path);
    byKind.set(entry.kind, existingKindPaths);
  };

  // Collect all entries from definition files
  const allEntries: RegistryEntry[] = [
    ...NAMESPACE_ENTRIES,
    ...SIGNAL_ENTRIES,
    ...CONFIG_MAP_ENTRIES,
    ...ENTITY_ENTRIES,
    ...BUILDER_ENTRIES,
    ...PRIMITIVE_ENTRIES,
    ...LIFECYCLE_ENTRIES,
  ];

  // Populate the registry
  for (const entry of allEntries) {
    addEntry(entry);
  }

  return {
    version: REGISTRY_VERSION,
    entries,
    byName,
    byKind,
  };
}

/**
 * Get the API registry singleton.
 * The registry is built lazily on first access.
 */
export function getApiRegistry(): ApiRegistry {
  if (!_registry) {
    _registry = buildRegistry();
  }
  return _registry;
}

/**
 * Look up an entry by its fully qualified path.
 * @param path - The path to look up (e.g., "mesh", "Signal.smooth")
 * @returns The entry, or undefined if not found
 */
export function lookupPath(path: string): RegistryEntry | undefined {
  return getApiRegistry().entries.get(path);
}

/**
 * Look up entries by name (may return multiple paths).
 * @param name - The name to look up (e.g., "cube", "smooth")
 * @returns Array of matching paths
 */
export function lookupByName(name: string): string[] {
  return getApiRegistry().byName.get(name) || [];
}

/**
 * Get all entries of a specific kind.
 * @param kind - The entry kind to filter by
 * @returns Array of paths for entries of that kind
 */
export function getEntriesByKind(kind: RegistryEntryKind): string[] {
  return getApiRegistry().byKind.get(kind) || [];
}

/**
 * Get all global namespace entries (top-level objects).
 * These are the entries available at the root scope.
 */
export function getGlobalNamespaces(): RegistryEntry[] {
  const registry = getApiRegistry();
  const paths = registry.byKind.get("namespace") || [];
  return paths
    .map((p) => registry.entries.get(p))
    .filter((e): e is RegistryEntry => e !== undefined && !e.path.includes("."));
}

/**
 * Get all lifecycle functions (init, update).
 */
export function getLifecycleFunctions(): RegistryEntry[] {
  const registry = getApiRegistry();
  const paths = registry.byKind.get("lifecycle") || [];
  return paths.map((p) => registry.entries.get(p)).filter((e): e is RegistryEntry => e !== undefined);
}

/**
 * Get all helper functions (help, doc, describe).
 */
export function getHelperFunctions(): RegistryEntry[] {
  const registry = getApiRegistry();
  const paths = registry.byKind.get("helper") || [];
  return paths.map((p) => registry.entries.get(p)).filter((e): e is RegistryEntry => e !== undefined);
}

/**
 * Resolve a chain of segments to find the resulting type.
 * Used for autocomplete after a chain like "inputs.bands["Bass"].energy."
 *
 * @param segments - Array of segment names (e.g., ["inputs", "bands", "energy"])
 * @returns Resolution result with the final type information
 */
export function resolveChain(segments: string[]): ChainResolution {
  if (segments.length === 0) {
    return { success: false, error: "Empty chain" };
  }

  const firstSegment = segments[0];
  if (!firstSegment) {
    return { success: false, error: "Empty first segment" };
  }

  const registry = getApiRegistry();
  let currentEntry = registry.entries.get(firstSegment);

  if (!currentEntry) {
    // Check if it's a known type name
    const paths = registry.byName.get(firstSegment);
    const firstPath = paths?.[0];
    if (firstPath) {
      currentEntry = registry.entries.get(firstPath);
    }
  }

  if (!currentEntry) {
    return { success: false, error: `Unknown identifier: ${firstSegment}` };
  }

  // Walk the chain
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];

    // Look for a property with this name
    const property = currentEntry.properties.find((p) => p.name === segment);
    if (property) {
      // Property found - resolve its type
      const typePaths = registry.byName.get(property.type);
      const firstTypePath = typePaths?.[0];
      if (firstTypePath) {
        const nextEntry = registry.entries.get(firstTypePath);
        if (nextEntry) {
          currentEntry = nextEntry;
          continue;
        }
      }
      // Type not found as an entry - return the property info
      if (i === segments.length - 1) {
        return {
          success: true,
          entry: currentEntry,
          property,
          nextType: property.type,
        };
      }
      return { success: false, error: `Cannot resolve type: ${property.type}` };
    }

    // Look for a method with this name
    const method = currentEntry.methods.find((m) => m.name === segment);
    if (method) {
      // Method found - resolve its return type or chainsTo
      const returnType = method.chainsTo || method.returns;
      const typePaths = registry.byName.get(returnType);
      const firstTypePath = typePaths?.[0];
      if (firstTypePath) {
        const nextEntry = registry.entries.get(firstTypePath);
        if (nextEntry) {
          currentEntry = nextEntry;
          continue;
        }
      }
      // Return type not found as an entry - return the method info
      if (i === segments.length - 1) {
        return {
          success: true,
          entry: currentEntry,
          method,
          nextType: returnType,
        };
      }
      return { success: false, error: `Cannot resolve type: ${returnType}` };
    }

    // Check for nested entry (e.g., "Signal.smooth" -> "SmoothBuilder")
    const nestedPath = `${currentEntry.path}.${segment}`;
    const nestedEntry = registry.entries.get(nestedPath);
    if (nestedEntry) {
      currentEntry = nestedEntry;
      continue;
    }

    return { success: false, error: `Unknown member: ${segment} on ${currentEntry.name}` };
  }

  return {
    success: true,
    entry: currentEntry,
    nextType: currentEntry.name,
  };
}

/**
 * Get the name from a ChainSegment.
 */
function getSegmentName(segment: ChainSegment): string | undefined {
  if (segment.kind === "index") {
    return segment.value;
  }
  return segment.name;
}

/**
 * Resolve a chain of ChainSegment objects to find the resulting type.
 * Supports local variable resolution for better type inference.
 *
 * @param segments - Array of ChainSegment objects
 * @param localVariables - Optional map of local variable names to their types
 * @returns Resolution result with the final type information
 */
export function resolveChainSegments(
  segments: ChainSegment[],
  localVariables?: Map<string, string>
): ChainResolution {
  if (segments.length === 0) {
    return { success: false, error: "Empty chain" };
  }

  const firstSegment = segments[0];
  if (!firstSegment) {
    return { success: false, error: "Empty first segment" };
  }

  const registry = getApiRegistry();
  let currentEntry: RegistryEntry | undefined;

  // Get the first segment name
  const firstName = getSegmentName(firstSegment);
  if (!firstName) {
    return { success: false, error: "Empty first segment name" };
  }

  // Check local variables first
  if (localVariables?.has(firstName)) {
    const typeName = localVariables.get(firstName)!;
    currentEntry = registry.entries.get(typeName);
    if (!currentEntry) {
      const paths = registry.byName.get(typeName);
      const firstPath = paths?.[0];
      if (firstPath) {
        currentEntry = registry.entries.get(firstPath);
      }
    }
  }

  if (!currentEntry) {
    // Look up directly
    currentEntry = registry.entries.get(firstName);

    if (!currentEntry) {
      // Check if it's a known type name
      const paths = registry.byName.get(firstName);
      const firstPath = paths?.[0];
      if (firstPath) {
        currentEntry = registry.entries.get(firstPath);
      }
    }
  }

  if (!currentEntry) {
    return { success: false, error: `Unknown identifier: ${firstName}` };
  }

  // Walk the chain
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]!;
    const segmentName = getSegmentName(segment);
    if (!segmentName) continue;

    // Handle special case for "bands" index access
    if (segment.kind === "index" && currentEntry.name === "Bands") {
      // inputs.bands["Bass"] -> BandSignals
      const bandSignals = registry.entries.get("BandSignals");
      if (bandSignals) {
        currentEntry = bandSignals;
        continue;
      }
    }

    // Look for a property with this name
    const property = currentEntry.properties.find((p) => p.name === segmentName);
    if (property) {
      // Property found - resolve its type
      const typePaths = registry.byName.get(property.type);
      const firstTypePath = typePaths?.[0];
      if (firstTypePath) {
        const nextEntry = registry.entries.get(firstTypePath);
        if (nextEntry) {
          currentEntry = nextEntry;
          continue;
        }
      }
      // Type not found as an entry - return the property info
      if (i === segments.length - 1) {
        return {
          success: true,
          entry: currentEntry,
          property,
          nextType: property.type,
        };
      }
      return { success: false, error: `Cannot resolve type: ${property.type}` };
    }

    // Look for a method with this name
    const method = currentEntry.methods.find((m) => m.name === segmentName);
    if (method) {
      // Method found - resolve its return type or chainsTo
      const returnType = method.chainsTo || method.returns;
      const typePaths = registry.byName.get(returnType);
      const firstTypePath = typePaths?.[0];
      if (firstTypePath) {
        const nextEntry = registry.entries.get(firstTypePath);
        if (nextEntry) {
          currentEntry = nextEntry;
          continue;
        }
      }
      // Return type not found as an entry - return the method info
      if (i === segments.length - 1) {
        return {
          success: true,
          entry: currentEntry,
          method,
          nextType: returnType,
        };
      }
      return { success: false, error: `Cannot resolve type: ${returnType}` };
    }

    // Check for nested entry (e.g., "Signal.smooth" -> "SmoothBuilder")
    const nestedPath = `${currentEntry.path}.${segmentName}`;
    const nestedEntry = registry.entries.get(nestedPath);
    if (nestedEntry) {
      currentEntry = nestedEntry;
      continue;
    }

    return {
      success: false,
      error: `Unknown member: ${segmentName} on ${currentEntry.name}`,
    };
  }

  return {
    success: true,
    entry: currentEntry,
    nextType: currentEntry.name,
  };
}

/**
 * Get completions for a given entry (its properties and methods).
 * @param entry - The entry to get completions for
 * @returns Object with properties and methods arrays
 */
export function getCompletionsForEntry(entry: RegistryEntry): {
  properties: RegistryProperty[];
  methods: RegistryMethod[];
} {
  return {
    properties: entry.properties,
    methods: entry.methods,
  };
}

/**
 * Look up a config-map schema by function path.
 * @param functionPath - The function path (e.g., "fx.bloom")
 * @returns The entry with configMapKeys, or undefined
 */
export function getConfigMapEntry(functionPath: string): RegistryEntry | undefined {
  const registry = getApiRegistry();

  // Direct lookup
  const entry = registry.entries.get(functionPath);
  if (entry?.configMapKeys) {
    return entry;
  }

  // Try looking up as a method on a namespace
  const parts = functionPath.split(".");
  if (parts.length >= 2) {
    const namespacePath = parts.slice(0, -1).join(".");
    const methodName = parts[parts.length - 1];
    const namespaceEntry = registry.entries.get(namespacePath);
    if (namespaceEntry) {
      const method = namespaceEntry.methods.find((m) => m.name === methodName);
      if (method) {
        // Check if there's a separate entry for the method with config-map keys
        const methodEntry = registry.entries.get(functionPath);
        if (methodEntry?.configMapKeys) {
          return methodEntry;
        }
      }
    }
  }

  return undefined;
}

/**
 * Find a method by its fully qualified path.
 * @param path - The method path (e.g., "Signal.smooth.exponential")
 * @returns The method, or undefined
 */
export function findMethod(path: string): RegistryMethod | undefined {
  const parts = path.split(".");
  if (parts.length < 2) return undefined;

  const methodName = parts.pop()!;
  const entryPath = parts.join(".");

  const entry = lookupPath(entryPath);
  if (!entry) return undefined;

  return entry.methods.find((m) => m.name === methodName);
}

/**
 * Find all methods with a given name across all entries.
 * Useful for signature help when the context type is unknown.
 * @param name - The method name
 * @returns Array of {entry, method} pairs
 */
export function findMethodsByName(
  name: string
): Array<{ entry: RegistryEntry; method: RegistryMethod }> {
  const registry = getApiRegistry();
  const results: Array<{ entry: RegistryEntry; method: RegistryMethod }> = [];

  for (const entry of registry.entries.values()) {
    for (const method of entry.methods) {
      if (method.name === name) {
        results.push({ entry, method });
      }
    }
  }

  return results;
}

/**
 * Get all top-level identifiers for root-level completion.
 * Includes namespaces, lifecycle functions, and helper functions.
 */
export function getTopLevelIdentifiers(): RegistryEntry[] {
  return [...getGlobalNamespaces(), ...getLifecycleFunctions(), ...getHelperFunctions()];
}
