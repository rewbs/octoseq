//! Signal API for declarative, beat-aware signal processing.
//!
//! Signals are immutable computation graphs that represent time-indexed values.
//! They are evaluated lazily by the engine, not eagerly by scripts.
//!
//! # Example (Rhai)
//! ```rhai
//! let smoothed = inputs.energy.smooth.exponential(0.5, 2.0);
//! let normalized = smoothed.normalise.robust();
//! cube.scale = normalized.add(1.0);
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::event_stream::Event;

/// Global counter for generating unique signal IDs.
static SIGNAL_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Unique identifier for a Signal, used for caching statistics and state.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SignalId(pub u64);

impl SignalId {
    /// Generate a new unique signal ID.
    pub fn new() -> Self {
        Self(SIGNAL_ID_COUNTER.fetch_add(1, Ordering::Relaxed))
    }
}

impl Default for SignalId {
    fn default() -> Self {
        Self::new()
    }
}

/// A Signal represents a lazy, time-indexed value that can be transformed.
///
/// Signals are immutable - all transformation methods return new Signals.
/// The actual computation happens during evaluation, controlled by the engine.
#[derive(Clone)]
pub struct Signal {
    /// The underlying computation node.
    pub(crate) node: Arc<SignalNode>,
    /// Unique identifier for caching.
    pub(crate) id: SignalId,
}

impl Signal {
    /// Create a new Signal from a node.
    pub fn new(node: SignalNode) -> Self {
        Self {
            node: Arc::new(node),
            id: SignalId::new(),
        }
    }

    /// Create an input signal that reads from a named source.
    /// Uses peak-preserving sampling with frame dt as window by default.
    pub fn input(name: impl Into<String>) -> Self {
        Self::new(SignalNode::Input {
            name: name.into(),
            sampling: SamplingConfig::default(),
        })
    }

    /// Create an input signal with custom sampling configuration.
    pub fn input_with_sampling(name: impl Into<String>, sampling: SamplingConfig) -> Self {
        Self::new(SignalNode::Input {
            name: name.into(),
            sampling,
        })
    }

    /// Create a band-scoped input signal.
    /// Uses peak-preserving sampling with frame dt as window by default.
    ///
    /// - `band_key`: The frequency band ID or label (both are supported).
    /// - `feature`: Signal type ("energy", "onset", "flux", "amplitude").
    pub fn band_input(band_key: impl Into<String>, feature: impl Into<String>) -> Self {
        Self::new(SignalNode::BandInput {
            band_key: band_key.into(),
            feature: feature.into(),
            sampling: SamplingConfig::default(),
        })
    }

    /// Create a band-scoped input signal with custom sampling configuration.
    pub fn band_input_with_sampling(
        band_key: impl Into<String>,
        feature: impl Into<String>,
        sampling: SamplingConfig,
    ) -> Self {
        Self::new(SignalNode::BandInput {
            band_key: band_key.into(),
            feature: feature.into(),
            sampling,
        })
    }

    /// Create a constant signal.
    pub fn constant(value: f32) -> Self {
        Self::new(SignalNode::Constant(value))
    }

    /// Create a generator signal.
    pub fn generator(gen: GeneratorNode) -> Self {
        Self::new(SignalNode::Generator(gen))
    }

    // === Arithmetic operations ===

    /// Add two signals together.
    pub fn add(&self, other: Signal) -> Signal {
        Signal::new(SignalNode::Add(self.clone(), other))
    }

    /// Add a constant to this signal.
    pub fn add_scalar(&self, value: f32) -> Signal {
        self.add(Signal::constant(value))
    }

    /// Multiply two signals together.
    pub fn mul(&self, other: Signal) -> Signal {
        Signal::new(SignalNode::Mul(self.clone(), other))
    }

    /// Multiply this signal by a constant.
    pub fn scale(&self, factor: f32) -> Signal {
        Signal::new(SignalNode::Scale(self.clone(), factor))
    }

