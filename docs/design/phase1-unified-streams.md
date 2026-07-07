# Phase 1: Unified Stream Model

Status: **complete** (June 2026). All eight tasks landed: core model, unified runner,
audio/stem flows, band authoring, signal/event addressing, timing consolidation,
project schema v2, WASM feed rewire + legacy deletion. Backwards compatibility with
existing saved projects was explicitly **not** a goal — old projects fail loudly on load.

## Problem

The web app grew accretively: mixdown was the original first-class citizen, and stems,
frequency bands, derived signals, and composed signals were each bolted on as parallel
store/cache/UI code paths. Concretely:

- 3 parallel MIR result paths: `mirStore.mirResults` (legacy mixdown),
  `mirStore.inputMirCache` (per-input), `bandMirStore` (4 separate caches:
  `cache`, `cqtCache`, `typedEventCache`, `eventCache`).
- Provenance-shaped reference types that force every consumer to branch:
  `Signal1DRef = {type:"mir", audioSourceId, fn} | {type:"band", bandId, fn} | {type:"derived", signalId}`.
- A string-event invalidation bus (`BandInvalidationEvent` + dynamic `require()`) keeping
  band caches coherent with band edits.
- UI that mirrors the fragmentation: hardcoded band-vs-mixdown tab conditionals in
  `page.tsx`, single-select band UI, bespoke panels per category.

Most observed bug classes live in the synchronization fabric between these paths.

## Core idea

**Everything the user can analyse is a Stream.** One collection, one analysis cache, one
address scheme. Band-ness is a property of the stream, not of the analysis, the cache,
the signal reference, or the UI panel.

```
Stream
├── AudioStream (kind: "mixdown" | "stem")   — has backing audio (PCM in audioCache)
└── BandStream  (kind: "band")               — virtual: parentId + time-varying frequency shape
```

- Exactly one `mixdown` stream (constant id `"mixdown"`).
- `BandStream.parentId` must reference an existing AudioStream (band-of-band is
  intentionally disallowed for now; the model permits lifting this later).
- Per-stem bands (README milestone S5) fall out for free: a band's parent can be any
  AudioStream.
- Removing a stream cascades to its dependent band streams.

## Analysis addressing

One namespace, one cache. The `band*`-prefixed MIR function ids disappear from the
addressing layer; the runner dispatches on `stream.kind`:

```
AnalysisKey = `${streamId}::${analysisId}::${paramsHash}`
```

- `analysisId` is the unified id (`amplitudeEnvelope`, `onsetEnvelope`,
  `cqtHarmonicEnergy`, …). For band streams the runner maps to the band-scoped
  implementation in `@octoseq/mir` (`bandAmplitudeEnvelope`, `bandOnsetStrength`,
  `bandCqtHarmonicEnergy`, …) using the parent's audio + the band's frequency shape.
- `paramsHash` is an FNV-1a hash of key-sorted params; `"default"` when no params.
- Invalidation is a prefix scan: `invalidateStream(streamId)` drops every key for that
  stream. No event bus, no listener registry.

Invalidation rules (enforced by the coordinated actions layer, not by store-to-store
subscriptions):

| Mutation                       | Invalidates                                  |
| ------------------------------ | -------------------------------------------- |
| Band shape/timeScope edit      | that band stream                             |
| Stream audio replaced          | that stream + all bands with parentId = it   |
| Stream removed                 | that stream + dependent bands (cascade)      |
| Band label/color/enabled edit  | nothing (no recompute needed)                |

## Signal & event addressing (task 5)

All consumable time-series get one address shape:

```
SignalAddress      = { scope: StreamId | "project", signalId: string }
EventStreamAddress = { scope: StreamId | "project", streamKey: string }
```

`signalId` is namespaced by provenance only for resolution, not for branching:
`mir:onsetEnvelope`, `derived:<uuid>`, `composed:<uuid>`. Composed signals are
project-scoped (curves over the beat grid, not tied to audio).

## Target store layout (~7 stores, from 23)

| Store              | Contents                                                            | Persisted |
| ------------------ | ------------------------------------------------------------------- | --------- |
| `streamStore`      | Stream collection (mixdown/stems/bands incl. band defs), selection | yes       |
| `analysisStore`    | Unified analysis cache: results/pending/errors                      | no (derived) |
| `signalStore`      | Derived + composed signal definitions, unified addresses            | yes       |
| `eventStore`       | Authored + candidate event streams                                  | yes (authored) |
| `timingStore`      | Beat grid / musical time / manual tempo (merger of 3 stores)        | yes       |
| `playbackStore`    | Transport, viewport (kept largely as-is)                            | no        |
| `projectStore`     | Project lifecycle, schema v2 serialization, autosave                | —         |

Non-reactive companions (not Zustand):
- `audioCache` — decoded PCM keyed by StreamId. Large buffers stay out of reactive
  state and devtools serialization.

Ephemeral UI state (config, inspection, tree expansion, script errors) consolidates
into a `uiStore` opportunistically during the port.

## What gets deleted by end of phase

`audioInputStore`, `frequencyBandStore` (+ invalidation bus), `bandMirStore`,
`mirStore` (both paths), `bandProposalStore` (re-target proposals to emit BandStreams),
`musicalTimeStore`/`beatGridStore`/`manualTempoStore` (merged), the provenance unions in
`types/derivedSignal.ts`, the band-vs-mixdown conditionals in `page.tsx`, and the
signal-name alias map in `VisualiserPanel.tsx` (silent drops become explicit errors).

## Non-goals for Phase 1

- No Rust/WASM API changes (the `push_signal`/`push_band_signal` surface stays; only the
  TS feeding layer changes). Engine-side unification is Phase 3/4.
- No new UI design (that's Phase 2) — existing panels are rewired, not redesigned.
- No data migration from v1 project blobs.

## Migration order

Mirrors the session task list: core model → unified runner → audio/stem flows → band
authoring → signal/event addressing → timing merge → project schema v2 → WASM feed
rewire + legacy deletion. The app may be transiently broken mid-port on this branch
(direct rewire, no adapter shims — agreed 2026-06-13).
