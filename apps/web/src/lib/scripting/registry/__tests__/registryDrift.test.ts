/**
 * Registry ↔ Rust API drift gate.
 *
 * rust-api-metadata.json is a snapshot of the engine's script API
 * (regenerate with: UPDATE_API_SNAPSHOT=1 cargo test --test api_snapshot
 * in packages/visualiser — a cargo test fails when it goes stale).
 *
 * This test fails when the Rust API surface has entries the Monaco registry
 * doesn't know about — the "autocomplete lies" failure mode. Registry
 * conventions are resolved structurally (globals are keyed by global name,
 * options config-maps are documented at their call sites). Pre-existing gaps
 * are ratcheted in known-drift.json: shrinking it is good, growing it fails
 * here until the registry (or, deliberately, the allowlist) is updated.
 */
import { describe, expect, it } from "vitest";
import metadata from "../rust-api-metadata.json";
import knownDrift from "./known-drift.json";
import { getApiRegistry, lookupByName, lookupPath } from "../index";

interface ApiParamJson {
  name: string;
  type_name: string;
}
interface ApiMethodJson {
  name: string;
  params: ApiParamJson[];
}
interface ApiTypeJson {
  name: string;
  methods: ApiMethodJson[];
  properties: Array<{ name: string }>;
}
interface ApiGlobalJson {
  name: string;
  type_name: string;
}
interface MetadataJson {
  globals: ApiGlobalJson[];
  types: ApiTypeJson[];
}

const meta = metadata as unknown as MetadataJson;
const allow = new Set(knownDrift.missing as string[]);

/** Rust backing type → the global it is exposed as (Mesh → mesh, Fx → fx …). */
const globalNameForType = new Map(meta.globals.map((g) => [g.type_name, g.name]));

/**
 * Flatten the registry: entry paths plus every nested method path/name and
 * property name. Methods live INSIDE entries (buildRegistry doesn't flatten),
 * so membership checks must walk the whole structure.
 */
function flattenRegistry() {
  const paths = new Set<string>();
  const names = new Set<string>();
  for (const entry of getApiRegistry().entries.values()) {
    paths.add(entry.path);
    names.add(entry.name);
    for (const method of entry.methods) {
      paths.add(method.path);
      names.add(method.name);
      // Also index as <entryPath>.<methodName> in case method.path differs.
      paths.add(`${entry.path}.${method.name}`);
    }
    for (const property of entry.properties) {
      paths.add(`${entry.path}.${property.name}`);
      names.add(property.name);
    }
  }
  return { paths, names };
}

const flat = { current: null as null | { paths: Set<string>; names: Set<string> } };
function flattened() {
  if (!flat.current) flat.current = flattenRegistry();
  return flat.current;
}

function pathKnown(key: string, shortName: string): boolean {
  if (lookupPath(key)) return true;
  const { paths, names } = flattened();
  if (paths.has(key)) return true;
  // Builder methods are often registered under fluent paths
  // (e.g. Signal.smooth.exponential rather than SmoothBuilder.exponential).
  return names.has(shortName) || lookupByName(shortName).length > 0;
}

/** All registry paths under which a method of `type` may plausibly be filed. */
function methodKeys(type: ApiTypeJson, method: ApiMethodJson): string[] {
  const keys = [`${type.name}.${method.name}`];
  const globalName = globalNameForType.get(type.name);
  if (globalName) keys.push(`${globalName}.${method.name}`);
  return keys;
}

function methodKnown(type: ApiTypeJson, method: ApiMethodJson): boolean {
  return methodKeys(type, method).some((key) => pathKnown(key, method.name));
}

/**
 * A type is covered when the registry knows it directly, knows the global it
 * backs, or (for options/config types) knows a method that accepts it.
 */
function typeKnown(type: ApiTypeJson): boolean {
  if (pathKnown(type.name, type.name)) return true;
  const globalName = globalNameForType.get(type.name);
  if (globalName && pathKnown(globalName, globalName)) return true;
  for (const t of meta.types) {
    for (const m of t.methods) {
      if (m.params.some((p) => p.type_name === type.name) && methodKnown(t, m)) {
        return true;
      }
    }
  }
  return false;
}

describe("scripting registry covers the Rust API", () => {
  // Force registry initialization.
  getApiRegistry();

  it("knows every Rust global namespace", () => {
    const missing = meta.globals
      .map((g) => g.name)
      .filter((name) => !pathKnown(name, name) && !allow.has(name));
    expect(missing, `Rust globals missing from registry: ${missing.join(", ")}`).toEqual([]);
  });

  it("knows every Rust type", () => {
    const missing = meta.types
      .filter((t) => !typeKnown(t) && !allow.has(t.name))
      .map((t) => t.name);
    expect(missing, `Rust types missing from registry: ${missing.join(", ")}`).toEqual([]);
  });

  it("knows every Rust method", () => {
    const missing: string[] = [];
    for (const type of meta.types) {
      for (const method of type.methods) {
        const key = `${type.name}.${method.name}`;
        if (!methodKnown(type, method) && !allow.has(key)) {
          missing.push(key);
        }
      }
    }
    expect(missing, `Rust methods missing from registry:\n${missing.join("\n")}`).toEqual([]);
  });

  it("ratchet: allowlist entries that are no longer missing should be removed", () => {
    const stale = [...allow].filter((key) => {
      const dot = key.lastIndexOf(".");
      if (dot === -1) {
        const type = meta.types.find((t) => t.name === key);
        return type ? typeKnown(type) : pathKnown(key, key);
      }
      const typeName = key.slice(0, dot);
      const methodName = key.slice(dot + 1);
      const type = meta.types.find((t) => t.name === typeName);
      const method = type?.methods.find((m) => m.name === methodName);
      if (type && method) return methodKnown(type, method);
      return pathKnown(key, methodName);
    });
    expect(
      stale,
      `known-drift.json entries now covered — delete them:\n${stale.join("\n")}`
    ).toEqual([]);
  });
});