    /// Mix this signal with another using a weight (0.0 = all self, 1.0 = all other).
    pub fn mix(&self, other: Signal, weight: f32) -> Signal {
        Signal::new(SignalNode::Mix {
            a: self.clone(),
            b: other,
            weight,
        })
    }

    // === Transformations ===

    /// Apply smoothing to this signal.
    pub fn smooth(&self, params: SmoothParams) -> Signal {
        Signal::new(SignalNode::Smooth {
            source: self.clone(),
            params,
        })
    }

    /// Apply normalization to this signal.
    pub fn normalise(&self, params: NormaliseParams) -> Signal {
        Signal::new(SignalNode::Normalise {
            source: self.clone(),
            params,
        })
    }

    /// Apply gating to this signal.
    pub fn gate(&self, params: GateParams) -> Signal {
        Signal::new(SignalNode::Gate {
            source: self.clone(),
            params,
        })
    }

    // === Debug ===

    /// Attach a debug probe to this signal.
    /// The probe emits values during analysis mode but doesn't affect the signal value.
    pub fn probe(&self, name: impl Into<String>) -> Signal {
        Signal::new(SignalNode::Debug {
            source: self.clone(),
            name: name.into(),
        })
    }

    // === Math Primitives ===

    /// Clamp the signal to a range [min, max].
    pub fn clamp(&self, min: f32, max: f32) -> Signal {
        Signal::new(SignalNode::Clamp {
            source: self.clone(),
            min,
            max,
        })
    }

    /// Floor (round down to nearest integer).
    pub fn floor(&self) -> Signal {
        Signal::new(SignalNode::Floor {
            source: self.clone(),
        })
    }

    /// Ceiling (round up to nearest integer).
    pub fn ceil(&self) -> Signal {
        Signal::new(SignalNode::Ceil {
            source: self.clone(),
        })
    }

    // === Rate and Accumulation ===

    /// Compute the rate of change (derivative approximation).
    /// Returns (current - previous) / dt.
    pub fn diff(&self) -> Signal {
        Signal::new(SignalNode::Diff {
            source: self.clone(),
        })
    }

    /// Integrate (cumulative sum) with optional decay.
    ///
    /// - `decay_beats`: Time constant for decay in beats. 0 = no decay.
    ///   The accumulated value decays by exp(-dt/tau) each frame.
    pub fn integrate(&self, decay_beats: f32) -> Signal {
        Signal::new(SignalNode::Integrate {
            source: self.clone(),
            decay_beats,
        })
    }

    // === Time Shifting ===

    /// Delay the signal by N beats (look back in time).
    /// Uses a ring buffer to store past values.
    pub fn delay(&self, beats: f32) -> Signal {
        Signal::new(SignalNode::Delay {
            source: self.clone(),
            beats,
        })
    }

    /// Anticipate the signal by N beats (look ahead in time).
    /// Only works reliably on Input signals; falls back to current value otherwise.
    pub fn anticipate(&self, beats: f32) -> Signal {
        Signal::new(SignalNode::Anticipate {
            source: self.clone(),
            beats,
        })
    }

    // === Utility ===

    // === Sampling Configuration ===

    /// Use linear interpolation sampling instead of peak-preserving.
    /// This samples at exactly the requested time without windowing.
    /// Use for signals where smoothness matters more than peak accuracy.
    pub fn interpolate(&self) -> Signal {
        self.with_sampling(SamplingConfig {
            strategy: SamplingStrategy::Interpolate,
            window: SamplingWindow::FrameDt, // Not used for interpolation
        })
    }

    /// Use peak-preserving sampling with frame dt as window.
    /// This is the default, but can be used to explicitly override.
    pub fn peak(&self) -> Signal {
        self.with_sampling(SamplingConfig {
            strategy: SamplingStrategy::Peak,
            window: SamplingWindow::FrameDt,
        })
    }

    /// Use peak-preserving sampling with a custom window size in beats.
    pub fn peak_window_beats(&self, beats: f32) -> Signal {
        self.with_sampling(SamplingConfig {
            strategy: SamplingStrategy::Peak,
            window: SamplingWindow::Beats(beats),
        })
    }

