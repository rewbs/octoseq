# CLAUDE.md

This file provides guidance for Claude Code when working with the Octoseq codebase.

## Project Overview

Octoseq is an experimental system for transforming music into deterministic visuals. It uses a two-phase creative approach:

1. **Interpretation**: Extract audio structure through MIR (Music Information Retrieval) analysis with human refinement
2. **Execution**: Render deterministic, reproducible visuals from structured interpretation using Rhai scripts

Live at: https://octoseq.xyz

## Tech Stack

| Component       | Technology                                                    |
| --------------- | ------------------------------------------------------------- |
| **Web App**     | Next.js 16, React 19, Tailwind CSS v4, Zustand, Monaco Editor |
| **MIR Library** | TypeScript, WebGPU compute shaders, fft.js                    |
| **Visualiser**  | Rust, wgpu, Rhai scripting, wasm-bindgen                      |
| **Monorepo**    | pnpm workspaces, Turborepo                                    |

## Project Structure

```
octoseq/
├── apps/web/              # Next.js web application
│   └── src/
│       ├── app/           # App Router pages
│       ├── components/    # React components by domain
│       ├── lib/           # Zustand stores, hooks, utilities
│       └── workers/       # Web Workers
├── packages/
│   ├── mir/               # MIR analysis library (TypeScript)
│   │   └── src/
│   │       ├── dsp/       # Digital signal processing
│   │       ├── gpu/       # WebGPU compute kernels
│   │       └── runner/    # Execution orchestration
│   └── visualiser/        # Rendering engine (Rust/WASM)
│       └── src/
│           ├── gpu/       # wgpu rendering pipeline
│           ├── script_*.rs # Rhai scripting
│           └── signal_*.rs # Signal computation
```

## Common Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm build:wasm           # Build WASM (required before first dev)
pnpm dev                  # Start dev servers

# Building
pnpm build                # Build all packages
pnpm --filter web build   # Build web app only
pnpm --filter @octoseq/mir build        # Build MIR library
pnpm --filter @octoseq/visualiser build:wasm  # Build WASM

# Quality
pnpm typecheck            # TypeScript checking
pnpm lint                 # ESLint
pnpm test                 # Run tests
pnpm format               # Format with Prettier

