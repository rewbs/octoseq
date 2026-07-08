/**
 * Display-edge transforms for analysis results.
 *
 * The unified analysisStore holds RAW results. The legacy mirStore baked
 * waveform-display normalization into cached values at store time, which destroyed
 * the raw data for other consumers (e.g. the WASM signal feed re-normalized
 * already-normalized values). Components now normalize here, at render time,
 * memoized per result object.
 */

import { normaliseForWaveform } from "@octoseq/mir";
import type { TempoHypothesis } from "@octoseq/mir";
import type { AnalysisId, AnalysisResult } from "./types";

export interface DisplaySignal {
  times: Float32Array;
  values: Float32Array;
}

const displayMemo = new WeakMap<object, DisplaySignal>();

/**
 * Per-analysis display normalization options, mirroring the legacy
 * useMirActions rules: centroid is centered, flux is symmetric around 0.
 */
function displayOptionsFor(analysisId: AnalysisId): {
  center?: boolean;
  min?: number;
  max?: number;
} {
  if (analysisId === "spectralCentroid") return { center: true };
  if (analysisId === "spectralFlux") return { min: -1, max: 1 };
  return {};
}

/**
 * Extract a waveform-displayable {times, values} from any 1D-shaped analysis
 * result, normalized to the waveform range. Returns null for results without a
 * 1D signal (2d, events, tempoHypotheses).
 */
export function toDisplaySignal(
  result: AnalysisResult,
  analysisId: AnalysisId
): DisplaySignal | null {
  const memoized = displayMemo.get(result);
  if (memoized) return memoized;

  let raw: { times: Float32Array; values: Float32Array } | null = null;
  if (result.kind === "1d" || result.kind === "bandMir1d" || result.kind === "bandCqt1d") {
    raw = { times: result.times, values: result.values };
  } else if (result.kind === "activity") {
    raw = { times: result.times, values: result.activityLevel };
  }
  if (!raw) return null;

  const display: DisplaySignal = {
    times: raw.times,
    values: normaliseForWaveform(raw.values, displayOptionsFor(analysisId)),
  };
  displayMemo.set(result, display);
  return display;
}

/**
 * Legacy display shape adapter. Components built against mirStore's UiMirResult
 * consume raw unified results through this without churn: 1D values come out
 * display-normalized, beatCandidates/activity collapse to the events/1d shapes
 * the UI always rendered, band results flatten to plain 1d.
 */
export type UiDisplayResult =
  | { kind: "1d"; fn: AnalysisId; times: Float32Array; values: Float32Array }
  | {
      kind: "2d";
      fn: AnalysisId;
      raw: { data: Float32Array[]; times: Float32Array };
    }
  | {
      kind: "events";
      fn: AnalysisId;
      times: Float32Array;
      events: Array<{ time: number; strength: number; index: number }>;
    }
  | {
      kind: "tempoHypotheses";
      fn: AnalysisId;
      hypotheses: TempoHypothesis[];
      inputCandidateCount: number;
    };

const uiResultMemo = new WeakMap<object, UiDisplayResult | null>();

export function toUiResult(result: AnalysisResult, analysisId: AnalysisId): UiDisplayResult | null {
  if (uiResultMemo.has(result)) return uiResultMemo.get(result) ?? null;

  let ui: UiDisplayResult | null = null;
  if (
    result.kind === "1d" ||
    result.kind === "activity" ||
    result.kind === "bandMir1d" ||
    result.kind === "bandCqt1d"
  ) {
    const display = toDisplaySignal(result, analysisId);
    ui = display
      ? { kind: "1d", fn: analysisId, times: display.times, values: display.values }
      : null;
  } else if (result.kind === "2d") {
    ui = { kind: "2d", fn: analysisId, raw: { data: result.data, times: result.times } };
  } else if (result.kind === "events" || result.kind === "beatCandidates" || result.kind === "bandEvents") {
    const events = toDisplayEvents(result) ?? [];
    const times = result.kind === "bandEvents" ? new Float32Array(0) : result.times;
    ui = { kind: "events", fn: analysisId, times, events };
  } else if (result.kind === "tempoHypotheses") {
    ui = {
      kind: "tempoHypotheses",
      fn: analysisId,
      hypotheses: result.hypotheses,
      inputCandidateCount: result.inputCandidateCount,
    };
  }

  uiResultMemo.set(result, ui);
  return ui;
}

export interface DisplayEvent {
  time: number;
  strength: number;
  index: number;
}

const eventsMemo = new WeakMap<object, DisplayEvent[]>();

/**
 * Extract a uniform event list from any events-shaped analysis result
 * (onset peaks, beat candidates, band events). Returns null otherwise.
 */
export function toDisplayEvents(result: AnalysisResult): DisplayEvent[] | null {
  const memoized = eventsMemo.get(result);
  if (memoized) return memoized;

  let events: DisplayEvent[] | null = null;
  if (result.kind === "events") {
    events = result.events.map((e, i) => ({ time: e.time, strength: e.strength, index: i }));
  } else if (result.kind === "beatCandidates") {
    events = result.candidates.map((c, i) => ({ time: c.time, strength: c.strength, index: i }));
  } else if (result.kind === "bandEvents") {
    events = result.events.map((e, i) => ({ time: e.time, strength: e.weight, index: i }));
  }
  if (!events) return null;

  eventsMemo.set(result, events);
  return events;
}
