# Redesign: Track In, Video Out

Status: **agreed direction** (November 2026). This defines the deliverable for a
ground-up rethink of Octoseq. It supersedes the "lab first" framing of the phase 1–3
docs; those remain accurate descriptions of the code as it stands. Nothing here is
implemented yet. Sketches marked _illustrative_ are not specifications.

## Problem

Octoseq today is an interpretation lab. Nothing renders until someone has authored
bands and events and written a Rhai script, so getting anything fun to watch takes a
large amount of human work. The visual language is a scene of objects on a blank
background rather than the continuous, flowing image that Milkdrop produces.

## Deliverable

**An audio file goes in and a watchable video comes out with no human input.
Editing is a small layer on top of a generated result, and that layer grows over
time.**

### Requirements

Kept from the current project:

- A modern music visualisation tool
- Deterministic outputs
- Outputs a human can edit
- Extensive audio pre-processing, including stem separation (which may be delegated
  to an external service)
- 3D modelling integration

New:

- Good, fun output out of the box for any track
- Silkier output, closer to Milkdrop
- Promptable: the input can be audio plus a text prompt that influences the result
- Rendered video is the final output, but live preview is a first-class feature,
  because the editor is meant to be enriched incrementally

Dropped:

- The heavy browser client. Not everything needs to be doable in the browser.
- The extensive editing interface. The first editable thing is the timing of
  transitions between scenes.

### Principle changes

- **Automation decides by default; humans override.** This reverses the current
  "automation proposes, humans promote" rule.
- **Determinism is defined at the render boundary:** the same analysis bundle, show
  file and engine version produce identical frames. Steps that are not reproducible
  (external stem separation, a language model choosing scenes) record their output
  so they are never re-run during a render.
- "Signals everywhere" and "whole-track analysis" are unchanged.

## Architecture

Three artefacts, each generated from the one before.

| Artefact            | What it is                                                                                     | Written by                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Analysis bundle** | Everything extracted from the track, cached and pinned per audio file                          | Machine only                                     |
| **Show file**       | A short timeline: scene per section, transitions, style, seed, the prompt, and human overrides | The director (automatic), then edited by a human |
| **Render**          | Video with the audio muxed in, plus a lower-quality live preview from the same engine          | Engine                                           |

### Analysis bundle

Target contents: stems, beats and downbeats, tempo, sections (intro, verse, drop and
so on), drum hits by type, vocal activity, melody contour, key, and a slow energy arc.

- A batch worker runs once per track and writes the bundle. This is the only place
  Python is allowed. The director, engine, preview and render contain none.
- Stem separation goes to an external API; its output is stored in the bundle.
- Prefer models that export to ONNX, so the worker can later be replaced by Rust
  without changing anything downstream.
- The existing Interpretation Package v1
  ([phase3-interpretation-package.md](phase3-interpretation-package.md)) is the
  starting point for the bundle format.

### Scenes and roles

Scenes ask for musical roles rather than named signals. A scene declares that it
needs, say, `kick`, `energy` and `section_progress`; the director binds those from
the bundle. A scene can never be left unwired.

_Illustrative_ starting role set: `beat`, `downbeat`, `bar_phase`, `kick`, `snare`,
`hat`, `bass`, `vocal_presence`, `melody_contour`, `energy`, `section_progress`,
`section_intensity`.

Every scene also exposes the same style controls, so one prompt or one edit means the
same thing across scenes. _Illustrative_ set: palette, motion speed, turbulence,
density, symmetry, brightness.

Scenes are authored in Rhai against the existing scripting API. Rhai becomes the
scene author's language, not something a user has to touch.

### Director

The director turns a bundle (and optionally a prompt) into a show file.

- **Default:** rule-based and seeded. It changes scene at section boundaries, matches
  scene intensity to the energy arc, and can be re-rolled with a new seed.
- **Prompted:** a language model sees a summary of the bundle, the scene catalogue
  and the prompt, and returns a show file. The prompt and every choice are recorded
  in the show file. Rendering never calls a model.

Prompt depth:

1. **Selection and style** — which scenes, palette, motion character, transition
   style. **In scope.**
2. **Generated assets** — textures or 3D models made from the prompt. Future.
3. **Generated scenes** — the model writes new scene code, checked by compiling and
   test-rendering it. Future, but the scene contract should not rule it out.

### Show file

Human-readable text. Generated choices and human overrides are stored separately, so
re-running the director does not discard edits.

_Illustrative:_

```toml
track = "dontstop.mp3"
seed = 7
prompt = "dark, slow, monochrome"

[style]
palette = "ash"
motion_speed = 0.4

[[section]]            # generated by the director
start = 0.0
scene = "ink-tunnel"
transition_in = { kind = "warp-blend", bars = 2 }

[[override]]           # written by a human or the editor
section = 3
transition_start = 61.25
```

