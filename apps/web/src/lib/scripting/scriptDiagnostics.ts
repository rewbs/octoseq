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

/**
 * API coverage validation diagnostic.
 */
export interface ApiCoverageDiagnostic {
  type: "unbound_signal" | "missing_runtime" | "missing_registry";
  path: string;
  message: string;
}

/**
 * Validate script API coverage consistency between project signals, runtime bindings, and registry entries.
 *
 * This function helps ensure that:
 * 1. All project signals are bound to the script runtime
 * 2. All Monaco registry entries have corresponding runtime bindings
 * 3. All runtime bindings have corresponding registry entries (for autocomplete)
 *
 * @param projectSignals - Signal IDs defined in the project (e.g., custom signals)
 * @param runtimeBindings - Signal paths available in the Rhai runtime
 * @param registryEntries - Signal paths registered in the Monaco type registry
 * @returns Array of diagnostic messages for any inconsistencies found
 */
export function validateScriptApiCoverage(
  projectSignals: string[],
  runtimeBindings: string[],
  registryEntries: string[]
): ApiCoverageDiagnostic[] {
  const diagnostics: ApiCoverageDiagnostic[] = [];
  const runtimeSet = new Set(runtimeBindings);
  const registrySet = new Set(registryEntries);

  // Check for project signals not bound to runtime
  for (const signal of projectSignals) {
    const expectedPath = `inputs.customSignals["${signal}"]`;
    // Check if signal is accessible in runtime (either directly or via index)
    const isBound = runtimeBindings.some(
      (b) => b === expectedPath || b.startsWith("inputs.customSignals")
    );
    if (!isBound) {
      diagnostics.push({
        type: "unbound_signal",
        path: signal,
        message: `Custom signal "${signal}" is defined but not bound to script runtime`,
      });
    }
  }

  // Check for registry entries without runtime counterparts
  for (const entry of registryEntries) {
    // Skip dynamic entries that use indexers (they can't be statically validated)
    if (entry.includes("[") || entry.includes("*")) continue;
    if (!runtimeSet.has(entry)) {
      diagnostics.push({
        type: "missing_runtime",
        path: entry,
        message: `Registry entry "${entry}" has no runtime binding`,
      });
    }
  }

  // Check for runtime bindings without registry entries (missing autocomplete)
  for (const binding of runtimeBindings) {
    // Skip dynamic bindings
    if (binding.includes("[") || binding.includes("*")) continue;
    if (!registrySet.has(binding)) {
      diagnostics.push({
        type: "missing_registry",
        path: binding,
        message: `Runtime binding "${binding}" has no registry entry (autocomplete will be missing)`,
      });
    }
  }

  return diagnostics;
}

/**
 * Get the canonical namespace paths for the current API structure.
 * Used for validation and documentation generation.
 */
export function getCanonicalNamespacePaths(): {
  timing: string[];
  inputsMix: string[];
  inputsStems: string[];
  inputsCustomSignals: string[];
  inputsCustomEvents: string[];
} {
  return {
    timing: [
      "timing.time",
      "timing.dt",
      "timing.beatPosition",
      "timing.beatIndex",
      "timing.beatPhase",
      "timing.bpm",
    ],
    inputsMix: [
      "inputs.mix.rms",
      "inputs.mix.energy",
      "inputs.mix.centroid",
      "inputs.mix.flux",
      "inputs.mix.onset",
      "inputs.mix.searchSimilarity",
      "inputs.mix.harmonic",
      "inputs.mix.bassMotion",
      "inputs.mix.tonal",
      "inputs.mix.bands",
      "inputs.mix.beatCandidates",
      "inputs.mix.onsetPeaks",
    ],
    inputsStems: [
      "inputs.stems[*].rms",
      "inputs.stems[*].energy",
      "inputs.stems[*].centroid",
      "inputs.stems[*].flux",
      "inputs.stems[*].onset",
      "inputs.stems[*].beatCandidates",
      "inputs.stems[*].onsetPeaks",
      "inputs.stems[*].bands",
    ],
    inputsCustomSignals: ["inputs.customSignals[*]"],
    inputsCustomEvents: ["inputs.customEvents[*]"],
  };
}

