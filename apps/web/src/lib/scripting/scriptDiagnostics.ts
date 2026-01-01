/**
 * Script diagnostics types (host-defined; produced by Rust).
 *
 * See: `packages/visualiser/src/script_diagnostics.rs`
 */

export type ScriptDiagnosticKind = "parse_error" | "runtime_error" | "host_api_misuse" | "host_error" | "warning";
export type ScriptPhase = "compile" | "init" | "update";

export interface ScriptLocation {
  line: number; // 1-based (user script)
  column: number; // 1-based
}

export interface ScriptDiagnostic {
  kind: ScriptDiagnosticKind;
  phase: ScriptPhase;
  message: string;
  location?: ScriptLocation | null;
  raw?: string | null;
}

export function parseScriptDiagnosticsJson(json: string): ScriptDiagnostic[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ScriptDiagnostic[];
  } catch {
    return [];
  }
}

