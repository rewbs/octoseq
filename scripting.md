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

// Load a custom mesh from the Assets panel
let teapot = mesh.load("Teapot");  // Load by asset name
```

The `mesh.load()` function creates an instance of a 3D mesh asset that was loaded in the **Assets > 3D Objects** panel. The asset name must match the name shown in the panel (case-sensitive).

Mesh entities have the following properties:

| Property   | Type           | Description                            |
| ---------- | -------------- | -------------------------------------- |
| `position` | `{x, y, z}`    | Position in 3D space                   |
| `rotation` | `{x, y, z}`    | Euler angles in radians                |
| `scale`    | `f32`          | Uniform scale factor (default: 1.0)    |
| `visible`  | `bool`         | Visibility flag                        |
| `color`    | `{r, g, b, a}` | RGBA tint (0.0-1.0, default: white)    |

The `color` property multiplies with the mesh's vertex colors, so white (`{r: 1.0, g: 1.0, b: 1.0, a: 1.0}`) shows the original vertex colors unchanged.

### Entity Instancing

Create multiple copies of an entity that share geometry but have independent properties:

```rhai
let base = mesh.cube();
base.position.x = 1.0;
base.color = #{ r: 1.0, g: 0.0, b: 0.0, a: 1.0 };

// Create instances with copied properties
let copy1 = base.instance();
copy1.position.x = -1.0;
copy1.color.g = 1.0;  // Different color

let copy2 = base.instance();
copy2.position.y = 2.0;

scene.add(base);
scene.add(copy1);
scene.add(copy2);
```

Instances share the underlying geometry (no memory duplication) but have their own:
- Transform (position, rotation, scale)
- Material and material parameters
- Color
- Deformations (copied as empty array)
- Visibility and lighting flags

If a property contains a Signal, the Signal reference is copied - both instances will evaluate the same Signal but can have different results if transforms differ.

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

### Creating Signal-Driven Lines (line.trace)

For declarative Signal visualization, use `line.trace()` instead of `line.strip()`:

```rhai
// Create a line that automatically traces a Signal over time
let amplitude_trace = line.trace(inputs.mix.rms, #{
    max_points: 256,  // Ring buffer size (default: 256)
    mode: "line",     // "line" or "points" (default: "line")
    x_scale: 1.0,     // Scale factor for X axis (time) (default: 1.0)
    y_scale: 1.0,     // Scale factor for Y axis (signal value) (default: 1.0)
    y_offset: 0.0     // Offset added to signal value before scaling (default: 0.0)
});
```

The engine automatically evaluates the Signal each frame and pushes a point at `(time * x_scale, (value + y_offset) * y_scale)`. This is the preferred way to visualize Signals without imperative code.

| Property/Method | Type           | Description                              |
| --------------- | -------------- | ---------------------------------------- |
| `color`         | `{r, g, b, a}` | RGBA color (0.0-1.0 range)               |
| `clear()`       | method         | Clear all points                         |
| `x_scale`       | `f32 \| Signal` | Scale factor for time axis              |
| `y_scale`       | `f32 \| Signal` | Scale factor for signal value           |
| `y_offset`      | `f32 \| Signal` | Offset added before scaling             |

**Comparison:**

```rhai
// Imperative (line.strip) - requires update() code
let spark = line.strip(#{ max_points: 256 });
fn update(dt, frame) {
    spark.push(frame.time, frame.amplitude);  // Must sample manually
}

// Declarative (line.trace) - automatic Signal evaluation
let trace = line.trace(inputs.mix.rms, #{ max_points: 256 });
// No update() code needed - engine evaluates Signal automatically
```

### Creating Ribbons (line.ribbon)

Ribbons are thick extruded lines that create 3D path visualizations from Signal history:

```rhai
// Create a ribbon that traces a Signal with visual thickness
let ribbon = line.ribbon(inputs.mix.rms, #{
    max_points: 256,    // Ring buffer size (default: 256)
    mode: "strip",      // "strip" (flat) or "tube" (cylindrical)
    width: 0.1,         // Ribbon width/diameter (default: 0.1)
    twist: 0.0,         // Twist rate in radians per unit (default: 0.0)
    tube_segments: 8    // Segments for tube mode (default: 8)
});
```

| Property/Method | Type            | Description                                |
| --------------- | --------------- | ------------------------------------------ |
| `color`         | `{r, g, b, a}`  | RGBA color (0.0-1.0 range)                 |
| `width`         | `f32 \| Signal` | Ribbon width (or diameter for tube mode)   |
| `twist`         | `f32 \| Signal` | Twist rate along ribbon length             |
| `clear()`       | method          | Clear all points                           |

**Mode comparison:**
- **strip**: Flat ribbon perpendicular to the view direction
- **tube**: Cylindrical tube around the path, best for 3D orbits

### Creating Radial Primitives

Radial primitives create circular patterns centered at the origin:

```rhai
// Create a ring/arc in the XY plane
let ring = radial.ring(#{
    radius: 1.0,        // Distance from center (default: 1.0)
    thickness: 0.1,     // Ring thickness (default: 0.1)
    start_angle: 0.0,   // Start angle in radians (default: 0.0)
    end_angle: TAU,     // End angle in radians (default: TAU = full circle)
    segments: 64        // Smoothness (default: 64)
});

// Create a signal-modulated circular waveform
let wave = radial.wave(inputs.mix.rms, #{
    base_radius: 1.0,   // Base radius (default: 1.0)
    amplitude: 0.5,     // Modulation amplitude (default: 0.5)
    wave_frequency: 4,  // Waves per revolution (default: 4)
    resolution: 128     // Line segments (default: 128)
});
```

The radial wave creates a pulsing, flower-like pattern where the Signal modulates how much the wave deviates from the base radius.

### Creating Point Clouds

Point clouds create dense fields of GL points with deterministic positions:

```rhai
let cloud = points.cloud(#{
    count: 1000,        // Number of points (default: 100)
    spread: 2.0,        // Distribution size (default: 1.0)
    mode: "sphere",     // "uniform" (cube) or "sphere" (default: "uniform")
    seed: 42,           // Random seed for reproducibility (default: 0)
    point_size: 3.0     // Point size in pixels (default: 2.0)
});
```

| Property   | Type            | Description                    |
| ---------- | --------------- | ------------------------------ |
| `color`    | `{r, g, b, a}`  | Point color (RGBA 0.0-1.0)     |
| `point_size` | `f32 \| Signal` | Size of each point in pixels |

**Modes:**
- **uniform**: Points distributed in a cube with half-extent = spread
- **sphere**: Points distributed on a sphere surface with radius = spread

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

There are two distinct input surfaces:

- `frame` (the second `update()` parameter): per-frame sampled values (numbers)
- `inputs` (global): Signal graph accessors with structured namespaces
- `timing` (global): Time-related signals (time, dt, beats, etc.)

Tip: avoid naming the second `update()` parameter `inputs` if you plan to use the Signal API, since it will shadow the global `inputs`.

Signals are **not** automatically coerced into numbers inside Rhai. Use:
- `frame.*` when you need a number for control-flow or arbitrary math (e.g. `if`, `sin()`, loops)
- `inputs.*` when you want to build a `Signal` graph and assign it to a numeric entity property
- `timing.*` for time-based animation (returns Signals, not numbers)

**Namespace structure:**
- `inputs.mix` - Mixdown audio signals: `rms`, `energy`, `centroid`, `flux`, `onset`, `searchSimilarity`, `harmonic`, `bassMotion`, `tonal`
  - `inputs.mix.bands[...]` - Frequency band signals
  - `inputs.mix.beatCandidates`, `inputs.mix.onsetPeaks` - Pre-extracted event streams
- `inputs.stems` - Per-stem signals (if stems are available): `inputs.stems["Drums"].energy`
  - `inputs.stems[...].bands[...]` - Per-stem frequency bands
  - `inputs.stems[...].beatCandidates`, `inputs.stems[...].onsetPeaks` - Per-stem events
- `inputs.customSignals` - User-defined 1D signals extracted from 2D data: `inputs.customSignals["MySignal"]`
- `inputs.customEvents` - User-authored event streams: `inputs.customEvents["Hits"]`

Per-frame sampled values are accessed from the map passed to `update()`:

```rhai
fn update(dt, frame) {
    let energy = frame.energy;
    let centroid = frame.centroid;
    let onset = frame.onset;
    // Signal names depend on the audio analysis package
}
```

### Using Signals in Entity Properties

Numeric entity fields can be authored as either numbers or `Signal` graphs. When a `Signal` is assigned, the engine evaluates it each frame at the current `time`/`dt` during scene sync.

Supported (signals allowed):
- `position.{x,y,z}`, `rotation.{x,y,z}`, `scale`
- `color.{r,g,b,a}`, `wireframeColor.{r,g,b,a}`

Not supported (signals are treated as plain values and won’t evaluate):
- `visible` (expects `bool`)
- `line.strip()` point data (`push(x, y)` expects numbers)

```rhai
fn update(dt, frame) {
    // Declarative: assign a Signal graph (evaluated by the engine each frame)
    cube.scale = inputs.mix.rms
        .smooth.exponential(0.05, 0.2)
        .normalise.robust()
        .scale(0.5)
        .add(1.0);

    // Imperative: use numeric per-frame samples for arbitrary math/control flow
    cube.rotation.x = (frame.time * 2.0).sin() * 0.1;
}
```

### Band-Scoped Inputs (Frequency Bands)

If frequency bands are available, scripts get a band-scoped namespace at `inputs.mix.bands[...]`.

- Keys are populated at **script load time**, and include both band IDs and human labels.
- Use `log.info(inputs.mix.bands)` to inspect available keys (and `describe(inputs.mix.bands)` for the API shape).

Each band entry is a `BandSignals` object with:
- `energy`, `onset`, `flux`, `centroid`, `amplitude` (alias of `energy`) → `Signal`
- `beatCandidates`, `onsetPeaks` → `EventStream` (pre-extracted events)
- `events` → `EventStream` (legacy, prefer `beatCandidates`/`onsetPeaks`)

```rhai
// Drive visuals from a band's energy signal
let bass = inputs.mix.bands["Bass"].energy
    .smooth.exponential(0.05, 0.2)
    .normalise.robust();

