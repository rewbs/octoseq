# Scripting API Audit & Repair Plan

This document inventories all script-relevant data sources and defines the canonical namespace structure for the Octoseq scripting API.

## Part 1: Complete Inventory of Script-Relevant Data Sources

### 1.1 Audio Sources

| Source | Location | UI Visible | Script Access Needed |
|--------|----------|------------|---------------------|
| Mixdown | `audioInputStore.collection.inputs["mixdown"]` | Yes | `inputs.*` (global signals) |
| Stems | `audioInputStore.collection.inputs[stemId]` | Yes | `inputs.stems[id\|label].*` |

### 1.2 MIR-Derived 1D Signals (per audio source)

| Signal | Description | Available For |
|--------|-------------|---------------|
| `amplitudeEnvelope` / `energy` | Loudness envelope | mixdown, stems |
| `spectralCentroid` | Spectral brightness | mixdown, stems |
| `spectralFlux` / `flux` | Rate of spectral change | mixdown, stems |
| `onsetEnvelope` | Transient detection | mixdown, stems |
| `cqtHarmonicEnergy` | Harmonic energy (CQT-based) | mixdown |
| `cqtBassPitchMotion` | Bass pitch trajectory | mixdown |
| `cqtTonalStability` | Tonal stability measure | mixdown |

### 1.3 Frequency Bands

| Data | Location | UI Visible | Script Access Needed |
|------|----------|------------|---------------------|
| Band definitions | `frequencyBandStore.bands` | Yes | `inputs.bands[id\|label]` |
| Band MIR signals | `bandMirStore` per band | Yes | `inputs.bands[id].{energy,onset,flux,amplitude}` |
| Band events | Extracted from band MIR | Yes | `inputs.bands[id].events` |

**Note**: Bands can have `sourceId` pointing to either "mixdown" OR a stem ID.

### 1.4 Custom Signals

| Data | Location | UI Visible | Script Access Needed |
|------|----------|------------|---------------------|
| Custom signal definitions | `customSignalStore.structure.signals` | Yes | `inputs.customSignals[id\|name]` |
| Custom signal results | `customSignalStore.resultCache` | Yes | As 1D signal data |

**Custom Signal Properties**:
- `id`: Unique identifier
- `name`: User-editable name
- `sourceAudioId`: "mixdown" or stem ID
- `source2DFunction`: melSpectrogram, hpssHarmonic, hpssPercussive, mfcc, etc.
- `reductionAlgorithm`: mean, max, amplitude, spectralFlux, spectralCentroid, onsetStrength
- Computed `times` and `values` arrays

### 1.5 Event Streams

| Stream Type | Location | UI Visible | Script Access Needed |
|-------------|----------|------------|---------------------|
| Named system events | `mirStore` (beatCandidates, onsetPeaks) | Yes | `inputs.mix.{streamName}` |
| Band events | Per-band extracted events | Yes | `inputs.mix.bands[id].{beatCandidates,onsetPeaks}` |
| Authored events | `authoredEventStore.streams` | Yes | `inputs.customEvents[name]` |
| Candidate events | `candidateEventStore` (ephemeral) | Yes | Not needed (ephemeral) |

### 1.6 Musical Time & Beat Information

| Data | Location | UI Visible | Script Access Needed |
|------|----------|------------|---------------------|
| Beat grid | `beatGridStore.activeBeatGrid` | Yes | `timing.beatPosition`, `timing.beatPhase`, `timing.bpm` |
| Tempo | `beatGridStore.selectedHypothesis` | Yes | `timing.bpm` |
| Time position | `playbackStore.playheadTimeSec` | Yes | `timing.time`, `timing.dt` |

### 1.7 Mesh Assets

| Data | Location | UI Visible | Script Access Needed |
|------|----------|------------|---------------------|
| 3D mesh assets | `meshAssetStore` | Yes | `mesh.load(assetId)` |

---

## Part 2: Audit of Current State

### 2.1 Runtime (Rhai) Bindings - What Exists

