# Octoseq

Live here: https://octoseq.xyz

**Octoseq** is an experimental, work-in-progress system for turning music into visuals. Some parts have been vibe coded with minimal human inspection, so use at your own risk for now.

It is **not** a single “audio in → visual out” black box and is **not** intended for realtime visuals. It is a **two-phase creative system**:

1. **Interpretation**: extract and refine meaningful structure from the whole audio track (often with a human in the loop)
2. **Execution**: render visuals deterministically from that structured interpretation using programmable visual presets

This separation is the core architectural idea behind the project.

---

## Hasn't this been done before?

Only to a point. Octoseq is inspired by a long lineage of audio-reactive visual tools, most notably Milkdrop and its successors, which demonstrated how expressive and programmable music-driven visuals could be.

Despite decades of progress in rendering and real-time graphics, there remains a gap between low-level audio features and visually or musically meaningful structure: most modern tools still operate in real time, react to instantaneous signals, and leave interpretation implicit or opaque.

Octoseq aims to explore that gap by treating audio understanding as a first-class, inspectable process, decoupling interpretation from execution, and enabling deterministic, non-realtime visual synthesis driven by whole-track context and programmable visual logic, using a combination of MIR signals, MIR pipelines aiming to capture perceptual traits, and human-driven tweaking, composition, and annotations.

## High-Level Architecture

```
Audio
  ↓
[MIR Library]  ──►  [Web UI “Lab”]  ──►  Audio Interpretation Package
                                           ↓
                                    [Rendering Engine]
                                           ↑
                                   [Rhai Visual Scripts]
```

---

## Components & Design Principles

## 1. MIR Library (TypeScript / WebGPU)

### What it is

A **pure audio analysis library** that extracts low-level and mid-level information from audio:

- 1D continuous signals (energy, flux, centroid, etc.)
- 2D representations (spectrograms, mel, HPSS)
- sparse events (onsets, peaks)
- whole-track, non-realtime analyses

### What it is _not_

- Not a UI
- Not tied to Web Audio APIs
- Not a renderer
- Not a service

### Core design principles

**Environment independence**

- Runs in browser, Web Workers, and Node.js
- Accepts a canonical AudioData interface (not AudioBuffer)

**Pure transformation**

- Deterministic mappings: AudioData → AnalysisData
- No global state or clocks

**Whole-track first**

- Look-ahead and look-back are normal
- Enables perceptually meaningful features

**Inspectability over automation**

- Outputs are meant to be inspected and questioned

**Replaceable backend**

- Current TS/WebGPU implementation is not a permanent constraint

---

## 2. Web UI “Lab” (Next.js)

### What it is

An interactive "laboratory" for audio interpretation.

- Load audio
- View waveforms
- Run MIR analyses
- Visualise 1D, 2D, and event-based outputs
- Inspect intermediate data
- Refine results manually
- Very experimental: select an audio segment and search for similar occurrences, even if combined into the mix.

### Design principles

**Human-in-the-loop is optional**

- The Lab supports judgement but is never required

**Data transparency**

- Intermediate representations are first-class

**Fast iteration**

- Browser-based by design

**Orchestration, not ownership**

- Produces an audio interpretation package

---

## 3. Rendering Engine (Rust / wgpu / WASM)

### What it is

A **deterministic visual execution engine** that renders visuals from:

- an audio interpretation package, which is the MIR outputs enriched by human analysis.
- a visual preset (script + shaders)

### Design principles

**Deterministic execution**

- Identical outputs across environments

**GPU-first**

- All rendering via wgpu

**Headless by design**

- Offline rendering is first-class

**Previewable in the the browser**

- WASM support so the visualisation can be previewed in the webapp "lab"

---

## 4. Rhai Scripting Interface

### What it is

A **Lua-inspired scripting layer** for defining scenes and behaviour.

### Design principles

**Scripts express intent**

- Heavy computation lives outside scripts

