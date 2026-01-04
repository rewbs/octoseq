//! Signal evaluation context and evaluation logic.
//!
//! This module provides the evaluation context that carries all state needed
//! to evaluate a Signal at a given time, including:
//! - Current time and delta time
//! - Musical time context (for beat-aware operations)
//! - Input signals (raw sample data)
//! - Pre-computed statistics (for normalization)
//! - Runtime state (for smoothing, gates)

use std::cell::RefCell;
use std::collections::HashMap;

use crate::debug_collector::debug_emit;
use crate::signal::SignalId;
use crate::input::{BandSignalMap, InputSignal, SignalMap};
use crate::musical_time::{MusicalTimeSegment, MusicalTimeStructure, DEFAULT_BPM};
use crate::signal::{
    EasingFunction, EnvelopeShape, GateParams, GeneratorNode, NormaliseParams, NoiseType,
    OverlapMode, SamplingConfig, SamplingStrategy, SamplingWindow, Signal, SignalNode,
    SmoothParams, TimeUnit, ToSignalOptions, WindowDirection,
};
use crate::signal_state::SignalState;
use crate::signal_stats::StatisticsCache;

/// Evaluation context for Signal evaluation.
///
/// This struct carries all the state needed to evaluate a Signal at a given time.
pub struct EvalContext<'a> {
    /// Current time in seconds.
    pub time: f32,

    /// Delta time since last frame.
    pub dt: f32,

    /// Frame count (incremented each update).
    pub frame_count: u64,

    /// Musical time structure (for beat-aware operations).
    pub musical_time: Option<&'a MusicalTimeStructure>,

    /// Input signals (raw sample data wrapped in Rc for cheap sharing).
    pub input_signals: &'a SignalMap,

    /// Band-scoped input signals: band_key -> feature -> Rc<InputSignal>
    pub band_signals: &'a BandSignalMap,

    /// Stem-scoped input signals: stem_id -> feature -> Rc<InputSignal>
    pub stem_signals: &'a BandSignalMap,

    /// Custom signals: signal_id -> Rc<InputSignal>
    pub custom_signals: &'a SignalMap,

    /// Pre-computed statistics for normalization.
    pub statistics: &'a StatisticsCache,

    /// Runtime state for stateful operations.
    pub state: &'a mut SignalState,

    /// Track duration in seconds (for event distance calculations).
    /// When unavailable, event-based signals use fallback behavior.
    pub track_duration: Option<f32>,

    /// Per-frame evaluation cache for signal memoization.
    /// Prevents re-evaluation of the same signal node multiple times per frame.
    frame_cache: RefCell<HashMap<SignalId, f32>>,
}

impl<'a> EvalContext<'a> {
    /// Create a new evaluation context.
    pub fn new(
        time: f32,
        dt: f32,
        frame_count: u64,
        musical_time: Option<&'a MusicalTimeStructure>,
        input_signals: &'a SignalMap,
        band_signals: &'a BandSignalMap,
        stem_signals: &'a BandSignalMap,
        custom_signals: &'a SignalMap,
        statistics: &'a StatisticsCache,
        state: &'a mut SignalState,
        track_duration: Option<f32>,
    ) -> Self {
        Self {
            time,
            dt,
            frame_count,
            musical_time,
            input_signals,
            band_signals,
            stem_signals,
            custom_signals,
            statistics,
            state,
            track_duration,
            frame_cache: RefCell::new(HashMap::new()),
        }
    }

    /// Clear the frame cache. Call this at the start of each frame.
    pub fn clear_frame_cache(&self) {
        self.frame_cache.borrow_mut().clear();
    }

    /// Get a cached value for a signal, if present.
    pub fn get_cached(&self, id: SignalId) -> Option<f32> {
        self.frame_cache.borrow().get(&id).copied()
    }

    /// Store a computed value in the frame cache.
    pub fn cache_value(&self, id: SignalId, value: f32) {
        self.frame_cache.borrow_mut().insert(id, value);
    }

    /// Get the current musical time segment (if any).
    pub fn current_segment(&self) -> Option<&MusicalTimeSegment> {
        self.musical_time?.segment_at(self.time)
    }

    /// Get the current BPM (from musical time or default).
    pub fn current_bpm(&self) -> f32 {
        self.current_segment().map(|s| s.bpm).unwrap_or_else(|| {
            // Log warning once
            if !self.state.warned_no_musical_time {
                // log::warn!(
                //     "No musical time available, using default BPM of {}",
                //     DEFAULT_BPM
                // );
            }
            DEFAULT_BPM
        })
    }

    /// Convert beats to seconds using current BPM.
    pub fn beats_to_seconds(&self, beats: f32) -> f32 {
        beats * 60.0 / self.current_bpm()
    }

    /// Get beat position at current time.
    pub fn beat_position(&self) -> f32 {
        if let Some(segment) = self.current_segment() {
            segment.beat_position_at(self.time).beat_position
        } else {
            // Default: assume 120 BPM starting at time 0
            self.time * DEFAULT_BPM / 60.0
        }
    }

    /// Get track duration, with fallback to a large value if not available.
    pub fn get_track_duration(&self) -> f32 {
        self.track_duration.unwrap_or(f32::MAX)
    }

    /// Convert seconds to beats using current BPM.
    pub fn seconds_to_beats(&self, seconds: f32) -> f32 {
        seconds * self.current_bpm() / 60.0
    }

    /// Convert seconds to frames using current dt.
    pub fn seconds_to_frames(&self, seconds: f32) -> f32 {
        if self.dt > 0.0 {
            seconds / self.dt
        } else {
            0.0
        }
    }
}

impl Signal {
    /// Evaluate the signal at the current time in the given context.
    ///
    /// Results are cached per-frame to avoid redundant computation when the same
    /// signal node is referenced multiple times (e.g., via derived signals).
    pub fn evaluate(&self, ctx: &mut EvalContext) -> f32 {
        // Check cache first
        if let Some(cached) = ctx.get_cached(self.id) {
            return cached;
        }

        // Compute the value
        let value = self.evaluate_uncached(ctx);

        // Cache and return
        ctx.cache_value(self.id, value);
        value
    }