| Namespace | Bound | Generated In |
|-----------|-------|--------------|
| `inputs.*` (global signals) | ✅ Yes | `generate_inputs_namespace()` |
| `inputs.bands[id\|label]` | ✅ Yes | `generate_bands_namespace()` |
| `inputs.stems[id\|label]` | ✅ Yes | `generate_stems_namespace()` |
| `inputs.{eventStreamName}` | ✅ Yes | `generate_event_streams_namespace()` |
| `inputs.authored[name]` (to rename: `inputs.customEvents`) | ✅ Yes | `generate_authored_namespace()` |
| `inputs.customSignals[id\|name]` | ❌ **MISSING** | Not implemented |
| `timing.*` | ❌ **MISSING** | Not yet separated from inputs |

**Stem Signals Exposed** (per `generate_stems_namespace()`) - CURRENT:
- `energy`, `amplitude` (alias), `flux`, `centroid`, `spectralCentroid`, `onset`, `onsetEnvelope`, `label`

**Band Signals Exposed** (per `generate_bands_namespace()`) - CURRENT:
- `energy`, `amplitude` (alias), `flux`, `onset`, `events`

**Issues with Current Bindings**:
- Inconsistent naming: `spectralCentroid` vs `centroid`, `onsetEnvelope` vs `onset`
- `amplitude` alias is redundant (should just use `energy`)
- No `beatCandidates` or `onsetPeaks` on bands/stems
- Bands are flat (not nested under mix or stem)
- No `inputs.mix` namespace (signals at top level)

### 2.2 Monaco Registry - What's Documented for IDE

| Namespace | In Registry | Location |
|-----------|-------------|----------|
| `inputs.*` (global signals) | ✅ Yes | `namespaces.ts` |
| `inputs.bands` | ✅ Yes | `signals.ts` (Bands, BandSignals types) |
| `inputs.stems` | ❌ **MISSING** | Not in registry |
| Named event streams | ❌ **MISSING** | Not discoverable |
| `inputs.customEvents` | ❌ **MISSING** | Not in registry |
| `inputs.customSignals` | ❌ **MISSING** | Not in registry |
| `timing.*` | ❌ **MISSING** | Not in registry |

### 2.3 Documentation - What's in scripting.md / scripting-reference.md

| Namespace | Documented |
|-----------|-----------|
| `inputs.*` (global signals) | ✅ Yes |
| `inputs.bands[id]` | ✅ Yes |
| `inputs.stems[id]` | ❌ **MISSING** |
| Named event streams | ⚠️ Partial (mentioned but not listed) |
| `inputs.customEvents[name]` | ❌ **MISSING** |
| `inputs.customSignals[id]` | ❌ **MISSING** |
| `timing.*` | ❌ **MISSING** |

---

## Part 3: Gap Analysis

### Critical Gaps (Data exists but NOT script-accessible)

| Gap | Severity | Impact |
|-----|----------|--------|
| Custom signals not bound | **CRITICAL** | Users can create custom signals in UI but cannot use them in scripts |
| Band-level event streams missing | **HIGH** | `beatCandidates`/`onsetPeaks` not on bands |
| Stem-level event streams missing | **HIGH** | `beatCandidates`/`onsetPeaks` not on stems |

### Structural Gaps (Wrong shape, needs refactoring)

| Gap | Severity | Impact |
|-----|----------|--------|
| No `inputs.mix` namespace | **HIGH** | Mixdown signals at top level, inconsistent with stems |
| Bands not hierarchical | **HIGH** | All bands flat instead of under mix/stem |
| Inconsistent signal names | **MEDIUM** | `spectralCentroid` vs `centroid`, etc. |

### Monaco/IDE Gaps (Data accessible but NOT discoverable)

| Gap | Severity | Impact |
|-----|----------|--------|
| `inputs.stems` not in registry | **HIGH** | No autocomplete for stem signals |
| `inputs.customEvents` not in registry | **HIGH** | No autocomplete for authored events |
| `inputs.mix` not in registry | **HIGH** | New namespace needs registry entry |
| `timing.*` not in registry | **HIGH** | New namespace needs registry entry |
| Named event streams not discoverable | **MEDIUM** | Users don't know what streams exist |