cube.position.y = bass.scale(2.0);

// Turn band-scoped events into an envelope signal
let hits = inputs.mix.bands["Bass"].events.to_signal(#{
    envelope: "attack_decay",
    attack_beats: 0.01,
    decay_beats: 0.25,
    easing: "exponential_out"
});

cube.color = #{
    r: hits.scale(0.8).add(0.2),
    g: 0.2,
    b: 0.2,
    a: 1.0
};
```

### Time Signals

The `timing` namespace provides canonical time signals for declarative time-based animation:

```rhai
// Time signals - all return Signal objects
timing.time          // Elapsed time in seconds
timing.dt            // Delta time since last frame
timing.beatPosition  // Current beat position (continuous)
timing.beatIndex     // Current beat index (integer-valued)
timing.beatPhase     // Beat phase 0-1 (fractional part of beat position)
timing.bpm           // Current BPM (from beat grid, or 120.0 default)
```

**Declarative vs Imperative Time-Based Animation:**

```rhai
// BEFORE (imperative): manage phase manually in update()
let phase = 0.0;
fn update(dt, frame) {
    phase += dt * 0.5;
    cube.rotation.y = phase;
}

// AFTER (declarative): use timing signals
fn update(dt, frame) {
    cube.rotation.y = timing.time.scale(0.5);
}
```

Time signals compose naturally with other Signal operations:

```rhai
// Smooth oscillation synced to beats
cube.scale = timing.beatPosition.scale(2.0).sin().scale(0.3).add(1.0);

// Phase-based animation
let phase_signal = timing.beatPhase.scale(6.28318);  // 0 to 2π
```

### Arithmetic Operations

```rhai
let sum = signal1.add(signal2);      // Add two signals
let sum = signal.add(0.5);           // Add constant
let diff = signal1.sub(signal2);     // Subtract signals
let diff = signal.sub(0.5);          // Subtract constant
let product = signal1.mul(signal2);  // Multiply signals
let quot = signal1.div(signal2);     // Divide signals
let scaled = signal.scale(2.0);      // Multiply by constant
let offset = signal.offset(0.5);     // Add constant (alias for add)
let mixed = sig1.mix(sig2, 0.5);     // Blend: 0.0=sig1, 1.0=sig2
let neg = signal.neg();              // Negate signal
let powered = signal.pow(2.0);       // Raise to power
let lerped = sig1.lerp(sig2, 0.5);   // Linear interpolation
```

**Important: Use Methods, Not Operators**

Rhai does not support custom operator overloading. You **cannot** use `+`, `-`, `*`, `/` on Signals:

```rhai
// ❌ WRONG - will fail with type error
let result = signal + 0.5;
let result = signal * 2.0;
let result = 1.0 - signal;

// ✅ CORRECT - use method chaining
let result = signal.add(0.5);
let result = signal.scale(2.0);
let result = gen.constant(1.0).sub(signal);
```

For `scalar op signal` patterns, use the signal's method with `gen.constant()`:

```rhai
// Instead of: 1.0 - signal
let inverted = gen.constant(1.0).sub(signal);

// Instead of: 2.0 * signal
let doubled = signal.scale(2.0);  // commutative, so this works
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
let rounded = signal.round();           // Round to nearest
let shaped = signal.sigmoid(10.0);      // Sigmoid curve (center 0.5)
let rate = signal.diff();               // Derivative: (current - prev) / dt
let accum = signal.integrate(2.0);      // Cumulative sum with decay (0 = no decay)
let sign_val = signal.sign();           // -1, 0, or 1 depending on sign
let abs_val = signal.abs();             // Absolute value
```

### Trigonometric Functions

Apply trigonometric functions to a signal's **value**. These transform the signal output, not the time domain.

```rhai
// Basic trig (input in radians)
let sine = signal.sin();        // sin(value)
let cosine = signal.cos();      // cos(value)
let tangent = signal.tan();     // tan(value)

// Inverse trig (returns radians)
let asin_val = signal.asin();   // asin(value), input clamped to [-1, 1]
let acos_val = signal.acos();   // acos(value), input clamped to [-1, 1]
let atan_val = signal.atan();   // atan(value)
let atan2_val = sig_y.atan2(sig_x);  // atan2(y, x)
```

**Important: `signal.sin()` vs `gen.sin()`**

These serve different purposes:

```rhai
// gen.sin(freq, phase) - TIME-BASED oscillator
// Generates a sine wave over time (beat position)
let oscillator = gen.sin(2.0, 0.0);  // 2 cycles per beat

// signal.sin() - VALUE transformation
// Applies sin() to the signal's current value
let transformed = timing.time.sin();  // sin(elapsed_seconds)
```

Use `gen.sin()` for rhythmic oscillations. Use `signal.sin()` when you want to apply the sine function to a signal's value.

### Exponential and Logarithmic Functions

```rhai
let root = signal.sqrt();           // Square root
let exp_val = signal.exp();         // e^value
let ln_val = signal.ln();           // Natural logarithm (ln)
let log_val = signal.log(10.0);     // Logarithm with custom base
```

### Modular and Periodic Functions

```rhai
let mod_val = signal.modulo(1.0);       // Euclidean modulo (always positive)
let rem_val = signal.rem(1.0);          // Remainder (can be negative)
let frac = signal.fract();              // Fractional part (value - floor(value))
let wrapped = signal.wrap(0.0, 1.0);    // Wrap value to range [min, max)
```

Useful for creating looping animations:

```rhai
// Continuous rotation that wraps at 2π
let rotation = timing.time.modulo(6.283185);  // 0 to 2π

// Looping 0-1 phase
let phase = timing.beatPosition.fract();
```

### Mapping and Shaping Functions

```rhai
// Map from one range to another
let mapped = signal.map(0.0, 1.0, -1.0, 1.0);  // [0,1] → [-1,1]

// Smoothstep interpolation (S-curve between edges)
let smooth = signal.smoothstep(0.2, 0.8);  // Smooth transition in [0.2, 0.8]

// Linear interpolation between two signals
let blended = sig_a.lerp(sig_b, 0.5);  // 50% blend
let dynamic_blend = sig_a.lerp(sig_b, inputs.mix.rms);  // Audio-reactive blend
```

All mapping parameters can be Signals for dynamic control:

```rhai
// Dynamic range mapping based on audio energy
let out_max = inputs.mix.rms.scale(2.0).add(1.0);
let mapped = signal.map(0.0, 1.0, 0.0, out_max);
```

### Time Shifting

```rhai
let delayed = signal.delay(0.5);       // Look 0.5 beats into the past
let ahead = signal.anticipate(0.5);    // Look 0.5 beats into the future (input signals only)
```

### Dynamic Parameters

Many signal methods accept either a constant or another signal as a parameter. This enables expressive, audio-reactive transformations where the transformation parameters themselves vary with the music.

```rhai
// Static: integrate with fixed decay
let static_decay = signal.integrate(2.0);

// Dynamic: decay rate controlled by another signal
let decay_signal = inputs.mix.rms.normalise.robust().scale(4.0);
let dynamic_decay = signal.integrate(decay_signal);

// Dynamic delay modulated by onset envelope
let delay_amount = inputs.mix.onset.normalise.robust().scale(0.5);
let wobbly_delay = signal.delay(delay_amount);

