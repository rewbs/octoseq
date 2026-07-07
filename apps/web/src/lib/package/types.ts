/**
 * Interpretation Package v1 — the push contract, serialized.
 *
 * One JSON file that the web app exports and the native CLI ingests; the same
 * script sees the same inputs in both. The shapes below mirror
 * docs/design/phase3-interpretation-package.md exactly — signal names/features
 * are EXACTLY as VisualiserPanel pushes them, and event elements use the same
 * JSON element shapes the WASM push functions parse.
 */

import type { FrequencyBandStructure, MusicalTimeStructure } from "@octoseq/mir";

/**
 * Event element shape shared by `eventStreams` and `authoredEventStreams`.
 * Matches the JSON elements VisualiserPanel passes to push_event_stream /
 * push_authored_event_stream (snake_case keys are part of the wire format).
 */
export type PackageEvent = {
  time: number;
  weight: number;
  beat_position?: number | null;
  beat_phase?: number | null;
  cluster_id?: number | null;
};

/** Mixdown-level signal (push_signal). */
export interface PackageSignal {
  name: string;
  rate: number;
  values: number[];
}

/** Per-band feature signal (push_band_signal). */
export interface PackageBandSignal {
  bandId: string;
  label: string;
  feature: string;
  rate: number;
  values: number[];
}

/** Per-stem feature signal (push_stem_signal). */
export interface PackageStemSignal {
  stemId: string;
  label: string;
  feature: string;
  rate: number;
  values: number[];
}

/** Derived ("custom") signal (push_custom_signal). */
export interface PackageCustomSignal {
  id: string;
  name: string;
  rate: number;
  values: number[];
}

/** Composed signal, pre-sampled to an array (push_composed_signal). */
export interface PackageComposedSignal {
  name: string;
  rate: number;
  values: number[];
}

/** Detected event stream (push_event_stream). */
export interface PackageEventStream {
  name: string;
  events: PackageEvent[];
}

/** Human-authored event stream (push_authored_event_stream). */
export interface PackageAuthoredEventStream {
  name: string;
  events: PackageEvent[];
}

/** Per-band detected events (push_band_events). */
export interface PackageBandEvents {
  bandId: string;
  events: Array<{ time: number; weight: number }>;
}

export interface InterpretationPackageV1 {
  formatVersion: 1;
  /** Informational only. */
  createdAt: string;
  projectName?: string;
  /** Default render duration. */
  durationSec: number;
  /** Active Rhai script. */
  script: string | null;

  // Signal payloads — names/features EXACTLY as the browser pushes them,
  // so scripts behave identically. `values` at explicit `rate` (Hz).
  signals: PackageSignal[];
  bandSignals: PackageBandSignal[];
  stemSignals: PackageStemSignal[];
  customSignals: PackageCustomSignal[];
  composedSignals: PackageComposedSignal[];

  // Event payloads — the same JSON element shapes the push functions parse.
  eventStreams: PackageEventStream[];
  authoredEventStreams: PackageAuthoredEventStream[];
  bandEvents: PackageBandEvents[];

  /** As set_musical_time expects. */
  musicalTime: MusicalTimeStructure | null;
  /** As set_frequency_bands expects. */
  frequencyBands: FrequencyBandStructure | null;
  /** [id, label] pairs, as set_available_stems expects. */
  availableStems: Array<[string, string]>;
}
