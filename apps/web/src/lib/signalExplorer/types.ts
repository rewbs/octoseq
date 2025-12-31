/**
 * Signal Explorer Types
 *
 * These types mirror the Rust types in packages/visualiser/src/signal_explorer.rs
 */

/** The type of transform applied in a signal chain step */
export type TransformType =
  | "Source"
  | "Smooth"
  | "Normalise"
  | "Gate"
  | "Arithmetic"
  | "Math"
  | "Trig"
  | "ExpLog"
  | "Modular"
  | "Mapping"
  | "TimeShift"
  | "RateChange"
  | "Debug";

/** A single transform step in a signal chain */
export interface TransformStep {
  /** Human-readable description (e.g., "Input(\"energy\")", "Smooth.Exponential(0.5, 2.0)") */
  description: string;
  /** The type of transform (for UI styling) */
  transform_type: TransformType;
  /** Signal ID for this step */
  signal_id: number;
}

/** Statistics for a transform step over a time window */
export interface StepStatistics {
  /** Minimum value in the window */
  min: number;
  /** Maximum value in the window */
  max: number;
  /** Mean value in the window */
  mean: number;
  /** Current value at center time */
  current_value: number;
}

/** Sampled data for a transform step */
export interface StepSamples {
  /** Sample times */
  times: number[];
  /** Sample values at each time */
  values: number[];
  /** Statistics computed from the samples */
  stats: StepStatistics;
}

/** Complete analysis result for a signal chain */
export interface SignalChainAnalysis {
  /** Ordered list of transform steps (root first, final last) */
  steps: TransformStep[];
  /** Sampled data for each step (parallel array with steps) */
  samples: StepSamples[];
  /** Time window that was analyzed [start, end] */
  time_range: [number, number];
}

/** Information about a signal variable in the script */
export interface ScriptSignalInfo {
  /** Variable name in the script */
  name: string;
  /** Line number where the signal is defined (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
}

/** Cursor context from Monaco editor */
export interface CursorContext {
  /** The signal variable name under/near the cursor, or null if none */
  signalName: string | null;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
}

/** Error result from signal analysis */
export interface AnalysisError {
  error: string;
}

/** Parse result from WASM - either success or error */
export type AnalysisResult = SignalChainAnalysis | AnalysisError;

/** Type guard for analysis error */
export function isAnalysisError(
  result: AnalysisResult
): result is AnalysisError {
  return "error" in result;
}