    /// Evaluate the signal without caching (internal implementation).
    fn evaluate_uncached(&self, ctx: &mut EvalContext) -> f32 {
        match &*self.node {
            // === Sources ===
            SignalNode::Input { name, sampling } => {
                // Special-cased built-ins (not backed by InputSignal sample arrays)
                // These form the canonical time namespace
                match name.as_str() {
                    // Legacy names (for backwards compatibility)
                    "time" => ctx.time,
                    "dt" => ctx.dt,
                    // Canonical time namespace
                    "time.seconds" => ctx.time,
                    "time.dt" => ctx.dt,
                    "time.frames" => ctx.frame_count as f32,
                    "time.beats" => ctx.beat_position(),
                    "time.beatIndex" => ctx.beat_position().floor(),
                    "time.phase" => ctx.beat_position().fract(),
                    "time.bpm" => ctx.current_bpm(),
                    _ => ctx
                        .input_signals
                        .get(name)
                        .map(|sig| self.sample_with_config(sig, *sampling, ctx))
                        .unwrap_or(0.0),
                }
            }

            SignalNode::BandInput {
                band_key,
                feature,
                sampling,
            } => ctx
                .band_signals
                .get(band_key)
                .and_then(|features| features.get(feature))
                .map(|sig| self.sample_with_config(sig, *sampling, ctx))
                .unwrap_or_else(|| {
                    // Log warning once for this band/feature combination
                    ctx.state.warn_missing_band(band_key, feature);
                    0.0
                }),

            SignalNode::StemInput {
                stem_id,
                feature,
                sampling,
            } => ctx
                .stem_signals
                .get(stem_id)
                .and_then(|features| features.get(feature))
                .map(|sig| self.sample_with_config(sig, *sampling, ctx))
                .unwrap_or_else(|| {
                    // Log warning once for this stem/feature combination
                    ctx.state.warn_missing_stem(stem_id, feature);
                    0.0
                }),

            SignalNode::CustomSignalInput { signal_id, sampling } => ctx
                .custom_signals
                .get(signal_id)
                .map(|sig| self.sample_with_config(sig, *sampling, ctx))
                .unwrap_or_else(|| {
                    // Log warning once for this custom signal
                    ctx.state.warn_missing_custom_signal(signal_id);
                    0.0
                }),

            SignalNode::Constant(v) => *v,

            SignalNode::Generator(gen) => self.evaluate_generator(gen, ctx),

            // === Transformations ===
            SignalNode::Smooth { source, params } => self.evaluate_smooth(source, params, ctx),

            SignalNode::Normalise { source, params } => {
                self.evaluate_normalise(source, params, ctx)
            }

            SignalNode::Gate { source, params } => self.evaluate_gate(source, params, ctx),

            // === Arithmetic ===
            SignalNode::Add(a, b) => a.evaluate(ctx) + b.evaluate(ctx),

            SignalNode::Mul(a, b) => a.evaluate(ctx) * b.evaluate(ctx),

            SignalNode::Scale { source, factor } => {
                let value = source.evaluate(ctx);
                let f = factor.evaluate(ctx);
                value * f
            }

            SignalNode::Mix { a, b, weight } => {
                let va = a.evaluate(ctx);
                let vb = b.evaluate(ctx);
                let w = weight.evaluate(ctx);
                va * (1.0 - w) + vb * w
            }

            // === Debug ===
            SignalNode::Debug { source, name } => {
                let value = source.evaluate(ctx);
                debug_emit(name, value);
                value
            }

            // === Event Sources ===
            SignalNode::EventStreamSource { events } => {
                self.evaluate_event_stream_source(events, ctx)
            }

            SignalNode::EventStreamEnvelope { events, options } => {
                self.evaluate_event_stream_envelope(events, options, ctx)
            }

            SignalNode::EventDistanceFromPrev { events, unit } => {
                self.evaluate_event_distance_from_prev(events, *unit, ctx)
            }

            SignalNode::EventDistanceToNext { events, unit } => {
                self.evaluate_event_distance_to_next(events, *unit, ctx)
            }

            SignalNode::EventCountInWindow { events, window_size, unit, direction } => {
                let window = window_size.evaluate(ctx);
                self.evaluate_event_count_in_window(events, window, *unit, *direction, ctx)
            }

            SignalNode::EventDensityInWindow { events, window_size, unit, direction } => {
                let window = window_size.evaluate(ctx);
                self.evaluate_event_density_in_window(events, window, *unit, *direction, ctx)
            }

            SignalNode::EventPhaseBetween { events } => {
                self.evaluate_event_phase_between(events, ctx)
            }

            // === Math Primitives ===
            SignalNode::Sigmoid { source, k } => {
                let x = source.evaluate(ctx);
                let k_val = k.evaluate(ctx);
                if k_val == 0.0 {
                    x
                } else {
                    let center = 0.5;
                    1.0 / (1.0 + (-k_val * (x - center)).exp())
                }
            }
            SignalNode::Clamp { source, min, max } => {
                let value = source.evaluate(ctx);
                let min_val = min.evaluate(ctx);
                let max_val = max.evaluate(ctx);
                value.clamp(min_val, max_val)
            }

            SignalNode::Floor { source } => source.evaluate(ctx).floor(),

            SignalNode::Ceil { source } => source.evaluate(ctx).ceil(),

            SignalNode::Abs { source } => source.evaluate(ctx).abs(),

            SignalNode::Round { source } => source.evaluate(ctx).round(),

            SignalNode::Sign { source } => {
                let v = source.evaluate(ctx);
                if v > 0.0 {
                    1.0
                } else if v < 0.0 {
                    -1.0
                } else {
                    0.0
                }
            }

            SignalNode::Neg { source } => -source.evaluate(ctx),

            // === Extended Arithmetic ===
            SignalNode::Sub(a, b) => a.evaluate(ctx) - b.evaluate(ctx),

            SignalNode::Div(a, b) => {
                let numerator = a.evaluate(ctx);
                let denominator = b.evaluate(ctx);
                if denominator.abs() < 1e-10 {
                    0.0 // Guard against division by zero
                } else {
                    numerator / denominator
                }
            }

            SignalNode::Pow { source, exponent } => {
                let base = source.evaluate(ctx);
                let exp = exponent.evaluate(ctx);
                base.powf(exp)
            }

            SignalNode::Offset { source, amount } => {
                let value = source.evaluate(ctx);
                let offset = amount.evaluate(ctx);
                value + offset
            }

            // === Trigonometric (value transformation) ===
            SignalNode::Sin { source } => source.evaluate(ctx).sin(),

            SignalNode::Cos { source } => source.evaluate(ctx).cos(),

            SignalNode::Tan { source } => source.evaluate(ctx).tan(),

            SignalNode::Asin { source } => {
                let v = source.evaluate(ctx).clamp(-1.0, 1.0); // Ensure valid domain
                v.asin()
            }

            SignalNode::Acos { source } => {
                let v = source.evaluate(ctx).clamp(-1.0, 1.0); // Ensure valid domain
                v.acos()
            }

            SignalNode::Atan { source } => source.evaluate(ctx).atan(),

            SignalNode::Atan2 { y, x } => {
                let y_val = y.evaluate(ctx);
                let x_val = x.evaluate(ctx);
                y_val.atan2(x_val)
            }

            // === Exponential and Logarithmic ===
            SignalNode::Sqrt { source } => {
                let v = source.evaluate(ctx).max(0.0); // Ensure non-negative
                v.sqrt()
            }

            SignalNode::Exp { source } => source.evaluate(ctx).exp(),

            SignalNode::Ln { source } => {
                let v = source.evaluate(ctx).max(1e-10); // Ensure positive
                v.ln()
            }

            SignalNode::Log { source, base } => {
                let v = source.evaluate(ctx).max(1e-10); // Ensure positive
                let b = base.evaluate(ctx).max(1e-10); // Ensure positive base
                if (b - 1.0).abs() < 1e-10 {
                    0.0 // log base 1 is undefined
                } else {
                    v.ln() / b.ln()
                }
            }

            // === Modular / Periodic ===
            SignalNode::Mod { source, divisor } => {
                let v = source.evaluate(ctx);
                let d = divisor.evaluate(ctx);
                if d.abs() < 1e-10 {
                    0.0
                } else {
                    v.rem_euclid(d) // Euclidean modulo (always positive)
                }
            }

            SignalNode::Rem { source, divisor } => {
                let v = source.evaluate(ctx);
                let d = divisor.evaluate(ctx);
                if d.abs() < 1e-10 {
                    0.0
                } else {
                    v % d // Remainder (can be negative)
                }
            }

            SignalNode::Wrap { source, min, max } => {
                let v = source.evaluate(ctx);
                let lo = min.evaluate(ctx);
                let hi = max.evaluate(ctx);
                let range = hi - lo;
                if range <= 0.0 {
                    lo
                } else {
                    lo + (v - lo).rem_euclid(range)
                }
            }

            SignalNode::Fract { source } => source.evaluate(ctx).fract(),

            // === Mapping / Shaping ===
            SignalNode::Map {
                source,
                in_min,
                in_max,
                out_min,
                out_max,
            } => {
                let v = source.evaluate(ctx);
                let i_lo = in_min.evaluate(ctx);
                let i_hi = in_max.evaluate(ctx);
                let o_lo = out_min.evaluate(ctx);
                let o_hi = out_max.evaluate(ctx);
                let in_range = i_hi - i_lo;
                if in_range.abs() < 1e-10 {
                    o_lo // Avoid division by zero
                } else {
                    let t = (v - i_lo) / in_range;
                    o_lo + t * (o_hi - o_lo)
                }
            }

            SignalNode::Smoothstep { source, edge0, edge1 } => {
                let x = source.evaluate(ctx);
                let e0 = edge0.evaluate(ctx);
                let e1 = edge1.evaluate(ctx);
                let range = e1 - e0;
                if range.abs() < 1e-10 {
                    if x < e0 { 0.0 } else { 1.0 }
                } else {
                    let t = ((x - e0) / range).clamp(0.0, 1.0);
                    t * t * (3.0 - 2.0 * t)
                }
            }

            SignalNode::Lerp { a, b, t } => {
                let va = a.evaluate(ctx);
                let vb = b.evaluate(ctx);
                let tv = t.evaluate(ctx);
                va + (vb - va) * tv
            }

            // === Rate and Accumulation ===
            SignalNode::Diff { source } => self.evaluate_diff(source, ctx),

            SignalNode::Integrate { source, decay_beats } => {
                let decay = decay_beats.evaluate(ctx);
                self.evaluate_integrate(source, decay, ctx)
            }

            // === Time Shifting ===
            SignalNode::Delay { source, beats } => {
                let b = beats.evaluate(ctx);
                self.evaluate_delay(source, b, ctx)
            }

            SignalNode::Anticipate { source, beats } => {
                let b = beats.evaluate(ctx);
                self.evaluate_anticipate(source, b, ctx)
            }
        }
    }

