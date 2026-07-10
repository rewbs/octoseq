# Octoseq Example Scripts

This collection showcases the full capabilities of the Octoseq Rhai scripting engine. Each script demonstrates different features and techniques for creating audio-reactive visualizations.

## Scripts

### 1. Spectral Flower (`01-spectral-flower.rhai`)

A blooming flower visualization driven by frequency bands.

**Features:**

- Radial wave primitives
- Frequency band signals (bass, mids, highs)
- Event extraction and envelope generation
- Gradient materials
- Lighting with rim highlights
- Blob shadows
- Post-processing (bloom, vignette)

**Visual:** Eight petals orbit a central sphere, each reacting to different frequency bands. A radial wave ring pulses with bass energy. Colors cycle through the spectrum while petal positions create a flower-like formation.

---

### 2. Particle Storm (`02-particle-storm.rhai`)

Dynamic particle bursts with warping feedback trails.

**Features:**

- Event-driven particle systems
- Point cloud primitives
- Multi-stage feedback warping (radial + noise)
- HSV color shifting in feedback
- Soft additive material
- Chromatic aberration
- Radial blur post-processing

**Visual:** Particles burst on strong onsets against a rotating point cloud. Feedback creates swirling trails with color shifts, while radial blur adds motion emphasis.

---

### 3. Audio Ribbon Dance (`03-audio-ribbon-dance.rhai`)

Flowing ribbons trace multiple signals through 3D space.

**Features:**

- Line ribbons (tube mode with twist)
- Line traces for 2D signal visualization
- Signal composition (weighted combination)
- Lighting with rim highlights
- Blob shadows with dynamic opacity
- Time-based orbital motion
- Color grading

**Visual:** Three ribbons (bass, mid, high) flow through 3D space in different orbital patterns. 2D signal traces show RMS and flux on side panels. A central guide sphere follows the combined signal.

---

### 4. Frequency Reactor (`04-frequency-reactor.rhai`)

Multi-layered frequency visualization with hierarchical organization.

**Features:**

- Scene groups
- Entity instancing
- Signal time-shifting (delay/anticipate)
- Multiple material types (gradient, wire_glow, soft_additive)
- Beat density signals
- Audio-reactive lighting intensity
- Per-entity shadows

**Visual:** Three concentric rings of objects orbit a central core, each ring responding to different frequency bands (bass=outer, mids=middle, highs=inner). Delay followers demonstrate time-shifted signals.

---

### 5. Psychedelic Feedback Tunnel (`05-psychedelic-feedback-tunnel.rhai`)

Warped feedback with extensive post-processing layers.

**Features:**

- Multi-stage feedback warping (spiral + noise + shear)
- Feedback sampling after effects (accumulating bloom)
- Color posterization in feedback
- Generated signals (Perlin noise, sine oscillators)
- Beat density calculation
- Extensive post-processing chain:
  - Bloom
  - Chromatic aberration
  - Zoom wrap
  - Film grain
  - Color grading
  - Directional blur
- Dynamic effect parameter updates

**Visual:** A large emissive sphere creates a tunnel effect. Six orbiters cycle through HSV colors. Complex feedback warping creates psychedelic trails. Signal traces show energy, flux, and centroid. All effects accumulate through feedback for intense visual density.

---

## Features Coverage

| Feature                 | Script 1 | Script 2 | Script 3 | Script 4 | Script 5 |
| ----------------------- | -------- | -------- | -------- | -------- | -------- |
| **Primitives**          |
| mesh.sphere/cube/plane  | ✓        | ✓        | ✓        | ✓        | ✓        |
| radial.wave/ring        | ✓        |          |          |          |          |
| line.ribbon             |          |          | ✓        |          |          |
| line.trace              |          |          | ✓        |          | ✓        |
| points.cloud            |          | ✓        |          |          |          |
| particles.from_events   |          | ✓        |          |          |          |
| **Signals**             |
| Frequency bands         | ✓        |          | ✓        | ✓        |          |
| Event extraction        | ✓        | ✓        |          | ✓        | ✓        |
| Signal smoothing        | ✓        | ✓        | ✓        | ✓        | ✓        |
| Signal composition      |          |          | ✓        |          |          |
| Time shifting (delay)   |          |          |          | ✓        |          |
| Generated signals       |          |          |          |          | ✓        |
| Beat density            |          |          |          |          | ✓        |
| **Scene**               |
| Groups                  |          |          |          | ✓        |          |
| Instancing              |          |          |          | ✓        |          |
| **Materials**           |
| emissive                | ✓        | ✓        | ✓        | ✓        | ✓        |
| gradient                | ✓        |          |          | ✓        |          |
| wire_glow               |          |          |          | ✓        |          |
| soft_additive           |          | ✓        |          | ✓        |          |
| **Lighting**            |
| Global lighting         | ✓        |          | ✓        | ✓        |          |
| Audio-reactive lighting |          |          |          | ✓        |          |
| Rim lighting            | ✓        |          | ✓        |          |          |
| Blob shadows            | ✓        |          | ✓        | ✓        |          |
| **Feedback**            |
| Warp effects            |          | ✓        |          |          | ✓        |
| Color effects           |          | ✓        |          |          | ✓        |
| Multi-stage warping     |          | ✓        |          |          | ✓        |
| Sample after effects    |          |          |          |          | ✓        |
| **Post-Processing**     |
| Bloom                   | ✓        | ✓        | ✓        | ✓        | ✓        |
| Vignette                | ✓        |          |          | ✓        |          |
| Color grading           |          |          | ✓        |          | ✓        |
| Chromatic aberration    |          | ✓        |          |          | ✓        |
| Radial blur             |          | ✓        |          |          |          |
| Directional blur        |          |          |          |          | ✓        |
| Zoom wrap               |          |          |          |          | ✓        |
| Grain                   |          |          |          |          | ✓        |

## Usage

1. Load any script in the Octoseq web app
2. Ensure you have frequency bands configured (Bass, Mids, Highs)
3. Load audio and run MIR analysis
4. Play back to see the visualization

## Learning Path

**Beginners:** Start with Script 1 (Spectral Flower) to understand basic concepts.

**Intermediate:** Try Scripts 3 (Ribbons) and 4 (Reactor) for signal composition and scene organization.

**Advanced:** Explore Scripts 2 and 5 for complex feedback and post-processing techniques.

## Customization

All scripts use the declarative Signal API extensively. Try modifying:

- Smoothing parameters (attack/decay times)
- Event extraction thresholds
- Material parameters
- Feedback warp strengths
- Post-processing intensities

The scripts are designed to be self-documenting with inline comments explaining each feature.
