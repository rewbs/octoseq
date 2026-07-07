/**
 * Interpretation Package export — a pure function over store states that
 * mirrors VisualiserPanel's push layer 1:1 (same alias map, same
 * normalization, same feature names).
 *
 * See docs/design/phase3-interpretation-package.md. This module must stay free
 * of React imports: it reads Zustand stores via getState() so it is callable
 * from event handlers, workers, and tests alike.
 */

import type { AudioBufferLike, FrequencyBandStructure } from "@octoseq/mir";
import {
  MIXDOWN_STREAM_ID,
  analysisKey,
  audioCache,
  toFrequencyBand,
  useAnalysisStore,
  useStreamStore,
  type AnalysisId,
} from "@/lib/streams";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTimingStore } from "@/lib/stores/timingStore";
import { sampleToArray } from "@/lib/composedSignal/interpolate";
import { normalizeSignal } from "./normalizeSignal";
import type {
  InterpretationPackageV1,
  PackageBandEvents,
  PackageBandSignal,
  PackageComposedSignal,
  PackageCustomSignal,
  PackageEventStream,
  PackageSignal,
  PackageStemSignal,
} from "./types";

/**
 * Script-facing mixdown signal names → unified analysis ids.
 * MUST match VisualiserPanel's `signalMappings` exactly ("flux" aliases
 * "spectralFlux", "energy" aliases "onsetEnvelope", CQT aliases "harmonic",
 * "bassMotion", "tonal").
 *
 * "searchSimilarity" is deliberately absent: it is session-ephemeral search UI
 * state, not part of the interpretation.
 */
export const MIXDOWN_SIGNAL_MAPPINGS: Record<string, AnalysisId> = {
  spectralCentroid: "spectralCentroid",
  spectralFlux: "spectralFlux",
  flux: "spectralFlux",
  onsetEnvelope: "onsetEnvelope",
  energy: "onsetEnvelope",
  cqtHarmonicEnergy: "cqtHarmonicEnergy",
  harmonic: "cqtHarmonicEnergy",
  cqtBassPitchMotion: "cqtBassPitchMotion",
  bassMotion: "cqtBassPitchMotion",
  cqtTonalStability: "cqtTonalStability",
  tonal: "cqtTonalStability",
  activity: "activity",
  pitchF0: "pitchF0",
  pitchConfidence: "pitchConfidence",
};

/** Band analysis ids → script feature names (VisualiserPanel band featureMap). */
export const BAND_FEATURE_MAP: Partial<Record<AnalysisId, string>> = {
  amplitudeEnvelope: "energy",
  onsetEnvelope: "onset",
  spectralFlux: "flux",
  spectralCentroid: "centroid",
};

/** Stem analysis ids → script feature names (VisualiserPanel stem featureMap). */
export const STEM_FEATURE_MAP: Partial<Record<AnalysisId, string>> = {
  spectralCentroid: "centroid",
  spectralFlux: "flux",
  onsetEnvelope: "energy",
};

/**
 * The browser pushes full-rate PCM as "amplitude"; the package bakes a
 * max-abs-per-window envelope at this rate instead (design doc note), keeping
 * files small while preserving envelope semantics for visuals.
 */
export const AMPLITUDE_ENVELOPE_RATE_HZ = 200;

/** Composed signals are sampled at this rate, like the panel's push path. */
const COMPOSED_SIGNAL_RATE_HZ = 100;

/** Extract mono PCM from a decoded buffer, mirroring the panel's handling. */
function pcmFromBuffer(buffer: AudioBufferLike | null): Float32Array | null {
  if (!buffer) return null;
  const loose = buffer as Partial<AudioBufferLike> & { mono?: Float32Array };
  if (typeof loose.getChannelData === "function") {
    return loose.getChannelData(0);
  }
  // MirAudioPayload-style buffers carry a mono channel directly.
  if (loose.mono) return loose.mono;
  return null;
}

/**
 * Max-abs-per-window envelope of the PCM at ~AMPLITUDE_ENVELOPE_RATE_HZ,
 * normalized to [0, 1] with normalizeSignal (min-max, like every other signal
 * the panel pushes).
 */
export function amplitudeEnvelope(pcm: Float32Array, durationSec: number): Float32Array {
  const sampleCount = Math.max(1, Math.ceil(durationSec * AMPLITUDE_ENVELOPE_RATE_HZ));
  const envelope = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * pcm.length) / sampleCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * pcm.length) / sampleCount));
    let maxAbs = 0;
    for (let j = start; j < end && j < pcm.length; j++) {
      const abs = Math.abs(pcm[j] as number);
      if (abs > maxAbs) maxAbs = abs;
    }
    envelope[i] = maxAbs;
  }
  return normalizeSignal(envelope);
}