// Dynamic clamping range
let min_bound = inputs.mix.rms.scale(0.2);
let max_bound = inputs.mix.rms.scale(0.8).add(0.2);
let adaptive_clamp = signal.clamp(min_bound, max_bound);
```

Methods supporting dynamic parameters: `scale`, `mix`, `clamp`, `sigmoid`, `integrate`, `delay`, `anticipate`, `pow`, `modulo`, `rem`, `wrap`, `map`, `smoothstep`, `lerp`, `log`, `offset`.

### Sampling Configuration

By default, input signals use **peak-preserving sampling** with a window equal to the frame delta time (`dt`). This ensures transients and peaks are not lost when downsampling high-frequency signals (like audio at 44.1kHz) to low-frequency evaluation (like 60fps rendering).

You can override this behavior:

```rhai
// Use linear interpolation (no peak preservation)
// Useful for smooth signals like spectral centroid where peaks aren't critical
let smooth = inputs.mix.centroid.interpolate();

// Explicitly use peak-preserving with frame dt (same as default)
let peaks = inputs.mix.onset.peak();

// Custom window size in beats
// Larger window captures peaks over a longer period
let wide_peaks = inputs.mix.energy.peak_window(0.25);  // 0.25 beats

// Custom window size in seconds
let timed_peaks = inputs.mix.energy.peak_window_sec(0.05);  // 50ms
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

### Explicit Sampling (Escape Hatch)

The `sample_at()` method provides an explicit escape hatch for imperative sampling. This breaks the declarative model but serves legitimate use cases like debugging, one-off queries, or init-time lookups.

```rhai
// Sample a signal at a specific time (in seconds)
let value = signal.sample_at(5.0);  // Get value at t=5 seconds
```

**Important Limitations:**

- Works reliably on `Input` and `BandInput` signals (raw audio data available)
- For computed signals, samples the entire graph at that time point
- Cannot look into the future beyond available audio data
- Returns 0.0 if sampling fails (with a warning logged)

**When to Use:**

```rhai
// ✅ Good: Debug/inspection during development
fn init(ctx) {
    let peak_at_chorus = inputs.mix.rms.sample_at(45.0);
    log.info("Amplitude at chorus: " + peak_at_chorus);
}

// ✅ Good: One-time init calculations
fn init(ctx) {
    let avg_energy = inputs.mix.energy.sample_at(30.0);  // Sample at 30s
    // Use for initial setup...
}

// ❌ Avoid: Per-frame sampling (defeats declarative model)
fn update(dt, frame) {
    // Don't do this - just assign the signal directly!
    cube.scale = signal.sample_at(frame.time);  // BAD
    cube.scale = signal;  // GOOD - declarative
}
```

Use `sample_at()` sparingly. Prefer declarative bindings where signals are assigned to entity properties and evaluated automatically by the engine.

---

## Event Extraction API

Events are sparse, time-ordered moments extracted from signals - useful for onset detection, beat tracking, and triggering envelopes.

### Extracting Events

```rhai
let events = inputs.mix.onset
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

### Event Distance Signals

Create signals based on temporal distance to events:

```rhai
let kicks = inputs.mix.kick.events(0.3);

// Distance from previous event (0 at event, grows linearly)
let time_since_kick = kicks.beats_from_prev();       // In beats
let seconds_since = kicks.seconds_from_prev();       // In seconds
let frames_since = kicks.frames_from_prev();         // In frames

// Distance to next event (shrinks to 0 at event)
let beats_to_kick = kicks.beats_to_next();           // In beats
let seconds_to = kicks.seconds_to_next();            // In seconds
let frames_to = kicks.frames_to_next();              // In frames

// Create anticipation effect that builds before each kick
let anticipation = kicks.beats_to_next()
    .clamp(0.0, 1.0)
    .sub(1.0)
    .neg();  // 0 far from kick, 1 at kick
```

**Edge cases:**
- Before first event: `*_from_prev()` returns distance to first event
- After last event: `*_to_next()` returns distance to track end
- Empty events: Returns 0.0

### Event Count and Density Signals

Count events within a time window:

```rhai
let kicks = inputs.mix.kick.events(0.3);

// Count events in a window looking backwards
let recent_kicks = kicks.count_prev_beats(4.0);      // Events in last 4 beats
let recent_secs = kicks.count_prev_seconds(2.0);     // Events in last 2 seconds
let recent_frames = kicks.count_prev_frames(60.0);   // Events in last 60 frames

// Count events in a window looking forwards
let upcoming = kicks.count_next_beats(4.0);          // Events in next 4 beats
let upcoming_secs = kicks.count_next_seconds(2.0);   // Events in next 2 seconds

// Density: count / window_size (events per unit time)
let kick_rate = kicks.density_prev_beats(8.0);       // Kicks per beat over 8 beats
let kick_hz = kicks.density_prev_seconds(4.0);       // Kicks per second over 4 seconds

// Use activity to control intensity
let activity = kicks.count_prev_beats(8.0);
cube.scale = activity.scale(0.1).add(1.0);
```

**Window parameter:** Can be a constant or a Signal for dynamic windows.

### Event Phase Signal

Get position between events as a 0-1 value:

```rhai
let beats = inputs.mix.beat.events(0.5);

// Phase: 0 at previous event, 1 at next event
let phase = beats.beat_phase_between();

// Create smooth breathing motion between beats
let breath = phase.scale(6.28318).sin();  // Full sine cycle between events

// Eased anticipation
let anticipation = phase.scale(2.0).clamp(0.0, 1.0);  // Build up in second half
```

**Edge cases:**
- Before first event: Returns 0.0
- After last event: Returns 1.0
- Single event or no events: Returns 0.0

### Impulse Alias

`impulse()` is an alias for `to_signal()`:

```rhai
let kicks = inputs.mix.kick.events(0.3);

// These are equivalent
let impulse1 = kicks.impulse();
let impulse2 = kicks.to_signal();
```

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

fn update(dt, frame) {
    // Spin faster with more spectral flux
    phase += dt * (0.5 + frame.spectralFlux * 2.0);
    cube.rotation.y = phase;

    // Subtle wobble using time-based sine
    cube.rotation.x = 0.1 * (frame.time * 2.0).sin();

    // Pulse with amplitude
    cube.scale = 1.0 + frame.amplitude * 0.5;
}
```

---

### Example 2: Onset-Triggered Flash

Extract discrete events from the onset envelope and convert them back to shaped envelopes.

```rhai
fn update(dt, frame) {
    // Extract onset events with preprocessing
    let onsets = inputs.mix.onset
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
    cube.scale = flash.scale(0.5).add(1.0);
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

let energy_smooth = 0.0;

fn init(ctx) {
    sparkline.color = #{ r: 0.0, g: 1.0, b: 0.5, a: 1.0 };
    sparkline.position = #{ x: -2.0, y: 0.0, z: 0.0 };
    scene.add(sparkline);
}

fn update(dt, frame) {
    // Line strips are immediate-mode: push numeric per-frame samples.
    // (If you want to inspect a Signal graph, attach `.probe("name")` instead.)
    let raw = frame.amplitude;

    // Simple smoothing using script state (0..1, higher = more responsive)
    let smoothing = 0.15;
    energy_smooth += (raw - energy_smooth) * smoothing;

    sparkline.push(frame.time, energy_smooth);
}
```

---

### Example 4: Beat-Synced Pulsing

Combine generated oscillators with audio input for musically-aware animation.

```rhai
fn update(dt, frame) {
    // Generate sine wave at 1 cycle per beat
    let pulse = gen.sin(1.0, 0.0)
        .add(1.0)     // Shift from [-1,1] to [0,2]
        .scale(0.5);  // Scale to [0,1]

    // Mix with onset envelope for more punch
    let onset = inputs.mix.onset
        .smooth.exponential(0.02, 0.2)
        .normalise.robust();

    let combined = pulse.mix(onset, 0.5);

    cube.scale = combined.scale(0.5).add(0.5);
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

fn update(dt, frame) {
    // === CENTER CUBE: Declarative reactivity (assign a Signal to a numeric field) ===
    center_cube.scale = inputs.mix.rms
        .smooth.exponential(0.05, 0.2)
        .normalise.robust()
        .scale(0.6)
        .add(0.8);

    // Imperative rotation using numeric dt
    center_cube.rotation.y += dt * 0.5;

    // === ORBITING CUBES: Imperative motion (use numeric per-frame samples) ===
    let onset = frame.onsetEnvelope;

    // Orbit speed increases with spectral flux
    let flux = frame.spectralFlux;
    orbit_phase += dt * (1.0 + flux * 2.0);

    // First orbiter
    let radius1 = 2.0 + onset * 0.5;
    orbit_cube_1.position = #{
        x: radius1 * orbit_phase.cos(),
        y: 0.5 + onset * 0.3,
        z: radius1 * orbit_phase.sin()
    };
    orbit_cube_1.scale = 0.3 + onset * 0.2;
    orbit_cube_1.rotation.x = orbit_phase * 2.0;

    // Second orbiter (opposite phase)
    let phase2 = orbit_phase + 3.14159;
    let radius2 = 2.5 + onset * 0.3;
    orbit_cube_2.position = #{
        x: radius2 * phase2.cos(),
        y: 0.3,
        z: radius2 * phase2.sin()
    };
    orbit_cube_2.scale = 0.25;
    orbit_cube_2.rotation.z = orbit_phase * -1.5;

    // === FLOOR: Control flow from numeric samples ===
    // (visible expects a bool, so use per-frame numeric values here)
    floor_plane.visible = frame.spectralCentroid > 0.3;
}
```

