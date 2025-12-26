# OCTOSEQ_CONTEXT

This file is a shared architectural/context reference for future work on Octoseq. It is synthesized from the repository’s docs (`README.md`, `ARCHITECTURE.md`, `scripting.md`) and the current code layout (`apps/web`, `packages/mir`, `packages/visualiser`).

⸻

## 1. Project Overview

Octoseq is an experimental, work-in-progress system for turning a *music track* into a *deterministic visual output* (previewable in a web “lab”, renderable headlessly/offline). It targets the gap between low-level audio-reactive features and musically/visually meaningful structure by making “audio understanding” explicit, inspectable, and (optionally) human-refined.

It is **not a realtime visualiser** because its core workflows assume whole‑track context and offline determinism:
- Analysis is “whole-track first” (lookahead/lookbehind are normal), which realtime systems can’t assume.
- Interpretation can involve manual judgement and revision, which doesn’t fit a 60fps live loop.
- Execution targets repeatable renders (including headless/offline), not live performance constraints.

The project is organized around a **two-phase model**:

1) **Interpretation**
- Analyze audio into MIR outputs (signals, 2D representations, sparse events).
- Optionally refine or author higher-level structure (e.g. musical time segments; frequency band structures; search refinement labels).
- Produce a stable, serialisable “interpretation” input for downstream rendering (the “audio interpretation package” concept).

2) **Execution**
- Run a deterministic visual engine that consumes the interpretation data plus a programmable visual preset (Rhai script + renderer primitives).
- Scripts declare visual intent; the engine evaluates signal graphs and renders frames deterministically (native CLI or WASM preview).

⸻

## 2. Core Architectural Principles

These are the “laws” that the codebase repeatedly reinforces:

1) **Authored state is authoritative; derived state is disposable**
- Structures that represent *decisions* (e.g. musical time segments, frequency bands) are treated as source-of-truth.
- Values that can be derived from those decisions (e.g. beat times, beat position, frequency bounds at time) are intentionally computed, not stored.

2) **Determinism beats cleverness**
- The system is designed so the same inputs (audio + authored interpretation + preset/script) yield identical outputs across environments.
- “Randomness” is treated as seeded/deterministic where it exists (e.g. noise generators in the signal system).

3) **Whole-track context is normal**
- Both analysis and scripting assume lookahead/lookbehind are available; the system is not built around realtime constraints.

4) **Human-in-the-loop is first-class (and optional)**
- Automation may propose, rank, or assist, but must not silently become authoritative.
- Examples in code/docs: band proposals are explicitly described as *advisory* and require user promotion; musical time is “explicitly authored, not inferred silently”.

5) **Scripts declare intent; engines execute**
- Rhai scripts are a control layer, not a compute substrate.
- Heavy work (DSP, feature extraction, signal evaluation, event extraction) lives in the host engine(s), not in scripts.

6) **Persist decisions, not computations**
- Persistence focuses on durable user choices and structures (with versioning and provenance).
- Cached computed results (MIR outputs, band MIR caches, etc.) are treated as recomputable working state rather than durable project assets.

7) **Stable contracts enable replaceable backends**
- The MIR implementation is explicitly not a permanent constraint; the architecture aims to keep the interpretation–execution boundary stable enough to swap analysis backends later.

⸻

## 3. Major Subsystems and Their Roles

### MIR library (`packages/mir`)

**Owns**
- Deterministic audio analysis primitives and pipelines (DSP + optional GPU acceleration).
- Canonical audio payload interface(s) and analysis result types.
- “Interpretation-side” utilities like beat/tempo hypotheses, musical time computations, frequency band utilities, band-scoped MIR, and within-track similarity search.

**Must not own**
- UI concerns, rendering concerns, or project persistence.
- Global clocks/stateful execution semantics (it is designed as pure transformations).
- Hidden “final decisions” about meaning/structure (it should expose inspectable data, not silently commit interpretations).

### Frequency band system (spans `packages/mir` + `apps/web` + `packages/visualiser`)