### Documentation Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| Stems not documented | **HIGH** | Users don't know stems are accessible |
| Authored events not documented | **HIGH** | Users don't know authored events are accessible |
| Custom signals not documented | **CRITICAL** | Feature is undiscoverable |
| `inputs.mix` not documented | **HIGH** | New namespace needs docs |
| `timing` namespace not documented | **HIGH** | New namespace needs docs |

---

## Part 4: Canonical Namespace Structure

This defines the **single source of truth** for the `inputs` namespace structure:

```
timing                             # Global timing namespace
├── time                           # Signal: playback time in seconds
├── dt                             # Signal: delta time
├── beatPosition                   # Signal: continuous beat position
├── beatIndex                      # Signal: integer beat number
├── beatPhase                      # Signal: phase within beat (0-1)
└── bpm                            # Signal: tempo

inputs                             # Audio-derived signals namespace
├── mix                            # Mixdown audio signals
│   ├── energy                     # Signal: overall amplitude
│   ├── centroid                   # Signal: spectral brightness (Hz)
│   ├── flux                       # Signal: rate of spectral change
│   ├── onset                      # Signal: transient detection
│   ├── searchSimilarity           # Signal: search similarity curve
│   ├── beatCandidates             # EventStream: detected beats
│   ├── onsetPeaks                 # EventStream: detected onsets
│   └── bands                      # Map<string, BandSignals>
│       └── [bandId | bandLabel]
│           ├── energy             # Signal
│           ├── centroid           # Signal (Hz)
│           ├── flux               # Signal
│           ├── onset              # Signal
│           ├── beatCandidates     # EventStream
│           └── onsetPeaks         # EventStream
│
├── stems                          # Map<string, StemSignals>
│   └── [stemId | stemLabel]
│       ├── energy                 # Signal
│       ├── centroid               # Signal (Hz)
│       ├── flux                   # Signal
│       ├── onset                  # Signal
│       ├── label                  # String
│       ├── beatCandidates         # EventStream
│       ├── onsetPeaks             # EventStream
│       └── bands                  # Map<string, BandSignals> (stem-scoped bands)
│           └── [bandId | bandLabel]
│               ├── energy         # Signal
│               ├── centroid       # Signal
│               ├── flux           # Signal
│               ├── onset          # Signal
│               ├── beatCandidates # EventStream
│               └── onsetPeaks     # EventStream
│
├── customSignals                  # Map<string, Signal>  **NEW**
│   └── [signalId | signalName]    # Signal (the computed 1D signal)
│
└── customEvents                   # Map<string, EventStream>  (renamed from authored)
    └── [streamName]               # EventStream
```

### Key Structural Decisions

1. **`timing` namespace (global)**: Time and beat signals separated from audio inputs
   - `timing.time`, `timing.dt`, `timing.beatPosition`, `timing.beatIndex`, `timing.beatPhase`, `timing.bpm`
   - These are global timing signals, not derived from specific audio sources

2. **`inputs.mix` namespace**: Audio-derived MIR signals under `inputs.mix` for clarity
   - `inputs.mix.energy`, `inputs.mix.flux`, etc. instead of `inputs.energy`

3. **Stems can have bands**: Each stem has its own `bands` sub-namespace
   - `inputs.stems["Drums"].bands["Kick"]` accesses kick band within drums stem
   - Band `sourceId` determines which audio source a band belongs to

4. **Event streams at all levels**: `beatCandidates` and `onsetPeaks` exist on:
   - `inputs.mix` (mixdown-level events)
   - `inputs.stems[id]` (stem-level events)
   - `inputs.mix.bands[id]` and `inputs.stems[id].bands[id]` (band-level events)

5. **Consistent signal naming** (no aliases):
   - `centroid` (not `spectralCentroid`)
   - `flux` (not `spectralFlux`)
   - `onset` (not `onsetEnvelope`)
   - `energy` remains as-is (already consistent)

### Namespace Invariants

