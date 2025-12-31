/**
 * Monaco Editor language support for Rhai scripting.
 *
 * Simplified registration API using the TypeScript API Registry.
 * No longer requires WASM metadata callback - registry is self-contained.
 */

import type { AvailableBand } from "./rhaiMonaco";
import { RHAI_LANGUAGE_ID, rhaiTokensProvider, rhaiLanguageConfig } from "./rhaiMonaco";
import {
  createCompletionProvider,
  createHoverProvider,
  createSignatureHelpProvider,
  createDiagnosticsProvider,
} from "./providers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Disposable = any;

/**
 * Feature flag for using the new TypeScript registry-based providers.
 *
 * Set to true to use the new implementation.
 * Set to false to fall back to the old rhaiMonaco.ts implementation.
 */
export const USE_NEW_REGISTRY = true;

export interface RhaiLanguageOptions {
  /**
   * Callback to get available frequency bands for band key completion.
   */
  getAvailableBands?: () => AvailableBand[];
}

/**
 * Register the Rhai language with Monaco.
 *
 * This is the new simplified API that uses the TypeScript registry.
 * It no longer requires getApiMetadata callback - the registry is self-contained.
 *
 * @param monaco The Monaco instance
 * @param options Optional configuration
 * @returns Array of disposables to clean up registrations
 */
export function registerRhaiLanguage(
  monaco: MonacoInstance,
  options: RhaiLanguageOptions = {}
): Disposable[] {
  const disposables: Disposable[] = [];
  const { getAvailableBands } = options;

  // Register the language if not already registered
  const languages = monaco.languages.getLanguages();
  const isRegistered = languages.some(
    (lang: { id: string }) => lang.id === RHAI_LANGUAGE_ID
  );

  if (!isRegistered) {
    monaco.languages.register({ id: RHAI_LANGUAGE_ID });
  }

  // Set language configuration (brackets, comments, etc.)
  disposables.push(
    monaco.languages.setLanguageConfiguration(RHAI_LANGUAGE_ID, rhaiLanguageConfig)
  );

  // Set tokenizer for syntax highlighting
  disposables.push(
    monaco.languages.setMonarchTokensProvider(RHAI_LANGUAGE_ID, rhaiTokensProvider)
  );

  // Register completion provider
  disposables.push(
    monaco.languages.registerCompletionItemProvider(
      RHAI_LANGUAGE_ID,
      createCompletionProvider(monaco, { getAvailableBands })
    )
  );

  // Register hover provider
  disposables.push(
    monaco.languages.registerHoverProvider(
      RHAI_LANGUAGE_ID,
      createHoverProvider(monaco)
    )
  );

  // Register signature help provider
  disposables.push(
    monaco.languages.registerSignatureHelpProvider(
      RHAI_LANGUAGE_ID,
      createSignatureHelpProvider(monaco)
    )
  );

  return disposables;
}

/**
 * Attach diagnostics to a Monaco editor model.
 *
 * @param monaco The Monaco instance
 * @param model The model to attach diagnostics to
 * @returns Dispose function to clean up
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachDiagnostics(monaco: MonacoInstance, model: any): () => void {
  const provider = createDiagnosticsProvider(monaco);
  return provider.attachToModel(model);
}

// Re-export constants and types for backwards compatibility
export { RHAI_LANGUAGE_ID } from "./rhaiMonaco";
export type { AvailableBand } from "./rhaiMonaco";
