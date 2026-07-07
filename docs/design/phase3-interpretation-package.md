# Phase 3: Interpretation Package v1

Status: in progress (June 2026). Milestones P1/P4: the bridge between the web "lab"
and headless rendering becomes a real, versioned artifact.

## Problem

The browser feeds the visualiser through per-session push calls
(`push_signal`, `push_band_signal`, `push_stem_signal`, `push_custom_signal`,
`push_composed_signal`, `push_event_stream`, `push_authored_event_stream`,
`push_band_events`, `set_musical_time`, `set_frequency_bands`,
`set_available_stems`, `load_script`). The CLI accepts one raw float array —
so nothing authored in the lab can be rendered offline.

## Design

**The package is the push contract, serialized.** One JSON file that the web app
exports and the CLI ingests; the same script sees the same inputs in both.

```ts
interface InterpretationPackageV1 {
  formatVersion: 1;
  createdAt: string;            // informational only
  projectName?: string;
  durationSec: number;          // default render duration
  script: string | null;        // active Rhai script

  // Signal payloads — names/features EXACTLY as the browser pushes them,
  // so scripts behave identically. `values` at explicit `rate` (Hz).
  signals: Array<{ name: string; rate: number; values: number[] }>;
  bandSignals: Array<{ bandId: string; label: string; feature: string; rate: number; values: number[] }>;
  stemSignals: Array<{ stemId: string; label: string; feature: string; rate: number; values: number[] }>;
  customSignals: Array<{ id: string; name: string; rate: number; values: number[] }>;
  composedSignals: Array<{ name: string; rate: number; values: number[] }>;

  // Event payloads — the same JSON element shapes the push functions parse.
  eventStreams: Array<{ name: string; events: PackageEvent[] }>;
  authoredEventStreams: Array<{ name: string; events: PackageEvent[] }>;
  bandEvents: Array<{ bandId: string; events: Array<{ time: number; weight: number }> }>;

  musicalTime: MusicalTimeStructure | null;     // as set_musical_time expects
  frequencyBands: FrequencyBandStructure | null; // as set_frequency_bands expects
  availableStems: Array<[string, string]>;       // [id, label] pairs
}

type PackageEvent = {
  time: number; weight: number;
  beat_position?: number | null; beat_phase?: number | null; cluster_id?: number | null;
};
```

Notes:

- **Amplitude**: the browser pushes full-rate PCM as `amplitude`; the package bakes a
  max-abs-per-window envelope at 200 Hz (normalized [0,1] like `normalizeSignal`),
  keeping files small while preserving envelope semantics for visuals.
- All other signals are MIR frame rate (~40–90 Hz) — plain JSON numbers are fine.
- Rust mirrors the schema with serde (field names match exactly; unknown fields
  ignored; `formatVersion !== 1` is a hard error).

## Web side

`apps/web/src/lib/package/exportInterpretationPackage.ts` — a pure function over
store states that mirrors VisualiserPanel's push layer 1:1 (same alias map, same
normalization, same feature names). Download button in ProjectInspector.

## CLI side

`packages/visualiser/src/interpretation_package.rs` — serde parse + a loaded
runtime bundle (SignalMap / BandSignalMap / custom SignalMap / musical time /
stems / bands / event streams) applied to `VisualiserState` exactly as the
wasm push functions do. `visualiser render --package pkg.json --out frames/`
(package supplies script and duration; explicit `--script`/`--duration` override;
`--input` remains for the legacy single-signal path).

## Validation

- TS: vitest over seeded stores; asserts names/rates/shapes match the push layer.
- Rust: unit tests parsing fixtures; error cases (bad version, malformed).
- End-to-end: a package exported by the TS function renders PNG frames via the
  native CLI on a real GPU.