    /// Use peak-preserving sampling with a custom window size in seconds.
    pub fn peak_window_seconds(&self, seconds: f32) -> Signal {
        self.with_sampling(SamplingConfig {
            strategy: SamplingStrategy::Peak,
            window: SamplingWindow::Seconds(seconds),
        })
    }

    /// Apply a custom sampling configuration to this signal.
    /// Only affects Input and BandInput nodes; other nodes are returned unchanged.
    fn with_sampling(&self, sampling: SamplingConfig) -> Signal {
        match &*self.node {
            SignalNode::Input { name, .. } => Signal::new(SignalNode::Input {
                name: name.clone(),
                sampling,
            }),
            SignalNode::BandInput {
                band_key, feature, ..
            } => Signal::new(SignalNode::BandInput {
                band_key: band_key.clone(),
                feature: feature.clone(),
                sampling,
            }),
            // For non-input signals, return a clone unchanged
            // (sampling config only applies to input sources)
            _ => self.clone(),
        }
    }

    /// Get the underlying input name if this is a simple Input signal.
    pub fn get_input_name(&self) -> Option<&str> {
        match &*self.node {
            SignalNode::Input { name, .. } => Some(name),
            _ => None,
        }
    }

    /// Check if this signal requires whole-track statistics for evaluation.
    pub fn requires_statistics(&self) -> bool {
        self.find_normalise_sources().is_some()
    }

    /// Find all source signals that need statistics (for normalization).
    pub fn find_normalise_sources(&self) -> Option<Vec<Signal>> {
        let mut sources = Vec::new();
        self.collect_normalise_sources(&mut sources);
        if sources.is_empty() {
            None
        } else {
            Some(sources)
        }
    }

