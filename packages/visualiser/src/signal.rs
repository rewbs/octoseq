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
use crate::signal_eval::EvalContext;

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

    /// Create a stem-scoped input signal.
    /// Uses peak-preserving sampling with frame dt as window by default.
    ///
    /// - `stem_id`: The stem ID or label (both are supported).
    /// - `feature`: Signal type ("energy", "onset", "flux", "amplitude", etc.).
    pub fn stem_input(stem_id: impl Into<String>, feature: impl Into<String>) -> Self {
        Self::new(SignalNode::StemInput {
            stem_id: stem_id.into(),
            feature: feature.into(),
            sampling: SamplingConfig::default(),
        })
    }

    /// Create a stem-scoped input signal with custom sampling configuration.
    pub fn stem_input_with_sampling(
        stem_id: impl Into<String>,
        feature: impl Into<String>,
        sampling: SamplingConfig,
    ) -> Self {
        Self::new(SignalNode::StemInput {
            stem_id: stem_id.into(),
            feature: feature.into(),
            sampling,
        })
    }

    /// Create a custom signal input.
    /// Uses peak-preserving sampling with frame dt as window by default.
    ///
    /// - `signal_id`: The custom signal ID.
    pub fn custom_signal_input(signal_id: impl Into<String>) -> Self {
        Self::new(SignalNode::CustomSignalInput {
            signal_id: signal_id.into(),
            sampling: SamplingConfig::default(),
        })
    }

    /// Create a custom signal input with custom sampling configuration.
    pub fn custom_signal_input_with_sampling(
        signal_id: impl Into<String>,
        sampling: SamplingConfig,
    ) -> Self {
        Self::new(SignalNode::CustomSignalInput {
            signal_id: signal_id.into(),
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

    /// Multiply this signal by a factor (constant or signal).
    pub fn scale(&self, factor: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Scale {
            source: self.clone(),
            factor: factor.into(),
        })
    }

    /// Mix this signal with another using a weight (0.0 = all self, 1.0 = all other).
    /// Weight can be a constant or a signal.
    pub fn mix(&self, other: Signal, weight: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Mix {
            a: self.clone(),
            b: other,
            weight: weight.into(),
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
    /// Min and max can be constants or signals.
    pub fn clamp(&self, min: impl Into<SignalParam>, max: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Clamp {
            source: self.clone(),
            min: min.into(),
            max: max.into(),
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

    /// Absolute value.
    pub fn abs(&self) -> Signal {
        Signal::new(SignalNode::Abs {
            source: self.clone(),
        })
    }

    /// Sigmoid curve centered at 0.5.
    /// `k` controls steepness (0.0 = no-op). Can be a constant or signal.
    pub fn sigmoid(&self, k: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Sigmoid {
            source: self.clone(),
            k: k.into(),
        })
    }

    /// Round to nearest integer.
    pub fn round(&self) -> Signal {
        Signal::new(SignalNode::Round {
            source: self.clone(),
        })
    }

    /// Sign function: returns -1.0, 0.0, or 1.0.
    pub fn sign(&self) -> Signal {
        Signal::new(SignalNode::Sign {
            source: self.clone(),
        })
    }

    /// Negate this signal (multiply by -1).
    pub fn neg(&self) -> Signal {
        Signal::new(SignalNode::Neg {
            source: self.clone(),
        })
    }

    // === Extended Arithmetic ===

    /// Subtract another signal from this one.
    pub fn sub(&self, other: Signal) -> Signal {
        Signal::new(SignalNode::Sub(self.clone(), other))
    }

    /// Subtract a constant from this signal.
    pub fn sub_scalar(&self, value: f32) -> Signal {
        self.sub(Signal::constant(value))
    }

    /// Divide this signal by another.
    pub fn div(&self, other: Signal) -> Signal {
        Signal::new(SignalNode::Div(self.clone(), other))
    }

    /// Divide this signal by a constant.
    pub fn div_scalar(&self, value: f32) -> Signal {
        self.div(Signal::constant(value))
    }

    /// Raise this signal to a power.
    /// Exponent can be a constant or signal.
    pub fn pow(&self, exponent: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Pow {
            source: self.clone(),
            exponent: exponent.into(),
        })
    }

    /// Add an offset to this signal.
    /// Amount can be a constant or signal.
    pub fn offset(&self, amount: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Offset {
            source: self.clone(),
            amount: amount.into(),
        })
    }

    // === Trigonometric (value transformation) ===

    /// Compute sine of this signal's value (in radians).
    /// Note: This transforms the signal VALUE, unlike gen.sin() which generates oscillators.
    pub fn sin(&self) -> Signal {
        Signal::new(SignalNode::Sin {
            source: self.clone(),
        })
    }

    /// Compute cosine of this signal's value (in radians).
    pub fn cos(&self) -> Signal {
        Signal::new(SignalNode::Cos {
            source: self.clone(),
        })
    }

    /// Compute tangent of this signal's value (in radians).
    pub fn tan(&self) -> Signal {
        Signal::new(SignalNode::Tan {
            source: self.clone(),
        })
    }

    /// Compute arc sine of this signal's value.
    pub fn asin(&self) -> Signal {
        Signal::new(SignalNode::Asin {
            source: self.clone(),
        })
    }

    /// Compute arc cosine of this signal's value.
    pub fn acos(&self) -> Signal {
        Signal::new(SignalNode::Acos {
            source: self.clone(),
        })
    }

    /// Compute arc tangent of this signal's value.
    pub fn atan(&self) -> Signal {
        Signal::new(SignalNode::Atan {
            source: self.clone(),
        })
    }

    /// Compute arc tangent of y/x, handling all quadrants correctly.
    /// This signal is treated as y, and `x` is the other signal.
    pub fn atan2(&self, x: Signal) -> Signal {
        Signal::new(SignalNode::Atan2 {
            y: self.clone(),
            x,
        })
    }

    // === Exponential and Logarithmic ===

    /// Compute square root of this signal's value.
    pub fn sqrt(&self) -> Signal {
        Signal::new(SignalNode::Sqrt {
            source: self.clone(),
        })
    }

    /// Compute e^x where x is this signal's value.
    pub fn exp(&self) -> Signal {
        Signal::new(SignalNode::Exp {
            source: self.clone(),
        })
    }

    /// Compute natural logarithm of this signal's value.
    pub fn ln(&self) -> Signal {
        Signal::new(SignalNode::Ln {
            source: self.clone(),
        })
    }

    /// Compute logarithm with custom base.
    /// Base can be a constant or signal.
    pub fn log(&self, base: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Log {
            source: self.clone(),
            base: base.into(),
        })
    }

    // === Modular / Periodic ===

    /// Compute Euclidean modulo (always positive result).
    /// Divisor can be a constant or signal.
    pub fn modulo(&self, divisor: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Mod {
            source: self.clone(),
            divisor: divisor.into(),
        })
    }

    /// Compute remainder (can be negative for negative dividend).
    /// Divisor can be a constant or signal.
    pub fn rem(&self, divisor: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Rem {
            source: self.clone(),
            divisor: divisor.into(),
        })
    }

    /// Wrap value to range [min, max).
    /// Min and max can be constants or signals.
    pub fn wrap(&self, min: impl Into<SignalParam>, max: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Wrap {
            source: self.clone(),
            min: min.into(),
            max: max.into(),
        })
    }

    /// Get fractional part of this signal's value.
    pub fn fract(&self) -> Signal {
        Signal::new(SignalNode::Fract {
            source: self.clone(),
        })
    }

    // === Mapping / Shaping ===

    /// Map this signal from one range to another.
    /// All parameters can be constants or signals.
    pub fn map(
        &self,
        in_min: impl Into<SignalParam>,
        in_max: impl Into<SignalParam>,
        out_min: impl Into<SignalParam>,
        out_max: impl Into<SignalParam>,
    ) -> Signal {
        Signal::new(SignalNode::Map {
            source: self.clone(),
            in_min: in_min.into(),
            in_max: in_max.into(),
            out_min: out_min.into(),
            out_max: out_max.into(),
        })
    }

    /// Apply smoothstep interpolation.
    /// Returns 0 when x <= edge0, 1 when x >= edge1, smooth interpolation between.
    /// Edges can be constants or signals.
    pub fn smoothstep(&self, edge0: impl Into<SignalParam>, edge1: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Smoothstep {
            source: self.clone(),
            edge0: edge0.into(),
            edge1: edge1.into(),
        })
    }

    /// Linearly interpolate between this signal and another.
    /// When t=0, returns self; when t=1, returns other.
    /// t can be a constant or signal.
    pub fn lerp(&self, other: Signal, t: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Lerp {
            a: self.clone(),
            b: other,
            t: t.into(),
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
    ///   Can be a constant or a signal.
    pub fn integrate(&self, decay_beats: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Integrate {
            source: self.clone(),
            decay_beats: decay_beats.into(),
        })
    }

    // === Time Shifting ===

    /// Delay the signal by N beats (look back in time).
    /// Uses a ring buffer to store past values.
    /// Beats can be a constant or a signal.
    pub fn delay(&self, beats: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Delay {
            source: self.clone(),
            beats: beats.into(),
        })
    }

    /// Anticipate the signal by N beats (look ahead in time).
    /// Only works reliably on Input signals; falls back to current value otherwise.
    /// Beats can be a constant or a signal.
    pub fn anticipate(&self, beats: impl Into<SignalParam>) -> Signal {
        Signal::new(SignalNode::Anticipate {
            source: self.clone(),
            beats: beats.into(),
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
            // Binary operations with two signal children
            SignalNode::Add(a, b)
            | SignalNode::Mul(a, b)
            | SignalNode::Sub(a, b)
            | SignalNode::Div(a, b) => {
                a.collect_normalise_sources(sources);
                b.collect_normalise_sources(sources);
            }
            SignalNode::Atan2 { y, x } => {
                y.collect_normalise_sources(sources);
                x.collect_normalise_sources(sources);
            }
            SignalNode::Scale { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            SignalNode::Mix { a, b, .. } | SignalNode::Lerp { a, b, .. } => {
                a.collect_normalise_sources(sources);
                b.collect_normalise_sources(sources);
            }
            SignalNode::Debug { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            // Unary primitives that wrap a source
            SignalNode::Sigmoid { source, .. }
            | SignalNode::Clamp { source, .. }
            | SignalNode::Floor { source }
            | SignalNode::Ceil { source }
            | SignalNode::Abs { source }
            | SignalNode::Round { source }
            | SignalNode::Sign { source }
            | SignalNode::Neg { source }
            | SignalNode::Pow { source, .. }
            | SignalNode::Offset { source, .. }
            | SignalNode::Sin { source }
            | SignalNode::Cos { source }
            | SignalNode::Tan { source }
            | SignalNode::Asin { source }
            | SignalNode::Acos { source }
            | SignalNode::Atan { source }
            | SignalNode::Sqrt { source }
            | SignalNode::Exp { source }
            | SignalNode::Ln { source }
            | SignalNode::Log { source, .. }
            | SignalNode::Mod { source, .. }
            | SignalNode::Rem { source, .. }
            | SignalNode::Wrap { source, .. }
            | SignalNode::Fract { source }
            | SignalNode::Map { source, .. }
            | SignalNode::Smoothstep { source, .. }
            | SignalNode::Diff { source }
            | SignalNode::Integrate { source, .. }
            | SignalNode::Delay { source, .. }
            | SignalNode::Anticipate { source, .. } => {
                source.collect_normalise_sources(sources);
            }
            // Leaf nodes don't have children
            SignalNode::Input { .. }
            | SignalNode::BandInput { .. }
            | SignalNode::StemInput { .. }
            | SignalNode::CustomSignalInput { .. }
            | SignalNode::Constant(_)
            | SignalNode::Generator(_)
            | SignalNode::EventStreamSource { .. }
            | SignalNode::EventStreamEnvelope { .. }
            | SignalNode::EventDistanceFromPrev { .. }
            | SignalNode::EventDistanceToNext { .. }
            | SignalNode::EventCountInWindow { .. }
            | SignalNode::EventDensityInWindow { .. }
            | SignalNode::EventPhaseBetween { .. } => {}
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

    /// Create a signal representing distance from previous event.
    /// Returns 0 at event time, grows linearly until next event.
    pub fn from_events_distance_from_prev(events: Arc<Vec<Event>>, unit: TimeUnit) -> Signal {
        Signal::new(SignalNode::EventDistanceFromPrev { events, unit })
    }

    /// Create a signal representing distance to next event.
    /// Decreases to 0 at next event time, returns distance to track end after last event.
    pub fn from_events_distance_to_next(events: Arc<Vec<Event>>, unit: TimeUnit) -> Signal {
        Signal::new(SignalNode::EventDistanceToNext { events, unit })
    }

    /// Create a signal counting events in a window.
    pub fn from_events_count_in_window(
        events: Arc<Vec<Event>>,
        window_size: impl Into<SignalParam>,
        unit: TimeUnit,
        direction: WindowDirection,
    ) -> Signal {
        Signal::new(SignalNode::EventCountInWindow {
            events,
            window_size: window_size.into(),
            unit,
            direction,
        })
    }

    /// Create a signal measuring event density in a window.
    pub fn from_events_density_in_window(
        events: Arc<Vec<Event>>,
        window_size: impl Into<SignalParam>,
        unit: TimeUnit,
        direction: WindowDirection,
    ) -> Signal {
        Signal::new(SignalNode::EventDensityInWindow {
            events,
            window_size: window_size.into(),
            unit,
            direction,
        })
    }

    /// Create a signal representing phase between adjacent events.
    /// Returns 0 at previous event, 1 at next event, linear interpolation between.
    pub fn from_events_phase_between(events: Arc<Vec<Event>>) -> Signal {
        Signal::new(SignalNode::EventPhaseBetween { events })
    }

    /// Returns a human-readable description of the signal's computation graph.
    ///
    /// Useful for debugging to understand how a signal is constructed.
    /// Example output: `Input("energy").Smooth.Exponential(0.1, 0.5).Add(Constant(1.0))`
    pub fn describe(&self) -> String {
        self.describe_node(&self.node)
    }

    fn describe_node(&self, node: &SignalNode) -> String {
        match node {
            SignalNode::Input { name, .. } => format!("Input(\"{}\")", name),
            SignalNode::BandInput { band_key, feature, .. } => {
                format!("BandInput(\"{}\", \"{}\")", band_key, feature)
            }
            SignalNode::StemInput { stem_id, feature, .. } => {
                format!("StemInput(\"{}\", \"{}\")", stem_id, feature)
            }
            SignalNode::CustomSignalInput { signal_id, .. } => {
                format!("CustomSignalInput(\"{}\")", signal_id)
            }
            SignalNode::Constant(v) => format!("Constant({})", v),
            SignalNode::Add(a, b) => {
                format!("{}.Add({})", self.describe_node(&a.node), self.describe_node(&b.node))
            }
            SignalNode::Sub(a, b) => {
                format!("{}.Sub({})", self.describe_node(&a.node), self.describe_node(&b.node))
            }
            SignalNode::Mul(a, b) => {
                format!("{}.Mul({})", self.describe_node(&a.node), self.describe_node(&b.node))
            }
            SignalNode::Div(a, b) => {
                format!("{}.Div({})", self.describe_node(&a.node), self.describe_node(&b.node))
            }
            SignalNode::Scale { source, factor } => {
                format!("{}.Scale({})", self.describe_node(&source.node), self.describe_param(factor))
            }
            SignalNode::Offset { source, amount } => {
                format!("{}.Offset({})", self.describe_node(&source.node), self.describe_param(amount))
            }
            SignalNode::Mix { a, b, weight } => {
                format!("{}.Mix({}, {})", self.describe_node(&a.node), self.describe_node(&b.node), self.describe_param(weight))
            }
            SignalNode::Neg { source } => {
                format!("{}.Neg()", self.describe_node(&source.node))
            }
            SignalNode::Pow { source, exponent } => {
                format!("{}.Pow({})", self.describe_node(&source.node), self.describe_param(exponent))
            }
            SignalNode::Lerp { a, b, t } => {
                format!("{}.Lerp({}, {})", self.describe_node(&a.node), self.describe_node(&b.node), self.describe_param(t))
            }
            SignalNode::Sin { source } => format!("{}.Sin()", self.describe_node(&source.node)),
            SignalNode::Cos { source } => format!("{}.Cos()", self.describe_node(&source.node)),
            SignalNode::Tan { source } => format!("{}.Tan()", self.describe_node(&source.node)),
            SignalNode::Asin { source } => format!("{}.Asin()", self.describe_node(&source.node)),
            SignalNode::Acos { source } => format!("{}.Acos()", self.describe_node(&source.node)),
            SignalNode::Atan { source } => format!("{}.Atan()", self.describe_node(&source.node)),
            SignalNode::Atan2 { y, x } => {
                format!("{}.Atan2({})", self.describe_node(&y.node), self.describe_node(&x.node))
            }
            SignalNode::Sqrt { source } => format!("{}.Sqrt()", self.describe_node(&source.node)),
            SignalNode::Exp { source } => format!("{}.Exp()", self.describe_node(&source.node)),
            SignalNode::Ln { source } => format!("{}.Ln()", self.describe_node(&source.node)),
            SignalNode::Log { source, base } => {
                format!("{}.Log({})", self.describe_node(&source.node), self.describe_param(base))
            }
            SignalNode::Mod { source, divisor } => {
                format!("{}.Mod({})", self.describe_node(&source.node), self.describe_param(divisor))
            }
            SignalNode::Rem { source, divisor } => {
                format!("{}.Rem({})", self.describe_node(&source.node), self.describe_param(divisor))
            }
            SignalNode::Fract { source } => format!("{}.Fract()", self.describe_node(&source.node)),
            SignalNode::Wrap { source, min, max } => {
                format!("{}.Wrap({}, {})", self.describe_node(&source.node), self.describe_param(min), self.describe_param(max))
            }
            SignalNode::Map { source, in_min, in_max, out_min, out_max } => {
                format!("{}.Map({}, {}, {}, {})",
                    self.describe_node(&source.node),
                    self.describe_param(in_min),
                    self.describe_param(in_max),
                    self.describe_param(out_min),
                    self.describe_param(out_max)
                )
            }
            SignalNode::Smoothstep { source, edge0, edge1 } => {
                format!("{}.Smoothstep({}, {})", self.describe_node(&source.node), self.describe_param(edge0), self.describe_param(edge1))
            }
            SignalNode::Clamp { source, min, max } => {
                format!("{}.Clamp({}, {})", self.describe_node(&source.node), self.describe_param(min), self.describe_param(max))
            }
            SignalNode::Abs { source } => format!("{}.Abs()", self.describe_node(&source.node)),
            SignalNode::Sign { source } => format!("{}.Sign()", self.describe_node(&source.node)),
            SignalNode::Floor { source } => format!("{}.Floor()", self.describe_node(&source.node)),
            SignalNode::Ceil { source } => format!("{}.Ceil()", self.describe_node(&source.node)),
            SignalNode::Round { source } => format!("{}.Round()", self.describe_node(&source.node)),
            SignalNode::Sigmoid { source, k } => {
                format!("{}.Sigmoid({})", self.describe_node(&source.node), self.describe_param(k))
            }
            SignalNode::Smooth { source, params } => {
                match params {
                    SmoothParams::MovingAverage { window_beats } => {
                        format!("{}.Smooth.MovingAverage({})", self.describe_node(&source.node), window_beats)
                    }
                    SmoothParams::Exponential { attack_beats, release_beats } => {
                        format!("{}.Smooth.Exponential({}, {})", self.describe_node(&source.node), attack_beats, release_beats)
                    }
                    SmoothParams::Gaussian { sigma_beats } => {
                        format!("{}.Smooth.Gaussian({})", self.describe_node(&source.node), sigma_beats)
                    }
                }
            }
            SignalNode::Normalise { source, params } => {
                match params {
                    NormaliseParams::Global => {
                        format!("{}.Normalise.Global()", self.describe_node(&source.node))
                    }
                    NormaliseParams::Robust => {
                        format!("{}.Normalise.Robust()", self.describe_node(&source.node))
                    }
                    NormaliseParams::Range { min, max } => {
                        format!("{}.Normalise.ToRange({}, {})", self.describe_node(&source.node), min, max)
                    }
                }
            }
            SignalNode::Gate { source, params } => {
                match params {
                    GateParams::Threshold { threshold } => {
                        format!("{}.Gate.Threshold({})", self.describe_node(&source.node), threshold)
                    }
                    GateParams::Hysteresis { on_threshold, off_threshold } => {
                        format!("{}.Gate.Hysteresis({}, {})", self.describe_node(&source.node), on_threshold, off_threshold)
                    }
                }
            }
            SignalNode::Diff { source } => format!("{}.Diff()", self.describe_node(&source.node)),
            SignalNode::Integrate { source, decay_beats } => {
                format!("{}.Integrate({})", self.describe_node(&source.node), self.describe_param(decay_beats))
            }
            SignalNode::Delay { source, beats } => {
                format!("{}.Delay({})", self.describe_node(&source.node), self.describe_param(beats))
            }
            SignalNode::Anticipate { source, beats } => {
                format!("{}.Anticipate({})", self.describe_node(&source.node), self.describe_param(beats))
            }
            SignalNode::Debug { source, name } => {
                format!("{}.Probe(\"{}\")", self.describe_node(&source.node), name)
            }
            SignalNode::Generator(gen_node) => {
                match gen_node {
                    GeneratorNode::Sin { freq_beats, phase } => {
                        format!("gen.sin({}, {})", freq_beats, phase)
                    }
                    GeneratorNode::Square { freq_beats, phase, duty } => {
                        format!("gen.square({}, {}, {})", freq_beats, phase, duty)
                    }
                    GeneratorNode::Triangle { freq_beats, phase } => {
                        format!("gen.triangle({}, {})", freq_beats, phase)
                    }
                    GeneratorNode::Saw { freq_beats, phase } => {
                        format!("gen.saw({}, {})", freq_beats, phase)
                    }
                    GeneratorNode::Noise { noise_type, seed } => {
                        format!("gen.noise({:?}, {})", noise_type, seed)
                    }
                    GeneratorNode::Perlin { scale_beats, seed } => {
                        format!("gen.perlin({}, {})", scale_beats, seed)
                    }
                }
            }
            SignalNode::EventStreamSource { events } => {
                format!("Events(count={})", events.len())
            }
            SignalNode::EventStreamEnvelope { events, .. } => {
                format!("EventsEnvelope(count={})", events.len())
            }
            SignalNode::EventDistanceFromPrev { events, unit } => {
                format!("EventDistanceFromPrev(count={}, {:?})", events.len(), unit)
            }
            SignalNode::EventDistanceToNext { events, unit } => {
                format!("EventDistanceToNext(count={}, {:?})", events.len(), unit)
            }
            SignalNode::EventCountInWindow { events, unit, direction, .. } => {
                format!("EventCountInWindow(count={}, {:?}, {:?})", events.len(), unit, direction)
            }
            SignalNode::EventDensityInWindow { events, unit, direction, .. } => {
                format!("EventDensityInWindow(count={}, {:?}, {:?})", events.len(), unit, direction)
            }
            SignalNode::EventPhaseBetween { events } => {
                format!("EventPhaseBetween(count={})", events.len())
            }
        }
    }

    fn describe_param(&self, param: &SignalParam) -> String {
        match param {
            SignalParam::Scalar(v) => format!("{}", v),
            SignalParam::Signal(s) => self.describe_node(&s.node),
        }
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

// ============================================================================
// SignalParam - Parameter type that can be either a scalar or a Signal
// ============================================================================

/// A parameter that can be either a constant scalar value or a Signal.
///
/// This allows signal transformation methods (like `integrate`, `delay`, etc.)
/// to accept either a fixed value or a dynamic signal as a parameter.
///
/// # Example (Rhai)
/// ```rhai
/// // Using a constant
/// let delayed = signal.delay(0.5);
///
/// // Using another signal as the parameter
/// let dynamic_delay = signal.delay(inputs.amplitude);
/// ```
#[derive(Clone)]
pub enum SignalParam {
    /// A constant scalar value.
    Scalar(f32),
    /// A dynamic signal that will be evaluated each frame.
    Signal(Box<Signal>),
}

impl SignalParam {
    /// Evaluate the parameter at the current time.
    ///
    /// - For `Scalar`, returns the constant value.
    /// - For `Signal`, evaluates the signal in the given context.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> f32 {
        match self {
            SignalParam::Scalar(v) => *v,
            SignalParam::Signal(s) => s.evaluate(ctx),
        }
    }
}

impl std::fmt::Debug for SignalParam {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SignalParam::Scalar(v) => write!(f, "Scalar({})", v),
            SignalParam::Signal(s) => write!(f, "Signal({:?})", s.id),
        }
    }
}

impl From<f32> for SignalParam {
    fn from(v: f32) -> Self {
        SignalParam::Scalar(v)
    }
}

impl From<Signal> for SignalParam {
    fn from(s: Signal) -> Self {
        SignalParam::Signal(Box::new(s))
    }
}

impl From<&Signal> for SignalParam {
    fn from(s: &Signal) -> Self {
        SignalParam::Signal(Box::new(s.clone()))
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
    /// Reference to a stem-scoped input signal.
    /// - `stem_id`: The stem ID or label.
    /// - `feature`: Signal type ("energy", "onset", "flux", "amplitude", etc.).
    StemInput {
        stem_id: String,
        feature: String,
        sampling: SamplingConfig,
    },
    /// Reference to a custom signal (user-defined 1D signal extracted from 2D data).
    /// - `signal_id`: The custom signal ID.
    CustomSignalInput {
        signal_id: String,
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
    /// Scale a signal by a factor (can be constant or signal).
    Scale { source: Signal, factor: SignalParam },
    /// Mix two signals with a weight (can be constant or signal).
    Mix { a: Signal, b: Signal, weight: SignalParam },

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

    /// Distance from current time to previous event.
    /// Returns 0 at event time, grows linearly until next event.
    /// Before first event: returns distance to first event.
    EventDistanceFromPrev {
        events: Arc<Vec<Event>>,
        unit: TimeUnit,
    },

    /// Distance from current time to next event.
    /// Decreases linearly to 0 at next event time.
    /// After last event: returns distance to track end.
    EventDistanceToNext {
        events: Arc<Vec<Event>>,
        unit: TimeUnit,
    },

    /// Count of events within a window.
    /// Window extends in the specified direction from current time.
    EventCountInWindow {
        events: Arc<Vec<Event>>,
        window_size: SignalParam,
        unit: TimeUnit,
        direction: WindowDirection,
    },

    /// Density of events within a window (count / window_size).
    /// Returns events per unit time within the window.
    EventDensityInWindow {
        events: Arc<Vec<Event>>,
        window_size: SignalParam,
        unit: TimeUnit,
        direction: WindowDirection,
    },

    /// Phase between previous and next event.
    /// Returns 0 at previous event, 1 at next event, linear interpolation between.
    /// Before first event: returns 0. After last event: returns 1.
    EventPhaseBetween {
        events: Arc<Vec<Event>>,
    },

    // === Math Primitives ===
    /// Sigmoid curve centered at 0.5.
    Sigmoid { source: Signal, k: SignalParam },
    /// Clamp signal to a range.
    Clamp { source: Signal, min: SignalParam, max: SignalParam },
    /// Floor (round down).
    Floor { source: Signal },
    /// Ceiling (round up).
    Ceil { source: Signal },
    /// Absolute value.
    Abs { source: Signal },
    /// Round to nearest integer.
    Round { source: Signal },
    /// Sign function: -1, 0, or 1.
    Sign { source: Signal },
    /// Negation (multiply by -1).
    Neg { source: Signal },

    // === Extended Arithmetic ===
    /// Subtract two signals.
    Sub(Signal, Signal),
    /// Divide two signals.
    Div(Signal, Signal),
    /// Power: source^exponent.
    Pow { source: Signal, exponent: SignalParam },
    /// Offset (add constant or signal).
    Offset { source: Signal, amount: SignalParam },

    // === Trigonometric (value transformation) ===
    /// Sine of signal value (radians).
    Sin { source: Signal },
    /// Cosine of signal value (radians).
    Cos { source: Signal },
    /// Tangent of signal value (radians).
    Tan { source: Signal },
    /// Arc sine of signal value.
    Asin { source: Signal },
    /// Arc cosine of signal value.
    Acos { source: Signal },
    /// Arc tangent of signal value.
    Atan { source: Signal },
    /// Arc tangent of y/x, handling quadrants.
    Atan2 { y: Signal, x: Signal },

    // === Exponential and Logarithmic ===
    /// Square root.
    Sqrt { source: Signal },
    /// Exponential (e^x).
    Exp { source: Signal },
    /// Natural logarithm.
    Ln { source: Signal },
    /// Logarithm with custom base.
    Log { source: Signal, base: SignalParam },

    // === Modular / Periodic ===
    /// Euclidean modulo.
    Mod { source: Signal, divisor: SignalParam },
    /// Remainder (can be negative).
    Rem { source: Signal, divisor: SignalParam },
    /// Wrap value to range [min, max).
    Wrap { source: Signal, min: SignalParam, max: SignalParam },
    /// Fractional part (x - floor(x)).
    Fract { source: Signal },

    // === Mapping / Shaping ===
    /// Map from input range to output range.
    Map {
        source: Signal,
        in_min: SignalParam,
        in_max: SignalParam,
        out_min: SignalParam,
        out_max: SignalParam,
    },
    /// Smoothstep interpolation between edges.
    Smoothstep { source: Signal, edge0: SignalParam, edge1: SignalParam },
    /// Linear interpolation between two signals.
    Lerp { a: Signal, b: Signal, t: SignalParam },

    // === Rate and Accumulation ===
    /// Rate of change (derivative approximation).
    Diff { source: Signal },
    /// Cumulative sum with optional decay (decay_beats can be constant or signal).
    Integrate { source: Signal, decay_beats: SignalParam },

    // === Time Shifting ===
    /// Delay by N beats (look back in time). Beats can be constant or signal.
    Delay { source: Signal, beats: SignalParam },
    /// Anticipate by N beats (look ahead in time). Beats can be constant or signal.
    Anticipate { source: Signal, beats: SignalParam },
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

/// Time unit for event distance/count calculations.
///
/// Specifies whether time values should be measured in beats, seconds, or frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimeUnit {
    /// Time measured in beats (BPM-aware).
    #[default]
    Beats,
    /// Time measured in seconds.
    Seconds,
    /// Time measured in frames.
    Frames,
}

/// Direction for windowed count/density operations.
///
/// Specifies whether to look backward or forward from the current time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WindowDirection {
    /// Look backward from current time.
    #[default]
    Prev,
    /// Look forward from current time.
    Next,
}

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
        assert!(matches!(&*scaled.node, SignalNode::Scale { .. }));

        let mixed = a.mix(b, 0.5);
        assert!(matches!(&*mixed.node, SignalNode::Mix { .. }));
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