**Persistent state**

- Enables memory and anticipation

**Explicit primitives**

- mesh.cube()
- line.strip({ max_points })

**Frame-aligned inputs**

- Decimation and smoothing are engine concerns

**Discoverability**

- Inputs and outputs are inspectable

**Full lookahead / lookbehind**

- Scripts are not subject to realtime constraints, so can look into the audio interpretation package data from before and after the current playback position

---

## The Audio Interpretation Package

A serialisable contract containing:

- audio
- MIR signals
- perceptual traits
- optional annotations

It bridges interpretation and execution.

---

## Project Philosophy

- Understanding comes before expression
- Humans maintain interpretative and artistic control
- Visuals much be deterministic and repeatable
- Scripts declare, engines execute
- Data should be visible
- Offline capability is essential

---

## Development

### Project Structure

Octoseq is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/):

```
octoseq/
├── apps/
│   └── web/              # Next.js web application ("Lab")
├── packages/
│   ├── mir/              # TypeScript MIR library (WebGPU)
│   └── visualiser/       # Rust/WASM rendering engine
├── turbo.json            # Turborepo task configuration
└── pnpm-workspace.yaml   # Workspace definition
```

### Prerequisites

- **Node.js** 20.x or later
- **pnpm** 10.x (`corepack enable` to use the version specified in package.json)
- **Rust toolchain** (for building the visualiser locally)
  - Install via [rustup](https://rustup.rs/)
  - Add the WASM target: `rustup target add wasm32-unknown-unknown`
  - Install wasm-pack: `cargo install wasm-pack`

### Local Development

```bash
# Install dependencies
pnpm install

# Build the WASM visualiser (required before first run)
pnpm build:wasm

# Start development server (all apps/packages in watch mode)
pnpm dev

# Build all packages
pnpm build

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run tests
pnpm test

# Format code
pnpm format
```

The web app will be available at `http://localhost:3000`.

### Package-Specific Commands

| Package               | Build                                          | Dev                              |
| --------------------- | ---------------------------------------------- | -------------------------------- |
| `@octoseq/mir`        | `pnpm --filter @octoseq/mir build`             | `pnpm --filter @octoseq/mir dev` |
| `@octoseq/visualiser` | `pnpm --filter @octoseq/visualiser build:wasm` | —                                |
| `web`                 | `pnpm --filter web build`                      | `pnpm --filter web dev`          |

---

## CI/CD Pipeline

### GitHub Actions: Build & Publish

The [build-and-publish.yml](.github/workflows/build-and-publish.yml) workflow handles building and publishing the library packages.

**Triggers:**

- Push to `main` branch (when `packages/visualiser/**`, `packages/mir/**`, or the workflow file changes)
- Push of version tags (`v*`)
- Manual dispatch (with optional publish flag)

**Jobs:**

1. **build-visualiser** — Builds the Rust/WASM visualiser:
   - Sets up Rust toolchain with `wasm32-unknown-unknown` target
   - Builds with `wasm-pack build --target web`
   - Publishes to npm

2. **build-mir** — Builds the TypeScript MIR library:
   - Installs dependencies with pnpm
   - Builds with `tsup`
   - Publishes to npm

**Versioning:**

- **Release builds** (tags like `v1.0.0`): Uses the version from `package.json` as-is, published with the `latest` npm tag
- **Prerelease builds** (pushes to `main`): Appends `-main.<short-sha>` to the version (e.g., `0.1.0-main.abc1234`), published with the `dev` npm tag

### Vercel Deployment

The web app at [octoseq.xyz](https://octoseq.xyz) is deployed via Vercel. The deployment uses a custom install script ([scripts/vercel-install.sh](scripts/vercel-install.sh)) that:

1. Waits for the corresponding npm packages (with matching git SHA) to be published
2. Updates the workspace to use the published npm packages instead of local builds
3. Runs `pnpm install` with the resolved versions

This approach ensures Vercel uses pre-built WASM artifacts from npm rather than attempting to compile Rust during deployment. The script includes retry logic to handle the race condition where GitHub Actions may still be publishing when Vercel starts building.

---

## Status

Octoseq is **experimental**.

Its purpose is to discover whether musical structure and interpretation can be extracted and visualised meaningfully.

### What's implemented

The project is actively evolving, but the following pieces are already working at a proof-of-concept level:

**MIR library**

- GPU-accelerated MIR pipeline implemented in TypeScript with WebGPU
- Runs in browser, Web Workers, and Node.js
- Implemented analyses include:
  - basic 1D signals (e.g. amplitude, flux, centroid)
  - 2D representations (spectrogram, mel spectrogram, HPSS)
  - sparse events (onsets / peaks)
- Whole-track (non-realtime) analysis is supported
- Outputs are designed to be inspectable and visualisable, not just consumed blindly

**Web UI “Lab”**

- Audio loading and waveform display
- Viewport-synchronised visualisation of:
  - waveform
  - 1D MIR signals
  - 2D MIR data (spectrogram-like views)
  - sparse event timelines
- Ability to run MIR analyses on demand and inspect intermediate results
- Experimental “audio search” feature:
  - select an audio segment
  - attempt to find similar occurrences elsewhere in the track
  - manual refinement of candidates
  - currently exploratory and not considered robust

**Rendering engine**

- Rust + wgpu based rendering engine
- Deterministic execution model
- Can run:
  - headless/offline (CLI, faster-than-realtime)
  - in the browser via WASM for preview
- GPU-first rendering with no software fallback
- Rendering engine itself contains no baked-in scene logic

**Rhai scripting**

- Rhai scripting integrated as the visual control layer
- Scripts run once per visual frame with persistent state
- Scripts can:
  - define scene content (no hardcoded geometry in Rust)
  - create mesh instances (e.g. cubes, planes)
  - create procedural line primitives (e.g. sparklines / oscilloscopes)
  - update transforms and properties over time
- Inputs to scripts include frame-aligned MIR-derived scalar signals
- Basic scripting DX in the web UI:
  - Monaco editor
  - Rhai syntax highlighting
  - hover tooltips and autocomplete for available inputs
  - script logging surfaced to the JS console and CLI output

Overall, the system already supports an end-to-end loop:  
audio → MIR analysis → inspected data → scripted visual → deterministic render.

### Next steps

Near-term development is focused on validating the **core hypothesis** of the project:  
that perceptually meaningful structure can be extracted from music and used to drive compelling visuals.

Planned next steps include:

**1. Visual scripting maturity**

- Expand the Rhai scene API incrementally:
  - materials
  - camera control
  - additional procedural primitives
- Improve scripting ergonomics and debugging affordances
- Build a small library of reference visuals to serve as a testbed

**2. Perceptual trait extraction (proof of concept)**

- Define a provisional ontology of perceptual traits (e.g. energy, density, tension, anticipation, release)
- Implement 2–3 traits end-to-end using whole-track context and lookahead/lookbehind
- Validate traits visually by mapping them to simple but expressive visuals
- Refine MIR or search techniques only insofar as they support trait extraction

**3. Strengthen the interpretation–execution contract**

- Formalise the “audio interpretation package” format
- Ensure it can be:
  - generated automatically
  - enriched manually in the Lab
  - consumed headlessly by the rendering engine
- Keep the boundary stable so alternative MIR backends can be explored later

**4. Offline rendering workflows**

- Improve CLI tooling for batch rendering
- Support parameter sweeps and preset iteration
- Focus on repeatability and determinism rather than realtime interactivity

Search, automatic classification, and robustness across genres are considered **supporting tools**, not headline goals, and will only be pursued insofar as they help extract or validate perceptual structure.

At this stage, the primary goal is not polish or completeness, but to determine whether the underlying idea is musically and visually meaningful at all.