1. **All named collections support dual-key access**: by ID and by label/name
2. **Signals are the primitive**: All numeric data sources resolve to `Signal`
3. **EventStreams are immutable**: They can be filtered/transformed but not mutated
4. **Dynamic data is derived from Project state**: Adding/removing stems/bands/signals updates availability
5. **No hardcoded signal names**: All bindings are generated from current data
6. **Hierarchical band ownership**: Bands belong to a specific audio source (mix or stem)

---

## Part 5: Implementation Plan

### 5.1 Runtime Population (Rust) - Namespace Restructuring

**File**: `packages/visualiser/src/signal_rhai.rs`

1. **Rename signal features for consistency**:
   - `spectralCentroid` → `centroid`
   - `onsetEnvelope` → `onset`
   - `spectralFlux` → `flux`
   - Remove `amplitude` alias (just use `energy`)

2. **Refactor `generate_inputs_namespace()`** to create `inputs.mix`:
   ```rhai
   inputs.mix = #{};
   inputs.mix.energy = __signal_input("energy");
   inputs.mix.centroid = __signal_input("centroid");
   inputs.mix.flux = __signal_input("flux");
   inputs.mix.onset = __signal_input("onset");
   inputs.mix.searchSimilarity = __signal_input("searchSimilarity");
   inputs.mix.beatCandidates = __event_stream_get("beatCandidates");
   inputs.mix.onsetPeaks = __event_stream_get("onsetPeaks");
   ```

3. **Refactor `generate_bands_namespace()`** to nest under source:
   - Accept source context (mix or stem ID)
   - Generate `inputs.mix.bands[id]` for mixdown bands
   - Generate `inputs.stems[stemId].bands[id]` for stem bands
   - Add `beatCandidates` and `onsetPeaks` to each band

4. **Update `generate_stems_namespace()`**:
   - Use consistent names (`centroid`, `flux`, `onset`)
   - Add `beatCandidates` and `onsetPeaks` per stem
   - Add `bands` sub-namespace per stem

5. **Add `generate_timing_namespace() -> String`**:
   ```rhai
   let timing = #{};
   timing.time = __signal_input("time");
   timing.dt = __signal_input("dt");
   timing.beatPosition = __signal_input("beatPosition");
   timing.beatIndex = __signal_input("beatIndex");
   timing.beatPhase = __signal_input("beatPhase");
   timing.bpm = __signal_input("bpm");
   ```

6. **Add `generate_custom_signals_namespace(signals: &[(String, String)]) -> String`**:
   ```rhai
   inputs.customSignals = #{};
   inputs.customSignals["sig-123"] = __custom_signal_input("sig-123");
   inputs.customSignals["Bass Energy"] = inputs.customSignals["sig-123"];
   ```

7. **Rename `generate_authored_namespace()` to `generate_custom_events_namespace()`**:
   ```rhai
   inputs.customEvents = #{};
   inputs.customEvents["Kick Events"] = __event_stream_get("Kick Events");
   ```

8. **Add `__custom_signal_input(id: &str) -> Signal`**

9. **Add thread-local storage for custom signal data**

**File**: `packages/visualiser/src/scripting.rs`

1. Add `available_custom_signals: Vec<(String, String)>` field
2. Add `set_available_custom_signals(signals: Vec<(String, String)>)` method
3. Refactor `load_script()` to:
   - Generate `timing` namespace with global timing signals
   - Generate `inputs.mix` namespace with mixdown signals
   - Generate mixdown bands under `inputs.mix.bands`
   - Generate stem bands under each stem
   - Generate custom signals namespace
   - Generate custom events namespace (renamed from authored)

**File**: `packages/visualiser/src/signal.rs`

1. Add `CustomSignalInput { id: String }` variant to `SignalNode` enum

**File**: `packages/visualiser/src/wasm.rs`

1. Add `set_available_custom_signals(json: &str)` WASM export
2. Add `push_custom_signal(id: &str, name: &str, signal_data: &[f32], rate: f32)` WASM export
3. Update band/stem pushing to include event streams

### 5.2 Monaco Type Registry (TypeScript)