**Owns**
- A versioned, authored `FrequencyBandStructure` describing semantic frequency regions (possibly time-varying via segments/keyframes).
- Validation/query utilities and band-scoped analysis (masking + per-band MIR signals).
- Automated *proposals* for candidate bands (explicitly described as ephemeral/advisory until user promotes them).

**Must not own**
- Automatic authority: proposals must not auto-persist or silently modify authored structures.
- Rendering logic or UI state (those belong to execution/UI layers).
- Treating band semantics as implicitly “true” or auto-inferred; bands remain authored decisions even when automation can suggest candidates.

### Scripting engine (Rhai) (`packages/visualiser` + `scripting.md`)

**Owns**
- The sandboxed Rhai runtime and its host-provided APIs (scene creation, signal graph construction, event extraction, debug emission).
- Persistent script variables/state across frames (for “memory” and anticipation effects).

**Must not own**
- Heavy computation or large data processing (the API is designed so scripts build graphs/intent).
- Direct access to system resources or uncontrolled side effects (sandbox limits and restricted APIs are part of the design).
- Persistence of project state beyond the script itself (project decisions live outside scripts).

### Visualisation engine (Rust/WASM) (`packages/visualiser`)

**Owns**
- Deterministic frame execution and rendering (wgpu), including headless/offline rendering and WASM preview.
- The runtime evaluation of signal graphs and event extraction (lazy evaluation; beat-aware operations when musical time is available).
- A script-driven scene graph (entities created/managed by scripts; renderer is intentionally “logic-free”).

**Must not own**
- MIR analysis/interpretation logic (it consumes interpretation data; it does not create it).
- UI state, persistence, or “meaning” decisions about the music.

### Interpretation package (conceptual contract between phases)

**Owns**
- The boundary object: “what execution is allowed to know” about the track.
- The durable authored/curated structures needed for deterministic rendering (conceptually: audio identity + selected MIR outputs + authored musical time + authored frequency bands + optional annotations/traits).

**Must not own**
- Renderer outputs, transient caches, or “post-hoc” derived computations that can be recomputed from source + authored decisions.
- Implicit/opaque interpretation: changes to interpretation should be explicit, inspectable, and attributable (provenance).

*Note:* The docs describe this package as a core contract, while the current implementation still passes signals/structures through in-app plumbing rather than a single finalized file format.

### Persistence / project management layer (`apps/web` stores)

**Owns**
- Local-first persistence of authored decisions keyed to an audio identity (e.g. musical time structures and frequency band structures stored in `localStorage`, with import/export).
- Persistence of user configuration that affects analysis ergonomics (config store).

**Must not own**
- Persistence of derived MIR result caches as “truth”.
- Hidden migration of authored meaning without explicit user action (versioning/provenance exist to keep decisions auditable).

⸻

## 4. Active Milestone Tracks

These are the work “tracks” that are visible in code/docs today.

### F (Frequency)

**Problems it addresses**
- Creating and editing semantic frequency regions (bands), including time-varying boundaries.
- Computing per-band MIR (“band-scoped MIR”) and surfacing those as scriptable inputs.
- Experimenting with automated band discovery as advisory proposals (CQT-driven heuristics).

**Current stage (as evidenced in code)**
- Clearly active and explicitly labeled in code as F1–F5:
  - F1: band structures + validation/query utilities
  - F2: keyframe-based editing helpers + rich UI state for manipulation
  - F3: band masking + band-scoped MIR features
  - F4: per-band signals surfaced into the scripting inputs namespace (via WASM plumbing)
  - F5: CQT + automated “band proposals”

### V (Visualisation)

**Problems it addresses**
- Deterministic rendering from scripts + interpretation inputs (native + WASM).
- A script-driven scene graph with a minimal but extensible primitive set.