    fn collect_normalise_sources(&self, sources: &mut Vec<Signal>) {
        match &*self.node {
            SignalNode::Normalise { source, params } => {
                // For Range normalization, we don't need statistics
                if !matches!(params, NormaliseParams::Range { .. }) {
                    sources.push(source.clone());
                }
                source.collect_normalise_sources(sources);
            }
            SignalNode::Smooth { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            SignalNode::Gate { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            SignalNode::Add(a, b) | SignalNode::Mul(a, b) => {
                a.collect_normalise_sources(sources);
                b.collect_normalise_sources(sources);
            }
            SignalNode::Scale(s, _) => {
                s.collect_normalise_sources(sources);
            }
            SignalNode::Mix { a, b, .. } => {
                a.collect_normalise_sources(sources);
                b.collect_normalise_sources(sources);
            }
            SignalNode::Debug { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            // New primitives that wrap a source
            SignalNode::Clamp { source, .. }
            | SignalNode::Floor { source }
            | SignalNode::Ceil { source }
            | SignalNode::Diff { source }
            | SignalNode::Integrate { source, .. }
            | SignalNode::Delay { source, .. }
            | SignalNode::Anticipate { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            // Leaf nodes don't have children
            SignalNode::Input { .. }
            | SignalNode::BandInput { .. }
            | SignalNode::Constant(_)
            | SignalNode::Generator(_)
            | SignalNode::EventStreamSource { .. }
            | SignalNode::EventStreamEnvelope { .. } => {}
        }
    }

    /// Get the sampling configuration if this is an Input or BandInput signal.
    pub fn get_sampling_config(&self) -> Option<SamplingConfig> {
        match &*self.node {
            SignalNode::Input { sampling, .. } => Some(*sampling),
            SignalNode::BandInput { sampling, .. } => Some(*sampling),
            _ => None,
        }
    }

    /// Create a signal from event stream data (for to_signal() conversion).
    /// Produces simple impulses at event times.
    pub fn from_events(events: Arc<Vec<Event>>) -> Signal {
        Signal::new(SignalNode::EventStreamSource { events })
    }

    /// Create a signal from event stream data with envelope shaping options.
    /// Produces shaped envelopes at event times.
    pub fn from_events_with_options(events: Arc<Vec<Event>>, options: ToSignalOptions) -> Signal {
        Signal::new(SignalNode::EventStreamEnvelope { events, options })
    }
}

impl std::fmt::Debug for Signal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Signal")
            .field("id", &self.id)
            .field("node", &self.node)
            .finish()
    }
}

/// The AST node representing a signal operation.
#[derive(Debug, Clone)]
pub enum SignalNode {
    // === Sources ===
    /// Reference to a named input signal (e.g., "onsetEnvelope", "spectralCentroid").
    Input {
        name: String,
        sampling: SamplingConfig,
    },
    /// Reference to a band-scoped input signal.
    /// - `band_key`: The frequency band ID or label.
    /// - `feature`: Signal type ("energy", "onset", "flux").
    BandInput {
        band_key: String,
        feature: String,
        sampling: SamplingConfig,
    },
    /// Constant value.
    Constant(f32),
    /// Generator function (oscillators, noise, etc.).
    Generator(GeneratorNode),

    // === Transformations ===
    /// Smoothing operation.
    Smooth { source: Signal, params: SmoothParams },
    /// Normalization operation.
    Normalise { source: Signal, params: NormaliseParams },
    /// Gate/threshold operation.
    Gate { source: Signal, params: GateParams },

    // === Arithmetic ===
    /// Add two signals.
    Add(Signal, Signal),
    /// Multiply two signals.
    Mul(Signal, Signal),
    /// Scale a signal by a constant factor.
    Scale(Signal, f32),
    /// Mix two signals with a weight.
    Mix { a: Signal, b: Signal, weight: f32 },

    // === Debug ===
    /// Debug probe - emits values during analysis but passes through unchanged.
    Debug { source: Signal, name: String },

    // === Event Sources ===
    /// Signal generated from an EventStream (impulses at event times).
    /// Each event produces an impulse with height equal to its weight.
    EventStreamSource { events: Arc<Vec<Event>> },

    /// Signal generated from an EventStream with envelope shaping.
    /// Each event generates an envelope; contributions are combined per overlap_mode.
    EventStreamEnvelope {
        events: Arc<Vec<Event>>,
        options: ToSignalOptions,
    },

    // === Math Primitives ===
    /// Clamp signal to a range.
    Clamp { source: Signal, min: f32, max: f32 },
    /// Floor (round down).
    Floor { source: Signal },
    /// Ceiling (round up).
    Ceil { source: Signal },

    // === Rate and Accumulation ===
    /// Rate of change (derivative approximation).
    Diff { source: Signal },
    /// Cumulative sum with optional decay.
    Integrate { source: Signal, decay_beats: f32 },

    // === Time Shifting ===
    /// Delay by N beats (look back in time).
    Delay { source: Signal, beats: f32 },
    /// Anticipate by N beats (look ahead in time).
    Anticipate { source: Signal, beats: f32 },
}

/// Generator node for oscillators, noise, and other signal sources.
#[derive(Debug, Clone)]
pub enum GeneratorNode {
    /// Sine wave oscillator.
    /// - `freq_beats`: Frequency in cycles per beat.
    /// - `phase`: Initial phase offset (0-1).
    Sin { freq_beats: f32, phase: f32 },

    /// Square wave oscillator.
    /// - `freq_beats`: Frequency in cycles per beat.
    /// - `phase`: Initial phase offset (0-1).
    /// - `duty`: Duty cycle (0-1), default 0.5.
    Square { freq_beats: f32, phase: f32, duty: f32 },

    /// Triangle wave oscillator.
    Triangle { freq_beats: f32, phase: f32 },

    /// Sawtooth wave oscillator.
    Saw { freq_beats: f32, phase: f32 },

    /// Random noise generator.
    /// - `noise_type`: Type of noise (white, pink).
    /// - `seed`: Random seed for deterministic output.
    Noise { noise_type: NoiseType, seed: u64 },

    /// 1D Perlin noise.
    /// - `scale_beats`: Scale factor in beats.
    /// - `seed`: Random seed for deterministic output.
    Perlin { scale_beats: f32, seed: u64 },
}

/// Type of noise for the noise generator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoiseType {
    /// White noise (uniform distribution).
    White,
    /// Pink noise (1/f spectrum).
    Pink,
}

// ============================================================================
// EventStream → Signal Conversion Types
// ============================================================================

/// Envelope shape for EventStream → Signal conversion.
///
/// Defines how each event contributes to the output signal over time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EnvelopeShape {
    /// Single-frame spike at event time (height = weight).
    #[default]
    Impulse,
    /// Step function: rises at event time and holds indefinitely.
    Step,
    /// Attack-decay envelope: rises over attack_beats, falls over decay_beats.
    AttackDecay,
    /// Full ADSR envelope with explicit sustain duration.
    Adsr,
    /// Gaussian bell curve centered at event time.
    Gaussian,
    /// Exponential decay from event time.
    ExponentialDecay,
}

