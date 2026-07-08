# Phase 2: UI Shell on the Unified Stream Model

Status: **complete** (June 2026) — Stream Manager, Comparison Panel, view presets,
and shell integration all landed; validated via typecheck, vitest, production build,
and headless-Chrome render. Builds directly on
[phase1-unified-streams.md](phase1-unified-streams.md) — the data model is done;
this phase makes the UI generic over it.

## Problem

Phase 1 unified the model, but the UI still reflects the old fragmentation:

- Stream management is scattered: stems in `StemsInspector`/`StemManagementContent`,
  bands in `BandsInspector`/`BandInspector`/band sidebar, audio in
  `AudioSourceInspector` — all reachable only through single-select tree navigation.
- Comparison across streams is structurally impossible: one `visualTab` × one
  `displayContextInputId` at a time. `BandMirSignalViewer` stacks bands, but only
  bands, and only for the one selected analysis family.
- `page.tsx` is still a 1,400-line layout god-component.

## Deliverables

### 1. Stream Manager (milestone S3)

One mixer-style panel managing ALL streams, stacked in the main column (same
rounded-card pattern as `DerivedSignalsPanel`):

```
▾ Streams                                    [+ Stem] [+ Band]
  ● Mixdown            drums.mp3    3:42   [analyses ✓] [≡]
  ├ ▣ Bass    20–250Hz   ■color  [solo][mute][✓on]  [✓]
  ├ ▣ Highs   2k–8kHz    ■color  [solo][mute][✓on]  […pending]
  ● Drums (stem)                  3:42   [analyses ✓] [≡]
  └ ▣ Kick    40–120Hz   ■color  [solo][mute][✓on]  [—]
```

- Rows: mixdown first, stems by sortOrder; band rows nested under their parent.
- Inline rename, enable toggle, band color swatch, solo/mute (bandEditingStore),
  dnd-kit reorder within sibling groups, remove with 5s undo (PCM re-seeded on
  undo, as StemManagementContent does), add stem (file import via existing flow),
  add band under any audio stream.
- Per-stream analysis status chip: none / pending / n results (from analysisStore).
- Row click selects the stream (streamStore.selectStream) so the tree/inspector
  follow; compare checkbox adds it to the comparison set (viewStore).

### 2. Comparison Panel (milestones U2-lite)

Stacked, viewport-synced signal rows for ANY set of streams × one chosen analysis:

- Selection = `viewStore.comparedStreamIds` (checkboxes in Stream Manager + chips
  in the panel header).
- Analysis picker over `mirTabDefinitions` (1d + events kinds; 2d excluded).
- Rows generalize `BandMirSignalViewer`'s canvas row to any stream kind via
  `toDisplaySignal`/`toDisplayEvents` — mixdown, stems, and bands render
  identically. Missing results show a "run" affordance (runStreamAnalysis).
- Shares `viewport`, mirrored cursor, and beat-grid overlay with the main player.

### 3. View state (`lib/streams/viewStore.ts`)

Ephemeral view state, NOT persisted (presets — task 13 — will snapshot it into
project uiState):

- `comparedStreamIds: Set<StreamId>`, `comparisonAnalysisId: AnalysisId`
- `streamManagerOpen`, `comparisonOpen`
- Convenience: `toggleCompared(id)`, `compareBandsOf(parentId)`, `clearCompared()`
- Removed streams are pruned from the compared set by `removeStreamCascade`.

### 4. Shell integration

- New panels render in the main column above `DerivedSignalsPanel`.
- `StemsInspector` and the stems-section inspector route point at the Stream
  Manager ("manage in the Streams panel") — management UI is no longer
  inspector-buried. Band keyframe AUTHORING (FrequencyBandContent keyframe table,
  heatmap overlay editing) stays where it is: it's authoring, not management.
- page.tsx: new panels mount as siblings; extraction of existing JSX happens
  opportunistically, not as a big-bang rewrite.

## Non-goals

- No redesign of the interpretation tree, inspector routing, or visualiser panel.
- No Rust/WASM changes.
- Full display-template system (U8) reduced to minimal named presets (task 13).
