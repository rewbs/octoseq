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

## Script Structure

Every script has two entry points:

```rhai
fn init(ctx) {
    // Called once after script load
    // Use for: creating entities, initial setup
}

fn update(dt, inputs) {
    // Called once per frame during playback
    // dt: delta time in seconds since last frame
    // inputs: map of available input signals
}
```

### Persistent State

Variables declared at the top level persist across frames:

```rhai
let phase = 0.0  // Survives across update() calls

fn update(dt, inputs) {
    phase += dt * 2.0
    cube.rotation.y = phase
}
```

---

## Scene Graph API

### Creating Meshes

```rhai
let cube = mesh.cube()    // Create a cube
let plane = mesh.plane()  // Create a plane
```

Mesh entities have the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `position` | `{x, y, z}` | Position in 3D space |
| `rotation` | `{x, y, z}` | Euler angles in radians |
| `scale` | `f32` | Uniform scale factor (default: 1.0) |
| `visible` | `bool` | Visibility flag |

### Creating Line Strips

```rhai
let sparkline = line.strip(#{
    max_points: 256,  // Ring buffer size (default: 256)
    mode: "line"      // "line" or "points" (default: "line")
})
```

Line entities have all mesh properties plus:

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `color` | `{r, g, b, a}` | RGBA color (0.0-1.0 range) |
| `push(x, y)` | method | Add a 2D point to the strip |
| `clear()` | method | Clear all points |

When `max_points` is reached, the oldest points are overwritten (ring buffer behaviour).

### Scene Management

```rhai
scene.add(entity)     // Add entity to render list
scene.remove(entity)  // Remove entity from render list
```

Entities exist in the scene graph but are only rendered when added to the scene.

### Logging

```rhai
log.info(value)   // Info level (stdout)
log.warn(value)   // Warning level (stderr)
log.error(value)  // Error level (stderr)
```

Values can be strings, numbers, booleans, arrays, or maps. Maximum 100 log messages per frame.

### Debug Signals

```rhai
dbg.emit("my_value", 42.0)  // Emit debug signal during analysis mode
```

Records numeric values for inspection in the debug UI. No-op during playback.

---

## Signal API

The Signal API provides a **declarative, lazy computation graph** for audio-reactive signal processing. Signals are immutable - all operations return new signals.

### Accessing Input Signals

Input signals are accessed from the `inputs` map passed to `update()`:

```rhai
fn update(dt, inputs) {
    let energy = inputs.energy
    let centroid = inputs.spectralCentroid
    let onset = inputs.onsetEnvelope
    // Signal names depend on the audio analysis package
}
```

### Arithmetic Operations

```rhai
let sum = signal1.add(signal2)      // Add two signals
let sum = signal.add(0.5)           // Add constant
let product = signal1.mul(signal2)  // Multiply signals
let scaled = signal.scale(2.0)      // Multiply by constant
let mixed = sig1.mix(sig2, 0.5)     // Blend: 0.0=sig1, 1.0=sig2
```

### Smoothing

All timing parameters are in **beats** (not seconds).

```rhai
// Moving average over window
let smoothed = signal.smooth.moving_average(0.5)

// Asymmetric exponential smoothing
let smoothed = signal.smooth.exponential(
    0.1,   // attack_beats (fast response to increases)
    0.5    // release_beats (slow response to decreases)
)

// Gaussian smoothing
let smoothed = signal.smooth.gaussian(0.25)  // sigma_beats
```

### Normalisation

```rhai
// Min-max normalisation using whole-track statistics
let normalized = signal.normalise.global()

// Robust percentile-based (5th-95th percentile, ignores outliers)
let normalized = signal.normalise.robust()

// Direct range mapping
let normalized = signal.normalise.to_range(0.0, 1.0)
```

### Gating

```rhai
// Simple threshold: 1.0 if >= threshold, else 0.0
let gated = signal.gate.threshold(0.5)

// Hysteresis gate (prevents flickering)
let gated = signal.gate.hysteresis(
    0.6,  // on_threshold: must exceed to turn on
    0.4   // off_threshold: must drop below to turn off
)
```

### Math Operations

```rhai
let clamped = signal.clamp(0.0, 1.0)  // Clamp to range
let floored = signal.floor()           // Round down
let ceiled = signal.ceil()             // Round up
let rate = signal.diff()               // Derivative: (current - prev) / dt
let accum = signal.integrate(2.0)      // Cumulative sum with decay (0 = no decay)
```

### Time Shifting

```rhai
let delayed = signal.delay(0.5)       // Look 0.5 beats into the past
let ahead = signal.anticipate(0.5)    // Look 0.5 beats into the future (input signals only)
```

### Debug Probes

```rhai
let probed = signal.debug("my_signal")  // Attach non-invasive probe
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
    })
```

### EventStream Methods