/// Easing function for envelope transitions.
///
/// Controls the shape of attack/decay/release curves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EasingFunction {
    /// Linear interpolation.
    #[default]
    Linear,
    /// Quadratic ease-in (slow start).
    QuadraticIn,
    /// Quadratic ease-out (slow end).
    QuadraticOut,
    /// Quadratic ease-in-out (slow start and end).
    QuadraticInOut,
    /// Cubic ease-in.
    CubicIn,
    /// Cubic ease-out.
    CubicOut,
    /// Cubic ease-in-out.
    CubicInOut,
    /// Exponential ease-in.
    ExponentialIn,
    /// Exponential ease-out.
    ExponentialOut,
    /// Smooth step (Hermite interpolation).
    SmoothStep,
    /// Elastic/bouncy effect (overshoots target).
    Elastic,
}

/// How to combine overlapping envelopes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OverlapMode {
    /// Sum all envelope contributions.
    #[default]
    Sum,
    /// Take the maximum of all contributions.
    Max,
}

/// How to merge grouped events before envelope generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MergeMode {
    /// Sum weights of grouped events.
    #[default]
    Sum,
    /// Take maximum weight.
    Max,
    /// Average weights.
    Mean,
}

/// Options for EventStream.to_signal() conversion.
///
/// Controls how discrete events are shaped into a continuous signal.
#[derive(Debug, Clone)]
pub struct ToSignalOptions {
    /// Envelope shape to use for each event.
    pub envelope: EnvelopeShape,
    /// Attack time in beats (for AttackDecay, Adsr).
    pub attack_beats: f32,
    /// Decay time in beats (for AttackDecay, Adsr).
    pub decay_beats: f32,
    /// Sustain level 0-1 (for Adsr).
    pub sustain_level: f32,
    /// Sustain duration in beats (for Adsr).
    pub sustain_beats: f32,
    /// Release time in beats (for Adsr).
    pub release_beats: f32,
    /// Width in beats (for Gaussian - approx 95% of bell curve).
    pub width_beats: f32,
    /// Easing function for envelope transitions.
    pub easing: EasingFunction,
    /// How to combine overlapping envelopes.
    pub overlap_mode: OverlapMode,
    /// Group events within this beat distance before generating envelopes.
    pub group_within_beats: Option<f32>,
    /// How to merge grouped events' weights.
    pub merge_mode: MergeMode,
}

impl Default for ToSignalOptions {
    fn default() -> Self {
        Self {
            envelope: EnvelopeShape::Impulse,
            attack_beats: 0.1,
            decay_beats: 0.5,
            sustain_level: 0.7,
            sustain_beats: 0.5,
            release_beats: 0.3,
            width_beats: 0.25,
            easing: EasingFunction::Linear,
            overlap_mode: OverlapMode::Sum,
            group_within_beats: None,
            merge_mode: MergeMode::Sum,
        }
    }
}

/// Parameters for smoothing operations.
#[derive(Debug, Clone)]
pub enum SmoothParams {
    /// Moving average over a window of N beats.
    MovingAverage { window_beats: f32 },

    /// Asymmetric exponential smoothing.
    /// - `attack_beats`: Time constant for rising values.
    /// - `release_beats`: Time constant for falling values.
    Exponential { attack_beats: f32, release_beats: f32 },

