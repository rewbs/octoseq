# Octoseq Scripting Guide

Octoseq uses **Rhai**, a lightweight embedded scripting language, to create audio-reactive visualisations. Scripts run in a sandboxed environment with full access to audio analysis data and a declarative signal processing API.

## Table of Contents

- [Script Structure](#script-structure)
- [Scene Graph API](#scene-graph-api)
- [Signal API](#signal-api)
- [Event Extraction API](#event-extraction-api)
- [Generator Functions](#generator-functions)
- [Examples](#examples)
- [Reference](#reference)

---

## Sidenote: Why Rhai?

Rhai is a practical early choice for Octoseq today because its user-space language features are sufficient for expressing signal transformations, and its Rust + WASM integration is excellent and reliable.

Its known weaknesses include a limited ecosystem and weak DSL-friendly customization at the language level (e.g. operator overloads etc...). These are acceptable in the short term and align with Octoseq’s current stage.

A future move to Lua (or a Lua-like language) will be considered once there is a mature, ergonomic Rust + WASM integration that allows deeper host-driven language shaping.

## Script Structure

Every script has two entry points:

```rhai
fn init(ctx) {
    // Called once after script load
    // Use for: creating entities, initial setup
}

fn update(dt, frame) {
    // Called once per frame during playback
    // dt: delta time in seconds since last frame
    // frame: map of available per-frame input samples (numbers)
}
```

### Persistent State

Variables declared at the top level persist across frames:

```rhai
let phase = 0.0;  // Survives across update() calls

fn update(dt, frame) {
    phase += dt * 2.0;
    cube.rotation.y = phase;
}
```

---

## Scene Graph API

### Creating Meshes

```rhai
let cube = mesh.cube();      // Create a cube
let plane = mesh.plane();    // Create a plane
let sphere = mesh.sphere();  // Create a sphere
```

Mesh entities have the following properties:

| Property   | Type           | Description                            |
| ---------- | -------------- | -------------------------------------- |
| `position` | `{x, y, z}`    | Position in 3D space                   |
| `rotation` | `{x, y, z}`    | Euler angles in radians                |
| `scale`    | `f32`          | Uniform scale factor (default: 1.0)    |
| `visible`  | `bool`         | Visibility flag                        |
| `color`    | `{r, g, b, a}` | RGBA tint (0.0-1.0, default: white)    |

The `color` property multiplies with the mesh's vertex colors, so white (`{r: 1.0, g: 1.0, b: 1.0, a: 1.0}`) shows the original vertex colors unchanged.

### Creating Line Strips

```rhai
let sparkline = line.strip(#{
    max_points: 256,  // Ring buffer size (default: 256)
    mode: "line"      // "line" or "points" (default: "line")
});
```

Line entities have all mesh properties plus:

| Property/Method | Type           | Description                 |
| --------------- | -------------- | --------------------------- |
| `color`         | `{r, g, b, a}` | RGBA color (0.0-1.0 range)  |
| `push(x, y)`    | method         | Add a 2D point to the strip |
| `clear()`       | method         | Clear all points            |

When `max_points` is reached, the oldest points are overwritten (ring buffer behaviour).

### Scene Management

```rhai
scene.add(entity);     // Add entity to render list
scene.remove(entity);  // Remove entity from render list
```

Entities exist in the scene graph but are only rendered when added to the scene.

### Groups (Hierarchical Transforms)

Groups allow you to organize entities hierarchically. Children inherit their parent's transform.

```rhai
let cube = mesh.cube();
let sphere = mesh.sphere();

let group = scene.group();  // Create a group

// Add children to group
group.add(cube);
group.add(sphere);

// Group transform applies to all children
group.position = #{ x: 2.0, y: 0.0, z: 0.0 };
group.rotation = #{ x: 0.0, y: 1.0, z: 0.0 };
group.scale = 2.0;

// Add group to scene (makes children visible)
scene.add(group);

// Remove a child from group
group.remove(cube);
```

Group properties:

| Property   | Type        | Description                              |
| ---------- | ----------- | ---------------------------------------- |
| `position` | `{x, y, z}` | Position offset for all children         |
| `rotation` | `{x, y, z}` | Rotation applied to all children         |
| `scale`    | `f32`       | Scale multiplier for all children        |
| `visible`  | `bool`      | When false, hides all children           |

Notes:
- Children don't need to be added to the scene individually (group membership implies visibility)
- Nested groups are supported (a group can contain other groups)
- An entity can only belong to one group at a time

### Logging

```rhai
log.info(value);   // Info level (stdout)
log.warn(value);   // Warning level (stderr)
log.error(value);  // Error level (stderr)
```

Values can be strings, numbers, booleans, arrays, or maps. Maximum 100 log messages per frame.

### Debug Tools

The `dbg` namespace provides debugging utilities for development.

#### Signal Emission

```rhai
dbg.emit("my_value", 42.0);  // Emit debug signal during analysis mode
```

Records numeric values for inspection in the debug UI. No-op during playback.

#### Visualization Controls

```rhai
dbg.wireframe(true);       // Enable wireframe rendering
dbg.boundingBoxes(true);   // Show bounding boxes around entities
dbg.isolate(entity);       // Only render this entity (for debugging)
dbg.clearIsolation();      // Resume normal rendering
```

These controls are useful during development to inspect individual entities or visualize mesh structure. Note: Wireframe mode may not be supported on all platforms (e.g., WebGL2 falls back to normal rendering).

### Introspection (DX)

These helpers are provided by the host (not by Rhai), and are powered by the same
Script API metadata as editor autocomplete/hover:

```rhai
// Human-readable summaries
log.info(help(mesh));
log.info(help("Signal"));

// Structured (JSON-like) descriptions
log.info(describe(mesh));
log.info(describe(inputs));

// Targeted docs lookup
log.info(doc("Signal.add"));
log.info(doc("EventStream.to_signal"));
```

---

## Signal API

The Signal API provides a **declarative, lazy computation graph** for audio-reactive signal processing. Signals are immutable - all operations return new signals.

### Accessing Input Signals

There are two related “inputs” concepts:

- `frame` (the second `update()` parameter): per-frame sampled values (numbers)
- `inputs` (global): Signal graph accessors (returns `Signal` objects for building graphs/events)

Per-frame sampled values are accessed from the map passed to `update()`:

```rhai
fn update(dt, frame) {
    let energy = frame.energy;
    let centroid = frame.spectralCentroid;
    let onset = frame.onsetEnvelope;
    // Signal names depend on the audio analysis package
}
```

### Arithmetic Operations

```rhai
let sum = signal1.add(signal2);      // Add two signals
let sum = signal.add(0.5);           // Add constant
let product = signal1.mul(signal2);  // Multiply signals
let scaled = signal.scale(2.0);      // Multiply by constant
let mixed = sig1.mix(sig2, 0.5);     // Blend: 0.0=sig1, 1.0=sig2
```

### Smoothing

All timing parameters are in **beats** (not seconds).

```rhai
// Moving average over window
let smoothed = signal.smooth.moving_average(0.5);

// Asymmetric exponential smoothing
let smoothed = signal.smooth.exponential(
    0.1,   // attack_beats (fast response to increases)
    0.5    // release_beats (slow response to decreases)
);

// Gaussian smoothing
let smoothed = signal.smooth.gaussian(0.25);  // sigma_beats
```

### Normalisation

```rhai
// Min-max normalisation using whole-track statistics
let normalized = signal.normalise.global();

// Robust percentile-based (5th-95th percentile, ignores outliers)
let normalized = signal.normalise.robust();

// Direct range mapping
let normalized = signal.normalise.to_range(0.0, 1.0);
```

### Gating

```rhai
// Simple threshold: 1.0 if >= threshold, else 0.0
let gated = signal.gate.threshold(0.5);

// Hysteresis gate (prevents flickering)
let gated = signal.gate.hysteresis(
    0.6,  // on_threshold: must exceed to turn on
    0.4   // off_threshold: must drop below to turn off
);
```

### Math Operations

```rhai
let clamped = signal.clamp(0.0, 1.0);  // Clamp to range
let floored = signal.floor();           // Round down
let ceiled = signal.ceil();             // Round up
let rate = signal.diff();               // Derivative: (current - prev) / dt
let accum = signal.integrate(2.0);      // Cumulative sum with decay (0 = no decay)
```

### Time Shifting

```rhai
let delayed = signal.delay(0.5);       // Look 0.5 beats into the past
let ahead = signal.anticipate(0.5);    // Look 0.5 beats into the future (input signals only)
```

### Sampling Configuration

By default, input signals use **peak-preserving sampling** with a window equal to the frame delta time (`dt`). This ensures transients and peaks are not lost when downsampling high-frequency signals (like audio at 44.1kHz) to low-frequency evaluation (like 60fps rendering).

You can override this behavior:

```rhai
// Use linear interpolation (no peak preservation)
// Useful for smooth signals like spectral centroid where peaks aren't critical
let smooth = inputs.spectralCentroid.interpolate();

// Explicitly use peak-preserving with frame dt (same as default)
let peaks = inputs.onsetEnvelope.peak();

// Custom window size in beats
// Larger window captures peaks over a longer period
let wide_peaks = inputs.energy.peak_window(0.25);  // 0.25 beats

// Custom window size in seconds
let timed_peaks = inputs.energy.peak_window_sec(0.05);  // 50ms
```

**When to use each strategy:**

| Strategy | Best For | Notes |
|----------|----------|-------|
| `peak()` (default) | Transient signals (onset, energy) | Preserves spikes that would be missed at low frame rates |
| `interpolate()` | Smooth signals (centroid, flux) | More accurate continuous values |
| `peak_window(beats)` | Custom temporal resolution | Larger window = more aggressive peak capture |

**Note:** Sampling configuration only affects `Input` and `BandInput` signals. For other signals (constants, generators, transformations), these methods return the signal unchanged.

### Debug Probes

```rhai
let probed = signal.probe("my_signal");  // Attach non-invasive probe
```

Emits signal values during analysis mode. The signal value passes through unchanged.

---

## Event Extraction API

Events are sparse, time-ordered moments extracted from signals - useful for onset detection, beat tracking, and triggering envelopes.

### Extracting Events

```rhai
let events = inputs.onsetEnvelope
    .smooth.exponential(0.1, 0.5)
    .pick.events(#{
        hysteresis_beats: 0.25,     // Minimum gap between events
        target_density: 2.0,         // Target events per beat
        min_threshold: 0.1,          // Minimum threshold after normalisation
        phase_bias: 0.2,             // Prefer on-beat events (0.0-1.0)
        weight_mode: "peak_height",  // "peak_height" or "integrated_energy"
        energy_window_beats: 0.25,   // Window for integrated_energy mode
        similarity_tolerance: 0.1,   // Group similar peaks
        adaptive_factor: 0.5         // Adaptive threshold factor
    });
```

### EventStream Methods

```rhai
events.len();                           // Count of events
events.is_empty();                      // Boolean check
events.get(0);                          // Get event at index (returns () if out of bounds)
events.to_array();                      // Convert to iterable array

let span = events.time_span();  // Time span as [start, end] in seconds
let start = span[0];
let end = span[1];
let max = events.max_weight();          // Maximum event weight
let min = events.min_weight();          // Minimum event weight

// Filtering
let filtered = events.filter_time(0.0, 10.0);  // Filter by time range (seconds)
let filtered = events.filter_weight(0.5);       // Filter by minimum weight
let limited = events.limit(100);                // Keep first N events
```

### Event Properties

Each event has the following properties:

| Property        | Type  | Description                    |
| --------------- | ----- | ------------------------------ |
| `time`          | `f32` | Time in seconds                |
| `weight`        | `f32` | Salience/importance (0.0-1.0)  |
| `beat_position` | `f32` | Continuous beat position       |
| `beat_phase`    | `f32` | Phase within beat (0.0-1.0)    |
| `cluster_id`    | `i64` | Cluster ID (-1 if unclustered) |

### Converting Events to Signals

Events can be converted back to continuous signals with envelope shaping:

```rhai
// Simple impulses (height = weight)
let impulses = events.to_signal();

// Shaped envelopes
let envelope = events.to_signal(#{
    envelope: "attack_decay",   // Envelope shape (see below)
    attack_beats: 0.05,         // Attack time
    decay_beats: 0.5,           // Decay time
    easing: "quadratic_out",    // Easing function (see below)
    overlap_mode: "sum"         // How overlapping envelopes combine
});
```

#### Envelope Shapes

| Shape                 | Description                      | Parameters                                                                       |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `"impulse"`           | Single-frame spike               | -                                                                                |
| `"step"`              | Instant rise, holds indefinitely | -                                                                                |
| `"attack_decay"`      | Rise then fall                   | `attack_beats`, `decay_beats`                                                    |
| `"adsr"`              | Full ADSR envelope               | `attack_beats`, `decay_beats`, `sustain_level`, `sustain_beats`, `release_beats` |
| `"gaussian"`          | Bell curve                       | `width_beats` (approx 95% of bell)                                               |
| `"exponential_decay"` | Exponential falloff              | `decay_beats`                                                                    |

#### Easing Functions

| Easing               | Description                 |
| -------------------- | --------------------------- |
| `"linear"`           | Linear interpolation        |
| `"quadratic_in"`     | Slow start, fast end        |
| `"quadratic_out"`    | Fast start, slow end        |
| `"quadratic_in_out"` | Slow start and end          |
| `"cubic_in"`         | Slower start than quadratic |
| `"cubic_out"`        | Faster start than quadratic |
| `"cubic_in_out"`     | Smooth S-curve              |
| `"exponential_in"`   | Very slow start             |
| `"exponential_out"`  | Very fast start             |
| `"smoothstep"`       | Hermite interpolation       |
| `"elastic"`          | Springy overshoot           |

#### Overlap and Merge Modes

| Parameter            | Options                    | Description                            |
| -------------------- | -------------------------- | -------------------------------------- |
| `overlap_mode`       | `"sum"`, `"max"`           | How overlapping envelopes combine      |
| `group_within_beats` | `f32`                      | Group events closer than this distance |
| `merge_mode`         | `"sum"`, `"max"`, `"mean"` | How grouped event weights combine      |

---

## Generator Functions

Create synthetic signals using the `gen` namespace:

```rhai
// Oscillators (frequency in cycles per beat)
let sine = gen.sin(1.0, 0.0);           // freq_beats, phase
let square = gen.square(1.0, 0.0, 0.5); // freq_beats, phase, duty (0.0-1.0)
let triangle = gen.triangle(1.0, 0.0);  // freq_beats, phase
let saw = gen.saw(1.0, 0.0);            // freq_beats, phase

// Noise generators
let white = gen.noise("white", 42);     // type, seed
let pink = gen.noise("pink", 42);       // type, seed
let perlin = gen.perlin(1.0, 42);       // scale_beats, seed

// Constants
let const_signal = gen.constant(1.5);
```

---

## Examples

This section provides progressively complex examples demonstrating the full capabilities of the scripting API.

### Example 1: Basic Audio-Reactive Cube

A minimal example showing reactive rotation and scaling.

```rhai
let phase = 0.0;

fn update(dt, inputs) {
    // Spin faster with more spectral flux
    phase += dt * (0.5 + inputs.spectralFlux * 2.0);
    cube.rotation.y = phase;

    // Subtle wobble using time-based sine
    cube.rotation.x = 0.1 * (inputs.time * 2.0).sin();

    // Pulse with amplitude
    cube.scale = 1.0 + inputs.amplitude * 0.5;
}
```

---

### Example 2: Onset-Triggered Flash

Extract discrete events from the onset envelope and convert them back to shaped envelopes.

```rhai
fn update(dt, inputs) {
    // Extract onset events with preprocessing
    let onsets = inputs.onsetEnvelope
        .smooth.exponential(0.05, 0.3)  // Quick attack, slower release
        .normalise.robust()              // Ignore outliers
        .pick.events(#{
            hysteresis_beats: 0.25,      // Minimum 1/4 beat between events
            target_density: 2.0          // ~2 events per beat
        });

    // Convert to envelope signal with fast attack, slow decay
    let flash = onsets.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.25,
        easing: "exponential_out"
    });

    // Apply to cube scale
    cube.scale = 1.0 + flash * 0.5;
}
```

---

### Example 3: Sparkline Visualisation

Create a scrolling waveform display using a line strip.

```rhai
let sparkline = line.strip(#{
    max_points: 256,
    mode: "line"
});

fn init(ctx) {
    sparkline.color = #{ r: 0.0, g: 1.0, b: 0.5, a: 1.0 };
    sparkline.position = #{ x: -2.0, y: 0.0, z: 0.0 };
    scene.add(sparkline);
}

fn update(dt, inputs) {
    // Push smoothed energy values
    let energy = inputs.amplitude
        .smooth.exponential(0.1, 0.3)
        .normalise.robust();

    sparkline.push(inputs.time, energy);
}
```

---

### Example 4: Beat-Synced Pulsing

Combine generated oscillators with audio input for musically-aware animation.

```rhai
fn update(dt, inputs) {
    // Generate sine wave at 1 cycle per beat
    let pulse = gen.sin(1.0, 0.0)
        .add(1.0)     // Shift from [-1,1] to [0,2]
        .scale(0.5);  // Scale to [0,1]

    // Mix with onset envelope for more punch
    let onset = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.2)
        .normalise.robust();

    let combined = pulse.mix(onset, 0.5);

    cube.scale = 0.5 + combined * 0.5;
}
```

---

### Example 5: Multi-Object Scene with Layered Reactivity

Create multiple entities that respond to different aspects of the audio.

```rhai
// Create scene entities
let center_cube = mesh.cube();
let orbit_cube_1 = mesh.cube();
let orbit_cube_2 = mesh.cube();
let floor_plane = mesh.plane();

// Persistent animation state
let orbit_phase = 0.0;
let color_hue = 0.0;

fn init(ctx) {
    // Position floor
    floor_plane.position = #{ x: 0.0, y: -2.0, z: 0.0 };
    floor_plane.rotation = #{ x: -1.57, y: 0.0, z: 0.0 };  // -PI/2
    floor_plane.scale = 5.0;

    // Add all entities to scene
    scene.add(center_cube);
    scene.add(orbit_cube_1);
    scene.add(orbit_cube_2);
    scene.add(floor_plane);
}

fn update(dt, inputs) {
    // === CENTER CUBE: React to low frequencies ===
    let bass = inputs.amplitude
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    center_cube.scale = 0.8 + bass * 0.6;
    center_cube.rotation.y += dt * 0.5;

    // === ORBITING CUBES: React to onsets ===
    let onset_signal = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.15)
        .normalise.robust();

    // Orbit speed increases with spectral flux
    let flux = inputs.spectralFlux.normalise.robust();
    orbit_phase += dt * (1.0 + flux * 2.0);

    // First orbiter
    let radius1 = 2.0 + onset_signal * 0.5;
    orbit_cube_1.position = #{
        x: radius1 * orbit_phase.cos(),
        y: 0.5 + onset_signal * 0.3,
        z: radius1 * orbit_phase.sin()
    };
    orbit_cube_1.scale = 0.3 + onset_signal * 0.2;
    orbit_cube_1.rotation.x = orbit_phase * 2.0;

    // Second orbiter (opposite phase)
    let phase2 = orbit_phase + 3.14159;
    let radius2 = 2.5 + onset_signal * 0.3;
    orbit_cube_2.position = #{
        x: radius2 * phase2.cos(),
        y: 0.3,
        z: radius2 * phase2.sin()
    };
    orbit_cube_2.scale = 0.25;
    orbit_cube_2.rotation.z = orbit_phase * -1.5;

    // === FLOOR: Subtle brightness pulse ===
    let brightness = inputs.spectralCentroid
        .smooth.moving_average(0.5)
        .normalise.global();

    // Floor visibility pulses with spectral centroid
    floor_plane.visible = brightness > 0.3;
}
```

---

### Example 6: Advanced Signal Processing Pipeline

Demonstrate complex signal chaining with comparison between raw and processed signals.

```rhai
let raw_line = line.strip(#{ max_points: 512, mode: "line" });
let processed_line = line.strip(#{ max_points: 512, mode: "line" });
let gated_line = line.strip(#{ max_points: 512, mode: "line" });

fn init(ctx) {
    // Raw signal - red
    raw_line.color = #{ r: 1.0, g: 0.3, b: 0.3, a: 0.8 };
    raw_line.position = #{ x: 0.0, y: 1.5, z: 0.0 };

    // Processed signal - green
    processed_line.color = #{ r: 0.3, g: 1.0, b: 0.3, a: 0.8 };
    processed_line.position = #{ x: 0.0, y: 0.0, z: 0.0 };

    // Gated signal - blue
    gated_line.color = #{ r: 0.3, g: 0.3, b: 1.0, a: 0.8 };
    gated_line.position = #{ x: 0.0, y: -1.5, z: 0.0 };

    scene.add(raw_line);
    scene.add(processed_line);
    scene.add(gated_line);
}

fn update(dt, inputs) {
    let time = inputs.time;

    // === RAW SIGNAL ===
    // Just normalise for display
    let raw = inputs.onsetEnvelope
        .normalise.global()
        .probe("raw_onset");  // Emit for debugging

    // === PROCESSED SIGNAL ===
    // Full processing pipeline
    let processed = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.1)  // Fast attack, moderate release
        .normalise.robust()              // Percentile-based normalisation
        .clamp(0.0, 1.0)                 // Ensure bounds
        .probe("processed_onset");

    // === GATED SIGNAL ===
    // Use hysteresis to prevent flickering
    let gated = processed
        .gate.hysteresis(0.6, 0.3)  // On at 0.6, off at 0.3
        .probe("gated_onset");

    // Push all signals to their respective sparklines
    raw_line.push(time, raw);
    processed_line.push(time, processed);
    gated_line.push(time, gated);
}
```

---

### Example 7: Event-Driven Particle Burst Effect

Use event extraction to trigger discrete visual events with ADSR envelopes.

```rhai
// Create a grid of cubes to act as "particles"
let particles = [];
let particle_count = 16;

fn init(ctx) {
    // Create particle grid
    for i in 0..particle_count {
        let p = mesh.cube();
        let row = i / 4;
        let col = i % 4;
        p.position = #{
            x: (col - 1.5) * 1.2,
            y: 0.0,
            z: (row - 1.5) * 1.2
        };
        p.scale = 0.1;  // Start small
        particles.push(p);
        scene.add(p);
    }
}

fn update(dt, inputs) {
    // Extract strong onset events
    let events = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.15)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.5,       // At most 2 events per beat
            target_density: 1.0,          // ~1 event per beat
            min_threshold: 0.4,           // Only strong onsets
            phase_bias: 0.3               // Prefer on-beat events
        });

    // Create burst envelope from events
    let burst = events.to_signal(#{
        envelope: "adsr",
        attack_beats: 0.02,       // Very fast attack
        decay_beats: 0.1,         // Quick decay to sustain
        sustain_level: 0.3,       // Hold at 30%
        sustain_beats: 0.05,      // Brief sustain
        release_beats: 0.3,       // Moderate release
        easing: "quadratic_out",
        overlap_mode: "max"       // Don't accumulate overlapping bursts
    });

    // Staggered delay for wave effect
    for i in 0..particle_count {
        let p = particles[i];

        // Calculate distance from center (0-2 range)
        let row = i / 4;
        let col = i % 4;
        let dist = ((row - 1.5).abs() + (col - 1.5).abs()) / 3.0;

        // Delay burst based on distance from center
        let delayed_burst = burst.delay(dist * 0.1);

        // Apply to particle
        p.scale = 0.1 + delayed_burst * 0.4;
        p.position.y = delayed_burst * 0.5;
        p.rotation.y += dt * (1.0 + delayed_burst * 3.0);
    }
}
```

---

### Example 8: Spectrum Analyzer with Frequency Bands

Visualize different frequency bands using multiple line strips.

```rhai
// Create sparklines for different frequency bands
let bass_line = line.strip(#{ max_points: 256, mode: "line" });
let mid_line = line.strip(#{ max_points: 256, mode: "line" });
let high_line = line.strip(#{ max_points: 256, mode: "line" });

// Create reactive cubes
let bass_cube = mesh.cube();
let mid_cube = mesh.cube();
let high_cube = mesh.cube();

fn init(ctx) {
    // Bass - red, left
    bass_line.color = #{ r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
    bass_line.position = #{ x: -3.0, y: 1.0, z: 0.0 };
    bass_cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };

    // Mid - green, center
    mid_line.color = #{ r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
    mid_line.position = #{ x: 0.0, y: 1.0, z: 0.0 };
    mid_cube.position = #{ x: 0.0, y: 0.0, z: 0.0 };

    // High - blue, right
    high_line.color = #{ r: 0.2, g: 0.2, b: 1.0, a: 1.0 };
    high_line.position = #{ x: 3.0, y: 1.0, z: 0.0 };
    high_cube.position = #{ x: 2.0, y: 0.0, z: 0.0 };

    scene.add(bass_line);
    scene.add(mid_line);
    scene.add(high_line);
    scene.add(bass_cube);
    scene.add(mid_cube);
    scene.add(high_cube);
}

fn update(dt, inputs) {
    let time = inputs.time;

    // Access frequency band data (requires configured bands)
    // Using spectral features as proxies for demonstration
    let bass = inputs.amplitude
        .smooth.exponential(0.05, 0.3)
        .normalise.robust();

    let mid = inputs.spectralCentroid
        .smooth.exponential(0.08, 0.2)
        .normalise.robust();

    let high = inputs.spectralFlux
        .smooth.exponential(0.03, 0.15)
        .normalise.robust();

    // Update sparklines
    bass_line.push(time, bass);
    mid_line.push(time, mid);
    high_line.push(time, high);

    // Update cubes - scale and vertical position
    bass_cube.scale = 0.5 + bass * 0.8;
    bass_cube.position.y = bass * 0.5;
    bass_cube.rotation.y += dt * 0.5;

    mid_cube.scale = 0.4 + mid * 0.6;
    mid_cube.position.y = mid * 0.5;
    mid_cube.rotation.x += dt * 0.7;

    high_cube.scale = 0.3 + high * 0.5;
    high_cube.position.y = high * 0.5;
    high_cube.rotation.z += dt * 1.0;
}
```

---

### Example 9: Anticipation and Delay for Motion Design

Use `anticipate()` and `delay()` to create sophisticated motion timing.

```rhai
let leader = mesh.cube();
let follower1 = mesh.cube();
let follower2 = mesh.cube();
let anticipator = mesh.cube();

fn init(ctx) {
    leader.position = #{ x: -3.0, y: 0.0, z: 0.0 };
    follower1.position = #{ x: -1.0, y: 0.0, z: 0.0 };
    follower2.position = #{ x: 1.0, y: 0.0, z: 0.0 };
    anticipator.position = #{ x: 3.0, y: 0.0, z: 0.0 };

    scene.add(leader);
    scene.add(follower1);
    scene.add(follower2);
    scene.add(anticipator);
}

fn update(dt, inputs) {
    // Base signal from onset envelope
    let base = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.2)
        .normalise.robust();

    // Leader: no delay (current time)
    let leader_signal = base;

    // Follower 1: 0.25 beats behind
    let follower1_signal = base.delay(0.25);

    // Follower 2: 0.5 beats behind
    let follower2_signal = base.delay(0.5);

    // Anticipator: 0.25 beats AHEAD (knows the future!)
    let anticipator_signal = base.anticipate(0.25);

    // Apply to vertical position
    leader.position.y = leader_signal * 2.0;
    follower1.position.y = follower1_signal * 2.0;
    follower2.position.y = follower2_signal * 2.0;
    anticipator.position.y = anticipator_signal * 2.0;

    // Visual feedback: scale indicates timing role
    leader.scale = 0.5;
    follower1.scale = 0.4;
    follower2.scale = 0.35;
    anticipator.scale = 0.6;  // Larger to show it leads
}
```

---

### Example 10: Noise and Procedural Animation

Combine Perlin noise with audio reactivity for organic motion.

```rhai
let cubes = [];
let cube_count = 9;

fn init(ctx) {
    for i in 0..cube_count {
        let c = mesh.cube();
        let row = i / 3;
        let col = i % 3;
        c.position = #{
            x: (col - 1.0) * 2.0,
            y: 0.0,
            z: (row - 1.0) * 2.0
        };
        cubes.push(c);
        scene.add(c);
    }
}

fn update(dt, inputs) {
    // Audio reactivity
    let energy = inputs.amplitude
        .smooth.exponential(0.1, 0.3)
        .normalise.robust();

    // Generate noise signals with different seeds for each cube
    for i in 0..cube_count {
        let c = cubes[i];

        // Each cube gets unique noise (different seed)
        let noise_x = gen.perlin(0.5, i * 3);
        let noise_y = gen.perlin(0.7, i * 3 + 1);
        let noise_z = gen.perlin(0.6, i * 3 + 2);

        // Base position
        let row = i / 3;
        let col = i % 3;
        let base_x = (col - 1.0) * 2.0;
        let base_z = (row - 1.0) * 2.0;

        // Apply noise offset, scaled by energy
        let noise_amount = 0.3 + energy * 0.7;
        c.position = #{
            x: base_x + noise_x * noise_amount,
            y: noise_y * noise_amount * 0.5,
            z: base_z + noise_z * noise_amount
        };

        // Rotation driven by noise
        c.rotation = #{
            x: noise_x * 1.5,
            y: noise_y * 1.5,
            z: noise_z * 1.5
        };

        // Scale pulses with energy
        c.scale = 0.3 + energy * 0.3;
    }
}
```

---

### Example 11: Integration and Accumulation

Use `integrate()` and `diff()` for physics-like and cumulative effects.

```rhai
let velocity_cube = mesh.cube();
let energy_cube = mesh.cube();
let decay_line = line.strip(#{ max_points: 256, mode: "line" });

let accumulated_rotation = 0.0;

fn init(ctx) {
    velocity_cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };
    energy_cube.position = #{ x: 2.0, y: 0.0, z: 0.0 };
    decay_line.position = #{ x: 0.0, y: 2.0, z: 0.0 };
    decay_line.color = #{ r: 1.0, g: 0.8, b: 0.2, a: 1.0 };

    scene.add(velocity_cube);
    scene.add(energy_cube);
    scene.add(decay_line);
}

fn update(dt, inputs) {
    let time = inputs.time;

    // === VELOCITY CUBE: React to rate of change ===
    // diff() gives us the derivative (velocity) of the signal
    let onset_velocity = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.1)
        .diff()                           // Rate of change
        .clamp(-2.0, 2.0)                 // Limit extremes
        .normalise.to_range(-1.0, 1.0);

    // Positive velocity = rising, negative = falling
    velocity_cube.position.y = onset_velocity;
    velocity_cube.scale = 0.5 + onset_velocity.clamp(0.0, 1.0) * 0.3;

    // === ENERGY CUBE: Accumulated energy with decay ===
    // integrate() accumulates the signal over time
    // The decay parameter (2.0) makes old values fade
    let accumulated = inputs.amplitude
        .normalise.robust()
        .integrate(2.0)                   // Accumulate with decay
        .clamp(0.0, 3.0)                  // Prevent runaway growth
        .probe("accumulated_energy");

    energy_cube.scale = 0.3 + accumulated * 0.3;
    accumulated_rotation += dt * accumulated;
    energy_cube.rotation.y = accumulated_rotation;

    // === DECAY LINE: Visualize the accumulation ===
    let normalized_accum = accumulated.scale(0.33);  // Scale to 0-1 range
    decay_line.push(time, normalized_accum);
}
```

---

### Example 12: Complete Music Visualizer

A comprehensive example combining multiple techniques for a full music visualization.

```rhai
// === SCENE ENTITIES ===
let main_cube = mesh.cube();
let floor = mesh.plane();
let beat_indicators = [];
let sparklines = [];

// === STATE ===
let main_rotation = 0.0;
let beat_flash_decay = 0.0;

fn init(ctx) {
    // Main reactive cube
    main_cube.position = #{ x: 0.0, y: 0.5, z: 0.0 };
    scene.add(main_cube);

    // Floor plane
    floor.position = #{ x: 0.0, y: -1.0, z: 0.0 };
    floor.rotation = #{ x: -1.5708, y: 0.0, z: 0.0 };
    floor.scale = 8.0;
    scene.add(floor);

    // Beat indicator ring (8 cubes in a circle)
    for i in 0..8 {
        let indicator = mesh.cube();
        let angle = i * 0.785398;  // 2*PI/8
        indicator.position = #{
            x: 3.0 * angle.cos(),
            y: -0.5,
            z: 3.0 * angle.sin()
        };
        indicator.scale = 0.2;
        beat_indicators.push(indicator);
        scene.add(indicator);
    }

    // Create sparklines for different signals
    let onset_line = line.strip(#{ max_points: 128, mode: "line" });
    onset_line.color = #{ r: 1.0, g: 0.3, b: 0.3, a: 0.8 };
    onset_line.position = #{ x: -5.0, y: 2.0, z: -3.0 };
    sparklines.push(onset_line);
    scene.add(onset_line);

    let centroid_line = line.strip(#{ max_points: 128, mode: "line" });
    centroid_line.color = #{ r: 0.3, g: 1.0, b: 0.3, a: 0.8 };
    centroid_line.position = #{ x: -5.0, y: 1.0, z: -3.0 };
    sparklines.push(centroid_line);
    scene.add(centroid_line);

    let flux_line = line.strip(#{ max_points: 128, mode: "line" });
    flux_line.color = #{ r: 0.3, g: 0.3, b: 1.0, a: 0.8 };
    flux_line.position = #{ x: -5.0, y: 0.0, z: -3.0 };
    sparklines.push(flux_line);
    scene.add(flux_line);
}

fn update(dt, inputs) {
    let time = inputs.time;

    // === SIGNAL PROCESSING ===
    let amplitude = inputs.amplitude
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    let onset = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.15)
        .normalise.robust();

    let centroid = inputs.spectralCentroid
        .smooth.moving_average(0.25)
        .normalise.robust();

    let flux = inputs.spectralFlux
        .smooth.exponential(0.03, 0.1)
        .normalise.robust();

    // === BEAT DETECTION ===
    let beat_events = onset
        .pick.events(#{
            hysteresis_beats: 0.4,
            target_density: 2.0,
            min_threshold: 0.3,
            phase_bias: 0.4
        });

    let beat_envelope = beat_events.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.2,
        easing: "exponential_out"
    });

    // === MAIN CUBE ANIMATION ===
    // Scale reacts to amplitude with beat punch
    main_cube.scale = 0.8 + amplitude * 0.4 + beat_envelope * 0.3;

    // Rotation speed based on flux
    main_rotation += dt * (0.5 + flux * 2.0);
    main_cube.rotation.y = main_rotation;

    // Vertical position follows centroid (brightness)
    main_cube.position.y = 0.5 + centroid * 1.0;

    // Subtle wobble
    main_cube.rotation.x = centroid * 0.3;
    main_cube.rotation.z = flux * 0.2;

    // === BEAT INDICATOR RING ===
    for i in 0..8 {
        let indicator = beat_indicators[i];
        let angle = i * 0.785398 + main_rotation * 0.2;

        // Radius pulses with beat
        let radius = 3.0 + beat_envelope * 0.5;

        indicator.position = #{
            x: radius * angle.cos(),
            y: -0.5 + beat_envelope * 0.3,
            z: radius * angle.sin()
        };

        // Staggered scale animation
        let phase_offset = i * 0.125;  // 1/8 beat offset per indicator
        let delayed_beat = beat_envelope.delay(phase_offset);
        indicator.scale = 0.15 + delayed_beat * 0.25;
    }

    // === SPARKLINES ===
    // Update each signal visualization
    sparklines[0].push(time, onset);
    sparklines[1].push(time, centroid);
    sparklines[2].push(time, flux);

    // === DEBUG OUTPUT ===
    // Emit key signals for debugging
    amplitude.probe("vis_amplitude");
    beat_envelope.probe("vis_beat");
    centroid.probe("vis_centroid");
}
```

---

### Example 13: Debugging and Development Workflow

A template showing best practices for developing and debugging scripts.

```rhai
// === CONFIGURATION ===
// Adjust these values while developing
let DEBUG_MODE = true;
let SMOOTHING_ATTACK = 0.02;
let SMOOTHING_RELEASE = 0.15;
let EVENT_DENSITY = 2.0;
let SCALE_MULTIPLIER = 0.5;

// === ENTITIES ===
let debug_cube = mesh.cube();
let raw_line = line.strip(#{ max_points: 256, mode: "line" });
let processed_line = line.strip(#{ max_points: 256, mode: "line" });

fn init(ctx) {
    raw_line.color = #{ r: 1.0, g: 0.0, b: 0.0, a: 0.5 };
    raw_line.position = #{ x: -3.0, y: 1.0, z: 0.0 };

    processed_line.color = #{ r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
    processed_line.position = #{ x: -3.0, y: -1.0, z: 0.0 };

    scene.add(debug_cube);
    scene.add(raw_line);
    scene.add(processed_line);

    log.info("Script initialized");
    log.info("Debug mode: " + DEBUG_MODE);
}

fn update(dt, inputs) {
    let time = inputs.time;

    // === RAW SIGNAL ===
    let raw = inputs.onsetEnvelope
        .normalise.global();

    // === PROCESSED SIGNAL ===
    let processed = inputs.onsetEnvelope
        .smooth.exponential(SMOOTHING_ATTACK, SMOOTHING_RELEASE)
        .normalise.robust();

    // === EVENT EXTRACTION ===
    let events = processed
        .pick.events(#{
            hysteresis_beats: 0.25,
            target_density: EVENT_DENSITY
        });

    let envelope = events.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.3,
        easing: "exponential_out"
    });

    // === APPLY TO VISUALS ===
    debug_cube.scale = 0.5 + envelope * SCALE_MULTIPLIER;
    debug_cube.rotation.y += dt;

    // === DEBUG VISUALIZATION ===
    if DEBUG_MODE {
        raw_line.push(time, raw);
        processed_line.push(time, processed);

        // Emit signals for external debugging
        raw.probe("dbg_raw");
        processed.probe("dbg_processed");
        envelope.probe("dbg_envelope");

        // Log event count periodically (every ~60 frames)
        if (time * 60.0).floor() % 60 == 0 {
            log.info("Events detected: " + events.len());
        }
    }
}
```

This pattern allows you to:

1. Toggle debug visualizations on/off
2. Tune parameters at the top of the file
3. Compare raw vs processed signals visually
4. Emit signals for the debug UI
5. Log periodic information without flooding the console

---

## Reference

### Signal Methods

| Method                  | Signature                                 | Description                      |
| ----------------------- | ----------------------------------------- | -------------------------------- |
| `add`                   | `(Signal) -> Signal` or `(f32) -> Signal` | Add signals or constant          |
| `mul`                   | `(Signal) -> Signal`                      | Multiply signals                 |
| `scale`                 | `(f32) -> Signal`                         | Multiply by constant             |
| `mix`                   | `(Signal, f32) -> Signal`                 | Blend two signals                |
| `smooth.moving_average` | `(beats: f32) -> Signal`                  | Moving average smoothing         |
| `smooth.exponential`    | `(attack: f32, release: f32) -> Signal`   | Asymmetric exponential smoothing |
| `smooth.gaussian`       | `(sigma: f32) -> Signal`                  | Gaussian smoothing               |
| `normalise.global`      | `() -> Signal`                            | Min-max normalisation            |
| `normalise.robust`      | `() -> Signal`                            | Percentile-based normalisation   |
| `normalise.to_range`    | `(min: f32, max: f32) -> Signal`          | Map to range                     |
| `gate.threshold`        | `(f32) -> Signal`                         | Simple threshold gate            |
| `gate.hysteresis`       | `(on: f32, off: f32) -> Signal`           | Hysteresis gate                  |
| `clamp`                 | `(min: f32, max: f32) -> Signal`          | Clamp to range                   |
| `floor`                 | `() -> Signal`                            | Round down                       |
| `ceil`                  | `() -> Signal`                            | Round up                         |
| `diff`                  | `() -> Signal`                            | Derivative                       |
| `integrate`             | `(decay: f32) -> Signal`                  | Cumulative sum with decay        |
| `delay`                 | `(beats: f32) -> Signal`                  | Time delay                       |
| `anticipate`            | `(beats: f32) -> Signal`                  | Look ahead (input signals only)  |
| `probe`                 | `(name: String) -> Signal`                | Attach debug probe               |
| `interpolate`           | `() -> Signal`                            | Use linear interpolation sampling |
| `peak`                  | `() -> Signal`                            | Use peak-preserving sampling (default) |
| `peak_window`           | `(beats: f32) -> Signal`                  | Peak-preserving with custom window |
| `peak_window_sec`       | `(seconds: f32) -> Signal`                | Peak-preserving with window in seconds |

### Generator Functions

| Function       | Signature                                      | Description     |
| -------------- | ---------------------------------------------- | --------------- |
| `gen.sin`      | `(freq: f32, phase: f32) -> Signal`            | Sine wave       |
| `gen.square`   | `(freq: f32, phase: f32, duty: f32) -> Signal` | Square wave     |
| `gen.triangle` | `(freq: f32, phase: f32) -> Signal`            | Triangle wave   |
| `gen.saw`      | `(freq: f32, phase: f32) -> Signal`            | Sawtooth wave   |
| `gen.noise`    | `(type: String, seed: i64) -> Signal`          | Noise generator |
| `gen.perlin`   | `(scale: f32, seed: i64) -> Signal`            | 1D Perlin noise |
| `gen.constant` | `(value: f32) -> Signal`                       | Constant signal |

### EventStream Methods

| Method          | Signature                               | Description          |
| --------------- | --------------------------------------- | -------------------- |
| `len`           | `() -> i64`                             | Event count          |
| `is_empty`      | `() -> bool`                            | Check if empty       |
| `get`           | `(i64) -> Event or ()`                  | Get event at index   |
| `to_array`      | `() -> Array`                           | Convert to array     |
| `time_span`     | `() -> [f32, f32]`                      | Time span in seconds |
| `max_weight`    | `() -> f32`                             | Maximum weight       |
| `min_weight`    | `() -> f32`                             | Minimum weight       |
| `filter_time`   | `(start: f32, end: f32) -> EventStream` | Filter by time       |
| `filter_weight` | `(min: f32) -> EventStream`             | Filter by weight     |
| `limit`         | `(n: i64) -> EventStream`               | Limit event count    |
| `to_signal`     | `() -> Signal` or `(Map) -> Signal`     | Convert to signal    |

### Sandbox Limits

| Limit                      | Value             |
| -------------------------- | ----------------- |
| Expression recursion depth | 64                |
| Function call depth        | 64                |
| Operations per frame       | 100,000           |
| Max string size            | 10,000 characters |
| Max array size             | 1,000 elements    |
| Max map size               | 500 entries       |
| Log messages per frame     | 100               |

---

## Design Principles

1. **Scripts express intent** - Heavy computation lives in the engine
2. **Lazy evaluation** - Signals build computation graphs, evaluated at render time
3. **Beat-aware** - All time-based operations use beat position when available
4. **Whole-track visibility** - Scripts can look ahead and behind in time
5. **Immutable signals** - All transformations return new signals
6. **Deterministic** - Same audio input always produces identical visuals