**File**: `apps/web/src/lib/scripting/registry/entries/signals.ts`

Add/update entries for:
1. `TimingSignals` type with `time`, `dt`, `beatPosition`, `beatIndex`, `beatPhase`, `bpm`
2. `MixSignals` type with `energy`, `centroid`, `flux`, `onset`, `searchSimilarity`, `beatCandidates`, `onsetPeaks`, `bands`
3. `Stems` type (map of stem signals)
4. `StemSignals` type with `energy`, `centroid`, `flux`, `onset`, `label`, `beatCandidates`, `onsetPeaks`, `bands`
5. Update `BandSignals` to include `centroid`, `beatCandidates`, `onsetPeaks`
6. `CustomSignals` type (map of signals)
7. `CustomEvents` type (map of event streams)

**File**: `apps/web/src/lib/scripting/registry/entries/namespaces.ts`

Add `timing` namespace:
1. New global namespace with `TimingSignals` properties

Update `inputs` namespace properties:
1. Remove top-level MIR signals (moved to `mix`)
2. Add `mix: MixSignals`
3. Add `stems: Stems`
4. Add `customSignals: CustomSignals`
5. Add `customEvents: CustomEvents`

**File**: `apps/web/src/lib/scripting/registry/index.ts`

Add chain resolution for:
1. `timing.*` → `TimingSignals` properties
2. `inputs.mix` → `MixSignals`
3. `inputs.mix.bands["key"]` → `BandSignals`
4. `inputs.stems["key"]` → `StemSignals`
5. `inputs.stems["key"].bands["key"]` → `BandSignals`
6. `inputs.customSignals["key"]` → `Signal`
7. `inputs.customEvents["key"]` → `EventStream`

### 5.3 Web App Integration

**File**: `apps/web/src/components/visualiser/VisualiserPanel.tsx`

1. Update band pushing to include source context (mix vs stem)
2. Push event streams for bands and stems
3. Add custom signal integration:
   - Get enabled custom signals from `customSignalStore`
   - Get computed results from `resultCache`
   - Call `set_available_custom_signals()` and `push_custom_signal()`

### 5.4 Documentation

**File**: `scripting.md`

Update/add sections for:
1. `timing` namespace - Global timing signals (time, dt, beatPosition, beatIndex, beatPhase, bpm)
2. `inputs.mix` - Mixdown audio signals
3. `inputs.mix.bands[id]` - Mixdown frequency bands
4. `inputs.stems[id]` - Stem audio signals
5. `inputs.stems[id].bands[id]` - Stem frequency bands
6. `inputs.customSignals[id]` - Custom extracted signals
7. `inputs.customEvents[name]` - Authored event streams
8. Consistent naming: `centroid`, `flux`, `onset`, `energy`

### 5.5 Backward Compatibility

**Breaking changes** (no aliases, clean break):
- `inputs.time` → `timing.time`
- `inputs.dt` → `timing.dt`
- `inputs.beatPosition` → `timing.beatPosition`
- `inputs.beatIndex` → `timing.beatIndex`
- `inputs.beatPhase` → `timing.beatPhase`
- `inputs.bpm` → `timing.bpm`
- `inputs.amplitude` → `inputs.mix.energy`
- `inputs.spectralCentroid` → `inputs.mix.centroid`
- `inputs.spectralFlux` → `inputs.mix.flux`
- `inputs.onsetEnvelope` → `inputs.mix.onset`
- `inputs.bands[id]` → `inputs.mix.bands[id]`
- `inputs.bands[id].events` → `inputs.mix.bands[id].onsetPeaks` (or `.beatCandidates`)
- `inputs.stems[id].spectralCentroid` → `inputs.stems[id].centroid`
- `inputs.stems[id].onsetEnvelope` → `inputs.stems[id].onset`
- `inputs.authored[name]` → `inputs.customEvents[name]`

**Approach**: Hard break, no legacy aliases. Early stage of project makes this the right time.

---

## Part 6: Validation Guardrails

### Development-Time Warnings