```rhai
events.len()                           // Count of events
events.is_empty()                      // Boolean check
events.get(0)                          // Get event at index (returns () if out of bounds)
events.to_array()                      // Convert to iterable array

let [start, end] = events.time_span()  // Time span in seconds
let max = events.max_weight()          // Maximum event weight
let min = events.min_weight()          // Minimum event weight

// Filtering
let filtered = events.filter_time(0.0, 10.0)  // Filter by time range (seconds)
let filtered = events.filter_weight(0.5)       // Filter by minimum weight
let limited = events.limit(100)                // Keep first N events
```

### Event Properties

Each event has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `time` | `f32` | Time in seconds |
| `weight` | `f32` | Salience/importance (0.0-1.0) |
| `beat_position` | `f32` | Continuous beat position |
| `beat_phase` | `f32` | Phase within beat (0.0-1.0) |
| `cluster_id` | `i64` | Cluster ID (-1 if unclustered) |

### Converting Events to Signals

Events can be converted back to continuous signals with envelope shaping:

```rhai
// Simple impulses (height = weight)
let impulses = events.to_signal()

// Shaped envelopes
let envelope = events.to_signal(#{
    envelope: "attack_decay",   // Envelope shape (see below)
    attack_beats: 0.05,         // Attack time
    decay_beats: 0.5,           // Decay time
    easing: "quadratic_out",    // Easing function (see below)
    overlap_mode: "sum"         // How overlapping envelopes combine
})
```

#### Envelope Shapes

| Shape | Description | Parameters |
|-------|-------------|------------|
| `"impulse"` | Single-frame spike | - |
| `"step"` | Instant rise, holds indefinitely | - |
| `"attack_decay"` | Rise then fall | `attack_beats`, `decay_beats` |
| `"adsr"` | Full ADSR envelope | `attack_beats`, `decay_beats`, `sustain_level`, `sustain_beats`, `release_beats` |
| `"gaussian"` | Bell curve | `width_beats` (approx 95% of bell) |
| `"exponential_decay"` | Exponential falloff | `decay_beats` |

#### Easing Functions

| Easing | Description |
|--------|-------------|
| `"linear"` | Linear interpolation |
| `"quadratic_in"` | Slow start, fast end |
| `"quadratic_out"` | Fast start, slow end |
| `"quadratic_in_out"` | Slow start and end |
| `"cubic_in"` | Slower start than quadratic |
| `"cubic_out"` | Faster start than quadratic |
| `"cubic_in_out"` | Smooth S-curve |
| `"exponential_in"` | Very slow start |
| `"exponential_out"` | Very fast start |
| `"smoothstep"` | Hermite interpolation |
| `"elastic"` | Springy overshoot |

#### Overlap and Merge Modes

| Parameter | Options | Description |
|-----------|---------|-------------|
| `overlap_mode` | `"sum"`, `"max"` | How overlapping envelopes combine |
| `group_within_beats` | `f32` | Group events closer than this distance |
| `merge_mode` | `"sum"`, `"max"`, `"mean"` | How grouped event weights combine |

---

## Generator Functions

Create synthetic signals using the `gen` namespace:

```rhai
// Oscillators (frequency in cycles per beat)
let sine = gen.sin(1.0, 0.0)           // freq_beats, phase
let square = gen.square(1.0, 0.0, 0.5) // freq_beats, phase, duty (0.0-1.0)
let triangle = gen.triangle(1.0, 0.0)  // freq_beats, phase
let saw = gen.saw(1.0, 0.0)            // freq_beats, phase

// Noise generators
let white = gen.noise("white", 42)     // type, seed
let pink = gen.noise("pink", 42)       // type, seed
let perlin = gen.perlin(1.0, 42)       // scale_beats, seed

// Constants
let const_signal = gen.constant(1.5)
```

---

## Examples

### Basic Audio-Reactive Cube

```rhai
let phase = 0.0

fn update(dt, inputs) {
    // Spin faster with more spectral flux
    phase += dt * (0.5 + inputs.flux * 2.0)
    cube.rotation.y = phase

    // Subtle wobble
    cube.rotation.x = 0.1 * (inputs.time * 2.0).sin()

    // Pulse with amplitude
    cube.scale = 1.0 + inputs.amplitude * 0.5
}
```

### Onset-Triggered Flash

```rhai
fn update(dt, inputs) {
    // Extract onset events
    let onsets = inputs.onsetEnvelope
        .smooth.exponential(0.05, 0.3)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.25,
            target_density: 2.0
        })

    // Convert to envelope signal
    let flash = onsets.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.25,
        easing: "exponential_out"
    })

    // Apply to cube scale
    cube.scale = 1.0 + flash * 0.5
}
```

### Sparkline Visualisation