# Rust (from packages/visualiser/)
cargo build --release     # Native binary
cargo test                # Run Rust tests
cargo check               # Fast type checking
```

## Key Architectural Patterns

### Determinism First

All outputs are deterministic - same inputs produce identical results. Random values use explicit seeds.

### Whole-Track Analysis

MIR has access to entire audio with lookahead/lookbehind, enabling perceptually meaningful features.

### Human-in-the-Loop

Automation proposes; humans decide. Band proposals are ephemeral until user promotes them.

### Signal Computation Graph

Lazy-evaluated signal graphs with transformations (smoothing, normalization, gating) assigned to entity properties for automatic per-frame evaluation.

### Signals Everywhere (Numeric Parameters)

**Core Principle**: All APIs that accept numeric parameters should also accept Signals. A Signal resolves to a number at runtime (per-frame evaluation). This enables audio-reactive control of any numeric property without requiring imperative code.

When implementing new APIs or reviewing existing ones:

- If a parameter is `f32`/`f64`/number, it should accept `Signal | f32`
- The engine evaluates Signals during scene sync, before rendering
- This applies to: entity properties, material parameters, effect parameters, feedback settings, etc.

### State Management

The web app is built on a **unified stream model** (`apps/web/src/lib/streams/` —
see [docs/design/phase1-unified-streams.md](docs/design/phase1-unified-streams.md)).
Everything analysable is a Stream: the mixdown, stems, and frequency bands
(virtual streams over a parent's frequency region). Analyses are addressed
`(streamId, analysisId)` regardless of stream kind.

Core modules in `lib/streams`:

- `streamStore` - The stream collection (mixdown/stems/bands incl. band definitions)
- `analysisStore` - THE analysis cache, keyed `streamId::analysisId::paramsHash`
- `analysisRunner` - `runStreamAnalysis(streamId, analysisId)` dispatches on stream kind
- `streamActions` - Coordinated mutations (edits invalidate analyses explicitly)
- `audioSourceStore` - Playback-source authority (URL resolution lifecycle)
- `audioCache` / `rawFileCache` - Decoded PCM / original bytes (non-reactive)
- `bandEditingStore` - Ephemeral band-authoring UI state
- `display.ts` - Normalize-at-the-edge helpers (`toDisplaySignal`, `toUiResult`)

Remaining domain stores in `lib/stores`: `timingStore` (beat grid + musical time +
manual tempo), `projectStore` (schema v2: `Project.streams`, version-checked
load), signal/event stores (derived/composed/authored/candidate), `playbackStore`,
`mirStore` (display UI state only — no results).

## Development Notes

### WASM Workflow

Changes to `packages/visualiser/` require rebuilding WASM:

```bash
pnpm build:wasm
```

### Workspace Dependencies

- Dev: Uses `workspace:*` (symlinks)
- Production: Vercel uses pre-built npm packages via custom install script

### Web Workers

MIR analysis runs in Web Workers to avoid blocking the UI thread.

## Build Loop (redesign work)

Octoseq is being redesigned (see
[docs/design/redesign-deliverable.md](docs/design/redesign-deliverable.md)). That work
is built with an automated render-and-score loop so it can proceed in large chunks
without waiting on a person. Read [docs/loop/README.md](docs/loop/README.md) before
starting redesign work.

```bash
python3 tools/loop/run.py --jobs 8   # render every scene on every test track and score it, eight clips at a time
python3 tools/loop/selftest.py   # after changing tools/loop/analyse.py or metrics.py
python3 tools/loop/accuracy.py   # score analysis timing against tracker-module ground truth
```

- Run the loop after any change to the engine, scenes or analysis, and look at the
  contact sheets it writes, not only the numbers.
- Do not stop for a judgement call. Take the most reversible default and record it
  in [docs/loop/queue.md](docs/loop/queue.md); that file is the batched list of
  everything waiting on the project owner.
- Run the accuracy loop after any change to analysis. It needs the instrumented
  module player (`tools/loop/modplayer/build.sh`) and, for the full corpus,
  `python3 tools/loop/corpus.py restore`. `--quick` uses only the committed fixtures.
- Use the loops to choose and prove work, not only to catch breakage.
  [docs/loop/scoreboard.md](docs/loop/scoreboard.md) shows each part of the analysis
  against its target: work on the rows furthest from target, name the row a change
  is meant to move, and keep the change only if that row improves on the held-out
  split without another falling. Then run `accuracy.py --save-baseline`, which
  rewrites the scoreboard, and commit it with the change.
- Model-based analysers need `tools/loop/models/setup.sh`, then run the loop as
  `.loop/venv/bin/python tools/loop/accuracy.py`. Save the baseline from that
  environment, or the scoreboard will lose the models' rows.
- [docs/loop/handover.md](docs/loop/handover.md) says where the work stood on 24 November
  2026: read it before picking the redesign up.
- New analysers (local models, hosted APIs) are registered in
  `tools/loop/analysers.py` so the accuracy loop scores them like any other. Tune
  only on the training split; never look at held-out modules while tuning.
- A hard-gate failure means the output is broken. Do not loosen a gate to make a run
  pass; gates change only in response to human ratings.
- Headless rendering needs a Vulkan driver. Without a GPU:
  `apt-get install -y mesa-vulkan-drivers`.
- On Windows the loops run in WSL2, from a checkout inside the Linux filesystem
  ([docs/loop/setup.md](docs/loop/setup.md)). Rendering goes through a second build
  of the engine made for Windows: run `tools/loop/win-engine.sh` again after
  changing anything in `packages/visualiser`, or the loop renders with a stale engine.
- Run the accuracy loop with `.loop/venv/bin/python` to include the model analysers.
  Their results are cached; the first run after a model or its settings change is
  slow. Do not run other GPU work while it is going.
- The render loop's bundles take drum hits from the Demucs drum stem when the model
  environment exists. Save the render baseline only on a machine that has it.
- Milkdrop, rendered through projectM, is the reference for how the picture should
  move. Every render report ends with our clips beside it; read that table, and
  [docs/design/milkdrop-study.md](docs/design/milkdrop-study.md) before writing a scene.
- New scenes ask for musical roles (`//! roles: kick, energy`, then `roles.kick`),
  never for named signals. The roles and what binds them are in
  `tools/loop/roles.py` and `scripting.md`.