---

### Example 6: Advanced Signal Processing Pipeline

Demonstrate complex signal chaining with comparison between raw and processed signals.

```rhai
let raw_cube = mesh.cube();
let processed_cube = mesh.cube();
let gated_cube = mesh.cube();

fn init(ctx) {
    // Raw signal - red (left)
    raw_cube.color = #{ r: 1.0, g: 0.3, b: 0.3, a: 1.0 };
    raw_cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };

    // Processed signal - green (center)
    processed_cube.color = #{ r: 0.3, g: 1.0, b: 0.3, a: 1.0 };
    processed_cube.position = #{ x: 0.0, y: 0.0, z: 0.0 };

    // Gated signal - blue (right)
    gated_cube.color = #{ r: 0.3, g: 0.3, b: 1.0, a: 1.0 };
    gated_cube.position = #{ x: 2.0, y: 0.0, z: 0.0 };

    scene.add(raw_cube);
    scene.add(processed_cube);
    scene.add(gated_cube);
}

fn update(dt, frame) {
    // === RAW SIGNAL ===
    // Just normalise for display, and attach a debug probe.
    let raw = inputs.mix.onset
        .normalise.global()
        .probe("raw_onset");

    // === PROCESSED SIGNAL ===
    // Full processing pipeline
    let processed = inputs.mix.onset
        .smooth.exponential(0.02, 0.1)  // Fast attack, moderate release
        .normalise.robust()              // Percentile-based normalisation
        .clamp(0.0, 1.0)                 // Ensure bounds
        .probe("processed_onset");

    // === GATED SIGNAL ===
    // Use hysteresis to prevent flickering
    let gated = processed
        .gate.hysteresis(0.6, 0.3)  // On at 0.6, off at 0.3
        .probe("gated_onset");

    // Compare by mapping each signal to vertical position.
    raw_cube.position.y = raw.scale(2.0);
    processed_cube.position.y = processed.scale(2.0);
    gated_cube.position.y = gated.scale(2.0);
}
```

---

### Example 7: Event-Driven Particle Burst Effect

Use built-in particle primitives to spawn bursts from onset events.

```rhai
// Extract strong onset events once (full track)
let burst_events = inputs.mix.onset
    .smooth.exponential(0.02, 0.15)
    .normalise.robust()
    .pick.events(#{
        hysteresis_beats: 0.5,     // At most 2 events per beat
        target_density: 1.0,        // ~1 event per beat
        min_threshold: 0.4,         // Only strong onsets
        phase_bias: 0.3             // Prefer on-beat events
    });

// Built-in particle system: emit multiple instances per event.
let burst_system = particles.from_events(burst_events, #{
    count: 24,                      // Instances per event
    lifetime_beats: 0.6,
    envelope: "attack_decay",
    attack_beats: 0.02,             // Very fast attack
    decay_beats: 0.35,              // Moderate decay
    easing: "exponential_out",
    spread: #{ x: 1.2, y: 0.6, z: 1.2 },
    scale: 0.08,
    scale_variation: 0.5,
    color: #{ r: 1.0, g: 0.7, b: 0.2, a: 1.0 },
    color_variation: 0.15
});

fn init(ctx) {
    scene.add(burst_system);
}

fn update(dt, frame) {
    // Optional: move the whole system with audio intensity
    burst_system.position = #{
        x: 0.0,
        y: frame.amplitude * 0.5,
        z: 0.0
    };
}
```

---

### Example 8: Spectrum Analyzer with Frequency Bands

Drive entities from authored frequency bands (`inputs.mix.bands[...]`), including band-scoped events.

```rhai
// Requires bands labeled "Bass", "Mids", "Highs" (adjust keys as needed).
let bass_cube = mesh.cube();
let mid_cube = mesh.cube();
let high_cube = mesh.cube();

fn init(ctx) {
    // Bass - red, left
    bass_cube.color = #{ r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
    bass_cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };

    // Mid - green, center
    mid_cube.color = #{ r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
    mid_cube.position = #{ x: 0.0, y: 0.0, z: 0.0 };

    // High - blue, right
    high_cube.color = #{ r: 0.2, g: 0.2, b: 1.0, a: 1.0 };
    high_cube.position = #{ x: 2.0, y: 0.0, z: 0.0 };

    scene.add(bass_cube);
    scene.add(mid_cube);
    scene.add(high_cube);
}

fn update(dt, frame) {
    let bass = inputs.mix.bands["Bass"].energy
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    let mids = inputs.mix.bands["Mids"].energy
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    let highs = inputs.mix.bands["Highs"].energy
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    // Update cubes - scale and vertical position
    bass_cube.scale = bass.scale(0.8).add(0.3);
    bass_cube.position.y = bass.scale(1.5);

    mid_cube.scale = mids.scale(0.8).add(0.3);
    mid_cube.position.y = mids.scale(1.5);

    high_cube.scale = highs.scale(0.8).add(0.3);
    high_cube.position.y = highs.scale(1.5);

    // Band-scoped events → envelope flash
    let bass_hit = inputs.mix.bands["Bass"].events.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.25,
        easing: "exponential_out"
    });

    bass_cube.color = #{
        r: bass_hit.scale(0.8).add(0.2),
        g: bass.scale(0.6).add(0.2),
        b: 0.2,
        a: 1.0
    };
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

fn update(dt, frame) {
    // Base signal from onset envelope
    let base = inputs.mix.onset
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
    leader.position.y = leader_signal.scale(2.0);
    follower1.position.y = follower1_signal.scale(2.0);
    follower2.position.y = follower2_signal.scale(2.0);
    anticipator.position.y = anticipator_signal.scale(2.0);

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

fn update(dt, frame) {
    // Audio reactivity
    let energy = inputs.mix.rms
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
        let noise_amount = energy.scale(0.7).add(0.3);
        c.position = #{
            x: noise_x.mul(noise_amount).add(base_x),
            y: noise_y.mul(noise_amount).scale(0.5),
            z: noise_z.mul(noise_amount).add(base_z)
        };

        // Rotation driven by noise
        c.rotation = #{
            x: noise_x.scale(1.5),
            y: noise_y.scale(1.5),
            z: noise_z.scale(1.5)
        };

        // Scale pulses with energy
        c.scale = energy.scale(0.3).add(0.3);
    }
}
```

---

### Example 11: Integration and Accumulation

Use `integrate()` and `diff()` for physics-like and cumulative effects.

```rhai
let velocity_cube = mesh.cube();
let energy_cube = mesh.cube();

fn init(ctx) {
    velocity_cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };
    energy_cube.position = #{ x: 2.0, y: 0.0, z: 0.0 };

    scene.add(velocity_cube);
    scene.add(energy_cube);
}

fn update(dt, frame) {
    // === VELOCITY CUBE: React to rate of change ===
    // diff() gives us the derivative (velocity) of the signal
    let onset_velocity = inputs.mix.onset
        .smooth.exponential(0.02, 0.1)
        .diff()                           // Rate of change
        .clamp(-2.0, 2.0)                 // Limit extremes
        .normalise.to_range(-1.0, 1.0);

    // Positive velocity = rising, negative = falling
    velocity_cube.position.y = onset_velocity;
    velocity_cube.scale = onset_velocity
        .clamp(0.0, 1.0)
        .scale(0.3)
        .add(0.5);

    // === ENERGY CUBE: Accumulated energy with decay ===
    // integrate() accumulates the signal over time
    // The decay parameter (2.0) makes old values fade
    let accumulated = inputs.mix.rms
        .normalise.robust()
        .integrate(2.0)                   // Accumulate with decay
        .clamp(0.0, 3.0)                  // Prevent runaway growth
        .probe("accumulated_energy");

    energy_cube.scale = accumulated.scale(0.3).add(0.3);
    energy_cube.rotation.y = accumulated.scale(1.5);
}
```

---

### Example 12: Complete Music Visualizer

A comprehensive example combining multiple techniques for a full music visualization.

