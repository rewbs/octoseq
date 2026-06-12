/**
 * Stream Actions — coordinated mutations across streamStore, analysisStore, and
 * audioCache.
 *
 * This module is the public mutation API for stream-related changes. It replaces the
 * old BandInvalidationEvent listener bus: instead of stores subscribing to each other,
 * every mutation that affects derived data performs the invalidation explicitly and
 * synchronously here.
 *
 * Invalidation rules (see docs/design/phase1-unified-streams.md):
 * - Band shape/timeScope edit      → invalidate that band stream
 * - Stream audio replaced          → invalidate stream + dependent bands
 * - Stream removed                 → invalidate removed stream(s), drop cached PCM
 * - Label/color/enabled edits      → no invalidation (no recompute needed)
 *
 * Plain module (not a hook): callable from React handlers, workers callbacks, and
 * tests alike via Zustand's getState().
 */

import type { AudioBufferLike, FrequencyBand } from "@octoseq/mir";
import { audioCache } from "./audioCache";
import { useAnalysisStore } from "./analysisStore";
import { useStreamStore, type AddBandParams, type BandShapePatch } from "./streamStore";
import {
  MIXDOWN_STREAM_ID,
  type AudioReference,
  type BandStream,
  type Stream,
  type StreamId,
} from "./types";

function invalidateStreamAndDependents(id: StreamId): void {
  const analysis = useAnalysisStore.getState();
  analysis.invalidateStream(id);
  for (const band of useStreamStore.getState().getBands(id)) {
    analysis.invalidateStream(band.id);
  }
}

/**
 * Load (or replace) the mixdown audio. Replacing invalidates the mixdown's analyses
 * and those of every band whose parent is the mixdown.
 */
export function loadMixdown(params: {
  audio: AudioReference;
  buffer: AudioBufferLike;
  label?: string;
}): void {
  useStreamStore.getState().initializeMixdown({ audio: params.audio, label: params.label });
  audioCache.set(MIXDOWN_STREAM_ID, params.buffer);
  invalidateStreamAndDependents(MIXDOWN_STREAM_ID);
}

/** Add a stem with its decoded audio. Returns the new StreamId. */
export function addStemWithAudio(params: {
  label: string;
  audio: AudioReference;
  buffer: AudioBufferLike;
}): StreamId {
  const id = useStreamStore.getState().addStem({ label: params.label, audio: params.audio });
  audioCache.set(id, params.buffer);
  return id;
}

/** Add a band stream. No invalidation needed — it has no analyses yet. */
export function addBand(params: AddBandParams): StreamId {
  return useStreamStore.getState().addBand(params);
}

/** Replace an AudioStream's audio: updates the reference, the PCM, and invalidates. */
export function replaceStreamAudio(
  id: StreamId,
  audio: AudioReference,
  buffer: AudioBufferLike
): void {
  useStreamStore.getState().updateAudio(id, audio);
  audioCache.set(id, buffer);
  invalidateStreamAndDependents(id);
}

/** Edit a band's frequency geometry and invalidate its analyses. */
export function updateBandShape(id: StreamId, patch: BandShapePatch): void {
  useStreamStore.getState().updateBandShape(id, patch);
  useAnalysisStore.getState().invalidateStream(id);
}

/**
 * Remove a stream, cascading to dependent bands. Drops analyses and cached PCM for
 * everything removed. Returns the removed streams for undo (restore via
 * useStreamStore restoreStreams; analyses recompute on demand).
 */
export function removeStreamCascade(id: StreamId): Stream[] {
  const removed = useStreamStore.getState().removeStream(id);
  const analysis = useAnalysisStore.getState();
  for (const stream of removed) {
    analysis.invalidateStream(stream.id);
    audioCache.delete(stream.id);
  }
  return removed;
}

/** Clear all stream state: collection, analyses, and cached PCM. */
export function resetAllStreams(): void {
  useStreamStore.getState().reset();
  useAnalysisStore.getState().reset();
  audioCache.clear();
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