### Engine

Keep the Rust/wgpu engine in `packages/visualiser`. It already has the renderer, the
signal graph, a feedback module, post-processing, a native CLI with ffmpeg output and
a WASM build.

Changes needed for the Milkdrop quality:

- **Feedback-first compositing.** The base layer is a warp field applied to the
  previous frame in HDR float buffers. Other content is drawn into that loop, so it
  leaves trails.
- **Motion driven by time, modulated by audio.** Signals are smooth by default.
  Because the whole track is known, smoothing can be zero-lag and motion can ease
  into a beat before it lands.
- **Blended transitions.** Both scenes render and their warp fields are mixed,
  rather than cross-fading the output.
- **Sub-frame accumulation** on offline renders for motion blur.
- **Role binding** between scenes and the bundle.

Standing constraint: every engine feature must work under WebGPU, because the preview
is the same engine compiled to WASM.

### Preview and editor

A thin local web page: waveform, section markers, scene blocks and draggable
transition points, with the WASM engine rendering the preview at reduced resolution.
Anything without a control in the page stays editable as text in the show file until
it earns one.

Previews run on the user's machine, so an eventual hosted service only pays for final
renders.

### 3D

Octoseq's own engine stays the renderer. Blender's renderers cannot be embedded:
Eevee is not a library and has no browser build, Cycles is a path tracer, and linking
Blender code would make the engine GPL. Running Blender as a separate process is
fine.

- **Engine:** a bounded glTF subset — meshes, cameras, node animation, textured
  materials (base colour, emissive, normal) and one environment map. The engine
  currently loads OBJ only, with one directional light and no textures.
- **Blender as baker:** a headless Blender step bakes lighting into textures and
  bakes rigs, modifiers, geometry nodes and physics into plain animated meshes. The
  engine plays these back and needs no shadows, skinning or simulation.
- **Audio reactivity for baked content:** the animation playhead is a signal.
- **Role tags:** custom properties set in Blender mark objects with musical roles and
  travel through glTF.

## What happens to the existing code

| Area                         | Fate                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `packages/visualiser` (Rust) | Kept and extended; the core of the new system                           |
| Interpretation Package v1    | Evolves into the analysis bundle                                        |
| Rhai scripting API           | Kept as the scene-authoring layer                                       |
| `packages/mir` (TypeScript)  | No longer the analysis backbone; replaced by the analysis worker        |
| `apps/web`                   | Frozen. The timeline page is new and small; reuse pieces where they fit |

## Milestones

1. **Proof of fun.** One command, track to mp4, no UI and no prompt.
   - Analysis worker writes the bundle
   - Engine: role binding, feedback-first compositing, blended transitions
   - 3–5 scenes with shared style controls; rule-based director
   - **Exit test:** ten tracks across genres, each watchable to the end unedited
2. **Preview and first edits.** Web timeline over the WASM engine: drag transition
   points, swap the scene for a section, re-roll.
3. **Prompt.** Model-backed director at depth 1.
4. **3D.** glTF subset, Blender baking pipeline, model slots in scenes.
5. **Later:** generated assets and scenes (prompt depths 2 and 3), then the upload
   service.

The upload service is deliberately last: it is only worth building once milestone 1's
exit test passes.

## Decisions

| Question       | Decision                                                              |
| -------------- | --------------------------------------------------------------------- |
| Primary output | Rendered video; live preview is first-class                           |
| Audience       | Local tool first; hosted upload service after outputs are proven fun  |
| Analysis stack | Python accepted, confined to the batch worker; stems via external API |
| Timeline UI    | Thin local web page over the WASM engine                              |
| Prompt depth   | Depth 1 now; 2 and 3 are future items                                 |
| 3D direction   | Deep import from Blender into Octoseq's engine, with Blender as baker |
| Renderer       | Keep the existing engine; do not adopt Bevy or three.js               |

## Deferred

- **Octoseq as a Blender plugin.** Signal-driven rigs and lights that cast real
  shadows belong here: Blender renders, Octoseq supplies the analysis bundle as
  animation data. Revisit after milestone 4.
- **Unbaked 3D in the engine.** If live lights or signal-driven rigs are wanted
  inside Octoseq's own engine, reconsider adopting Bevy at that point.

## Still to specify

- Which analysis models and which stem separation provider
- The role set and the shared style controls (the lists above are starting points)
- The show file schema, and how overrides survive a re-run of the director
- The scene contract: how a scene declares roles, style controls and model slots
- The ten-track test set for milestone 1