    /// Sample an input signal using the specified sampling configuration.
    ///
    /// - `Peak` strategy: Uses `sample_window` to find max absolute value within the window.
    /// - `Interpolate` strategy: Uses `sample` for linear interpolation at exact time.
    fn sample_with_config(
        &self,
        sig: &InputSignal,
        config: SamplingConfig,
        ctx: &EvalContext,
    ) -> f32 {
        match config.strategy {
            SamplingStrategy::Peak => {
                let window = match config.window {
                    SamplingWindow::FrameDt => ctx.dt,
                    SamplingWindow::Beats(beats) => ctx.beats_to_seconds(beats),
                    SamplingWindow::Seconds(secs) => secs,
                };
                sig.sample_window(ctx.time, window)
            }
            SamplingStrategy::Interpolate => sig.sample(ctx.time),
        }
    }

    /// Evaluate an EventStreamSource signal.
    ///
    /// Produces impulses at event times with height equal to event weight.
    /// Between events, the signal is 0.0.
    fn evaluate_event_stream_source(
        &self,
        events: &[crate::event_stream::Event],
        ctx: &EvalContext,
    ) -> f32 {
        if events.is_empty() {
            return 0.0;
        }

        // Find the nearest event to current time
        // Use a small window around current time for impulse detection
        let impulse_window = ctx.dt * 0.5; // Half a frame

        for event in events {
            let time_diff = (event.time - ctx.time).abs();
            if time_diff <= impulse_window {
                // Within impulse window - return weight
                return event.weight;
            }
        }

        // Not near any event
        0.0
    }