- The feedback loop's settings mean "per thirtieth of a second". Anything new that
  acts once a step must be scaled to the step's length, or it runs four times as fast
  at 120 steps a second; the render loop checks that a 30 fps render made with
  `--step-rate 120` is the 120 fps render, byte for byte.
- An audio file's analysis bundle is made once by `tools/loop/worker.py` and kept in
  `.loop/analysis`; shows are only reproducible while it is. Do not clear that
  directory casually. The worker takes each part's analyser from
  `accuracy_baseline.json`, so saving the accuracy baseline is what changes how later
  bundles are made.
- Stem sources live behind `tools/loop/stems.py`. The hosted ones cost money per new
  file: results are cached and their scores recorded, so never clear
  `.loop/cache/stems` casually. Keys come from the environment or `.env`; never
  print, log or commit one.
- Every scene keeps a contract, checked by `tools/loop/contract.py`. After writing or
  changing a scene run `contract.py --render scenes/<name>.rhai`: it renders the
  scene as it stands, at its crispest and at its mistiest, and all three must pass
  the hard gates. `scripting.md` has the shapes the scenes are built from and the
  script language's traps.
- Fifty of the scenes were each written from a Milkdrop preset
  (`tools/loop/preset_pool.json`, [docs/design/preset-pool.md](docs/design/preset-pool.md)).
  After saving the render baseline run `python3 tools/loop/presets.py table`, which
  rewrites that file from it.
- The picture must answer the music, and `tools/loop/response.py` measures whether it
  does: `answered`, `answered_rolls`, `jump_size`, `undone`, `dead_time`. Work on
  scenes is judged by those first. Change one thing at a time and test it on a few
  scenes before a full scan: three changes made together once hid that two of them
  made things worse. An answer must be sudden and visible, and not taken back at
  once: it eases back, or it stays (a turn, a change of direction). One that is gone
  by the next frame was rated "twitchy, not punchy".
- Every scene's main movement follows `roles.hit`, which is every kick and snare,
  and ends with `post.answer(style.answer, style.kick, roles.hit, style.at);`. The
  engine shapes that answer; `style.answer` picks one of nine.
- The loops can run on a rented GPU machine ([docs/loop/setup.md](docs/loop/setup.md)).
  It takes the code from GitHub: never copy the working tree to it, which holds `.env`.
- The director takes a brief (`director.BRIEF_PARTS`): keep it plain data, and keep
  its refusals saying what would have been right. It is how a prompt will reach the
  engine.

## Coding Conventions

### TypeScript

- Functional components with hooks
- Type imports: `import type { Foo } from './foo'`
- 2-space indentation, 100-char line width
- camelCase for variables/functions, PascalCase for components/types

### Rust

- Edition 2021
- Platform-specific code uses `#[cfg(target_arch = "wasm32")]`
- Error handling with `anyhow`

## Important Files

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed system design
- [scripting.md](scripting.md) - Rhai scripting API and examples
- [packages/mir/src/index.ts](packages/mir/src/index.ts) - MIR library entry
- [packages/visualiser/src/lib.rs](packages/visualiser/src/lib.rs) - Visualiser entry
- [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) - Web app entry

## CI/CD

GitHub Actions builds and publishes packages on push to `main` or version tags (`v*`).
Vercel deployment waits for matching npm packages before building.