    /// Gaussian smoothing.
    /// - `sigma_beats`: Standard deviation in beats.
    Gaussian { sigma_beats: f32 },
}

/// Parameters for normalization operations.
#[derive(Debug, Clone)]
pub enum NormaliseParams {
    /// Min-max normalization using whole-track statistics.
    Global,

    /// Robust normalization using percentiles (5th-95th).
    /// Ignores outliers for more stable normalization.
    Robust,

    /// Direct range mapping (doesn't require statistics).
    Range { min: f32, max: f32 },
}

/// Parameters for gating operations.
#[derive(Debug, Clone)]
pub enum GateParams {
    /// Simple threshold gate.
    /// Output is 1.0 when input >= threshold, else 0.0.
    Threshold { threshold: f32 },

    /// Hysteresis gate to prevent rapid flickering.
    /// - `on_threshold`: Value must exceed this to turn on.
    /// - `off_threshold`: Value must drop below this to turn off.
    Hysteresis { on_threshold: f32, off_threshold: f32 },
}

/// Sampling strategy for input signals.
///
/// Controls how input signal values are sampled when evaluated at a given time.
/// Peak-preserving sampling is important for transient signals (onsets, energy)
/// to avoid aliasing when the evaluation rate is lower than the signal rate.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum SamplingStrategy {
    /// Peak-preserving: returns the max absolute value within a window.
    /// Window size is determined by `SamplingWindow`.
    /// This is the default to preserve transients when downsampling.
    #[default]
    Peak,

    /// Linear interpolation between adjacent samples.
    /// No windowing - samples at exactly the requested time.
    /// Use for signals where smoothness matters more than peak accuracy.
    Interpolate,
}

/// Window size for peak-preserving sampling.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum SamplingWindow {
    /// Use the frame delta time (dt) as the window.
    /// This is the default and adapts to the evaluation frame rate.
    #[default]
    FrameDt,

    /// Use a fixed window size in beats.
    /// Converts to seconds using current BPM.
    Beats(f32),

    /// Use a fixed window size in seconds.
    Seconds(f32),
}

/// Combined sampling configuration for input signals.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct SamplingConfig {
    /// The sampling strategy to use.
    pub strategy: SamplingStrategy,
    /// The window size (only used for Peak strategy).
    pub window: SamplingWindow,
}

// === Builder types for fluent API ===

/// Builder for smoothing operations, returned by `signal.smooth`.
#[derive(Clone)]
pub struct SmoothBuilder {
    pub source: Signal,
}

impl SmoothBuilder {
    /// Create a new smooth builder for the given signal.
    pub fn new(source: Signal) -> Self {
        Self { source }
    }

    /// Apply moving average smoothing over a window of N beats.
    pub fn moving_average(self, beats: f32) -> Signal {
        self.source.smooth(SmoothParams::MovingAverage { window_beats: beats })
    }

    /// Apply asymmetric exponential smoothing.
    pub fn exponential(self, attack_beats: f32, release_beats: f32) -> Signal {
        self.source.smooth(SmoothParams::Exponential {
            attack_beats,
            release_beats,
        })
    }

    /// Apply Gaussian smoothing.
    pub fn gaussian(self, sigma_beats: f32) -> Signal {
        self.source.smooth(SmoothParams::Gaussian { sigma_beats })
    }
}

/// Builder for normalization operations, returned by `signal.normalise`.
#[derive(Clone)]
pub struct NormaliseBuilder {
    pub source: Signal,
}

impl NormaliseBuilder {
    /// Create a new normalise builder for the given signal.
    pub fn new(source: Signal) -> Self {
        Self { source }
    }

    /// Apply global min-max normalization using whole-track statistics.
    pub fn global(self) -> Signal {
        self.source.normalise(NormaliseParams::Global)
    }

    /// Apply robust percentile-based normalization (5th-95th percentile).
    pub fn robust(self) -> Signal {
        self.source.normalise(NormaliseParams::Robust)
    }