```rhai
// === SCENE ENTITIES ===
let main_cube = mesh.cube();
let floor = mesh.plane();
let beat_ring = scene.group();
let beat_indicators = [];

// === SIGNALS (computed once, evaluated every frame) ===
let amplitude = inputs.mix.rms
    .smooth.exponential(0.05, 0.2)
    .normalise.robust()
    .probe("vis_amplitude");

let onset = inputs.mix.onset
    .smooth.exponential(0.02, 0.15)
    .normalise.robust();

let centroid = inputs.mix.centroid
    .smooth.moving_average(0.25)
    .normalise.robust()
    .probe("vis_centroid");

let flux = inputs.mix.flux
    .smooth.exponential(0.03, 0.1)
    .normalise.robust();

let beat_events = onset.pick.events(#{
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
}).probe("vis_beat");

// A slowly-accumulating spin signal driven by flux
let spin = flux.scale(2.0).add(0.5).integrate(0.0);

fn init(ctx) {
    main_cube.position = #{ x: 0.0, y: 0.5, z: 0.0 };
    scene.add(main_cube);

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
        beat_ring.add(indicator);
    }

    scene.add(beat_ring);
}

fn update(dt, frame) {
    // === MAIN CUBE ===
    main_cube.scale = amplitude
        .scale(0.4)
        .add(0.8)
        .add(beat_envelope.scale(0.3));

    main_cube.rotation.y = spin;
    main_cube.position.y = centroid.add(0.5);
    main_cube.rotation.x = centroid.scale(0.3);
    main_cube.rotation.z = flux.scale(0.2);

    // Spin the whole ring a bit
    beat_ring.rotation.y = spin.scale(0.2);

    // === BEAT INDICATOR RING ===
    for i in 0..8 {
        let indicator = beat_indicators[i];
        let phase_offset = i * 0.125;  // 1/8 beat offset per indicator
        let delayed = beat_envelope.delay(phase_offset);

        indicator.scale = delayed.scale(0.25).add(0.15);
        indicator.position.y = delayed.scale(0.3).add(-0.5);
    }
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

fn init(ctx) {
    raw_line.color = #{ r: 1.0, g: 0.0, b: 0.0, a: 0.5 };
    raw_line.position = #{ x: -3.0, y: 1.0, z: 0.0 };

    scene.add(debug_cube);
    scene.add(raw_line);

    log.info("Script initialized");
    log.info("Debug mode: " + DEBUG_MODE);
}

fn update(dt, frame) {
    let time = frame.time;

    // === PROCESSED SIGNAL ===
    let processed = inputs.mix.onset
        .smooth.exponential(SMOOTHING_ATTACK, SMOOTHING_RELEASE)
        .normalise.robust()
        .probe("dbg_processed");

    // === EVENT EXTRACTION ===
    let events = processed.pick.events(#{
        hysteresis_beats: 0.25,
        target_density: EVENT_DENSITY
    });

    let envelope = events.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.3,
        easing: "exponential_out"
    }).probe("dbg_envelope");

    // === APPLY TO VISUALS ===
    debug_cube.scale = envelope.scale(SCALE_MULTIPLIER).add(0.5);
    debug_cube.position.y = processed.scale(2.0);
    debug_cube.rotation.y += dt;

    // === DEBUG VISUALIZATION ===
    if DEBUG_MODE {
        // Line strips are numeric-only: use the per-frame sampled values.
        raw_line.push(time, frame.onsetEnvelope);

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
3. Compare raw (frame) vs processed/envelope (Signal) output
4. Emit signals for the debug UI
5. Log periodic information without flooding the console

---

### Example 14: Feedback Layers for Trails and Visual Memory

Use the `feedback` API to create Milkdrop-style temporal effects: trails, motion blur, and warped accumulation. The fluent builder API provides autocomplete and parameter documentation in the editor.

```rhai
let cube = mesh.cube();

// Audio-reactive signals
let energy = inputs.mix.rms
    .smooth.exponential(0.05, 0.2)
    .normalise.robust();

let onset = inputs.mix.onset
    .smooth.exponential(0.02, 0.15)
    .normalise.robust();

fn init(ctx) {
    scene.add(cube);

    // Create feedback using the fluent builder API
    let fb = feedback.builder()
        .warp.spiral(0.8, 0.02)      // strength, rotation (scale defaults to 1.0)
        .color.decay(0.92)           // decay rate (0.9=fast, 0.99=slow)
        .blend.add()                 // additive blending for trails
        .opacity(0.85)               // feedback visibility
        .build();

    feedback.enable(fb);
}

fn update(dt, frame) {
    // Animate the cube
    cube.rotation.y += dt * 0.5;
    cube.rotation.x = onset.scale(0.5);
    cube.scale = energy.scale(0.4).add(0.6);

    // Color pulses on beats
    cube.color = #{
        r: onset.scale(0.8).add(0.2),
        g: energy.scale(0.5).add(0.3),
        b: 0.8,
        a: 1.0
    };
}
```

#### Chained Transforms

Multiple warp and color operations can be chained by calling methods multiple times. Operations are applied in sequence: `previous_frame → warp₁ → warp₂ → ... → color₁ → color₂ → ... → blend(current) → output`.

```rhai
let cube = mesh.cube();

fn init(ctx) {
    scene.add(cube);

    // Chain multiple transforms using the fluent API (up to 4 each)
    let fb = feedback.builder()
        // Warp chain: spiral then radial zoom
        .warp.spiral(0.5, 0.02)              // strength, rotation
        .warp.radial(0.3, 1.01)              // strength, scale

        // Color chain: decay then hue shift
        .color.decay(0.95)                   // decay rate
        .color.hsv(0.01, 0.0, 0.0)           // h, s, v shifts

        .blend.add()
        .opacity(0.9)
        .build();

    feedback.enable(fb);
}

fn update(dt, frame) {
    cube.rotation.y += dt * 0.5;
}
```

#### Dynamic Feedback Updates

For audio-reactive feedback parameters, recreate and re-enable the config in `update()`:

```rhai
let sphere = mesh.sphere();

let energy = inputs.mix.rms
    .smooth.exponential(0.1, 0.3)
    .normalise.robust();

fn init(ctx) {
    scene.add(sphere);
}