Add diagnostic checks that warn when:
1. Project contains custom signals that aren't bound to scripts
2. Monaco registry has entries without runtime counterparts
3. Runtime bindings exist without Monaco entries

### Implementation Location

**File**: `apps/web/src/lib/scripting/scriptDiagnostics.ts`

Add validation functions:
```typescript
function validateScriptApiCoverage(
  projectSignals: string[],
  runtimeBindings: string[],
  registryEntries: string[]
): Diagnostic[]
```

---

## Part 7: Data Flow Patterns (Implementation Reference)

### 7.1 Current Pattern: Stems

The stem data flow provides the template for custom signals:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Web App (VisualiserPanel.tsx)                                      │
│                                                                     │
│  1. Read stems from audioInputStore                                 │
│  2. Read stem MIR results from inputMirCache                        │
│  3. Call set_available_stems(json) with [(id, label), ...]          │
│  4. For each stem signal:                                           │
│     - Normalize values to 0-1                                       │
│     - Call push_stem_signal(id, label, feature, values, rate)       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WASM (wasm.rs)                                                     │
│                                                                     │
│  set_available_stems():                                             │
│    - Parses JSON to Vec<(String, String)>                           │
│    - Calls state.set_available_stems(stems)                         │
│                                                                     │
│  push_stem_signal():                                                │
│    - Creates InputSignal from samples + rate                        │
│    - Stores in internal HashMap<stem_id, HashMap<feature, Signal>>  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Scripting (scripting.rs + signal_rhai.rs)                          │
│                                                                     │
│  In load_script():                                                  │
│    - Call generate_stems_namespace(&self.available_stems)           │
│    - This generates Rhai code like:                                 │
│        inputs.stems = #{};                                          │
│        inputs.stems["stem-abc"] = #{};                              │
│        inputs.stems["stem-abc"].energy = __stem_signal_input(...);  │
│        inputs.stems["Drums"] = inputs.stems["stem-abc"];            │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Pattern for Custom Signals (To Implement)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Web App (VisualiserPanel.tsx)                                      │
│                                                                     │
│  1. Read enabled custom signals from customSignalStore              │
│  2. Read computed results from resultCache                          │
│  3. Call set_available_custom_signals(json) with [(id, name), ...]  │
│  4. For each custom signal with cached result:                      │
│     - Normalize values                                              │
│     - Call push_custom_signal(id, name, values, rate)               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WASM (wasm.rs) - TO ADD                                            │
│                                                                     │
│  set_available_custom_signals():                                    │
│    - Parses JSON to Vec<(String, String)>                           │
│    - Calls state.set_available_custom_signals(signals)              │
│                                                                     │
│  push_custom_signal():                                              │
│    - Creates InputSignal from samples + rate                        │
│    - Stores in thread-local CURRENT_CUSTOM_SIGNALS                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Scripting (scripting.rs + signal_rhai.rs) - TO ADD                 │
│                                                                     │
│  In load_script():                                                  │
│    - Call generate_custom_signals_namespace(&self.available_custom) │
│    - This generates Rhai code like:                                 │
│        inputs.customSignals = #{};                                  │
│        inputs.customSignals["sig-123"] = __custom_signal_input(...);│
│        inputs.customSignals["Bass Energy"] = inputs.custom...;     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Current Pattern: Bands