**Current stage (as evidenced in code/docs)**
- Functional proof-of-concept: wgpu-based renderer, scene graph, Rhai integration, WASM preview, and a headless/offline CLI path.
- Explicitly positioned as “no baked-in scene logic”; visual richness is expected to come from scripts + incremental API growth (materials/camera/primitives are listed as next steps in docs).

### P (Persistence)

**Problems it addresses**
- Local-first persistence of authored interpretation decisions per audio track.
- Import/export/versioning of durable interpretation structures.

**Current stage (as evidenced in code)**
- Present but narrow: localStorage persistence exists for musical time structures and frequency band structures (keyed by a simple audio identity), plus persisted analysis configuration.
- A broader “project” layer (multi-asset packaging, durable MIR result storage, sharing/versioning beyond localStorage) is not represented as a first-class subsystem yet.

### Scripting / Signal algebra

**Problems it addresses**
- Making visual logic programmable while keeping computation deterministic and host-controlled.
- Providing a declarative signal-processing model (lazy signal graphs, beat-aware operations, event extraction, generators) that scripts can compose.

**Current stage (as evidenced in code/docs)**
- Substantial core exists: immutable `Signal` graphs, smoothing/normalisation/gating/time shifting, sampling modes, deterministic generators, and an event extraction pipeline (`EventStream`).
- Documented scripting surface area (including sandbox limits and design principles) suggests this is an actively shaped DSL rather than a thin “bind everything” wrapper.

*Related labeled track:* A beat/musical-time track appears in MIR and UI code as B1–B4 (tempo hypotheses, phase alignment/beat grids, authored musical time), and is already integrated into beat-aware signal operations.

⸻

## 5. Explicit Non-Goals and Guardrails

These guardrails are stated directly in the docs or enforced by the architecture/types:

- **No black-box “audio in → visuals out” pipeline.** Interpretation is first-class, inspectable, and can be revised.
- **No realtime constraint as a design requirement.** Whole-track analysis, lookahead/lookbehind, and offline/headless rendering are primary use cases.
- **No “silent authority” from automation.** Automated outputs (e.g. band proposals) are advisory and require explicit user promotion; musical time and bands are explicitly authored, not inferred silently.
- **No heavy DSP inside scripts.** Scripts build intent/graphs; the engine evaluates (and scripts run within explicit sandbox limits).
- **No renderer-owned scene logic.** The visualiser provides primitives and execution; scripts define the scene and behavior.
- **Search / classification are supporting tools, not headline goals.** They are pursued only insofar as they help extract/validate perceptual structure (per README).
- **No dependency on a single MIR backend.** The current TS/WebGPU implementation is treated as replaceable; contracts are intended to outlive implementations.

⸻

## 6. Open Questions / Intentional Unknowns

These areas are explicitly evolving or not yet finalized in the current repo state:

- **Final form of the “audio interpretation package”.** Docs describe it as the key contract, but a single canonical on-disk/package format is not yet the dominant interface across tools.
- **Perceptual trait ontology and pipelines.** Docs describe “perceptual traits” as a near-term research target, but concrete trait extraction is not yet the primary implemented surface.
- **Scripting language choice long-term.** Rhai is the current pragmatic choice; a future move to Lua (or similar) is explicitly considered.
- **Scope of persistence/project management.** Today’s persistence is localStorage + import/export for selected authored structures; broader project/versioning/sharing workflows are not yet represented as core infrastructure.
- **How far the visual API expands.** Materials, cameras, additional primitives, and richer debugging are planned, but their eventual shape and boundaries are intentionally incremental.
- **How much “interpretation assistance” becomes productized.** Search refinement, band proposals, and other helpers exist, but are explicitly positioned as supporting mechanisms rather than the project’s thesis.

⸻

## 7. How to Use This Context

- Treat this file as assumed background for all future Octoseq tasks (design, debugging, implementation, documentation).
- Future prompts may reference the concepts here implicitly (interpretation vs execution, authored vs derived state, advisory automation, determinism).
- If a requested change appears to conflict with this document, raise the conflict explicitly before proceeding (do not silently “correct” the architecture).