    /// Evaluate a generator node.
    fn evaluate_generator(&self, gen: &GeneratorNode, ctx: &mut EvalContext) -> f32 {
        let beat_pos = ctx.beat_position();

        match gen {
            GeneratorNode::Sin { freq_beats, phase } => {
                let t = beat_pos * freq_beats + phase;
                (t * std::f32::consts::TAU).sin()
            }

            GeneratorNode::Square {
                freq_beats,
                phase,
                duty,
            } => {
                let t = (beat_pos * freq_beats + phase).fract();
                let t = if t < 0.0 { t + 1.0 } else { t };
                if t < *duty {
                    1.0
                } else {
                    -1.0
                }
            }

            GeneratorNode::Triangle { freq_beats, phase } => {
                let t = (beat_pos * freq_beats + phase).fract();
                let t = if t < 0.0 { t + 1.0 } else { t };
                if t < 0.5 {
                    4.0 * t - 1.0
                } else {
                    3.0 - 4.0 * t
                }
            }

            GeneratorNode::Saw { freq_beats, phase } => {
                let t = (beat_pos * freq_beats + phase).fract();
                let t = if t < 0.0 { t + 1.0 } else { t };
                2.0 * t - 1.0
            }

            GeneratorNode::Noise { noise_type, seed } => {
                // Deterministic noise based on time + seed
                let hash = self.hash_time_seed(ctx.time, *seed);

                match noise_type {
                    NoiseType::White => {
                        // Convert hash to float in [-1, 1]
                        (hash as f64 / u64::MAX as f64) as f32 * 2.0 - 1.0
                    }
                    NoiseType::Pink => {
                        // Use pink noise state
                        let white = (hash as f64 / u64::MAX as f64) as f32 * 2.0 - 1.0;
                        ctx.state.get_pink_noise(self.id).next(white)
                    }
                }
            }

            GeneratorNode::Perlin { scale_beats, seed } => {
                let t = beat_pos / scale_beats;
                self.perlin_1d(t, *seed)
            }
        }
    }

    /// Hash time and seed for deterministic noise.
    fn hash_time_seed(&self, time: f32, seed: u64) -> u64 {
        // Simple hash combining time and seed
        let time_bits = time.to_bits() as u64;
        let mut h = seed;
        h = h.wrapping_mul(0x517cc1b727220a95);
        h ^= time_bits;
        h = h.wrapping_mul(0x517cc1b727220a95);
        h ^= h >> 32;
        h
    }

    /// 1D Perlin noise implementation.
    fn perlin_1d(&self, t: f32, seed: u64) -> f32 {
        // Integer and fractional parts
        let i = t.floor() as i32;
        let f = t - t.floor();

        // Smoothstep interpolation
        let u = f * f * (3.0 - 2.0 * f);

        // Gradient at each integer point
        let grad = |n: i32| -> f32 {
            let h = self.hash_int_seed(n, seed);
            if h & 1 == 0 {
                1.0
            } else {
                -1.0
            }
        };

        // Compute dot products
        let n0 = grad(i) * f;
        let n1 = grad(i + 1) * (f - 1.0);

        // Interpolate
        n0 + u * (n1 - n0)
    }

    /// Hash an integer with a seed.
    fn hash_int_seed(&self, n: i32, seed: u64) -> u64 {
        let mut h = seed;
        h = h.wrapping_mul(0x517cc1b727220a95);
        h ^= n as u64;
        h = h.wrapping_mul(0x517cc1b727220a95);
        h ^= h >> 32;
        h
    }

    /// Evaluate smoothing.
    fn evaluate_smooth(
        &self,
        source: &Signal,
        params: &SmoothParams,
        ctx: &mut EvalContext,
    ) -> f32 {
        let current = source.evaluate(ctx);

        match params {
            SmoothParams::MovingAverage { window_beats } => {
                let window_secs = ctx.beats_to_seconds(*window_beats);
                let capacity = (window_secs / ctx.dt).ceil() as usize;
                let capacity = capacity.max(1).min(10000); // Clamp to reasonable range

                let buffer = ctx.state.get_ma_buffer(self.id, capacity);

                // Resize if needed (e.g., BPM changed)
                if buffer.capacity() != capacity {
                    buffer.resize(capacity);
                }

                buffer.push(current);
                buffer.average()
            }

            SmoothParams::Exponential {
                attack_beats,
                release_beats,
            } => {
                let last = ctx.state.get_exp_smooth(self.id, current);

                let beats = if current > last {
                    *attack_beats
                } else {
                    *release_beats
                };
                let tau = ctx.beats_to_seconds(beats).max(0.001);
                let alpha = 1.0 - (-ctx.dt / tau).exp();

                let result = last + alpha * (current - last);
                ctx.state.set_exp_smooth(self.id, result);
                result
            }

            SmoothParams::Gaussian { sigma_beats } => {
                // Gaussian blur requires looking back in time
                // For real-time evaluation, we approximate with weighted sampling
                let sigma_secs = ctx.beats_to_seconds(*sigma_beats);
                let window = sigma_secs * 3.0; // 3-sigma window

                // Get the underlying input signal name if this is an Input node
                let input_name = self.find_root_input_name(source);

                if let Some((_name, input)) = input_name.and_then(|n| {
                    ctx.input_signals.get(&n).map(|sig| (n, sig))
                }) {
                    // Sample at multiple points with Gaussian weights
                    let num_samples = 7;
                    let mut sum = 0.0;
                    let mut weight_sum = 0.0;

                    for i in 0..num_samples {
                        let offset =
                            (i as f32 / (num_samples - 1) as f32 - 0.5) * 2.0 * window;
                        let sample_time = (ctx.time + offset).max(0.0);

                        let weight =
                            (-offset.powi(2) / (2.0 * sigma_secs.powi(2))).exp();

                        let value = input.sample(sample_time);
                        sum += value * weight;
                        weight_sum += weight;
                    }

                    if weight_sum > 0.0 {
                        sum / weight_sum
                    } else {
                        current
                    }
                } else {
                    // Can't do Gaussian on non-Input signals in real-time
                    // Fall back to current value
                    current
                }
            }
        }
    }