```rhai
let sparkline = line.strip(#{
    max_points: 256,
    mode: "line"
})

fn init(ctx) {
    sparkline.color = #{ r: 0.0, g: 1.0, b: 0.5, a: 1.0 }
    sparkline.position = #{ x: -2.0, y: 0.0, z: 0.0 }
    scene.add(sparkline)
}

fn update(dt, inputs) {
    // Push smoothed energy values
    let energy = inputs.energy
        .smooth.exponential(0.1, 0.3)
        .normalise.robust()

    sparkline.push(inputs.time, energy)
}
```

### Beat-Synced Pulsing

```rhai
fn update(dt, inputs) {
    // Generate sine wave at 1 cycle per beat
    let pulse = gen.sin(1.0, 0.0)
        .add(1.0)     // Shift from [-1,1] to [0,2]
        .scale(0.5)   // Scale to [0,1]

    // Mix with onset envelope for more punch
    let onset = inputs.onsetEnvelope
        .smooth.exponential(0.02, 0.2)
        .normalise.robust()

    let combined = pulse.mix(onset, 0.5)

    cube.scale = 0.5 + combined * 0.5
}
```

---

## Reference

### Signal Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `add` | `(Signal) -> Signal` or `(f32) -> Signal` | Add signals or constant |
| `mul` | `(Signal) -> Signal` | Multiply signals |
| `scale` | `(f32) -> Signal` | Multiply by constant |
| `mix` | `(Signal, f32) -> Signal` | Blend two signals |
| `smooth.moving_average` | `(beats: f32) -> Signal` | Moving average smoothing |
| `smooth.exponential` | `(attack: f32, release: f32) -> Signal` | Asymmetric exponential smoothing |
| `smooth.gaussian` | `(sigma: f32) -> Signal` | Gaussian smoothing |
| `normalise.global` | `() -> Signal` | Min-max normalisation |
| `normalise.robust` | `() -> Signal` | Percentile-based normalisation |
| `normalise.to_range` | `(min: f32, max: f32) -> Signal` | Map to range |
| `gate.threshold` | `(f32) -> Signal` | Simple threshold gate |
| `gate.hysteresis` | `(on: f32, off: f32) -> Signal` | Hysteresis gate |
| `clamp` | `(min: f32, max: f32) -> Signal` | Clamp to range |
| `floor` | `() -> Signal` | Round down |
| `ceil` | `() -> Signal` | Round up |
| `diff` | `() -> Signal` | Derivative |
| `integrate` | `(decay: f32) -> Signal` | Cumulative sum with decay |
| `delay` | `(beats: f32) -> Signal` | Time delay |
| `anticipate` | `(beats: f32) -> Signal` | Look ahead (input signals only) |
| `debug` | `(name: String) -> Signal` | Attach debug probe |

### Generator Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `gen.sin` | `(freq: f32, phase: f32) -> Signal` | Sine wave |
| `gen.square` | `(freq: f32, phase: f32, duty: f32) -> Signal` | Square wave |
| `gen.triangle` | `(freq: f32, phase: f32) -> Signal` | Triangle wave |
| `gen.saw` | `(freq: f32, phase: f32) -> Signal` | Sawtooth wave |
| `gen.noise` | `(type: String, seed: i64) -> Signal` | Noise generator |
| `gen.perlin` | `(scale: f32, seed: i64) -> Signal` | 1D Perlin noise |
| `gen.constant` | `(value: f32) -> Signal` | Constant signal |

### EventStream Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `len` | `() -> i64` | Event count |
| `is_empty` | `() -> bool` | Check if empty |
| `get` | `(i64) -> Event or ()` | Get event at index |
| `to_array` | `() -> Array` | Convert to array |
| `time_span` | `() -> [f32, f32]` | Time span in seconds |
| `max_weight` | `() -> f32` | Maximum weight |
| `min_weight` | `() -> f32` | Minimum weight |
| `filter_time` | `(start: f32, end: f32) -> EventStream` | Filter by time |
| `filter_weight` | `(min: f32) -> EventStream` | Filter by weight |
| `limit` | `(n: i64) -> EventStream` | Limit event count |
| `to_signal` | `() -> Signal` or `(Map) -> Signal` | Convert to signal |

### Sandbox Limits

| Limit | Value |
|-------|-------|
| Expression recursion depth | 64 |
| Function call depth | 64 |
| Operations per frame | 100,000 |
| Max string size | 10,000 characters |
| Max array size | 1,000 elements |
| Max map size | 500 entries |
| Log messages per frame | 100 |

---

## Design Principles

1. **Scripts express intent** - Heavy computation lives in the engine
2. **Lazy evaluation** - Signals build computation graphs, evaluated at render time
3. **Beat-aware** - All time-based operations use beat position when available
4. **Whole-track visibility** - Scripts can look ahead and behind in time
5. **Immutable signals** - All transformations return new signals
6. **Deterministic** - Same audio input always produces identical visuals
