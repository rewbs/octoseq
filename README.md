# Octoseq

**Octoseq** is an experimental, work-in-progress system for turning music into visuals. Some parts have been vibe coded with minimal human inspection, so use at your own risk for now.

It is **not** a single “audio in → visual out” black box and is **not** intended for realtime visuals. It is a **two-phase creative system**:

1. **Interpretation**: extract and refine meaningful structure from the whole audio track (often with a human in the loop)
2. **Execution**: render visuals deterministically from that structured interpretation using programmable visual presets

This separation is the core architectural idea behind the project.

---

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

## Status

Octoseq is **experimental**.

Its purpose is to discover whether musical structure can be extracted and visualised meaningfully.

### What's implemented

### Next steps
