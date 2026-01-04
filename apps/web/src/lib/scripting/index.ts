/**
 * Rhai scripting support for the visualiser.
 *
 * Re-exports all scripting utilities from a single entry point.
 */

// ============================================================================
// New TypeScript Registry-based Implementation
// ============================================================================

// Monaco integration (new simplified API)
export {
  registerRhaiLanguage,
  attachDiagnostics,
  USE_NEW_REGISTRY,
  RHAI_LANGUAGE_ID,
} from "./monaco";
export type { RhaiLanguageOptions, AvailableBand, AvailableCustomEvent } from "./monaco";

// Registry types and accessors
export * from "./registry";
export * from "./registry/types";

// Context detection
export * from "./context";
export * from "./context/types";

// Providers (for advanced use cases)
export * from "./providers";

// ============================================================================
// Legacy Implementation (DEPRECATED)
// These exports are maintained for backwards compatibility during migration.
// Use the new registry-based implementation above instead.
// ============================================================================

// @deprecated Use registerRhaiLanguage from "./monaco" instead
export {
  rhaiTokensProvider,
  rhaiLanguageConfig,
  createRhaiHoverProvider,
  createRhaiCompletionProvider,
  createRhaiSignatureHelpProvider,
  registerRhaiLanguage as registerRhaiLanguageOld,
  validateConfigMaps,
  type ConfigMapDiagnostic,
} from "./rhaiMonaco";

// @deprecated Types now come from the registry
export * from "./scriptApi";

// @deprecated Use runDiagnostics from "./providers" instead
export * from "./scriptDiagnostics";

// @deprecated Config-map schemas are now in the registry
export * from "./configMapSchema";
