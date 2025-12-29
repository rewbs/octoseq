# CLAUDE.md

This file provides guidance for Claude Code when working with the Octoseq codebase.

## Project Overview

Octoseq is an experimental system for transforming music into deterministic visuals. It uses a two-phase creative approach:
1. **Interpretation**: Extract audio structure through MIR (Music Information Retrieval) analysis with human refinement
2. **Execution**: Render deterministic, reproducible visuals from structured interpretation using Rhai scripts

Live at: https://octoseq.xyz

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Web App** | Next.js 16, React 19, Tailwind CSS v4, Zustand, Monaco Editor |
| **MIR Library** | TypeScript, WebGPU compute shaders, fft.js |
| **Visualiser** | Rust, wgpu, Rhai scripting, wasm-bindgen |
| **Monorepo** | pnpm workspaces, Turborepo |

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
Zustand stores with actions in hooks (`useMirActions`, `useBandMirActions`, etc.):
- `audioStore` - Audio data
- `playbackStore` - Playback position
- `mirStore` - MIR analysis results
- `beatGridStore` - Beat/tempo data
- `frequencyBandStore` - Frequency bands

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
