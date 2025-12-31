// Types
export type {
  AnalysisError,
  AnalysisResult,
  CursorContext,
  ScriptSignalInfo,
  SignalChainAnalysis,
  StepSamples,
  StepStatistics,
  TransformStep,
  TransformType,
} from "./types";
export { isAnalysisError } from "./types";

// Cursor detection
export {
  cursorChangedSignal,
  detectSignalAtCursor,
} from "./cursorDetection";

// Analysis service
export {
  cancelPendingAnalysis,
  refreshCurrentSignal,
  requestSignalAnalysis,
  updateScriptSignals,
} from "./analysisService";
