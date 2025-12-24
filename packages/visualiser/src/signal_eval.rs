//! Signal evaluation context and evaluation logic.
//!
//! This module provides the evaluation context that carries all state needed
//! to evaluate a Signal at a given time, including:
//! - Current time and delta time
//! - Musical time context (for beat-aware operations)
//! - Input signals (raw sample data)
//! - Pre-computed statistics (for normalization)
//! - Runtime state (for smoothing, gates)

use std::collections::HashMap;

use crate::debug_collector::debug_emit;
use crate::input::InputSignal;
use crate::musical_time::{MusicalTimeSegment, MusicalTimeStructure, DEFAULT_BPM};
use crate::signal::{
    GateParams, GeneratorNode, NormaliseParams, NoiseType, Signal, SignalNode, SmoothParams,
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

    /// Musical time structure (for beat-aware operations).
    pub musical_time: Option<&'a MusicalTimeStructure>,

    /// Input signals (raw sample data).
    pub input_signals: &'a HashMap<String, InputSignal>,

    /// Pre-computed statistics for normalization.
    pub statistics: &'a StatisticsCache,

    /// Runtime state for stateful operations.
    pub state: &'a mut SignalState,
}

impl<'a> EvalContext<'a> {
    /// Create a new evaluation context.
    pub fn new(
        time: f32,
        dt: f32,
        musical_time: Option<&'a MusicalTimeStructure>,
        input_signals: &'a HashMap<String, InputSignal>,
        statistics: &'a StatisticsCache,
        state: &'a mut SignalState,
    ) -> Self {
        Self {
            time,
            dt,
            musical_time,
            input_signals,
            statistics,
            state,
        }
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
                log::warn!(
                    "No musical time available, using default BPM of {}",
                    DEFAULT_BPM
                );
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
}

impl Signal {
    /// Evaluate the signal at the current time in the given context.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> f32 {
        match &*self.node {
            // === Sources ===
            SignalNode::Input { name } => ctx
                .input_signals
                .get(name)
                .map(|sig| sig.sample(ctx.time))
                .unwrap_or(0.0),

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

            SignalNode::Scale(s, factor) => s.evaluate(ctx) * factor,

            SignalNode::Mix { a, b, weight } => {
                let va = a.evaluate(ctx);
                let vb = b.evaluate(ctx);
                va * (1.0 - weight) + vb * weight
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
            SignalNode::Input { name } => Some(name.clone()),
            SignalNode::Smooth { source, .. } => self.find_root_input_name(source),
            SignalNode::Normalise { source, .. } => self.find_root_input_name(source),
            SignalNode::Gate { source, .. } => self.find_root_input_name(source),
            SignalNode::Scale(s, _) => self.find_root_input_name(s),
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
                    // No statistics available, return raw
                    log::warn!("No statistics available for global normalization");
                    raw
                }
            }

            NormaliseParams::Robust => {
                if let Some(stats) = ctx.statistics.get(source.id) {
                    stats.normalize_robust(raw)
                } else {
                    // No statistics available, return raw
                    log::warn!("No statistics available for robust normalization");
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_context<'a>(
        time: f32,
        dt: f32,
        input_signals: &'a HashMap<String, InputSignal>,
        statistics: &'a StatisticsCache,
        state: &'a mut SignalState,
    ) -> EvalContext<'a> {
        EvalContext::new(time, dt, None, input_signals, statistics, state)
    }

    #[test]
    fn test_evaluate_constant() {
        let inputs = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &stats, &mut state);

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

        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.5, 0.016, &inputs, &stats, &mut state);

        let signal = Signal::input("energy");
        assert!((signal.evaluate(&mut ctx) - 0.5).abs() < 0.001);

        // Unknown input returns 0
        let unknown = Signal::input("unknown");
        assert!((unknown.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_arithmetic() {
        let inputs = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &stats, &mut state);

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
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &stats, &mut state);

        let high = Signal::constant(0.8);
        let low = Signal::constant(0.2);

        let gated_high = high.gate(crate::signal::GateParams::Threshold { threshold: 0.5 });
        let gated_low = low.gate(crate::signal::GateParams::Threshold { threshold: 0.5 });

        assert!((gated_high.evaluate(&mut ctx) - 1.0).abs() < 0.001);
        assert!((gated_low.evaluate(&mut ctx) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_evaluate_generator_sin() {
        let inputs = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();

        // At time 0, beat position 0, sin(0) = 0
        let mut ctx = make_test_context(0.0, 0.016, &inputs, &stats, &mut state);
        let sin = Signal::generator(GeneratorNode::Sin {
            freq_beats: 1.0,
            phase: 0.0,
        });
        assert!(sin.evaluate(&mut ctx).abs() < 0.1);

        // At beat position 0.25, sin(0.25 * 2pi) = 1
        // With default 120 BPM, beat 0.25 is at 0.125 seconds
        let mut ctx = make_test_context(0.125, 0.016, &inputs, &stats, &mut state);
        let value = sin.evaluate(&mut ctx);
        assert!((value - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_beat_position_default() {
        let inputs = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let ctx = make_test_context(1.0, 0.016, &inputs, &stats, &mut state);

        // At 120 BPM, 1 second = 2 beats
        assert!((ctx.beat_position() - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_beats_to_seconds_default() {
        let inputs = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        let ctx = make_test_context(0.0, 0.016, &inputs, &stats, &mut state);

        // At default 120 BPM, 1 beat = 0.5 seconds
        assert!((ctx.beats_to_seconds(1.0) - 0.5).abs() < 0.001);
    }
}
