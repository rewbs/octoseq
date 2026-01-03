# Octoseq Rhai Scripting Reference

Complete API reference for Rhai scripts in Octoseq. All numeric parameters (`f32`) also accept `Signal` for audio-reactive control.

---

## Table of Contents

- [Namespaces](#namespaces)
  - [mesh](#mesh---mesh-creation)
  - [deform](#deform---deformation-builders)
  - [line](#line---line-and-ribbon-creation)
  - [radial](#radial---radial-primitives)
  - [points](#points---point-cloud-creation)
  - [scene](#scene---scene-management)
  - [log](#log---logging)
  - [dbg](#dbg---debug-utilities)
  - [gen](#gen---signal-generators)
  - [time / timing](#time--timing---time-signals)
  - [inputs](#inputs---analysis-inputs)
  - [materials](#materials---available-materials)
  - [fx](#fx---post-processing-effects)
  - [post](#post---effect-chain-management)
  - [feedback](#feedback---temporal-feedback)
  - [particles](#particles---particle-systems)
  - [camera](#camera---camera-control)
- [Types](#types)
  - [Signal](#signal)
  - [EventStream](#eventstream)
  - [Event](#event)
  - [Entity](#entity)
  - [FeedbackBuilder](#feedbackbuilder)
  - [ParticleSystem](#particlesystem)
- [Global Functions](#global-functions)

---

## Namespaces

### `mesh` - Mesh Creation

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `cube()` | — | `Entity` | Create a cube mesh entity |
| `plane()` | — | `Entity` | Create a plane mesh entity |
| `sphere()` | — | `Entity` | Create a sphere mesh entity |
| `load(asset_id)` | `asset_id: string` | `Entity` | Load mesh from asset by ID |

### `deform` - Deformation Builders

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `twist(options)` | `options: Map { axis, amount, center }` | `Deformation` | Create twist deformation around axis |
| `bend(options)` | `options: Map { axis, amount, center }` | `Deformation` | Create bend deformation around axis |
| `wave(options)` | `options: Map { axis, direction, amplitude, frequency, phase }` | `Deformation` | Create wave deformation |
| `noise(options)` | `options: Map { scale, amplitude, seed }` | `Deformation` | Create noise-based deformation |

### `line` - Line and Ribbon Creation

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `strip(options)` | `options: Map { max_points?, mode? }` | `Entity` | Create manual line strip (mode: "line" or "points") |
| `trace(signal, options)` | `signal: Signal`, `options: Map { max_points?, mode?, x_scale?, y_scale?, y_offset? }` | `Entity` | Create signal-driven trace line |
| `ribbon(signal, options)` | `signal: Signal`, `options: Map { max_points?, mode?, width?, twist?, tube_segments? }` | `Entity` | Create thick extruded ribbon (mode: "strip" or "tube") |

### `radial` - Radial Primitives

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `ring(options)` | `options: Map { radius?, thickness?, start_angle?, end_angle?, segments? }` | `Entity` | Create ring/arc mesh in XY plane |
| `wave(signal, options)` | `signal: Signal`, `options: Map { base_radius?, amplitude?, wave_frequency?, resolution? }` | `Entity` | Create signal-modulated radial waveform |

### `points` - Point Cloud Creation

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `cloud(options)` | `options: Map { count?, spread?, mode?, seed?, point_size? }` | `Entity` | Create point cloud (mode: "uniform" or "sphere") |

### `scene` - Scene Management

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `add(entity)` | `entity: Entity` | — | Add entity to render scene |
| `remove(entity)` | `entity: Entity` | — | Remove entity from render scene |
| `group()` | — | `Entity` | Create a grouping entity for hierarchies |

### `log` - Logging

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `info(value)` | `value: any` | — | Log info message |
| `warn(value)` | `value: any` | — | Log warning message |
| `error(value)` | `value: any` | — | Log error message |

### `dbg` - Debug Utilities

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `emit(name, value)` | `name: string`, `value: f32` | — | Emit debug signal (analysis mode only) |
| `wireframe(enabled)` | `enabled: bool` | — | Toggle wireframe rendering globally |
| `boundingBoxes(enabled)` | `enabled: bool` | — | Toggle bounding box display |
| `showBounds(entity)` | `entity: Entity` | — | Toggle bounds for specific entity |
| `isolate(entity)` | `entity: Entity` | — | Isolate entity for solo viewing |
| `clearIsolation()` | — | — | Clear entity isolation |
| `showEvents(events)` | `events: EventStream` | — | Visualize events with default options |
| `showEventsOpts(events, options)` | `events: EventStream`, `options: Map` | — | Visualize events with custom options |
| `listMaterials()` | — | `Array[string]` | Get array of available material IDs |
| `describeMaterial(id)` | `id: string` | `Map` | Get material metadata |
| `listEffects()` | — | `Array[string]` | Get array of available effect IDs |
| `describeEffect(id)` | `id: string` | `Map` | Get effect metadata |

### `gen` - Signal Generators

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `sin(freq, phase)` | `freq: f32`, `phase: f32` | `Signal` | Sine oscillator (beat-synced) |
| `square(freq, phase, duty)` | `freq: f32`, `phase: f32`, `duty: f32` | `Signal` | Square wave oscillator |
| `triangle(freq, phase)` | `freq: f32`, `phase: f32` | `Signal` | Triangle wave oscillator |
| `saw(freq, phase)` | `freq: f32`, `phase: f32` | `Signal` | Sawtooth oscillator |
| `noise(noise_type, seed)` | `noise_type: string`, `seed: i64` | `Signal` | Noise generator ("white" or "pink") |
| `perlin(scale, seed)` | `scale: f32`, `seed: i64` | `Signal` | Perlin noise generator |
| `constant(value)` | `value: f32` | `Signal` | Constant value signal |

### `time` / `timing` - Time Signals

Pre-populated namespace with time-based signals. Both `time` and `timing` namespaces are available.

| `time` Property | `timing` Property | Type | Description |
|-----------------|-------------------|------|-------------|
| `seconds` | `time` | `Signal` | Elapsed time in seconds |
| `frames` | — | `Signal` | Frame counter |
| `beats` | `beatPosition` | `Signal` | Continuous beat position |
| `phase` | `beatPhase` | `Signal` | Phase within current beat (0–1) |
| `bpm` | `bpm` | `Signal` | Beats per minute |
| `dt` | `dt` | `Signal` | Delta time per frame |
| — | `beatIndex` | `Signal` | Integer beat index |

### `inputs` - Analysis Inputs

Dynamically populated namespace with analysis signals.

| Property | Type | Description |
|----------|------|-------------|
| `<signal_name>` | `Signal` | Analysis input by name (e.g., `inputs.energy`, `inputs.spectralCentroid`) |

#### `inputs.bands.<band_id>` - Band-Specific Inputs

| Property | Type | Description |
|----------|------|-------------|
| `energy` | `Signal` | Band energy level |
| `onset` | `Signal` | Onset envelope |
| `flux` | `Signal` | Spectral flux |
| `amplitude` | `Signal` | Alias for energy |
| `events` | `EventStream` | Pre-extracted events for band |

### `materials` - Available Materials

| Material ID | Description | Parameters |
|------------|-------------|------------|
| `default` | Standard mesh rendering | `base_color` |
| `emissive` | Self-illuminating glow | `emission_color`, `emission_intensity` |
| `wire_glow` | Glowing wireframe effect | `glow_color`, `glow_intensity`, `line_width` |
| `soft_additive` | Soft additive blending | `base_color`, `softness` |
| `gradient` | Two-tone gradient | `color_top`, `color_bottom`, `blend_height` |

Use `dbg.listMaterials()` and `dbg.describeMaterial(id)` for runtime introspection.

### `fx` - Post-Processing Effects

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `bloom(options)` | `options: Map { threshold?, intensity?, radius?, downsample? }` | `PostEffect` | Create bloom effect |
| `colorGrade(options)` | `options: Map { brightness?, contrast?, saturation?, gamma?, tint? }` | `PostEffect` | Create color grading effect |
| `vignette(options)` | `options: Map { intensity?, smoothness?, color? }` | `PostEffect` | Create vignette effect |
| `distortion(options)` | `options: Map { amount?, center? }` | `PostEffect` | Create distortion effect |
| `zoomWrap(options)` | `options: Map { amount?, center?, wrap_mode? }` | `PostEffect` | Zoom with edge wrapping (wrap_mode: "repeat" or "mirror") |
| `radialBlur(options)` | `options: Map { strength?, center?, samples? }` | `PostEffect` | Radial motion blur (samples: 2-32) |
| `directionalBlur(options)` | `options: Map { amount?, angle?, samples? }` | `PostEffect` | Directional motion blur (amount in pixels, angle in radians) |
| `chromaticAberration(options)` | `options: Map { amount?, angle? }` | `PostEffect` | RGB channel separation |
| `grain(options)` | `options: Map { amount?, scale?, seed? }` | `PostEffect` | Deterministic film grain |

Use `dbg.listEffects()` and `dbg.describeEffect(id)` for runtime introspection.

### `post` - Effect Chain Management

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `add(effect)` | `effect: PostEffect` | — | Add effect to chain |
| `remove(effect)` | `effect: PostEffect` | — | Remove effect from chain |
| `clear()` | — | — | Clear all effects |
| `setOrder(order)` | `order: Array[PostEffect]` | — | Set effect execution order |

### `feedback` - Temporal Feedback

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `builder()` | — | `FeedbackBuilder` | Create new feedback configuration builder |
| `enable(config)` | `config: FeedbackConfig` | — | Enable feedback with configuration |
| `disable()` | — | — | Disable feedback |
| `is_enabled()` | — | `bool` | Check if feedback is enabled |

### `particles` - Particle Systems

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `from_events(events, options)` | `events: EventStream`, `options: Map` | `ParticleSystem` | Create particle system triggered by events |
| `stream(signal, options)` | `signal: Signal`, `options: Map` | `ParticleSystem` | Create continuous particle stream |

#### Particle Options

| Option | Type | Description |
|--------|------|-------------|
| `count` | `i64` | Instances per event |
| `lifetime_beats` | `f32` | Particle lifetime in beats |
| `max_instances` | `i64` | Maximum particle instances |
| `color` | `Map { r, g, b, a }` | Base color |
| `scale` | `f32` | Base scale |
| `seed` | `i64` | Random seed for determinism |
| `envelope` | `string` | Envelope shape (see Signal envelopes) |
| `attack_beats` | `f32` | Attack duration in beats |
| `decay_beats` | `f32` | Decay duration in beats |
| `width_beats` | `f32` | Gaussian width in beats |
| `easing` | `string` | Easing function |
| `spread` | `Map { x, y, z }` | Position spread |
| `scale_variation` | `f32` | Scale randomization |
| `color_variation` | `f32` | Color randomization |
| `rotation_variation` | `f32` | Rotation randomization |
| `material` | `string` | Material ID |
| `geometry` | `string` | "point" or "billboard" |
| `mesh` | `string` | Mesh asset ID |
| `point_size` | `f32` | Point size |
| `billboard_size` | `f32` | Billboard size |
| `mesh_scale` | `f32` | Mesh scale |
| `mode` | `string` | "proportional" or "threshold" (stream only) |
| `rate_per_beat` | `f32` | Emission rate (proportional mode) |
| `threshold` | `f32` | Trigger threshold (threshold mode) |
| `instances_per_burst` | `i64` | Burst count (threshold mode) |

### `camera` - Camera Control

Global camera singleton. Controls view position, orientation, and projection. Supports signal-binding for audio-reactive camera motion.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `position` | `Map { x, y, z }` | Camera position in world space (each component: `Signal \| f32`) |
| `rotation` | `Map { x, y, z }` | Euler rotation (pitch, yaw, roll) in radians. Used when `target` is not set |
| `target` | `Map { x, y, z } \| ()` | Look-at target position. Set to enable LookAt mode; `()` for Euler mode |
| `up` | `Map { x, y, z }` | Up vector for LookAt mode. Default: (0, 1, 0) |
| `fov` | `Signal \| f32` | Field of view in degrees. Default: 45 |
| `near` | `Signal \| f32` | Near clip plane. Default: 0.1 |
| `far` | `Signal \| f32` | Far clip plane. Default: 100.0 |

#### Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `lookAt(target)` | `target: Map { x, y, z }` | — | Set camera to look at target position (enables LookAt mode) |
| `orbit(center, radius, angle)` | `center: Map { x, y, z }`, `radius: f32`, `angle: f32` | — | Position camera on orbit around center point |
| `dolly(distance)` | `distance: f32` | — | Move camera forward/backward along view direction |
| `pan(dx, dy)` | `dx: f32`, `dy: f32` | — | Move camera laterally (left/right, up/down) |

#### Coordinate Modes

The camera operates in one of two modes:

- **Euler mode** (default): When `camera.target` is `()`, orientation is derived from `camera.rotation` (pitch, yaw, roll)
- **LookAt mode**: When `camera.target` is set to a position, the camera automatically orients to look at that point

#### Defaults

| Property | Default Value |
|----------|---------------|
| `position` | (4.0, 2.0, 4.0) |
| `rotation` | (0.0, 0.0, 0.0) |
| `target` | `()` (unset, Euler mode) |
| `up` | (0.0, 1.0, 0.0) |
| `fov` | 45.0 |
| `near` | 0.1 |
| `far` | 100.0 |

---

## Types

### Signal

Lazy-evaluated computation graph for audio-reactive values.

#### Arithmetic Operations

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `add(other)` | `other: Signal \| f32` | `Signal` | Add two signals |
| `sub(other)` | `other: Signal \| f32` | `Signal` | Subtract signals |
| `mul(other)` | `other: Signal \| f32` | `Signal` | Multiply signals |
| `div(other)` | `other: Signal \| f32` | `Signal` | Divide signals |
| `scale(factor)` | `factor: Signal \| f32` | `Signal` | Multiply by factor |
| `mix(other, weight)` | `other: Signal`, `weight: Signal \| f32` | `Signal` | Blend between signals |
| `pow(exponent)` | `exponent: Signal \| f32` | `Signal` | Power operation |
| `offset(amount)` | `amount: Signal \| f32` | `Signal` | Add offset |

#### Math Functions

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `abs()` | — | `Signal` | Absolute value |
| `floor()` | — | `Signal` | Floor function |
| `ceil()` | — | `Signal` | Ceiling function |
| `round()` | — | `Signal` | Round to nearest |
| `sign()` | — | `Signal` | Sign (-1, 0, 1) |
| `neg()` | — | `Signal` | Negate value |

#### Trigonometric Functions

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `sin()` | — | `Signal` | Sine of value |
| `cos()` | — | `Signal` | Cosine of value |
| `tan()` | — | `Signal` | Tangent of value |
| `asin()` | — | `Signal` | Arc sine |
| `acos()` | — | `Signal` | Arc cosine |
| `atan()` | — | `Signal` | Arc tangent |
| `atan2(x)` | `x: Signal` | `Signal` | Two-argument arctangent |

#### Exponential & Logarithmic

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `sqrt()` | — | `Signal` | Square root |
| `exp()` | — | `Signal` | e^x |
| `ln()` | — | `Signal` | Natural logarithm |
| `log(base)` | `base: Signal \| f32` | `Signal` | Logarithm with base |

#### Modular & Periodic

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `modulo(divisor)` | `divisor: Signal \| f32` | `Signal` | Modulo operation |
| `rem(divisor)` | `divisor: Signal \| f32` | `Signal` | Remainder operation |
| `wrap(min, max)` | `min: Signal \| f32`, `max: Signal \| f32` | `Signal` | Wrap value to range |
| `fract()` | — | `Signal` | Fractional part |

#### Mapping & Shaping

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `clamp(min, max)` | `min: Signal \| f32`, `max: Signal \| f32` | `Signal` | Clamp to range |
| `map(in_min, in_max, out_min, out_max)` | all `Signal \| f32` | `Signal` | Remap value from one range to another |
| `smoothstep(edge0, edge1)` | `edge0: Signal \| f32`, `edge1: Signal \| f32` | `Signal` | Smoothstep interpolation |
| `lerp(other, t)` | `other: Signal`, `t: Signal \| f32` | `Signal` | Linear interpolation |
| `sigmoid(k)` | `k: Signal \| f32` | `Signal` | Sigmoid curve |

#### Rate & Accumulation

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `diff()` | — | `Signal` | Rate of change (derivative) |
| `integrate(decay_beats)` | `decay_beats: Signal \| f32` | `Signal` | Accumulation with exponential decay |

#### Time Shifting

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `delay(beats)` | `beats: Signal \| f32` | `Signal` | Delay signal by beats |
| `anticipate(beats)` | `beats: Signal \| f32` | `Signal` | Look ahead by beats |

#### Sampling Configuration

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `interpolate()` | — | `Signal` | Use linear interpolation |
| `peak()` | — | `Signal` | Use peak-preserving sampling (default) |
| `peak_window(beats)` | `beats: f32` | `Signal` | Peak-preserving with custom window |
| `peak_window_sec(seconds)` | `seconds: f32` | `Signal` | Peak-preserving with time window |

#### Imperative Sampling

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `sample_at(time)` | `time: f32` | `f32` | Sample signal at specific time (Input/BandInput only) |

#### Smoothing Builder (`.smooth`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `moving_average(beats)` | `beats: f32` | `Signal` | Moving average smoothing |
| `exponential(attack, release)` | `attack: f32`, `release: f32` | `Signal` | Exponential smoothing |
| `gaussian(sigma)` | `sigma: f32` | `Signal` | Gaussian smoothing |

#### Normalization Builder (`.normalise`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `global()` | — | `Signal` | Global min/max normalization |
| `robust()` | — | `Signal` | Percentile-based robust normalization |
| `to_range(min, max)` | `min: f32`, `max: f32` | `Signal` | Normalize to specific range |

#### Gating Builder (`.gate`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `threshold(threshold)` | `threshold: f32` | `Signal` | Simple threshold gate |
| `hysteresis(on, off)` | `on: f32`, `off: f32` | `Signal` | Hysteresis gate |

#### Event Extraction Builder (`.pick`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `events(options)` | `options: Map` | `EventStream` | Extract events from signal |

#### Debug

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `probe(name)` | `name: string` | `Signal` | Attach debug probe for visualization |
| `describe()` | — | `string` | Get human-readable description |

---

### EventStream

Collection of temporal point events.

#### Query Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `len()` | — | `i64` | Number of events |
| `is_empty()` | — | `bool` | True if no events |
| `get(index)` | `index: i64` | `Event \| null` | Get event by index |
| `to_array()` | — | `Array[Event]` | Convert to array for iteration |
| `time_span()` | — | `Array[f32]` | [start_time, end_time] |
| `max_weight()` | — | `f32` | Maximum event weight |
| `min_weight()` | — | `f32` | Minimum event weight |

#### Filtering

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `filter_time(start, end)` | `start: f32`, `end: f32` | `EventStream` | Filter by time range |
| `filter_weight(min_weight)` | `min_weight: f32` | `EventStream` | Filter by minimum weight |
| `limit(max_events)` | `max_events: i64` | `EventStream` | Limit number of events |

#### Conversion

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `to_signal()` | — | `Signal` | Convert to impulse signal |
| `to_signal(options)` | `options: Map` | `Signal` | Convert with envelope options |
| `impulse()` | — | `Signal` | Alias for `to_signal()` |

#### Distance Signals

Create signals based on temporal distance to events. Values are linear (no easing).

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `beats_from_prev()` | — | `Signal` | Beats elapsed since previous event (0 at event, grows linearly) |
| `beats_to_next()` | — | `Signal` | Beats remaining until next event (shrinks to 0 at event) |
| `seconds_from_prev()` | — | `Signal` | Seconds elapsed since previous event |
| `seconds_to_next()` | — | `Signal` | Seconds remaining until next event |
| `frames_from_prev()` | — | `Signal` | Frames elapsed since previous event |
| `frames_to_next()` | — | `Signal` | Frames remaining until next event |

**Edge cases:**
- Before first event: `*_from_prev()` returns distance to first event
- After last event: `*_to_next()` returns distance to track end
- Empty events: Returns 0.0

#### Count Signals

Count events within a time window. Window parameter can be a constant or Signal.

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `count_prev_beats(window)` | `window: f32 \| Signal` | `Signal` | Events in previous N beats |
| `count_next_beats(window)` | `window: f32 \| Signal` | `Signal` | Events in next N beats |
| `count_prev_seconds(window)` | `window: f32 \| Signal` | `Signal` | Events in previous N seconds |
| `count_next_seconds(window)` | `window: f32 \| Signal` | `Signal` | Events in next N seconds |
| `count_prev_frames(window)` | `window: f32 \| Signal` | `Signal` | Events in previous N frames |
| `count_next_frames(window)` | `window: f32 \| Signal` | `Signal` | Events in next N frames |

#### Density Signals

Event density within a time window (count / window_size). Returns pure ratio with no smoothing.

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `density_prev_beats(window)` | `window: f32 \| Signal` | `Signal` | Events per beat in previous N beats |
| `density_next_beats(window)` | `window: f32 \| Signal` | `Signal` | Events per beat in next N beats |
| `density_prev_seconds(window)` | `window: f32 \| Signal` | `Signal` | Events per second in previous N seconds |
| `density_next_seconds(window)` | `window: f32 \| Signal` | `Signal` | Events per second in next N seconds |

#### Phase Signal

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `beat_phase_between()` | — | `Signal` | Position between events (0 at previous, 1 at next) |

**Edge cases:**
- Before first event: Returns 0.0
- After last event: Returns 1.0
- Single/no events: Returns 0.0

#### Event-to-Signal Options

| Option | Type | Values |
|--------|------|--------|
| `envelope` | `string` | "impulse", "step", "attack_decay", "adsr", "gaussian", "exponential_decay" |
| `easing` | `string` | "linear", "quadratic_in", "quadratic_out", "quadratic_in_out", "cubic_in", "cubic_out", "cubic_in_out", "exponential_in", "exponential_out", "smoothstep", "elastic" |
| `overlap` | `string` | "sum", "max" |
| `attack_beats` | `f32` | Attack duration |
| `decay_beats` | `f32` | Decay duration |
| `sustain_level` | `f32` | Sustain level (0–1) |
| `sustain_beats` | `f32` | Sustain duration |
| `release_beats` | `f32` | Release duration |
| `width_beats` | `f32` | Gaussian width |
| `group_within_beats` | `f32` | Event grouping threshold |
| `merge_mode` | `string` | How to merge grouped events |

#### Debug

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `probe(name)` | `name: string` | `Signal` | Visualize as signal with debug probe |

---

### Event

Individual temporal event.

| Property | Type | Description |
|----------|------|-------------|
| `time` | `f32` | Time in seconds |
| `weight` | `f32` | Salience/strength (0–1) |
| `beat_position` | `f32` | Continuous beat position |
| `beat_phase` | `f32` | Phase within beat (0–1) |
| `cluster_id` | `i64` | Cluster ID (-1 if unclustered) |

---

### Entity

Base type for all scene objects (Mesh, Line, Group).

#### Common Properties

| Property | Type | Description |
|----------|------|-------------|
| `position` | `Map { x, y, z }` | Position (each component: `Signal \| f32`) |
| `rotation` | `Map { x, y, z }` | Euler rotation (each component: `Signal \| f32`) |
| `scale` | `Signal \| f32` | Uniform scale |
| `visible` | `bool` | Visibility flag |

#### Mesh Properties

| Property | Type | Description |
|----------|------|-------------|
| `color` | `Map { r, g, b, a }` | Base color (each component: `Signal \| f32`) |
| `renderMode` | `string` | "solid", "wireframe", "solidWithWireframe" |
| `wireframeColor` | `Map { r, g, b, a }` | Wireframe color |
| `deformations` | `Array[Deformation]` | List of deformations |
| `material` | `string` | Material ID |
| `params` | `Map` | Custom material parameters |

#### Mesh Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `instance()` | — | `Entity` | Create copy sharing geometry with independent properties |

#### Line Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `push(x, y)` | `x: f32`, `y: f32` | — | Add point to line (manual mode) |
| `clear()` | — | — | Clear all points |

#### Group Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `add(child)` | `child: Entity` | — | Add child entity |
| `remove(child)` | `child: Entity` | — | Remove child entity |

---

### FeedbackBuilder

Fluent builder for feedback configuration.

#### Base Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `opacity(val)` | `val: Signal \| f32` | `FeedbackBuilder` | Set frame opacity |
| `build()` | — | `FeedbackConfig` | Build final configuration |

#### Warp Builder (`.warp`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `spiral(strength, rotation)` | `strength: Signal \| f32`, `rotation: Signal \| f32` | `FeedbackBuilder` | Spiral warp |
| `spiral(strength, rotation, scale)` | all `Signal \| f32` | `FeedbackBuilder` | Spiral warp with scale |
| `radial(strength)` | `strength: Signal \| f32` | `FeedbackBuilder` | Radial warp |
| `radial(strength, scale)` | `strength: Signal \| f32`, `scale: Signal \| f32` | `FeedbackBuilder` | Radial warp with scale |
| `affine(scale, rotation)` | `scale: Signal \| f32`, `rotation: Signal \| f32` | `FeedbackBuilder` | Affine transform |
| `affine(scale, rotation, tx, ty)` | all `Signal \| f32` | `FeedbackBuilder` | Affine with translation |
| `noise(strength, frequency)` | `strength: Signal \| f32`, `frequency: Signal \| f32` | `FeedbackBuilder` | Noise-based warp |
| `shear(strength)` | `strength: Signal \| f32` | `FeedbackBuilder` | Shear transform |

#### Color Builder (`.color`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `decay(rate)` | `rate: Signal \| f32` | `FeedbackBuilder` | Exponential color fade |
| `hsv(h, s, v)` | all `Signal \| f32` | `FeedbackBuilder` | HSV shift |
| `posterize(levels)` | `levels: Signal \| f32` | `FeedbackBuilder` | Reduce color levels |
| `channel_offset(x, y)` | `x: Signal \| f32`, `y: Signal \| f32` | `FeedbackBuilder` | RGB chromatic aberration |

#### Blend Builder (`.blend`)

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `alpha()` | — | `FeedbackBuilder` | Alpha blending |
| `add()` | — | `FeedbackBuilder` | Additive blending |
| `multiply()` | — | `FeedbackBuilder` | Multiplicative blending |
| `screen()` | — | `FeedbackBuilder` | Screen blending |
| `overlay()` | — | `FeedbackBuilder` | Overlay blending |
| `difference()` | — | `FeedbackBuilder` | Difference blending |
| `max()` | — | `FeedbackBuilder` | Maximum blending |

---

### ParticleSystem

Particle system container.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `visible` | `bool` | Visibility flag |
| `position` | `Map { x, y, z }` | Base position |
| `color` | `Map { r, g, b, a }` | Base color |
| `scale` | `f32` | Base scale |

#### Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `instance_count()` | — | `i64` | Get number of particle instances |
| `reset()` | — | — | Reset particle system state |

---

## Global Functions

| Function | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `describe(x)` | `x: any` | `Map` | Get structured metadata about a value or type |
| `help(x)` | `x: any` | `string` | Get human-readable help text |
| `doc(path)` | `path: string` | `Map` | Lookup documentation by path (e.g., "Signal.smooth") |

---

## Quick Reference

### Signal Pipeline Example

```rhai
// Audio-reactive property
entity.position.y = inputs.energy
    .smooth.exponential(0.05, 0.2)
    .normalise.robust()
    .scale(5.0);
```

### Event-Driven Particles Example

```rhai
let events = inputs.bands.kick.events
    .filter_weight(0.5);

let particles = particles.from_events(events, #{
    count: 10,
    lifetime_beats: 2.0,
    envelope: "attack_decay",
    attack_beats: 0.1,
    decay_beats: 1.5,
});
scene.add(particles);
```

### Feedback Example

```rhai
let fb = feedback.builder()
    .opacity(0.95)
    .warp.spiral(0.01, inputs.energy.scale(0.1))
    .color.decay(0.98)
    .blend.add()
    .build();
feedback.enable(fb);
```

### Camera Examples

```rhai
// Static camera positioning
camera.position = #{ x: 0.0, y: 5.0, z: 10.0 };
camera.lookAt(#{ x: 0.0, y: 0.0, z: 0.0 });
camera.fov = 60.0;

// Audio-reactive camera (signal-driven)
camera.position.z = inputs.energy
    .smooth.exponential(0.1, 0.3)
    .scale(-5.0)
    .offset(10.0);

camera.fov = gen.sin(0.25, 0.0)
    .scale(10.0)
    .offset(60.0);

// Orbit around origin
camera.orbit(#{ x: 0.0, y: 0.0, z: 0.0 }, 5.0, time.seconds * 0.5);
```

### Event Distance & Density Example

```rhai
let kicks = inputs.bands.kick.events.filter_weight(0.3);

// Anticipation that builds before each kick
let anticipation = kicks.beats_to_next()
    .clamp(0.0, 1.0)
    .sub(1.0)
    .neg();  // 0 far from kick, 1 at kick

// Intensity based on recent kick activity
let activity = kicks.count_prev_beats(8.0);
cube.scale = activity.scale(0.1).add(1.0);

// Smooth breathing motion between beats
let beats = inputs.mix.beat.events(0.5);
let phase = beats.beat_phase_between();
let breath = phase.scale(6.28318).sin().scale(0.5).add(1.0);
cube.position.y = breath;

// Kick density for color intensity
let kick_rate = kicks.density_prev_beats(4.0);
cube.color.r = kick_rate.clamp(0.0, 2.0).scale(0.5);
```