    /// Find the root input signal name by traversing the graph.
    fn find_root_input_name(&self, signal: &Signal) -> Option<String> {
        match &*signal.node {
            SignalNode::Input { name, .. } => Some(name.clone()),
            SignalNode::Smooth { source, .. } => self.find_root_input_name(source),
            SignalNode::Normalise { source, .. } => self.find_root_input_name(source),
            SignalNode::Gate { source, .. } => self.find_root_input_name(source),
            SignalNode::Sigmoid { source, .. } => self.find_root_input_name(source),
            SignalNode::Scale { source, .. } => self.find_root_input_name(source),
            SignalNode::Debug { source, .. } => self.find_root_input_name(source),
            _ => None,
        }
    }

    /// Evaluate normalization.
    fn evaluate_normalise(
        &self,
        source: &Signal,
        params: &NormaliseParams,
        ctx: &mut EvalContext,
    ) -> f32 {
        let raw = source.evaluate(ctx);

        match params {
            NormaliseParams::Global => {
                if let Some(stats) = ctx.statistics.get(source.id) {
                    stats.normalize_global(raw)
                } else {
                    // No statistics available, warn once and return raw
                    ctx.state.warn_missing_stats_once(source.id, "global");
                    raw
                }
            }

            NormaliseParams::Robust => {
                if let Some(stats) = ctx.statistics.get(source.id) {
                    stats.normalize_robust(raw)
                } else {
                    // No statistics available, warn once and return raw
                    ctx.state.warn_missing_stats_once(source.id, "robust");
                    raw
                }
            }

            NormaliseParams::Range { min, max } => {
                // Direct range mapping, doesn't need statistics
                let range = max - min;
                if range > 0.0 {
                    ((raw - min) / range).clamp(0.0, 1.0)
                } else {
                    0.5
                }
            }
        }
    }