fn update(dt, frame) {
    // Rebuild feedback each frame with dynamic values
    let warp_strength = frame.amplitude * 0.5;
    let hue_shift = frame.energy * 0.1;

    let fb = feedback.builder()
        .warp.radial(warp_strength, 1.01)
        .color.hsv(hue_shift, 0.0, -0.05)
        .blend.screen()
        .opacity(0.9)
        .build();

    feedback.enable(fb);

    sphere.position.y = energy.scale(0.5);
    sphere.rotation.y += dt;
}
```

**Notes on chained transforms:**
- Up to 4 warp operations and 4 color operations can be chained
- Each method call adds a new operation to the chain
- Methods can be called in any order; `.build()` finalizes the config

#### Warp Methods Reference

| Method | Signature | Effect |
|--------|-----------|--------|
| `.warp.spiral` | `(strength, rotation)` or `(strength, rotation, scale)` | Radial + rotation combined |
| `.warp.radial` | `(strength)` or `(strength, scale)` | Expand/contract from center |
| `.warp.affine` | `(scale, rotation)` or `(scale, rotation, tx, ty)` | Scale, rotate, translate |
| `.warp.noise` | `(strength, frequency)` | Perlin-based displacement |
| `.warp.shear` | `(strength)` | Skew transformation |

#### Color Methods Reference

| Method | Signature | Effect |
|--------|-----------|--------|
| `.color.decay` | `(rate)` | Fade to black (0.9=fast, 0.99=slow) |
| `.color.hsv` | `(h, s, v)` | Hue/saturation/value shift |
| `.color.posterize` | `(levels)` | Reduce color levels (2-16 typical) |
| `.color.channel_offset` | `(x, y)` | RGB split / chromatic aberration |

#### Blend Methods Reference

| Method | Effect |
|--------|--------|
| `.blend.alpha()` | Linear interpolation (default) |
| `.blend.add()` | Additive (brightens, good for trails) |
| `.blend.multiply()` | Darkens overlapping areas |
| `.blend.screen()` | Inverse multiply (brightens) |
| `.blend.overlay()` | Contrast enhancement |
| `.blend.difference()` | Subtractive (psychedelic effects) |
| `.blend.max()` | Maximum of both values |

#### Feedback Sampling Mode

By default, feedback samples the scene render **before** post-processing effects are applied. This means post-FX like bloom and color grading are applied fresh each frame on top of the feedback result.

You can change this behavior so feedback samples **after** post-processing effects, creating interesting cumulative effects where bloom, grain, or color grading accumulate over time:

```rhai
fn init(ctx) {
    // Feedback samples AFTER post-FX (bloom/grain accumulate in feedback)
    let fb = feedback.builder()
        .warp.spiral(0.5, 0.02)
        .color.decay(0.92)
        .sample_after_effects()  // Key: sample post-FX result
        .build();
    feedback.enable(fb);

    // Add post-FX that will be included in feedback
    post.add(fx.bloom(#{ threshold: 0.6, intensity: 0.5 }));
    post.add(fx.grain(#{ amount: 0.02 }));
}
```

| Method | Pipeline Order | Use Case |
|--------|----------------|----------|
| `.sample_before_effects()` | scene → feedback → post-FX (default) | Fresh post-FX each frame |
| `.sample_after_effects()` | scene → post-FX → feedback | Accumulating bloom/grain effects |

**Example: Accumulating Bloom Trails**

```rhai
let sphere = mesh.sphere();

fn init(ctx) {
    scene.add(sphere);
    sphere.material = "emissive";

    // Bloom accumulates in feedback for glowing trails
    let fb = feedback.builder()
        .warp.radial(0.3, 1.01)
        .color.decay(0.95)
        .sample_after_effects()
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: 0.5, intensity: 0.8 }));
}

fn update(dt, frame) {
    sphere.position.x = (frame.time * 0.5).sin() * 2.0;
    sphere.params.emission_intensity = 1.5;
}
```

#### Disabling Feedback

```rhai
// Toggle feedback off
feedback.disable();

// Check if feedback is active
if feedback.is_enabled() {
    log.info("Feedback is on");
}
```

---

### Example 15: Materials and Shader Parameters

Use the material system to apply host-defined shaders with signal-driven parameters.

```rhai
let cube = mesh.cube();
let glowing_sphere = mesh.sphere();

// Audio-reactive signals
let energy = inputs.mix.rms
    .smooth.exponential(0.05, 0.2)
    .normalise.robust();

let onset = inputs.mix.onset
    .smooth.exponential(0.02, 0.15)
    .normalise.robust();

fn init(ctx) {
    // Default material (no special effects)
    cube.position = #{ x: -2.0, y: 0.0, z: 0.0 };
    scene.add(cube);

    // Emissive material with glow
    glowing_sphere.position = #{ x: 2.0, y: 0.0, z: 0.0 };
    glowing_sphere.material = "emissive";
    scene.add(glowing_sphere);
}

fn update(dt, frame) {
    // Animate positions
    cube.rotation.y += dt * 0.5;
    glowing_sphere.rotation.y -= dt * 0.3;

    // Signal-driven emissive parameters
    // The emission_intensity responds to audio
    glowing_sphere.params.emission_color = #{
        r: onset.scale(0.8).add(0.2),
        g: energy.scale(0.5).add(0.2),
        b: 0.8,
        a: 1.0
    };
    glowing_sphere.params.emission_intensity = onset.scale(2.0).add(0.5);
}
```

#### Available Materials

| Material ID | Description | Parameters |
|------------|-------------|------------|
| `default` | Standard mesh rendering | `base_color` |
| `emissive` | Self-illuminating glow | `emission_color`, `emission_intensity` |
| `wire_glow` | Glowing wireframe effect | `glow_color`, `glow_intensity`, `line_width` |
| `soft_additive` | Soft additive blending | `base_color`, `softness` |
| `gradient` | Two-tone gradient | `color_top`, `color_bottom`, `blend_height` |

#### Material Introspection

```rhai
// List all available materials
log.info(dbg.listMaterials());
// → ["default", "emissive", "wire_glow", "soft_additive", "gradient"]

// Get detailed info about a material
log.info(dbg.describeMaterial("emissive"));
// → { name: "emissive", blend_mode: "Additive", params: [...] }
```

---

### Example 16: Post-Processing Effects

Apply composable post-processing effects to the final render.

```rhai
let cube = mesh.cube();

// Create post-processing effects
let bloom = fx.bloom(#{
    threshold: 0.7,      // Brightness threshold (0.0-2.0)
    intensity: 0.5,      // Bloom strength (0.0-2.0)
    radius: 4.0,         // Blur radius (0.0-32.0, uses optimized separable blur)
    downsample: 2.0      // Resolution factor (1=full, 2=half, etc. for performance)
});

let grade = fx.colorGrade(#{
    contrast: 1.1,
    saturation: 1.2
});

let vignette = fx.vignette(#{
    intensity: 0.3,
    smoothness: 0.5
});

fn init(ctx) {
    scene.add(cube);

    // Add effects to the post-processing chain
    post.add(bloom);
    post.add(grade);
    post.add(vignette);
}

fn update(dt, frame) {
    cube.rotation.y += dt * 0.5;

    // Signal-driven bloom intensity
    bloom.intensity = inputs.mix.rms
        .smooth.exponential(0.05, 0.2)
        .normalise.robust()
        .scale(0.8);
}
```

#### Dynamic Effect Chains

```rhai
let cube = mesh.cube();

