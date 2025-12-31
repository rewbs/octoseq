/**
 * Signal Explorer Analysis Service
 *
 * Manages debounced signal chain analysis with cancellation support.
 */

import { useSignalExplorerStore } from "../stores/signalExplorerStore";
import type {
  AnalysisResult,
  ScriptSignalInfo,
  SignalChainAnalysis,
} from "./types";
import { isAnalysisError } from "./types";

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 200;

/** Number of beats before/after center to sample */
const WINDOW_BEATS = 2;

/** Number of samples to take */
const SAMPLE_COUNT = 200;

/** Timer handle for debouncing */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Counter for tracking latest request */
let requestCounter = 0;

/**
 * WasmVisualiser interface (subset of methods we need)
 */
interface WasmVisualiser {
  get_script_signals(): string;
  has_signal(name: string): boolean;
  analyze_signal_chain(
    signalName: string,
    centerTime: number,
    windowBeats: number,
    sampleCount: number
  ): string;
}

/**
 * Request signal chain analysis with debouncing and cancellation.
 *
 * - Cancels any pending debounce timer
 * - Starts a new debounce timer
 * - When timer fires, calls WASM and updates store
 * - Ignores results from stale requests
 */
export function requestSignalAnalysis(
  visualiser: WasmVisualiser,
  signalName: string,
  centerTime: number
): void {
  const store = useSignalExplorerStore.getState();

  // Cancel any pending debounce
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  // Increment request counter to track latest request
  const currentRequest = ++requestCounter;

  // Mark as analyzing
  store.setAnalyzing(true);

  // Start new debounce timer
  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    // Check if this request is still current
    if (currentRequest !== requestCounter) {
      return;
    }

    try {
      // Check if signal exists
      if (!visualiser.has_signal(signalName)) {
        // Don't clear existing valid analysis, just stop analyzing
        store.setAnalyzing(false);
        return;
      }

      // Call WASM
      const resultJson = visualiser.analyze_signal_chain(
        signalName,
        centerTime,
        WINDOW_BEATS,
        SAMPLE_COUNT
      );

      // Check if this request is still current
      if (currentRequest !== requestCounter) {
        return;
      }

      // Parse result
      const result = parseAnalysisResult(resultJson);

      if (isAnalysisError(result)) {
        store.setError(result.error);
        // Keep showing last valid analysis
      } else {
        store.setAnalysis(result, signalName);
      }
    } catch (e) {
      // Check if this request is still current
      if (currentRequest !== requestCounter) {
        return;
      }
      store.setError(String(e));
    }
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending analysis request.
 */
export function cancelPendingAnalysis(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  requestCounter++;
  useSignalExplorerStore.getState().setAnalyzing(false);
}

/**
 * Update script signals from WASM after script load.
 */
export function updateScriptSignals(visualiser: WasmVisualiser): void {
  try {
    const signalsJson = visualiser.get_script_signals();
    const signals: ScriptSignalInfo[] = JSON.parse(signalsJson);
    useSignalExplorerStore.getState().setScriptSignals(signals);
  } catch (e) {
    console.warn("Failed to get script signals:", e);
    useSignalExplorerStore.getState().setScriptSignals([]);
  }
}

/**
 * Refresh analysis for the current signal if one is selected.
 * Useful after script recompilation.
 */
export function refreshCurrentSignal(
  visualiser: WasmVisualiser,
  centerTime: number
): void {
  const store = useSignalExplorerStore.getState();
  const { lastValidSignalName, scriptSignals } = store;

  // Check if current signal still exists
  if (
    lastValidSignalName &&
    scriptSignals.find((s) => s.name === lastValidSignalName)
  ) {
    requestSignalAnalysis(visualiser, lastValidSignalName, centerTime);
  }
}

/**
 * Parse analysis result from WASM JSON.
 */
function parseAnalysisResult(json: string): AnalysisResult {
  try {
    const raw = JSON.parse(json);

    // Check for error
    if (raw.error) {
      return { error: raw.error };
    }

    // Convert to typed result
    const analysis: SignalChainAnalysis = {
      steps: raw.steps,
      samples: raw.samples.map(
        (s: { times: number[]; values: number[]; stats: unknown }) => ({
          times: s.times,
          values: s.values,
          stats: s.stats,
        })
      ),
      time_range: raw.time_range,
    };

    return analysis;
  } catch (e) {
    return { error: `Parse error: ${e}` };
  }
}
