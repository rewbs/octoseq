/**
 * Unified Stream Model — core types.
 *
 * Everything the user can analyse is a Stream:
 * - AudioStream (kind "mixdown" | "stem"): has backing audio (PCM lives in audioCache)
 * - BandStream  (kind "band"): a virtual stream over a frequency region of a parent
 *   AudioStream, with a time-varying frequency shape
 *
 * Analyses, signals, and events are addressed by StreamId uniformly. Band-ness is a
 * property of the stream — never of the cache key shape, the reference type, or the
 * UI panel. The analysis runner dispatches on `stream.kind`.
 *
 * See docs/design/phase1-unified-streams.md
 */

import type {
  BandCqt1DResult,
  BandCqtFunctionId,
  BandEventFunctionId,
  BandEventsResult,
  BandMir1DResult,
  BandMirFunctionId,
  FrequencyBand,
  FrequencyBandProvenance,
  FrequencyBandTimeScope,
  FrequencySegment,
  MirFunctionId,
  MirResult,
} from "@octoseq/mir";

// ----------------------------
// Streams
// ----------------------------

/** The mixdown stream always has this id. There is at most one mixdown. */
export const MIXDOWN_STREAM_ID = "mixdown";

export type StreamId = string;

export type StreamKind = "mixdown" | "stem" | "band";

export type AudioOrigin = "file" | "url" | "demo" | "cloud" | "generated";

/**
 * Reference to backing audio. Decoded PCM is intentionally NOT stored here — it lives
 * in the non-reactive audioCache, keyed by StreamId.
 */
export interface AudioReference {
  origin: AudioOrigin;
  /** Playable URL (object URL or remote). Null until resolved. */
  url: string | null;
  /** Cloud asset id when persisted. */
  assetId?: string;
  fileName?: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
}

interface StreamBase {
  id: StreamId;
  label: string;
  enabled: boolean;
  /** Stable ordering among siblings (stems globally; bands per parent). */
  sortOrder: number;
  createdAt: string;
  modifiedAt: string;
}

/** A stream backed by its own audio: the mixdown or a stem. */
export interface AudioStream extends StreamBase {
  kind: "mixdown" | "stem";
  audio: AudioReference;
}

/** A virtual stream defined as a (time-varying) frequency region of a parent stream. */
export interface BandStream extends StreamBase {
  kind: "band";
  /** Must reference an existing AudioStream. Bands of bands are not supported. */
  parentId: StreamId;
  timeScope: FrequencyBandTimeScope;
  frequencyShape: FrequencySegment[];
  provenance: FrequencyBandProvenance;
  color?: string;
}

export type Stream = AudioStream | BandStream;

export function isAudioStream(stream: Stream): stream is AudioStream {
  return stream.kind === "mixdown" || stream.kind === "stem";
}

export function isBandStream(stream: Stream): stream is BandStream {
  return stream.kind === "band";
}

// ----------------------------
// Analysis addressing
// ----------------------------

/**
 * The unified analysis namespace. The `band*`-prefixed function ids from @octoseq/mir
 * do NOT appear here: a band analysis is addressed by the same id as its full-stream
 * counterpart, and the runner picks the band-scoped implementation when the target
 * stream is a band.
 */
export type AnalysisId = MirFunctionId;

export type AnalysisParams = Record<string, number | string | boolean>;

/**
 * Everything the unified cache can hold. Band results keep their original shapes from
 * @octoseq/mir for now; consumers narrow on `kind`.
 */
export type AnalysisResult =
  | MirResult
  | BandMir1DResult
  | BandCqt1DResult
  | BandEventsResult;

/** Opaque cache key: `${streamId}::${analysisId}::${paramsHash}`. */
export type AnalysisKey = string;

const KEY_SEPARATOR = "::";

/**
 * Stable, order-insensitive hash of analysis params (FNV-1a, 8 hex chars).
 * Undefined or empty params hash to "default".
 */
export function stableParamsHash(params?: AnalysisParams): string {
  if (!params) return "default";
  const keys = Object.keys(params).sort();
  if (keys.length === 0) return "default";
  let hash = 0x811c9dc5;
  for (const key of keys) {
    const chunk = `${key}=${JSON.stringify(params[key])};`;
    for (let i = 0; i < chunk.length; i++) {
      hash ^= chunk.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function analysisKey(
  streamId: StreamId,
  analysisId: AnalysisId,
  params?: AnalysisParams
): AnalysisKey {
  return `${streamId}${KEY_SEPARATOR}${analysisId}${KEY_SEPARATOR}${stableParamsHash(params)}`;
}

/** Prefix shared by every AnalysisKey of a stream — used for invalidation scans. */
export function streamKeyPrefix(streamId: StreamId): string {
  return `${streamId}${KEY_SEPARATOR}`;
}

// ----------------------------
// Band implementation mapping
// ----------------------------

/**
 * Maps unified analysis ids to their band-scoped implementations in @octoseq/mir.
 * An analysis id absent from this map is not available on band streams.
 * Used by the unified analysis runner (task 2).
 */
export const BAND_ANALYSIS_IMPL: Partial<
  Record<AnalysisId, BandMirFunctionId | BandCqtFunctionId | BandEventFunctionId>
> = {
  amplitudeEnvelope: "bandAmplitudeEnvelope",
  onsetEnvelope: "bandOnsetStrength",
  spectralFlux: "bandSpectralFlux",
  spectralCentroid: "bandSpectralCentroid",
  cqtHarmonicEnergy: "bandCqtHarmonicEnergy",
  cqtBassPitchMotion: "bandCqtBassPitchMotion",
  cqtTonalStability: "bandCqtTonalStability",
  onsetPeaks: "bandOnsetPeaks",
  beatCandidates: "bandBeatCandidates",
};

/** Whether the given analysis can run on the given stream. */
export function supportsAnalysis(stream: Stream, analysisId: AnalysisId): boolean {
  if (isAudioStream(stream)) return true;
  return analysisId in BAND_ANALYSIS_IMPL;
}

/**
 * Adapter for @octoseq/mir's band-scoped functions, which still speak FrequencyBand.
 * The stream's parentId maps onto the legacy sourceId field.
 */
export function toFrequencyBand(band: BandStream): FrequencyBand {
  return {
    id: band.id,
    label: band.label,
    sourceId: band.parentId,
    enabled: band.enabled,
    timeScope: band.timeScope,
    frequencyShape: band.frequencyShape,
    sortOrder: band.sortOrder,
    provenance: band.provenance,
  };
}

// ----------------------------
// Signal & event addressing
// ----------------------------
// The full definitions port in task 5; the address shape is fixed here so new code
// can target it.

/** Streams own most signals; "project" scopes signals not tied to audio (e.g. composed). */
export type SignalScope = StreamId | "project";

export interface SignalAddress {
  scope: SignalScope;
  /** Namespaced id: "mir:<analysisId>" | "derived:<uuid>" | "composed:<uuid>". */
  signalId: string;
}

export interface EventStreamAddress {
  scope: SignalScope;
  /** Namespaced id: "mir:<analysisId>" | "authored:<uuid>" | "candidate:<uuid>". */
  eventStreamId: string;
}