Bands use a slightly different pattern - availability is inferred from pushed signals:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Web App (VisualiserPanel.tsx)                                      │
│                                                                     │
│  1. Read all band MIR results from bandMirStore                     │
│  2. For each band with results:                                     │
│     - Get band definition from frequencyBandStore                   │
│     - Normalize values                                              │
│     - Call push_band_signal(bandId, bandLabel, feature, values, rate)│
│  3. Push band events with push_band_events(bandId, eventsJson)      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WASM (wasm.rs)                                                     │
│                                                                     │
│  push_band_signal():                                                │
│    - Creates InputSignal                                            │
│    - Stores in band_id_to_label map (for namespace generation)      │
│    - Stores signal data in internal storage                         │
│                                                                     │
│  load_script():                                                     │
│    - Reads band_id_to_label to build available bands                │
│    - Calls state.set_available_bands(bands) internally              │
└─────────────────────────────────────────────────────────────────────┘
```

**Note**: Bands infer availability from pushed signals. Custom signals should use the explicit `set_available_custom_signals` approach like stems for clearer semantics.

---

## Summary: What Needs to Change

| Component | Changes Required |
|-----------|-----------------|
| **Rust (signal.rs)** | Add `CustomSignalInput` variant to `SignalNode` |
| **Rust (signal_rhai.rs)** | Restructure namespace generation: `timing`, `inputs.mix`, hierarchical bands, consistent naming, custom signals, custom events |
| **Rust (scripting.rs)** | Add `available_custom_signals`, refactor `load_script()` for new structure |
| **Rust (wasm.rs)** | Add WASM exports for custom signals, update band/stem event streams |
| **TS (signals.ts)** | Add `TimingSignals`, `MixSignals`, `Stems`, `StemSignals`, `CustomSignals`, `CustomEvents` types; update `BandSignals` |
| **TS (namespaces.ts)** | Add `timing` namespace, replace top-level signals with `mix`, add `stems`, `customSignals`, `customEvents` |
| **TS (registry/index.ts)** | Add chain resolution for `timing`, `inputs.mix`, nested bands, custom signals, custom events |
| **TS (VisualiserPanel.tsx)** | Update band pushing for source context, add event streams, integrate custom signals |
| **Docs (scripting.md)** | Full rewrite: add `timing` namespace, `inputs.mix`, `stems`, `customSignals`, `customEvents`, consistent naming |

---

## Success Criteria

After implementation:

**Timing Namespace**
- [ ] `timing.time` returns playback time signal
- [ ] `timing.dt` returns delta time signal
- [ ] `timing.beatPosition` returns continuous beat position
- [ ] `timing.beatIndex` returns integer beat number
- [ ] `timing.beatPhase` returns phase within beat (0-1)
- [ ] `timing.bpm` returns tempo signal

**Inputs Namespace**
- [ ] `inputs.mix.energy` returns mixdown energy signal
- [ ] `inputs.mix.centroid` returns mixdown spectral centroid
- [ ] `inputs.mix.flux` returns mixdown spectral flux
- [ ] `inputs.mix.onset` returns mixdown onset signal
- [ ] `inputs.mix.bands["Bass"].onset` returns band onset signal
- [ ] `inputs.mix.bands["Bass"].centroid` returns band centroid signal
- [ ] `inputs.mix.beatCandidates` returns mixdown beat candidates EventStream
- [ ] `inputs.mix.onsetPeaks` returns mixdown onset peaks EventStream
- [ ] `inputs.stems["Drums"].centroid` returns stem centroid signal
- [ ] `inputs.stems["Drums"].bands["Kick"].flux` returns stem-scoped band signal
- [ ] `inputs.stems["Drums"].beatCandidates` returns stem beat candidates
- [ ] `inputs.stems["Drums"].onsetPeaks` returns stem onset peaks
- [ ] `inputs.customSignals["My Signal"]` returns custom signal
- [ ] `inputs.customEvents["Kick Events"]` returns authored event stream

**Monaco IDE**
- [ ] Monaco autocomplete shows `timing` as global namespace
- [ ] Monaco shows `time`, `dt`, `beatPosition`, `beatIndex`, `beatPhase`, `bpm` under `timing`
- [ ] Monaco autocomplete shows `mix`, `stems`, `customSignals`, `customEvents` under `inputs`
- [ ] Monaco shows nested `bands` under both `inputs.mix` and `inputs.stems[id]`

**Documentation**
- [ ] `timing` namespace documented with all signals
- [ ] `inputs.mix` documented with all signals and event streams
- [ ] `inputs.stems` documented with bands sub-namespace
- [ ] `inputs.customSignals` documented
- [ ] `inputs.customEvents` documented
- [ ] Consistent naming (`centroid`, `flux`, `onset`, `energy`) documented throughout
- [ ] No "why can't my script see this?" surprises
