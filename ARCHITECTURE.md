# Octoseq Architecture

This document provides a detailed technical overview of the Octoseq system architecture, component structure, key interfaces, and implementation approaches.

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Project Structure](#project-structure)
4. [Component Details](#component-details)
   - [MIR Library](#1-mir-library)
   - [Web UI Lab](#2-web-ui-lab)
   - [Rendering Engine](#3-rendering-engine)
   - [Rhai Scripting](#4-rhai-scripting)
5. [Key Interfaces and Types](#key-interfaces-and-types)
6. [Data Flow Patterns](#data-flow-patterns)
7. [Build System](#build-system)
8. [Technology Stack](#technology-stack)

---

## System Overview

Octoseq is a **two-phase creative system** for turning music into visuals:

1. **Interpretation Phase**: Extract and refine meaningful structure from audio (often with human-in-the-loop)
2. **Execution Phase**: Render visuals deterministically from structured interpretation using programmable visual presets

This separation is the core architectural principle. Understanding comes before expression, and all intermediate data remains visible and inspectable.

### Design Philosophy

- **Determinism**: Same inputs produce identical outputs across environments
- **Transparency**: All intermediate representations are first-class and inspectable
- **Human Control**: Interpretation benefits from but doesn't require human refinement
- **Offline First**: Headless, faster-than-realtime rendering is a primary use case
- **Modularity**: Components are loosely coupled with clear contracts

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              INTERPRETATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐         ┌─────────────────────────────────────┐     │
│   │              │         │          Web UI "Lab"               │     │
│   │    Audio     │─────────►   • Audio loading & waveform       │     │
│   │    File      │         │   • MIR analysis visualization      │     │
│   │              │         │   • Human-in-the-loop refinement    │     │
│   └──────────────┘         │   • Audio search & similarity       │     │
│          │                 └──────────────┬──────────────────────┘     │
│          │                                │                             │
│          ▼                                ▼                             │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                      MIR Library                              │     │
│   │  • Spectral analysis (FFT, Mel, MFCC)                        │     │
│   │  • Onset detection & peak picking                             │     │
│   │  • HPSS (Harmonic-Percussive separation)                      │     │
│   │  • Audio fingerprinting & search                              │     │
│   │  • WebGPU acceleration                                        │     │
│   └──────────────────────────────────────────────────────────────┘     │
│                                │                                        │
│                                ▼                                        │
│                  ┌──────────────────────────┐                          │
│                  │  Audio Interpretation    │                          │
│                  │       Package            │                          │
│                  │  • MIR signals           │                          │
│                  │  • Perceptual traits     │                          │
│                  │  • Annotations           │                          │
│                  └──────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                               EXECUTION                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────┐     ┌───────────────────────────────────┐       │
│   │   Rhai Scripts   │────►│       Rendering Engine            │       │
│   │                  │     │   • GPU-first (wgpu)              │       │
│   │  • init()        │     │   • Headless/offline support      │       │
│   │  • update(dt)    │     │   • WASM for browser preview      │       │
│   │  • Scene graph   │     │   • Deterministic execution       │       │
│   └──────────────────┘     └───────────────────────────────────┘       │
│                                          │                              │
│                                          ▼                              │
│                              ┌───────────────────────┐                 │
│                              │    Visual Output      │                 │
│                              │  • PNG frames         │                 │
│                              │  • Canvas preview     │                 │
│                              └───────────────────────┘                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

Octoseq is a **monorepo** using Turbo for build orchestration and pnpm for dependency management.

```
octoseq/
├── apps/
│   └── web/                      # Next.js web application
│       ├── src/
│       │   ├── app/              # Next.js App Router
│       │   ├── components/       # React components
│       │   ├── lib/              # Core logic, stores, hooks
│       │   └── workers/          # Web Workers
│       ├── public/               # Static assets
│       └── next.config.ts
│
├── packages/
│   ├── mir/                      # MIR analysis library (TypeScript)
│   │   ├── src/
│   │   │   ├── dsp/              # Digital signal processing
│   │   │   ├── gpu/              # WebGPU acceleration
│   │   │   ├── runner/           # Execution orchestration
│   │   │   ├── search/           # Audio fingerprinting & search
│   │   │   └── util/             # Utilities
│   │   └── package.json
│   │
│   └── visualiser/               # Rendering engine (Rust/WASM)
│       ├── src/
│       │   ├── gpu/              # wgpu rendering
│       │   ├── visualiser.rs     # Core state
│       │   ├── scripting.rs      # Rhai integration
│       │   ├── scene_graph.rs    # Scene management
│       │   ├── wasm.rs           # WASM bindings
│       │   └── main.rs           # CLI entry
│       └── Cargo.toml
│
├── data/                         # Sample audio files
├── turbo.json                    # Build orchestration
├── pnpm-workspace.yaml           # Workspace config
└── tsconfig.base.json            # Shared TypeScript config
```

---

## Component Details

### 1. MIR Library

**Package**: `@octoseq/mir`
**Location**: `packages/mir/`
**Language**: TypeScript with WebGPU (WGSL shaders)

#### Purpose

A pure audio analysis library that extracts low-level and mid-level information from audio. Environment-agnostic (runs in browser, Web Workers, and Node.js).

#### Module Structure

```
packages/mir/src/
├── dsp/                          # Digital Signal Processing
│   ├── spectrogram.ts            # STFT computation
│   ├── mel.ts                    # Mel-scale filterbank
│   ├── spectral.ts               # Spectral centroid, flux
│   ├── onset.ts                  # Onset envelope detection
│   ├── peakPick.ts               # Peak picking algorithms
│   ├── hpss.ts                   # Harmonic-Percussive separation
│   ├── mfcc.ts                   # Mel-frequency cepstral coefficients
│   ├── fft.ts                    # FFT interface
│   └── fftBackend.ts             # FFT implementation abstraction
│
├── gpu/                          # WebGPU Acceleration
│   ├── context.ts                # MirGPU browser context
│   ├── melProject.ts             # GPU mel projection kernel
│   ├── hpssMasks.ts              # GPU HPSS mask estimation
│   ├── onsetEnvelope.ts          # GPU onset envelope
│   ├── kernels/                  # WGSL shader sources
│   │   ├── melProject.wgsl.ts
│   │   ├── hpssMasks.wgsl.ts
│   │   └── onsetEnvelope.wgsl.ts
│   └── helpers.ts                # GPU buffer/dispatch utilities
│
├── runner/
│   ├── runMir.ts                 # Main execution entrypoint
│   └── workerProtocol.ts         # Web Worker message protocol
│
├── search/                       # Audio Search & Fingerprinting
│   ├── fingerprintV1.ts          # Audio fingerprint generation
│   ├── similarity.ts             # Fingerprint similarity scoring
│   ├── searchTrackV1.ts          # Baseline sliding-window search
│   └── searchTrackV1Guided.ts    # Human-in-the-loop refinement
│
├── util/
│   ├── stats.ts                  # Statistical utilities
│   ├── normalise.ts              # Audio normalization
│   └── display.ts                # dB conversion for visualization
│
└── index.ts                      # Public API exports
```

#### Implementation Approach

**DSP Pipeline (CPU)**:
1. Audio input → FFT (via fft.js) → Complex spectrogram
2. Spectrogram → Feature extraction (mel, MFCC, spectral features)
3. Features → Event detection (onset envelope, peak picking)
4. Features → Source separation (HPSS via median filtering)

**GPU Acceleration** (optional):
- Mel projection uses compute shaders for large spectrograms
- HPSS mask estimation parallelized on GPU
- Onset envelope computation accelerated
- All GPU paths have CPU fallbacks

**Search Algorithm**:
1. Query region → Fingerprint (compressed representation)
2. Sliding window across track → Similarity scores
3. Optional: Logistic regression refinement with human labels

---

### 2. Web UI Lab

**Package**: `apps/web`
**Framework**: Next.js 16 with React 19

#### Purpose

An interactive laboratory for audio interpretation, visualization, and human-in-the-loop refinement.

#### Directory Structure

```
apps/web/src/
├── app/
│   ├── layout.tsx                # Root layout with theme provider
│   └── page.tsx                  # Main application page
│
├── components/
│   ├── ui/                       # Primitive UI components
│   │   ├── button.tsx
│   │   └── modal.tsx
│   │
│   ├── wavesurfer/               # Audio playback & waveform
│   │   ├── WaveSurferPlayer.tsx  # Main audio player
│   │   ├── SyncedWaveSurferSignal.tsx   # 1D signal overlay
│   │   ├── SparseEventsViewer.tsx       # Event markers
│   │   ├── ClickableWaveformOverlay.tsx
│   │   └── ViewportOverlay*.tsx  # Viewport overlays
│   │
│   ├── heatmap/                  # 2D visualizations
│   │   ├── TimeAlignedHeatmapPixi.tsx   # PixiJS heatmap
│   │   └── HeatmapPlayheadOverlay.tsx
│   │
│   ├── mir/                      # MIR analysis controls
│   │   ├── MirControlPanel.tsx
│   │   └── MirConfigModal.tsx
│   │
│   ├── search/                   # Audio search interface
│   │   ├── SearchPanel.tsx
│   │   ├── SearchControlsPanel.tsx
│   │   └── SearchRefinementPanel.tsx
│   │
│   ├── visualiser/
│   │   └── VisualiserPanel.tsx   # Rhai script editor + preview
│   │
│   └── panels/
│       └── DebugPanel.tsx        # Debug controls
│
├── lib/
│   ├── stores/                   # Zustand state management
│   │   ├── audioStore.ts         # Audio buffer + metadata
│   │   ├── playbackStore.ts      # Playback position + viewport
│   │   ├── mirStore.ts           # MIR results cache
│   │   ├── searchStore.ts        # Search candidates + refinement
│   │   ├── configStore.ts        # UI configuration
│   │   └── hooks/
│   │       ├── useMirActions.ts
│   │       ├── useSearchActions.ts
│   │       ├── useAudioActions.ts
│   │       └── useNavigationActions.ts
│   │
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   │
│   ├── scripting/                # Rhai editor support
│   │   ├── rhaiMonaco.ts         # Monaco language config
│   │   └── signalMetadata.ts     # Available signal docs
│   │
│   └── mirDisplayTransforms.ts   # Display normalization
│
└── workers/                      # Web Workers for MIR
```

#### State Management Architecture

Using **Zustand** with devtools middleware:

| Store | Purpose | Key State |
|-------|---------|-----------|
| `audioStore` | Audio data | `audioBuffer`, `sampleRate`, `duration` |
| `playbackStore` | Playback control | `currentTime`, `isPlaying`, `viewport` |
| `mirStore` | Analysis results | `results` (cached by function ID) |
| `searchStore` | Search state | `candidates`, `refinementLabels`, `queryRegion` |
| `configStore` | UI settings | `colorSchemes`, `debugFlags` |

#### Implementation Approach

**Audio Loading**:
- WaveSurfer.js handles audio decoding and waveform display
- AudioBuffer stored in Zustand for sharing across components

**MIR Execution**:
- Analysis runs in Web Workers via `workerProtocol`
- Results transferred back with ArrayBuffer ownership
- Cached by function ID to avoid recomputation

**Visualization Strategy**:
- 1D signals: SVG overlays synced to viewport
- 2D data: PixiJS WebGL heatmaps with viewport culling
- Events: Marker overlays at peak positions

**Keyboard Shortcuts**:
| Key | Action |
|-----|--------|
| `←/j` | Previous candidate |
| `→/k` | Next candidate |
| `a` | Accept candidate |
| `r` | Reject candidate |
| `space` | Play/pause |
| `q` | Play query region |

---

### 3. Rendering Engine

**Package**: `@octoseq/visualiser`
**Location**: `packages/visualiser/`
**Language**: Rust with wgpu

#### Purpose

A deterministic visual execution engine that renders visuals from interpretation data and visual scripts.

#### Module Structure

```
packages/visualiser/src/
├── visualiser.rs                 # High-level visualiser state
│   └── VisualiserState
│       ├── script_engine
│       └── time, config
│
├── scripting.rs                  # Rhai script VM
│   └── ScriptEngine
│       ├── load_script()
│       ├── init() / update()
│       └── scene_graph management
│
├── scene_graph.rs                # Dynamic scene representation
│   ├── EntityId
│   ├── MeshType (Cube, Plane)
│   ├── MeshInstance
│   ├── LineStrip
│   ├── Transform
│   └── SceneGraph
│
├── gpu/
│   ├── renderer.rs               # wgpu render pass
│   ├── pipeline.rs               # Shader pipeline
│   └── mesh.rs                   # Geometry primitives
│
├── input.rs                      # InputSignal wrapper
├── sparkline.rs                  # Line rendering
├── script_log.rs                 # Script logging
│
├── cli.rs                        # Headless CLI
│   └── Commands::Render
│
├── wasm.rs                       # WASM bindings
└── main.rs                       # Native entry
```

#### Implementation Approach

**Dual Target Build**:
- **Native**: Full CLI with headless rendering to PNG frames
- **WASM**: Browser-compatible module for preview

**Rendering Pipeline**:
1. Load Rhai script → Parse and validate
2. Call `init(ctx)` → Create initial scene graph
3. Per frame: Call `update(dt, inputs)` → Update scene
4. Render scene graph via wgpu → Output frame

**Scene Graph**:
- Entity-based system with unique IDs
- Transform hierarchy (position, rotation, scale)
- Mesh instances + procedural line strips
- Visibility toggling

**CLI Usage**:
```bash
visualiser render \
  --input data.json \
  --script scene.rhai \
  --out frames/ \
  --fps 60 \
  --width 1920 \
  --height 1080
```

---

### 4. Rhai Scripting

#### Purpose

A Lua-inspired scripting layer for defining visual scenes and behavior.

#### Script Structure

```rhai
// Called once at initialization
fn init(ctx) {
    let cube = mesh.cube();
    cube.position.y = 1.0;
    scene.add(cube);

    let sparkline = line.strip(#{ max_points: 100 });
    scene.add(sparkline);
}

// Called every frame
fn update(dt, inputs) {
    // Access MIR-derived signals
    let energy = inputs.get("spectralFlux");

    // Update scene based on signals
    cube.scale = 1.0 + energy * 0.5;

    // Update line primitives
    sparkline.push(time, energy);
}
```

#### Available APIs

**Mesh Creation**:
- `mesh.cube()` → MeshInstance
- `mesh.plane()` → MeshInstance

**Line Primitives**:
- `line.strip({ max_points })` → LineStrip
- `entity.push(x, y)` / `entity.clear()`

**Scene Management**:
- `scene.add(entity)`
- `scene.remove(entity)`

**Entity Properties**:
- `entity.position.{x, y, z}`
- `entity.rotation.{x, y, z}`
- `entity.scale`
- `entity.visible`

**Logging**:
- `log.info(val)`, `log.warn(val)`, `log.error(val)`

#### Implementation Approach

- Scripts run in Rhai VM with sandboxed context
- Persistent state between frames enables memory effects
- Frame-aligned inputs pre-computed from MIR signals
- Full lookahead/lookbehind available (not realtime constrained)

---

## Key Interfaces and Types

### MIR Types

```typescript
// Analysis function identifiers
type MirFunctionId =
  | "spectralCentroid" | "spectralFlux"
  | "melSpectrogram" | "onsetEnvelope" | "onsetPeaks"
  | "hpssHarmonic" | "hpssPercussive"
  | "mfcc" | "mfccDelta" | "mfccDeltaDelta";

// Analysis request configuration
interface MirRunRequest {
  fn: MirFunctionId;
  params?: Record<string, number>;
  useGpu?: boolean;
}

// Canonical audio interface
interface MirAudioPayload {
  sampleRate: number;
  samples: Float32Array;  // Mono
}

// Result types (discriminated union)
type MirResult = Mir1DResult | Mir2DResult | MirEventsResult;

interface Mir1DResult {
  kind: "1d";
  times: Float32Array;
  values: Float32Array;
  meta: MirRunMeta;
}

interface Mir2DResult {
  kind: "2d";
  times: Float32Array;
  data: Float32Array[];  // Per-band
  meta: MirRunMeta;
}

interface MirEventsResult {
  kind: "events";
  times: Float32Array;
  events: Array<{ time: number; strength: number; index: number }>;
  meta: MirRunMeta;
}

interface MirRunMeta {
  cpuMs: number;
  gpuMs?: number;
  backend: "cpu" | "gpu";
}
```

### Search Types

```typescript
interface SearchResult {
  times: Float32Array;
  scores: Float32Array;
  curveKind: "similarity" | "confidence";
  model: {
    kind: "baseline" | "logistic";
    positives: number;
    negatives: number;
    weightL2: Record<string, number>;
  };
  candidates: SearchCandidateOverlayEvent[];
  timings: {
    fingerprintMs: number;
    scanMs: number;
    modelMs: number;
    totalMs: number;
  };
}

interface SearchCandidateOverlayEvent {
  time: number;
  score: number;
  rank: number;
}
```

### Rendering Types (Rust)

```rust
// Scene entity identifier
pub struct EntityId(u64);

// Mesh primitive types
pub enum MeshType {
    Cube,
    Plane,
}

// Transform components
pub struct Transform {
    pub position: Vec3,
    pub rotation: Vec3,
    pub scale: f32,
}

// Mesh instance in scene
pub struct MeshInstance {
    pub id: EntityId,
    pub mesh_type: MeshType,
    pub transform: Transform,
    pub visible: bool,
}

// Procedural line primitive
pub struct LineStrip {
    pub id: EntityId,
    pub points: RingBuffer<Vec2>,
    pub max_points: usize,
}

// Scene container
pub struct SceneGraph {
    pub meshes: HashMap<EntityId, MeshInstance>,
    pub lines: HashMap<EntityId, LineStrip>,
}
```

---

## Data Flow Patterns

### End-to-End Flow

```
1. AUDIO LOAD
   User loads audio file
   → WaveSurfer decodes → AudioBuffer
   → audioStore.setAudioBuffer()

2. MIR ANALYSIS
   User triggers analysis
   → useMirActions.runAnalysis(fnId)
   → Web Worker: runMir(audio, request)
   → DSP pipeline + optional GPU
   → Worker returns results
   → mirStore.setMirResult(fnId, result)

3. VISUALIZATION
   Component reads mirStore
   → 1D: SyncedWaveSurferSignal renders overlay
   → 2D: TimeAlignedHeatmapPixi renders heatmap
   → Events: SparseEventsViewer renders markers

4. SEARCH (optional)
   User selects region
   → searchStore.setQueryRegion()
   → useSearchActions.runSearch()
   → Worker: searchTrackV1(query, track)
   → Returns similarity curve + candidates
   → searchStore.setSearchResult()

5. REFINEMENT (optional)
   User accepts/rejects candidates
   → searchStore.updateRefinement()
   → Re-run with labels
   → searchTrackV1Guided applies logistic regression
   → Updated confidence curve

6. VISUAL PREVIEW
   User writes Rhai script
   → VisualiserPanel loads WASM module
   → WasmVisualiser.load_script(rhai)
   → Per frame: update(dt, mirSignals)
   → Canvas renders via wgpu/WASM

7. OFFLINE RENDER
   CLI: visualiser render --input data.json --script scene.rhai
   → Loads interpretation package
   → Headless wgpu rendering
   → Outputs PNG frames
```

### Worker Communication

```
Main Thread                          Web Worker
     │                                    │
     │  MirWorkerRunMessage               │
     │  { fn, params, audio }             │
     ├───────────────────────────────────►│
     │                                    │
     │                            runMir(audio, request)
     │                                    │
     │  MirWorkerResultMessage            │
     │  { fnId, result, timing }          │
     │◄───────────────────────────────────┤
     │                                    │
```

---

## Build System

### Turbo Configuration

**Root `turbo.json`**:
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "pkg/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {},
    "lint": {},
    "test": {}
  }
}
```

### Package Builds

| Package | Build Tool | Entry | Output |
|---------|-----------|-------|--------|
| `@octoseq/mir` | tsup | `src/index.ts` | `dist/` (ESM + CJS) |
| `apps/web` | Next.js | `src/app/page.tsx` | `.next/` |
| `@octoseq/visualiser` | wasm-pack | `src/lib.rs` | `pkg/` (WASM) |

### Development Commands

```bash
# Start all packages in dev mode
pnpm dev

# Build all packages
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build visualiser for WASM
cd packages/visualiser && wasm-pack build --target web

# Run native visualiser CLI
cd packages/visualiser && cargo run --release -- render ...
```

---

## Technology Stack

### Frontend (Web App)

| Category | Technology |
|----------|------------|
| Framework | Next.js 16, React 19 |
| Compiler | React Compiler, Turbopack |
| UI | Radix UI primitives |
| Styling | Tailwind CSS v4 |
| Audio | WaveSurfer.js 7.12 |
| 2D Graphics | PixiJS 8.14 |
| Code Editor | Monaco Editor 4.7 |
| State | Zustand 5.0 |

### MIR Library

| Category | Technology |
|----------|------------|
| Language | TypeScript (ES2022) |
| GPU Compute | WebGPU + WGSL |
| DSP | fft.js |
| Build | tsup |
| Testing | Vitest |

### Rendering Engine

| Category | Technology |
|----------|------------|
| Language | Rust (2021 edition) |
| Graphics | wgpu 23.0 |
| Scripting | Rhai 1.20 |
| Math | glam 0.28 |
| WASM | wasm-bindgen, web-sys |
| CLI | clap 4.5 |

### Monorepo

| Category | Technology |
|----------|------------|
| Task Runner | Turbo |
| Package Manager | pnpm |
| TypeScript | 5.x with strict mode |

---

## Appendix: File Metrics

| Component | Approximate LOC |
|-----------|-----------------|
| MIR Library | ~5,000 |
| Web App | ~9,200 |
| Visualiser | ~2,900 |
| **Total** | **~17,100** |