    /// Evaluate gating.
    fn evaluate_gate(
        &self,
        source: &Signal,
        params: &GateParams,
        ctx: &mut EvalContext,
    ) -> f32 {
        let value = source.evaluate(ctx);

        match params {
            GateParams::Threshold { threshold } => {
                if value >= *threshold {
                    1.0
                } else {
                    0.0
                }
            }

            GateParams::Hysteresis {
                on_threshold,
                off_threshold,
            } => {
                let was_on = ctx.state.get_gate(self.id);

                let is_on = if was_on {
                    value >= *off_threshold
                } else {
                    value >= *on_threshold
                };

                ctx.state.set_gate(self.id, is_on);
                if is_on {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    // =========================================================================
    // EventStream Envelope Evaluation
    // =========================================================================

    /// Evaluate an EventStreamEnvelope signal.
    ///
    /// Computes the contribution of all events' envelopes at the current time,
    /// combining them according to the overlap mode.
    fn evaluate_event_stream_envelope(
        &self,
        events: &[crate::event_stream::Event],
        options: &ToSignalOptions,
        ctx: &EvalContext,
    ) -> f32 {
        if events.is_empty() {
            return 0.0;
        }

        let mut result = 0.0f32;

        for event in events {
            let contribution = self.evaluate_single_envelope(event, options, ctx);

            match options.overlap_mode {
                OverlapMode::Sum => result += contribution,
                OverlapMode::Max => result = result.max(contribution),
            }
        }

        result
    }

    /// Evaluate a single event's envelope contribution at the current time.
    fn evaluate_single_envelope(
        &self,
        event: &crate::event_stream::Event,
        options: &ToSignalOptions,
        ctx: &EvalContext,
    ) -> f32 {
        let time = ctx.time;
        let event_time = event.time;
        let weight = event.weight;

        // Time relative to event
        let dt = time - event_time;

        // Convert beat parameters to seconds
        let attack_sec = ctx.beats_to_seconds(options.attack_beats);
        let decay_sec = ctx.beats_to_seconds(options.decay_beats);
        let sustain_sec = ctx.beats_to_seconds(options.sustain_beats);
        let release_sec = ctx.beats_to_seconds(options.release_beats);
        let width_sec = ctx.beats_to_seconds(options.width_beats);

        match options.envelope {
            EnvelopeShape::Impulse => {
                // Single-frame spike
                let impulse_window = ctx.dt * 0.5;
                if dt.abs() <= impulse_window {
                    weight
                } else {
                    0.0
                }
            }

            EnvelopeShape::Step => {
                // Step up at event time, hold forever
                if dt >= 0.0 {
                    weight
                } else {
                    0.0
                }
            }

            EnvelopeShape::AttackDecay => {
                if dt < 0.0 {
                    0.0
                } else if dt < attack_sec {
                    // Attack phase
                    let t = if attack_sec > 0.0 { dt / attack_sec } else { 1.0 };
                    weight * apply_easing(t, options.easing)
                } else {
                    // Decay phase
                    let decay_dt = dt - attack_sec;
                    if decay_sec <= 0.0 || decay_dt >= decay_sec {
                        0.0
                    } else {
                        let t = decay_dt / decay_sec;
                        weight * (1.0 - apply_easing(t, options.easing))
                    }
                }
            }

            EnvelopeShape::Adsr => {
                if dt < 0.0 {
                    0.0
                } else if dt < attack_sec {
                    // Attack: 0 → 1
                    let t = if attack_sec > 0.0 { dt / attack_sec } else { 1.0 };
                    weight * apply_easing(t, options.easing)
                } else if dt < attack_sec + decay_sec {
                    // Decay: 1 → sustain_level
                    let decay_dt = dt - attack_sec;
                    let t = if decay_sec > 0.0 {
                        decay_dt / decay_sec
                    } else {
                        1.0
                    };
                    let decay_amount = 1.0 - options.sustain_level;
                    weight * (1.0 - decay_amount * apply_easing(t, options.easing))
                } else if dt < attack_sec + decay_sec + sustain_sec {
                    // Sustain: hold at sustain_level
                    weight * options.sustain_level
                } else {
                    // Release: sustain_level → 0
                    let release_dt = dt - attack_sec - decay_sec - sustain_sec;
                    if release_sec <= 0.0 || release_dt >= release_sec {
                        0.0
                    } else {
                        let t = release_dt / release_sec;
                        weight * options.sustain_level * (1.0 - apply_easing(t, options.easing))
                    }
                }
            }

            EnvelopeShape::Gaussian => {
                // Gaussian bell curve centered at event time
                // width_sec is approximately the 95% width (2 sigma)
                let sigma = width_sec / 2.0;
                if sigma <= 0.0 {
                    if dt.abs() < ctx.dt * 0.5 {
                        weight
                    } else {
                        0.0
                    }
                } else {
                    let exponent = -0.5 * (dt / sigma).powi(2);
                    weight * exponent.exp()
                }
            }

            EnvelopeShape::ExponentialDecay => {
                if dt < 0.0 {
                    0.0
                } else if decay_sec <= 0.0 {
                    // Instant decay
                    if dt.abs() < ctx.dt * 0.5 {
                        weight
                    } else {
                        0.0
                    }
                } else {
                    // Exponential decay with time constant tau
                    // decay_sec is time to reach ~5% (3 tau)
                    let tau = decay_sec / 3.0;
                    weight * (-dt / tau).exp()
                }
            }
        }
    }

    // =========================================================================
    // Event Distance, Count, Density, and Phase Operations
    // =========================================================================

    /// Binary search to find the index of the event just before or at the given time.
    /// Returns None if time is before all events.
    fn find_prev_event_index(events: &[crate::event_stream::Event], time: f32) -> Option<usize> {
        if events.is_empty() || time < events[0].time {
            return None;
        }
        // Binary search for the last event with time <= current time
        let mut lo = 0;
        let mut hi = events.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if events[mid].time <= time {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo > 0 { Some(lo - 1) } else { None }
    }

    /// Binary search to find the index of the event just after the given time.
    /// Returns None if time is after all events.
    fn find_next_event_index(events: &[crate::event_stream::Event], time: f32) -> Option<usize> {
        if events.is_empty() {
            return None;
        }
        // Binary search for the first event with time > current time
        let mut lo = 0;
        let mut hi = events.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if events[mid].time <= time {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo < events.len() { Some(lo) } else { None }
    }

    /// Convert time difference (in seconds) to the specified unit.
    fn time_to_unit(dt_seconds: f32, unit: TimeUnit, ctx: &EvalContext) -> f32 {
        match unit {
            TimeUnit::Seconds => dt_seconds,
            TimeUnit::Beats => ctx.seconds_to_beats(dt_seconds),
            TimeUnit::Frames => ctx.seconds_to_frames(dt_seconds),
        }
    }

    /// Convert window size from the specified unit to seconds.
    fn window_to_seconds(window: f32, unit: TimeUnit, ctx: &EvalContext) -> f32 {
        match unit {
            TimeUnit::Seconds => window,
            TimeUnit::Beats => ctx.beats_to_seconds(window),
            TimeUnit::Frames => window * ctx.dt,
        }
    }

    /// Evaluate distance from previous event.
    fn evaluate_event_distance_from_prev(
        &self,
        events: &[crate::event_stream::Event],
        unit: TimeUnit,
        ctx: &EvalContext,
    ) -> f32 {
        if events.is_empty() {
            return 0.0;
        }

        let time = ctx.time;

        match Self::find_prev_event_index(events, time) {
            Some(idx) => {
                // Distance from previous event
                let prev_time = events[idx].time;
                let dt_seconds = time - prev_time;
                Self::time_to_unit(dt_seconds, unit, ctx)
            }
            None => {
                // Before first event: return distance to first event
                let first_time = events[0].time;
                let dt_seconds = first_time - time;
                Self::time_to_unit(dt_seconds, unit, ctx)
            }
        }
    }

    /// Evaluate distance to next event.
    fn evaluate_event_distance_to_next(
        &self,
        events: &[crate::event_stream::Event],
        unit: TimeUnit,
        ctx: &EvalContext,
    ) -> f32 {
        if events.is_empty() {
            // No events: return distance to track end
            let track_end = ctx.get_track_duration();
            let dt_seconds = (track_end - ctx.time).max(0.0);
            return Self::time_to_unit(dt_seconds, unit, ctx);
        }

        let time = ctx.time;

        match Self::find_next_event_index(events, time) {
            Some(idx) => {
                // Distance to next event
                let next_time = events[idx].time;
                let dt_seconds = next_time - time;
                Self::time_to_unit(dt_seconds, unit, ctx)
            }
            None => {
                // After last event: return distance to track end
                let track_end = ctx.get_track_duration();
                let dt_seconds = (track_end - time).max(0.0);
                Self::time_to_unit(dt_seconds, unit, ctx)
            }
        }
    }

    /// Evaluate event count in a window.
    fn evaluate_event_count_in_window(
        &self,
        events: &[crate::event_stream::Event],
        window: f32,
        unit: TimeUnit,
        direction: WindowDirection,
        ctx: &EvalContext,
    ) -> f32 {
        if window <= 0.0 || events.is_empty() {
            return 0.0;
        }

        let time = ctx.time;
        let window_seconds = Self::window_to_seconds(window, unit, ctx);

        let (start, end) = match direction {
            WindowDirection::Prev => (time - window_seconds, time),
            WindowDirection::Next => (time, time + window_seconds),
        };

        // Count events in range [start, end)
        events.iter()
            .filter(|e| e.time >= start && e.time < end)
            .count() as f32
    }

    /// Evaluate event density in a window.
    fn evaluate_event_density_in_window(
        &self,
        events: &[crate::event_stream::Event],
        window: f32,
        unit: TimeUnit,
        direction: WindowDirection,
        ctx: &EvalContext,
    ) -> f32 {
        if window <= 0.0 || events.is_empty() {
            return 0.0;
        }

        let count = self.evaluate_event_count_in_window(events, window, unit, direction, ctx);

        // Density = count / window_size (in original units)
        count / window
    }

    /// Evaluate phase between previous and next event.
    fn evaluate_event_phase_between(
        &self,
        events: &[crate::event_stream::Event],
        ctx: &EvalContext,
    ) -> f32 {
        if events.is_empty() {
            return 0.0;
        }

        let time = ctx.time;
        let prev_idx = Self::find_prev_event_index(events, time);
        let next_idx = Self::find_next_event_index(events, time);

        match (prev_idx, next_idx) {
            (Some(pi), Some(ni)) => {
                let prev_time = events[pi].time;
                let next_time = events[ni].time;
                let interval = next_time - prev_time;
                if interval <= 0.0 {
                    0.5 // Events at same time
                } else {
                    (time - prev_time) / interval
                }
            }
            (None, Some(_)) => 0.0,  // Before first event
            (Some(_), None) => 1.0,  // After last event
            (None, None) => 0.0,     // Should not happen if events is non-empty
        }
    }

    // =========================================================================
    // Rate and Accumulation Operations
    // =========================================================================

    /// Evaluate diff (rate of change).
    fn evaluate_diff(&self, source: &Signal, ctx: &mut EvalContext) -> f32 {
        let current = source.evaluate(ctx);
        let last = ctx.state.get_diff_last(self.id, current);

        let diff = if ctx.dt > 0.0 {
            (current - last) / ctx.dt
        } else {
            0.0
        };

        ctx.state.set_diff_last(self.id, current);
        diff
    }

    /// Evaluate integrate (cumulative sum with optional decay).
    fn evaluate_integrate(
        &self,
        source: &Signal,
        decay_beats: f32,
        ctx: &mut EvalContext,
    ) -> f32 {
        let current = source.evaluate(ctx);
        let accumulated = ctx.state.get_integrate(self.id, 0.0);

        // Apply decay per frame
        let decay_factor = if decay_beats > 0.0 {
            let tau = ctx.beats_to_seconds(decay_beats);
            (-ctx.dt / tau).exp()
        } else {
            1.0 // No decay
        };

        let new_accumulated = accumulated * decay_factor + current * ctx.dt;
        ctx.state.set_integrate(self.id, new_accumulated);
        new_accumulated
    }

    // =========================================================================
    // Time Shifting Operations
    // =========================================================================

    /// Evaluate delay (look back in time using a ring buffer).
    fn evaluate_delay(&self, source: &Signal, beats: f32, ctx: &mut EvalContext) -> f32 {
        let current = source.evaluate(ctx);

        if beats <= 0.0 {
            return current;
        }

        let delay_sec = ctx.beats_to_seconds(beats);
        let buffer_size = ((delay_sec / ctx.dt).ceil() as usize).max(1).min(10000);

        let buffer = ctx.state.get_delay_buffer(self.id, buffer_size);

        // Resize if BPM changed
        if buffer.capacity() != buffer_size {
            buffer.resize(buffer_size);
        }

        // Push current value and get delayed value
        buffer.push(current)
    }

    /// Evaluate anticipate (look ahead in time).
    ///
    /// Only works reliably on Input signals where we can sample at future times.
    /// For other signals, falls back silently to current value.
    fn evaluate_anticipate(&self, source: &Signal, beats: f32, ctx: &mut EvalContext) -> f32 {
        if beats <= 0.0 {
            return source.evaluate(ctx);
        }

        let anticipate_sec = ctx.beats_to_seconds(beats);
        let future_time = ctx.time + anticipate_sec;

        // Try to find the root input signal and sample at future time
        if let Some(name) = self.find_root_input_name(source) {
            if let Some(input) = ctx.input_signals.get(&name) {
                return input.sample(future_time);
            }
        }

        // For non-Input signals, fall back to current value silently
        source.evaluate(ctx)
    }
}

// =============================================================================
// Easing Functions
// =============================================================================

/// Apply an easing function to a normalized value (0-1).
fn apply_easing(t: f32, easing: EasingFunction) -> f32 {
    let t = t.clamp(0.0, 1.0);

    match easing {
        EasingFunction::Linear => t,

        EasingFunction::QuadraticIn => t * t,

        EasingFunction::QuadraticOut => t * (2.0 - t),

        EasingFunction::QuadraticInOut => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                -1.0 + (4.0 - 2.0 * t) * t
            }
        }

        EasingFunction::CubicIn => t * t * t,

        EasingFunction::CubicOut => {
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }

        EasingFunction::CubicInOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                let t1 = 2.0 * t - 2.0;
                0.5 * t1 * t1 * t1 + 1.0
            }
        }

        EasingFunction::ExponentialIn => {
            if t == 0.0 {
                0.0
            } else {
                2.0_f32.powf(10.0 * (t - 1.0))
            }
        }

        EasingFunction::ExponentialOut => {
            if t == 1.0 {
                1.0
            } else {
                1.0 - 2.0_f32.powf(-10.0 * t)
            }
        }

        EasingFunction::SmoothStep => t * t * (3.0 - 2.0 * t),

        EasingFunction::Elastic => {
            if t == 0.0 {
                0.0
            } else if t == 1.0 {
                1.0
            } else {
                let c4 = (2.0 * std::f32::consts::PI) / 3.0;
                2.0_f32.powf(-10.0 * t) * ((t * 10.0 - 0.75) * c4).sin() + 1.0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_context<'a>(
        time: f32,
        dt: f32,
        input_signals: &'a SignalMap,
        band_signals: &'a BandSignalMap,
        stem_signals: &'a BandSignalMap,
        custom_signals: &'a SignalMap,
        statistics: &'a StatisticsCache,
        state: &'a mut SignalState,
    ) -> EvalContext<'a> {
        EvalContext::new(time, dt, 0, None, input_signals, band_signals, stem_signals, custom_signals, statistics, state, None)
    }

    #[test]
    fn test_evaluate_constant() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        let signal = Signal::constant(42.0);
        assert!((signal.evaluate(&mut ctx) - 42.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_input() {
        let mut inputs = HashMap::new();
        inputs.insert(
            "energy".to_string(),
            InputSignal::new(vec![0.5; 100], 100.0),
        );

        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.5, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        let signal = Signal::input("energy");
        assert!((signal.evaluate(&mut ctx) - 0.5).abs() < 0.001);

        // Unknown input returns 0
        let unknown = Signal::input("unknown");
        assert!((unknown.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_band_input() {
        let inputs = HashMap::new();
        let mut band_signals = HashMap::new();

        // Set up a band signal
        let mut bass_features = HashMap::new();
        bass_features.insert(
            "energy".to_string(),
            InputSignal::new(vec![0.75; 100], 100.0),
        );
        band_signals.insert("Bass".to_string(), bass_features);

        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.5, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        // Access by label
        let bass_energy = Signal::band_input("Bass", "energy");
        assert!((bass_energy.evaluate(&mut ctx) - 0.75).abs() < 0.001);

        // Unknown band returns 0
        let unknown = Signal::band_input("Unknown", "energy");
        assert!((unknown.evaluate(&mut ctx) - 0.0).abs() < 0.001);

        // Unknown feature returns 0
        let unknown_feature = Signal::band_input("Bass", "unknown");
        assert!((unknown_feature.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_arithmetic() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        let a = Signal::constant(3.0);
        let b = Signal::constant(4.0);

        // Add
        let sum = a.add(b.clone());
        assert!((sum.evaluate(&mut ctx) - 7.0).abs() < 0.001);

        // Mul
        let product = a.mul(b.clone());
        assert!((product.evaluate(&mut ctx) - 12.0).abs() < 0.001);

        // Scale
        let scaled = a.scale(2.0);
        assert!((scaled.evaluate(&mut ctx) - 6.0).abs() < 0.001);

        // Mix
        let mixed = a.mix(b.clone(), 0.5);
        assert!((mixed.evaluate(&mut ctx) - 3.5).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_gate_threshold() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        let high = Signal::constant(0.8);
        let low = Signal::constant(0.2);

        let gated_high = high.gate(crate::signal::GateParams::Threshold { threshold: 0.5 });
        let gated_low = low.gate(crate::signal::GateParams::Threshold { threshold: 0.5 });

        assert!((gated_high.evaluate(&mut ctx) - 1.0).abs() < 0.001);
        assert!((gated_low.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_sigmoid() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        let mid = Signal::constant(0.5).sigmoid(10.0);
        assert!((mid.evaluate(&mut ctx) - 0.5).abs() < 0.01);

        let high = Signal::constant(1.0).sigmoid(10.0);
        assert!(high.evaluate(&mut ctx) > 0.9);

        let pass_through = Signal::constant(0.2).sigmoid(0.0);
        assert!((pass_through.evaluate(&mut ctx) - 0.2).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_generator_sin() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();

        // At time 0, beat position 0, sin(0) = 0
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);
        let sin = Signal::generator(GeneratorNode::Sin {
            freq_beats: 1.0,
            phase: 0.0,
        });
        assert!(sin.evaluate(&mut ctx).abs() < 0.1);

        // At beat position 0.25, sin(0.25 * 2pi) = 1
        // With default 120 BPM, beat 0.25 is at 0.125 seconds
        let mut ctx = make_test_context(0.125, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);
        let value = sin.evaluate(&mut ctx);
        assert!((value - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_beat_position_default() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let ctx = make_test_context(1.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        // At 120 BPM, 1 second = 2 beats
        assert!((ctx.beat_position() - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_beats_to_seconds_default() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let stem_signals = HashMap::new();
        let custom_signals = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let ctx = make_test_context(0.0, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        // At default 120 BPM, 1 beat = 0.5 seconds
        assert!((ctx.beats_to_seconds(1.0) - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_stem_input() {
        let inputs = HashMap::new();
        let band_signals = HashMap::new();
        let mut stem_signals = HashMap::new();

        // Set up a stem signal
        let mut drums_features = HashMap::new();
        drums_features.insert(
            "energy".to_string(),
            InputSignal::new(vec![0.9; 100], 100.0),
        );
        stem_signals.insert("drums".to_string(), drums_features);

        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.5, 0.016, &inputs, &band_signals, &stem_signals, &custom_signals, &stats, &mut state);

        // Access by ID
        let drums_energy = Signal::stem_input("drums", "energy");
        assert!((drums_energy.evaluate(&mut ctx) - 0.9).abs() < 0.001);

        // Unknown stem returns 0
        let unknown = Signal::stem_input("unknown", "energy");
        assert!((unknown.evaluate(&mut ctx) - 0.0).abs() < 0.001);

        // Unknown feature returns 0
        let unknown_feature = Signal::stem_input("drums", "unknown");
        assert!((unknown_feature.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }
}
