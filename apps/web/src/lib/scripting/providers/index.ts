/**
 * Monaco language providers for Rhai scripting.
 *
 * Provides:
 * - Completion provider (autocomplete)
 * - Hover provider (tooltips)
 * - Signature help provider (parameter hints)
 * - Diagnostics provider (gentle validation)
 */

export { createCompletionProvider } from "./completion";
export { createHoverProvider } from "./hover";
export { createSignatureHelpProvider } from "./signature";
export { createDiagnosticsProvider, runDiagnostics } from "./diagnostics";