let bloom = fx.bloom(#{ threshold: 0.6 });
let distortion = fx.distortion(#{ amount: 0.0 });

fn init(ctx) {
    scene.add(cube);
    post.add(bloom);
    post.add(distortion);
}

fn update(dt, frame) {
    cube.rotation.y += dt;

    // Audio-reactive distortion on strong onsets
    let onset = inputs.mix.onset
        .smooth.exponential(0.02, 0.1)
        .normalise.robust();

    distortion.amount = onset.scale(0.15);

    // Temporarily disable bloom during quiet sections
    bloom.enabled = frame.amplitude > 0.2;
}
```

#### Available Effects

| Effect | Description | Parameters |
|--------|-------------|------------|
| `fx.bloom()` | Glow on bright areas | `threshold`, `intensity`, `radius` (capped at 32), `downsample` |
| `fx.colorGrade()` | Color correction | `brightness`, `contrast`, `saturation`, `gamma`, `tint` |
| `fx.vignette()` | Darkened edges | `intensity`, `smoothness`, `color` |
| `fx.distortion()` | Barrel/pincushion | `amount`, `center` |
| `fx.zoomWrap()` | Zoom with edge wrapping | `amount` (<1=zoom in), `center`, `wrap_mode` ("repeat"/"mirror") |
| `fx.radialBlur()` | Radial motion blur | `strength`, `center`, `samples` (2-32) |
| `fx.directionalBlur()` | Directional motion blur | `amount` (pixels), `angle` (radians), `samples` (2-32) |
| `fx.chromaticAberration()` | RGB channel separation | `amount`, `angle` (radians) |
| `fx.grain()` | Deterministic film grain | `amount`, `scale`, `seed` |

#### Chain Management

```rhai
// Create effects
let bloom = fx.bloom(#{ threshold: 0.7 });
let grade = fx.colorGrade(#{ contrast: 1.1 });

// Add effects to chain
post.add(bloom);
post.add(grade);

// Remove an effect
post.remove(bloom);

// Clear all effects
post.clear();

// Re-add for reorder demo
post.add(bloom);
post.add(grade);

// Reorder effects (grade first, then bloom)
post.setOrder([grade.__id, bloom.__id]);
```

#### Effect Introspection

```rhai
// List all available effects
log.info(dbg.listEffects());
// → ["bloom", "color_grade", "vignette", "distortion"]

// Get detailed info about an effect
log.info(dbg.describeEffect("bloom"));
// → { name: "bloom", description: "...", params: [...] }
```

---

### Example 17: Combined Materials, Effects, and Feedback

A comprehensive example combining all visual enhancement systems.

```rhai
let main_sphere = mesh.sphere();
let accent_cubes = [];

// Audio signals
let energy = inputs.mix.rms
    .smooth.exponential(0.05, 0.2)
    .normalise.robust();

let onset = inputs.mix.onset
    .smooth.exponential(0.02, 0.15)
    .normalise.robust();

let beat_events = onset.pick.events(#{
    hysteresis_beats: 0.4,
    target_density: 2.0
});

let beat_envelope = beat_events.to_signal(#{
    envelope: "attack_decay",
    attack_beats: 0.01,
    decay_beats: 0.2,
    easing: "exponential_out"
});

// Post-processing effects
let bloom = fx.bloom(#{ threshold: 0.6, intensity: 0.5 });
let grade = fx.colorGrade(#{ saturation: 1.1 });
let vignette = fx.vignette(#{ intensity: 0.2 });

fn init(ctx) {
    // Main sphere with emissive material
    main_sphere.material = "emissive";
    scene.add(main_sphere);

    // Create orbiting accent cubes with gradient material
    for i in 0..6 {
        let cube = mesh.cube();
        cube.material = "gradient";
        cube.scale = 0.2;
        accent_cubes.push(cube);
        scene.add(cube);
    }

    // Set up post-processing chain
    post.add(bloom);
    post.add(grade);
    post.add(vignette);

    // Create feedback for trails
    let fb = feedback.builder()
        .warp.spiral(0.3, 0.01)
        .color.decay(0.92)
        .blend.add()
        .opacity(0.7)
        .build();
    feedback.enable(fb);
}

fn update(dt, frame) {
    let time = frame.time;

    // Main sphere - pulsing glow
    main_sphere.scale = energy.scale(0.3).add(0.8);
    main_sphere.params.emission_intensity = beat_envelope.scale(2.0).add(0.5);
    main_sphere.params.emission_color = #{
        r: beat_envelope.scale(0.6).add(0.4),
        g: energy.scale(0.4).add(0.3),
        b: 0.9,
        a: 1.0
    };

    // Orbiting cubes
    for i in 0..6 {
        let cube = accent_cubes[i];
        let angle = time * 0.5 + (i * 1.047);  // 60 degrees apart
        let radius = 2.0 + beat_envelope.scale(0.5);

        cube.position = #{
            x: radius * angle.cos(),
            y: beat_envelope.scale(0.3),
            z: radius * angle.sin()
        };
        cube.rotation.y = time * 2.0;

        // Gradient colors react to audio
        cube.params.color_top = #{
            r: onset.scale(0.8).add(0.2),
            g: 0.3,
            b: 0.8,
            a: 1.0
        };
        cube.params.color_bottom = #{
            r: 0.2,
            g: energy.scale(0.6).add(0.2),
            b: 0.5,
            a: 1.0
        };
    }

    // Dynamic post-processing
    bloom.intensity = beat_envelope.scale(0.5).add(0.3);
    grade.saturation = energy.scale(0.3).add(1.0);
    vignette.intensity = beat_envelope.scale(0.2).add(0.1);
}
```

---

## Reference

### Signal Methods

Parameters marked with `†` can accept either a constant (`f32`) or a `Signal` for dynamic control.

#### Arithmetic

| Method    | Signature                                 | Description              |
| --------- | ----------------------------------------- | ------------------------ |
| `add`     | `(Signal) -> Signal` or `(f32) -> Signal` | Add signals or constant  |
| `sub`     | `(Signal) -> Signal` or `(f32) -> Signal` | Subtract signals         |
| `mul`     | `(Signal) -> Signal`                      | Multiply signals         |
| `div`     | `(Signal) -> Signal`                      | Divide signals           |
| `scale`   | `(factor†) -> Signal`                     | Multiply by factor       |
| `offset`  | `(amount†) -> Signal`                     | Add constant (alias)     |
| `neg`     | `() -> Signal`                            | Negate signal            |
| `pow`     | `(exponent†) -> Signal`                   | Raise to power           |
| `mix`     | `(Signal, weight†) -> Signal`             | Blend two signals        |
| `lerp`    | `(Signal, t†) -> Signal`                  | Linear interpolation     |

#### Trigonometric

| Method  | Signature                | Description                    |
| ------- | ------------------------ | ------------------------------ |
| `sin`   | `() -> Signal`           | Sine of value                  |
| `cos`   | `() -> Signal`           | Cosine of value                |
| `tan`   | `() -> Signal`           | Tangent of value               |
| `asin`  | `() -> Signal`           | Arc sine (input clamped)       |
| `acos`  | `() -> Signal`           | Arc cosine (input clamped)     |
| `atan`  | `() -> Signal`           | Arc tangent                    |
| `atan2` | `(Signal) -> Signal`     | atan2(self, other)             |

#### Exponential and Logarithmic

| Method | Signature          | Description              |
| ------ | ------------------ | ------------------------ |
| `sqrt` | `() -> Signal`     | Square root              |
| `exp`  | `() -> Signal`     | e^value                  |
| `ln`   | `() -> Signal`     | Natural logarithm        |
| `log`  | `(base†) -> Signal`| Logarithm with base      |

#### Modular and Periodic

| Method   | Signature                    | Description                      |
| -------- | ---------------------------- | -------------------------------- |
| `modulo` | `(divisor†) -> Signal`       | Euclidean modulo (always ≥ 0)    |
| `rem`    | `(divisor†) -> Signal`       | Remainder (can be negative)      |
| `fract`  | `() -> Signal`               | Fractional part                  |
| `wrap`   | `(min†, max†) -> Signal`     | Wrap value to range [min, max)   |

#### Mapping and Shaping

| Method      | Signature                                      | Description                    |
| ----------- | ---------------------------------------------- | ------------------------------ |
| `map`       | `(in_min†, in_max†, out_min†, out_max†) -> Signal` | Map from one range to another |
| `smoothstep`| `(edge0†, edge1†) -> Signal`                   | S-curve interpolation          |
| `clamp`     | `(min†, max†) -> Signal`                       | Clamp to range                 |
| `abs`       | `() -> Signal`                                 | Absolute value                 |
| `sign`      | `() -> Signal`                                 | -1, 0, or 1                    |
| `floor`     | `() -> Signal`                                 | Round down                     |
| `ceil`      | `() -> Signal`                                 | Round up                       |
| `round`     | `() -> Signal`                                 | Round to nearest               |
| `sigmoid`   | `(k†) -> Signal`                               | Sigmoid curve (center 0.5)     |

#### Smoothing

| Method                  | Signature                               | Description                      |
| ----------------------- | --------------------------------------- | -------------------------------- |
| `smooth.moving_average` | `(beats: f32) -> Signal`                | Moving average smoothing         |
| `smooth.exponential`    | `(attack: f32, release: f32) -> Signal` | Asymmetric exponential smoothing |
| `smooth.gaussian`       | `(sigma: f32) -> Signal`                | Gaussian smoothing               |

#### Normalisation

| Method               | Signature                    | Description                    |
| -------------------- | ---------------------------- | ------------------------------ |
| `normalise.global`   | `() -> Signal`               | Min-max normalisation          |
| `normalise.robust`   | `() -> Signal`               | Percentile-based normalisation |
| `normalise.to_range` | `(min: f32, max: f32) -> Signal` | Map to range               |

#### Gating

| Method            | Signature                  | Description        |
| ----------------- | -------------------------- | ------------------ |
| `gate.threshold`  | `(f32) -> Signal`          | Simple threshold   |
| `gate.hysteresis` | `(on: f32, off: f32) -> Signal` | Hysteresis gate |

#### Time and State

| Method      | Signature              | Description                         |
| ----------- | ---------------------- | ----------------------------------- |
| `diff`      | `() -> Signal`         | Derivative                          |
| `integrate` | `(decay†) -> Signal`   | Cumulative sum with decay           |
| `delay`     | `(beats†) -> Signal`   | Time delay                          |
| `anticipate`| `(beats†) -> Signal`   | Look ahead (input signals only)     |
| `sample_at` | `(time: f32) -> f32`   | Sample value at time (escape hatch) |

#### Sampling Configuration

| Method          | Signature              | Description                            |
| --------------- | ---------------------- | -------------------------------------- |
| `interpolate`   | `() -> Signal`         | Use linear interpolation sampling      |
| `peak`          | `() -> Signal`         | Use peak-preserving sampling (default) |
| `peak_window`   | `(beats: f32) -> Signal`| Peak-preserving with custom window    |
| `peak_window_sec`| `(seconds: f32) -> Signal`| Peak-preserving with window in seconds|

#### Debug

| Method     | Signature                  | Description                       |
| ---------- | -------------------------- | --------------------------------- |
| `probe`    | `(name: String) -> Signal` | Attach debug probe                |
| `describe` | `() -> String`             | Human-readable graph description  |

### Time Signals

| Signal              | Description                               |
| ------------------- | ----------------------------------------- |
| `timing.time`       | Elapsed time in seconds                   |
| `timing.dt`         | Delta time since last frame               |
| `timing.beatPosition` | Current beat position (continuous)      |
| `timing.beatIndex`  | Current beat index (integer-valued)       |
| `timing.beatPhase`  | Beat phase 0-1 (fractional part of beat)  |
| `timing.bpm`        | Current BPM (from beat grid, or 120.0)    |

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

| Limit                      | Value              |
| -------------------------- | ------------------ |
| Expression recursion depth | 64                 |
| Function call depth        | 64                 |
| Operations per frame       | 100,000            |
| Max string size            | 10,000 characters  |
| Max array size             | 100,000 elements   |
| Max map size               | 500 entries        |
| Log messages per frame     | 100                |

---

## Lighting

Octoseq provides a simple directional lighting system with ambient and rim lighting support. All lighting parameters accept Signals for audio-reactive control.

### Global Lighting Configuration

The `lighting` namespace controls the global light source:

```rhai
fn init(ctx) {
    // Enable lighting
    lighting.enabled = true;

    // Set light direction (points FROM the light)
    lighting.direction = #{ x: -0.5, y: -1.0, z: -0.3 };

    // Light properties
    lighting.intensity = 1.0;          // Light intensity multiplier
    lighting.color = #{ r: 1.0, g: 0.95, b: 0.9 };  // Warm white
    lighting.ambient = 0.3;            // Ambient fill (0.0-1.0)

    // Rim lighting (edge highlights)
    lighting.rim_intensity = 0.3;      // Rim light strength
    lighting.rim_power = 2.0;          // Rim falloff (higher = sharper)
}
```

#### Lighting Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable/disable global lighting |
| `direction` | `{x, y, z}` | `(0, -1, 0)` | Light direction (points from light) |
| `intensity` | `Signal \| f32` | `1.0` | Light intensity multiplier |
| `color` | `{r, g, b}` | `(1, 1, 1)` | Light color (0-1 range) |
| `ambient` | `Signal \| f32` | `0.3` | Ambient light intensity |
| `rim_intensity` | `Signal \| f32` | `0.0` | Rim lighting intensity |
| `rim_power` | `Signal \| f32` | `2.0` | Rim lighting falloff power |

### Audio-Reactive Lighting

All numeric lighting properties accept Signals:

```rhai
fn init(ctx) {
    lighting.enabled = true;

    // Pulsing light intensity synced to audio
    lighting.intensity = inputs.mix.energy
        .smooth.exponential(0.05, 0.2)
        .normalise.robust()
        .scale(0.5)
        .add(0.5);

    // Rim glow on beats
    let beat_envelope = inputs.mix.onset
        .smooth.exponential(0.02, 0.15)
        .normalise.robust()
        .pick.events(#{ hysteresis_beats: 0.4, target_density: 2.0 })
        .to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.2 });

    lighting.rim_intensity = beat_envelope.scale(0.5);
}
```

### Per-Entity Lighting Control

Individual mesh entities can control their lighting behavior:

```rhai
let lit_cube = mesh.cube();
let unlit_floor = mesh.plane();
let glowing_sphere = mesh.sphere();