export interface ExportInterpretationPackageOptions {
  /**
   * Override the informational createdAt timestamp (also used for the
   * frequencyBands structure timestamps). Exists so tests/fixtures can be
   * byte-for-byte deterministic; production callers omit it.
   */
  createdAt?: string;
}

/**
 * Serialize the current interpretation state into an Interpretation Package.
 *
 * Pure function over getState() reads; throws if no mixdown is loaded (the
 * package is meaningless without a track duration).
 */
export function exportInterpretationPackage(
  options?: ExportInterpretationPackageOptions
): InterpretationPackageV1 {
  const streamState = useStreamStore.getState();
  const analysisResults = useAnalysisStore.getState().results;

  const mixdown = streamState.getMixdown();
  if (!mixdown) {
    throw new Error("exportInterpretationPackage: no mixdown loaded");
  }

  const buffer = audioCache.get(MIXDOWN_STREAM_ID);
  const pcm = pcmFromBuffer(buffer);

  // Duration resolution mirrors the panel: explicit duration first, then
  // PCM length / sample rate, then the panel's fallback of 1s.
  let durationSec = mixdown.audio.durationSec;
  if (!(durationSec > 0) && pcm && buffer && buffer.sampleRate > 0) {
    durationSec = pcm.length / buffer.sampleRate;
  }
  if (!(durationSec > 0)) durationSec = 1;

  const createdAt = options?.createdAt ?? new Date().toISOString();

  // ----------------------------
  // Mixdown signals (push_signal)
  // ----------------------------
  // NOTE: the panel additionally pushes beatPosition/beatIndex/beatPhase/bpm
  // signals precomputed from the musical time structure. The package instead
  // carries `musicalTime` itself; the CLI loader derives those signals from it
  // (same computeBeatPosition semantics) rather than shipping redundant arrays.
  const signals: PackageSignal[] = [];

  if (pcm && pcm.length > 0) {
    const envelope = amplitudeEnvelope(pcm, durationSec);
    signals.push({
      name: "amplitude",
      rate: envelope.length / durationSec,
      values: Array.from(envelope),
    });
  }

  for (const [signalName, analysisId] of Object.entries(MIXDOWN_SIGNAL_MAPPINGS)) {
    const result = analysisResults.get(analysisKey(MIXDOWN_STREAM_ID, analysisId));
    if (!result) continue;

    let data: Float32Array | null = null;
    if (result.kind === "1d") {
      data = result.values;
    } else if (result.kind === "activity") {
      data = result.activityLevel;
    }
    if (!data || data.length === 0) continue;

    const norm = normalizeSignal(data);
    signals.push({
      name: signalName,
      rate: norm.length / durationSec,
      values: Array.from(norm),
    });
  }

  // ----------------------------
  // Band signals + band events
  // ----------------------------
  const bands = streamState.getBands();

  const bandSignals: PackageBandSignal[] = [];
  for (const band of bands) {
    for (const [analysisId, feature] of Object.entries(BAND_FEATURE_MAP)) {
      const result = analysisResults.get(analysisKey(band.id, analysisId as AnalysisId));
      if (!result || result.kind !== "bandMir1d") continue;
      if (result.values.length === 0) continue;

      const norm = normalizeSignal(result.values);
      bandSignals.push({
        bandId: band.id,
        label: band.label,
        feature,
        // The panel derives the rate from the times axis; values/times are the
        // same length for 1D band results.
        rate: result.times.length / durationSec,
        values: Array.from(norm),
      });
    }
  }

  const bandEvents: PackageBandEvents[] = [];
  for (const band of bands) {
    const eventResult = analysisResults.get(analysisKey(band.id, "onsetPeaks"));
    if (!eventResult || eventResult.kind !== "bandEvents") continue;
    if (eventResult.events.length === 0) continue;
    bandEvents.push({
      bandId: band.id,
      events: eventResult.events.map((e) => ({ time: e.time, weight: e.weight })),
    });
  }

  // ----------------------------
  // Stem signals + available stems
  // ----------------------------
  const stems = streamState.getStems();

  const stemSignals: PackageStemSignal[] = [];
  for (const stem of stems) {
    for (const [analysisId, feature] of Object.entries(STEM_FEATURE_MAP)) {
      const result = analysisResults.get(analysisKey(stem.id, analysisId as AnalysisId));
      if (!result || result.kind !== "1d") continue;
      if (result.values.length === 0) continue;

      const norm = normalizeSignal(result.values);
      stemSignals.push({
        stemId: stem.id,
        label: stem.label,
        feature,
        rate: result.times.length / durationSec,
        values: Array.from(norm),
      });
    }
  }

  const availableStems: Array<[string, string]> = stems.map((s) => [s.id, s.label]);

  // ----------------------------
  // Detected event streams (mixdown)
  // ----------------------------
  const eventStreams: PackageEventStream[] = [];

  const beatCandidatesResult = analysisResults.get(
    analysisKey(MIXDOWN_STREAM_ID, "beatCandidates")
  );
  if (beatCandidatesResult && beatCandidatesResult.kind === "beatCandidates") {
    eventStreams.push({
      name: "beatCandidates",
      events: beatCandidatesResult.candidates.map((c) => ({
        time: c.time,
        weight: c.strength,
        beat_position: null,
        beat_phase: null,
        cluster_id: null,
      })),
    });
  }

  const onsetPeaksResult = analysisResults.get(analysisKey(MIXDOWN_STREAM_ID, "onsetPeaks"));
  if (onsetPeaksResult && onsetPeaksResult.kind === "events") {
    eventStreams.push({
      name: "onsetPeaks",
      events: onsetPeaksResult.events.map((e) => ({
        time: e.time,
        weight: e.strength,
        beat_position: null,
        beat_phase: null,
        cluster_id: null,
      })),
    });
  }

  // ----------------------------
  // Authored event streams
  // ----------------------------
  const authoredEventStreams = useAuthoredEventStore
    .getState()
    .getAllStreams()
    .map((stream) => ({
      name: stream.name,
      events: stream.events.map((e) => ({
        time: e.time,
        weight: e.weight,
        beat_position: e.beatPosition,
        beat_phase: null,
        cluster_id: null,
      })),
    }));

  // ----------------------------
  // Composed signals (pre-sampled, like the panel's push path)
  // ----------------------------
  const composedSignals: PackageComposedSignal[] = [];
  const bpm = useTimingStore.getState().selectedHypothesis?.bpm ?? null;
  if (bpm !== null) {
    for (const signal of useComposedSignalStore.getState().getEnabledSignals()) {
      const values = sampleToArray(
        signal.nodes,
        COMPOSED_SIGNAL_RATE_HZ,
        durationSec,
        bpm,
        signal.valueMin,
        signal.valueMax
      );
      if (values.length === 0) continue;
      composedSignals.push({
        name: signal.name,
        rate: values.length / durationSec,
        values: Array.from(values),
      });
    }
  }

  // ----------------------------
  // Derived ("custom") signals
  // ----------------------------
  // The panel pushes already-computed results from the derived-signal result
  // cache (computation itself is hook-driven, but the cache is plain store
  // state). Signals without a computed result are skipped, same as the panel.
  const derivedState = useDerivedSignalStore.getState();
  const customSignals: PackageCustomSignal[] = [];
  for (const signal of derivedState.structure?.signals ?? []) {
    if (!signal.enabled) continue;
    const result = derivedState.getSignalResult(signal.id);
    if (!result || result.status !== "computed" || !result.values) continue;
    if (result.values.length === 0) continue;
    customSignals.push({
      id: signal.id,
      name: signal.name,
      rate: result.values.length / durationSec,
      values: Array.from(result.values),
    });
  }

  // ----------------------------
  // Musical time
  // ----------------------------
  // The authoritative structure from the timing store. NOTE: the live panel
  // also falls back to a provisional structure synthesized from the active
  // (unpromoted) beat grid; the package intentionally exports only committed
  // musical time.
  const timingStructure = useTimingStore.getState().structure;
  const musicalTime =
    timingStructure && timingStructure.segments.length > 0 ? timingStructure : null;

  // ----------------------------
  // Frequency bands (as set_frequency_bands expects)
  // ----------------------------
  const frequencyBands: FrequencyBandStructure | null =
    bands.length > 0
      ? {
          version: 2,
          bands: bands.map(toFrequencyBand),
          createdAt,
          modifiedAt: createdAt,
        }
      : null;

  // ----------------------------
  // Script + project metadata
  // ----------------------------
  const project = useProjectStore.getState().activeProject;
  const activeScript = project?.scripts.activeScriptId
    ? (project.scripts.scripts.find((s) => s.id === project.scripts.activeScriptId) ?? null)
    : null;

  return {
    formatVersion: 1,
    createdAt,
    projectName: project?.name,
    durationSec,
    script: activeScript?.content ?? null,
    signals,
    bandSignals,
    stemSignals,
    customSignals,
    composedSignals,
    eventStreams,
    authoredEventStreams,
    bandEvents,
    musicalTime,
    frequencyBands,
    availableStems,
  };
}