    /// Apply direct range mapping.
    pub fn to_range(self, min: f32, max: f32) -> Signal {
        self.source.normalise(NormaliseParams::Range { min, max })
    }
}

/// Builder for gating operations, returned by `signal.gate`.
#[derive(Clone)]
pub struct GateBuilder {
    pub source: Signal,
}

impl GateBuilder {
    /// Create a new gate builder for the given signal.
    pub fn new(source: Signal) -> Self {
        Self { source }
    }

    /// Apply simple threshold gating.
    pub fn threshold(self, threshold: f32) -> Signal {
        self.source.gate(GateParams::Threshold { threshold })
    }

    /// Apply hysteresis gating to prevent flickering.
    pub fn hysteresis(self, on_threshold: f32, off_threshold: f32) -> Signal {
        self.source.gate(GateParams::Hysteresis {
            on_threshold,
            off_threshold,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signal_id_uniqueness() {
        let s1 = Signal::constant(1.0);
        let s2 = Signal::constant(1.0);
        assert_ne!(s1.id, s2.id);
    }

    #[test]
    fn test_signal_input() {
        let s = Signal::input("energy");
        assert_eq!(s.get_input_name(), Some("energy"));
    }

    #[test]
    fn test_signal_arithmetic() {
        let a = Signal::constant(1.0);
        let b = Signal::constant(2.0);

        let sum = a.add(b.clone());
        assert!(matches!(&*sum.node, SignalNode::Add(_, _)));

        let product = a.mul(b.clone());
        assert!(matches!(&*product.node, SignalNode::Mul(_, _)));

        let scaled = a.scale(2.0);
        assert!(matches!(&*scaled.node, SignalNode::Scale(_, 2.0)));

        let mixed = a.mix(b, 0.5);
        assert!(matches!(&*mixed.node, SignalNode::Mix { weight: 0.5, .. }));
    }

    #[test]
    fn test_fluent_builders() {
        let energy = Signal::input("energy");

        // Test smooth builder
        let smoothed = SmoothBuilder::new(energy.clone()).exponential(0.5, 2.0);
        assert!(matches!(&*smoothed.node, SignalNode::Smooth { .. }));

        // Test normalise builder
        let normalized = NormaliseBuilder::new(smoothed.clone()).robust();
        assert!(matches!(&*normalized.node, SignalNode::Normalise { .. }));

        // Test gate builder
        let gated = GateBuilder::new(normalized.clone()).threshold(0.5);
        assert!(matches!(&*gated.node, SignalNode::Gate { .. }));
    }

    #[test]
    fn test_requires_statistics() {
        let energy = Signal::input("energy");

        // Input alone doesn't require statistics
        assert!(!energy.requires_statistics());

        // Range normalization doesn't require statistics
        let range_norm = energy.normalise(NormaliseParams::Range { min: 0.0, max: 1.0 });
        assert!(!range_norm.requires_statistics());

        // Global normalization requires statistics
        let global_norm = energy.normalise(NormaliseParams::Global);
        assert!(global_norm.requires_statistics());

        // Robust normalization requires statistics
        let robust_norm = energy.normalise(NormaliseParams::Robust);
        assert!(robust_norm.requires_statistics());
    }

    #[test]
    fn test_debug_probe() {
        let energy = Signal::input("energy");
        let probed = energy.probe("my_probe");

        assert!(matches!(&*probed.node, SignalNode::Debug { name, .. } if name == "my_probe"));
    }

    #[test]
    fn test_generator() {
        let sin = Signal::generator(GeneratorNode::Sin {
            freq_beats: 1.0,
            phase: 0.0,
        });
        assert!(matches!(&*sin.node, SignalNode::Generator(GeneratorNode::Sin { .. })));
    }

    #[test]
    fn test_band_input() {
        let band_signal = Signal::band_input("Bass", "energy");
        assert!(matches!(
            &*band_signal.node,
            SignalNode::BandInput { band_key, feature, .. }
            if band_key == "Bass" && feature == "energy"
        ));
    }
}