fn init(ctx) {
    // Normal lit mesh (default)
    lit_cube.lit = true;
    scene.add(lit_cube);

    // Unlit mesh (flat colors, ignores lighting)
    unlit_floor.lit = false;
    unlit_floor.position = #{ x: 0.0, y: -1.0, z: 0.0 };
    scene.add(unlit_floor);

    // Mesh with emissive glow
    glowing_sphere.lit = true;
    glowing_sphere.emissive = 0.5;  // Adds glow unaffected by lighting
    scene.add(glowing_sphere);

    lighting.enabled = true;
}
```

#### Per-Entity Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `lit` | `bool` | `true` | Whether this mesh is affected by global lighting |
| `emissive` | `Signal \| f32` | `0.0` | Emissive intensity (adds glow unaffected by lighting) |

### Lighting Model

Octoseq uses a simple but effective lighting model:

- **Half-Lambert diffuse**: Softer shadows than traditional Lambert (`NdotL * 0.5 + 0.5`)
- **Rim lighting**: Highlights edges facing away from the camera
- **Ambient**: Constant fill light for shadowed areas
- **Per-entity emissive**: Adds to base color, unaffected by light direction

### OBJ Mesh Normals

Loaded OBJ meshes automatically use their vertex normals for lighting:

- If the OBJ file contains normals, they are used directly
- If normals are missing, they are computed as area-weighted vertex normals from face geometry

Built-in primitives have appropriate normals:
- **Cube**: Per-face normals (flat shading)
- **Sphere**: Smooth normals (normalized position)
- **Plane**: Y-up normals `(0, 1, 0)`

---

## Blob Shadows

Octoseq provides simple blob/contact shadows that render a soft ellipse on a ground plane beneath entities. These are not real shadows based on light direction, but stylized fake shadows for visual grounding.

### Enabling Blob Shadows

```rhai
fn init(ctx) {
    let cube = mesh.cube();
    cube.position.y = 2.0;

    // Enable blob shadow
    cube.shadow.enabled = true;
    cube.shadow.plane_y = 0.0;   // Shadow on ground plane
    cube.shadow.opacity = 0.5;
    cube.shadow.radius = 1.5;    // Uniform radius
    cube.shadow.softness = 0.3;  // Soft edges

    scene.add(cube);
}
```

### Shadow Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable/disable the shadow |
| `plane_y` | `Signal \| f32` | `0.0` | Y position of shadow plane |
| `opacity` | `Signal \| f32` | `0.5` | Shadow opacity (0.0-1.0) |
| `radius` | `Signal \| f32` | `1.0` | Uniform radius (sets both radius_x and radius_z) |
| `radius_x` | `Signal \| f32` | `1.0` | Shadow radius in X direction |
| `radius_z` | `Signal \| f32` | `1.0` | Shadow radius in Z direction |
| `softness` | `Signal \| f32` | `0.3` | Edge softness (0 = hard, 1 = very soft) |
| `offset_x` | `Signal \| f32` | `0.0` | X offset from entity position |
| `offset_z` | `Signal \| f32` | `0.0` | Z offset from entity position |
| `color` | `Map { r, g, b }` | `(0, 0, 0)` | Shadow color (RGB, 0-1 range) |

### Audio-Reactive Shadows

All numeric shadow properties accept Signals:

```rhai
fn init(ctx) {
    let sphere = mesh.sphere();
    sphere.position.y = inputs.mix.energy.scale(2.0).offset(1.0);

    // Audio-reactive shadow
    sphere.shadow.enabled = true;
    sphere.shadow.plane_y = 0.0;

    // Shadow grows/shrinks with energy
    sphere.shadow.radius = inputs.mix.energy.scale(1.0).offset(1.0);

    // Shadow fades as object rises
    sphere.shadow.opacity = inputs.mix.energy.scale(-0.3).offset(0.6);

    scene.add(sphere);
}
```

### Elliptical Shadows

For non-uniform shadows, use separate `radius_x` and `radius_z`:

```rhai
fn init(ctx) {
    let cube = mesh.cube();
    cube.scale = 2.0;
    cube.position.y = 1.0;

    // Elliptical shadow
    cube.shadow.enabled = true;
    cube.shadow.radius_x = 2.5;  // Wider in X
    cube.shadow.radius_z = 1.5;  // Narrower in Z
    cube.shadow.softness = 0.4;

    scene.add(cube);
}
```

---

## Design Principles

1. **Scripts express intent** - Heavy computation lives in the engine
2. **Lazy evaluation** - Signals build computation graphs, evaluated at render time
3. **Beat-aware** - All time-based operations use beat position when available
4. **Whole-track visibility** - Scripts can look ahead and behind in time
5. **Immutable signals** - All transformations return new signals
6. **Deterministic** - Same audio input always produces identical visuals
7. **Signals everywhere** - All APIs that accept numeric parameters should also accept Signals (see below)

---

## Signals Everywhere

**Core Principle**: Any API parameter that accepts a number should also accept a `Signal`. Signals are evaluated per-frame during scene sync, enabling audio-reactive control of any numeric property without imperative code.

### Currently Supported

The following APIs fully support Signals for numeric parameters:

- **Entity properties**: `position.{x,y,z}`, `rotation.{x,y,z}`, `scale`, `color.{r,g,b,a}`
- **Material parameters**: `entity.params.*` (all numeric material params)
- **Post-processing effects**: `fx.bloom()`, `fx.colorGrade()`, `fx.vignette()`, `fx.distortion()` - all numeric parameters
- **Effect post-modification**: `bloom.intensity = signal`, `grade.saturation = signal`, etc.
- **Effect color/vec params**: `tint.r/g/b/a`, `color.r/g/b/a`, `center.x/y` - all accept Signals
- **Feedback builder**: All warp, color, and opacity parameters accept Signals via `SignalOrF32`
- **Line trace**: `line.trace(signal, options)` - declarative Signal-driven line visualization
- **Signal methods with dynamic params**: `scale()`, `mix()`, `clamp()`, `sigmoid()`, `integrate()`, `delay()`, `anticipate()`

### APIs That Accept Numbers Only

| API | Parameters | Notes |
|-----|------------|-------|
| `line.push(x, y)` | `x`, `y` | Immediate-mode; use `line.trace()` for Signal-driven lines |
| `dbg.emit(name, value)` | `value` | Debug emission - samples value at call time |

### Implementation Pattern

When adding Signal support to a parameter:

1. Accept `rhai::Dynamic` instead of `f64`/`f32`
2. Store as `Dynamic` in the effect/config struct
3. During sync/evaluation, use `eval_signal_param()` or similar to resolve:
   - If it's a number, use directly
   - If it's a Signal, evaluate at current time/dt

Example (pseudo-code):
```rust
// In effect parameter storage
pub struct BloomOptions {
    pub intensity: Dynamic,  // Can be f64 or Signal
}

// During sync
let intensity_value = eval_signal_param(&options.intensity, time, dt, signals)?;
```

### Why This Matters

Without Signal support, users must write imperative code in `update()`:
```rhai
// Without Signal support (verbose, imperative)
fn update(dt, frame) {
    bloom.intensity = frame.amplitude * 0.5;  // Must sample manually each frame
}
```

With Signal support, users can express intent declaratively:
```rhai
// With Signal support (declarative, expressive)
let bloom = fx.bloom(#{
    intensity: inputs.mix.rms.smooth.exponential(0.1, 0.3).scale(0.5)
});
// Engine evaluates automatically each frame
```
