/**
 * Script API metadata types (host-defined; produced by Rust).
 *
 * The authoritative source of truth lives in `packages/visualiser/src/script_api.rs`.
 * The web app consumes the JSON to drive editor UX (autocomplete/hover/docs).
 */

export type ApiGlobalKind = "object" | "function" | "variable";
export type ApiTypeKind = "namespace" | "struct" | "opaque";

export interface ApiParam {
  name: string;
  type_name: string;
  description: string;
  optional?: boolean;
  default?: unknown | null;
}

export interface ApiMethod {
  name: string;
  description: string;
  params: ApiParam[];
  returns: string;
  overload_id?: string | null;
  example?: string | null;
  notes?: string | null;
}

export interface ApiProperty {
  name: string;
  type_name: string;
  description: string;
  readonly?: boolean;
  optional?: boolean;
}

export interface ApiType {
  name: string;
  kind: ApiTypeKind;
  description: string;
  properties: ApiProperty[];
  methods: ApiMethod[];
}

export interface ApiGlobal {
  name: string;
  kind: ApiGlobalKind;
  type_name: string;
  description: string;
}

export interface ScriptApiMetadata {
  schema_version: number;
  api_version: string;
  globals: ApiGlobal[];
  types: ApiType[];
}

export interface ScriptApiIndex {
  meta: ScriptApiMetadata;
  globalsByName: Map<string, ApiGlobal>;
  typesByName: Map<string, ApiType>;
}

export function parseScriptApiMetadata(json: string): ScriptApiMetadata {
  const parsed = JSON.parse(json) as ScriptApiMetadata;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid script API metadata JSON");
  }
  return parsed;
}

export function buildScriptApiIndex(meta: ScriptApiMetadata): ScriptApiIndex {
  return {
    meta,
    globalsByName: new Map(meta.globals.map((g) => [g.name, g])),
    typesByName: new Map(meta.types.map((t) => [t.name, t])),
  };
}

export function formatMethodSignature(method: ApiMethod): string {
  const params = method.params.map((p) => `${p.name}: ${p.type_name}`).join(", ");
  return `${method.name}(${params}) -> ${method.returns}`;
}

