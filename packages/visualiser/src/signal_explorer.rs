//! Signal Explorer types and utilities for introspecting signal transform chains.
//!
//! This module provides the data structures and sampling logic needed to
//! analyze and visualize signal transform chains in the Signal Explorer UI.

use serde::Serialize;
use std::collections::HashMap;

use crate::input::InputSignal;
use crate::musical_time::MusicalTimeStructure;
use crate::signal::{Signal, SignalNode};
use crate::signal_eval::EvalContext;
use crate::signal_state::SignalState;
use crate::signal_stats::StatisticsCache;

/// The type of transform applied in a signal chain step.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum TransformType {
    /// Source signals: Input, BandInput, Constant, Generator, EventStream
    Source,
    /// Smoothing operations: MovingAverage, Exponential, Gaussian
    Smooth,
    /// Normalization: Global, Robust, Range
    Normalise,
    /// Gating: Threshold, Hysteresis
    Gate,
    /// Arithmetic: Add, Sub, Mul, Div, Scale, Mix, Offset
    Arithmetic,
    /// Math primitives: Clamp, Sigmoid, Floor, Ceil, Abs, Round, Sign, Neg, Pow
    Math,
    /// Trigonometric: Sin, Cos, Tan, Asin, Acos, Atan, Atan2
    Trig,
    /// Exponential/Logarithmic: Sqrt, Exp, Ln, Log
    ExpLog,
    /// Modular/Periodic: Mod, Rem, Wrap, Fract
    Modular,
    /// Mapping/Shaping: Map, Smoothstep, Lerp
    Mapping,
    /// Time shifting: Delay, Anticipate
    TimeShift,
    /// Rate/Accumulation: Diff, Integrate
    RateChange,
    /// Debug probe
    Debug,
}

impl TransformType {
    /// Get the display name for this transform type
    pub fn display_name(&self) -> &'static str {
        match self {
            TransformType::Source => "Source",
            TransformType::Smooth => "Smooth",
            TransformType::Normalise => "Normalise",
            TransformType::Gate => "Gate",
            TransformType::Arithmetic => "Arithmetic",
            TransformType::Math => "Math",
            TransformType::Trig => "Trig",
            TransformType::ExpLog => "Exp/Log",
            TransformType::Modular => "Modular",
            TransformType::Mapping => "Mapping",
            TransformType::TimeShift => "TimeShift",
            TransformType::RateChange => "RateChange",
            TransformType::Debug => "Debug",
        }
    }
}

/// A single transform step in a signal chain.
#[derive(Debug, Clone, Serialize)]
pub struct TransformStep {
    /// Human-readable description of this step (e.g., "Input(\"energy\")", "Smooth.Exponential(0.5, 2.0)")
    pub description: String,
    /// The type of transform (for UI styling)
    pub transform_type: TransformType,
    /// Signal ID for this step (for caching)
    pub signal_id: u64,
}

/// Statistics for a single transform step over a time window.
#[derive(Debug, Clone, Serialize, Default)]
pub struct StepStatistics {
    /// Minimum value in the window
    pub min: f32,
    /// Maximum value in the window
    pub max: f32,
    /// Mean value in the window
    pub mean: f32,
    /// Current value at center time
    pub current_value: f32,
}

/// Sampled data for a transform step.
#[derive(Debug, Clone, Serialize)]
pub struct StepSamples {
    /// Sample times
    pub times: Vec<f32>,
    /// Sample values at each time
    pub values: Vec<f32>,
    /// Statistics computed from the samples
    pub stats: StepStatistics,
}

/// Complete analysis result for a signal chain.
#[derive(Debug, Clone, Serialize)]
pub struct SignalChainAnalysis {
    /// Ordered list of transform steps (root first, final last)
    pub steps: Vec<TransformStep>,
    /// Sampled data for each step (parallel array with steps)
    pub samples: Vec<StepSamples>,
    /// Time window that was analyzed [start, end]
    pub time_range: (f32, f32),
}

/// Information about a signal variable in the script.
#[derive(Debug, Clone, Serialize)]
pub struct ScriptSignalInfo {
    /// Variable name in the script
    pub name: String,
    /// Line number where the signal is defined (1-based, adjusted for user script)
    pub line: usize,
    /// Column number (1-based)
    pub column: usize,
}

/// Error result for signal chain analysis.
#[derive(Debug, Clone, Serialize)]
pub struct AnalysisError {
    pub error: String,
}

/// Determine the transform type of a SignalNode.
pub fn node_transform_type(node: &SignalNode) -> TransformType {
    match node {
        // Sources
        SignalNode::Input { .. }
        | SignalNode::BandInput { .. }
        | SignalNode::StemInput { .. }
        | SignalNode::Constant(_)
        | SignalNode::Generator(_)
        | SignalNode::EventStreamSource { .. }
        | SignalNode::EventStreamEnvelope { .. } => TransformType::Source,

        // Transformations
        SignalNode::Smooth { .. } => TransformType::Smooth,
        SignalNode::Normalise { .. } => TransformType::Normalise,
        SignalNode::Gate { .. } => TransformType::Gate,

        // Arithmetic
        SignalNode::Add(_, _)
        | SignalNode::Sub(_, _)
        | SignalNode::Mul(_, _)
        | SignalNode::Div(_, _)
        | SignalNode::Scale { .. }
        | SignalNode::Mix { .. }
        | SignalNode::Offset { .. }
        | SignalNode::Neg { .. } => TransformType::Arithmetic,

        // Math primitives
        SignalNode::Sigmoid { .. }
        | SignalNode::Clamp { .. }
        | SignalNode::Floor { .. }
        | SignalNode::Ceil { .. }
        | SignalNode::Abs { .. }
        | SignalNode::Round { .. }
        | SignalNode::Sign { .. }
        | SignalNode::Pow { .. } => TransformType::Math,

        // Trigonometric
        SignalNode::Sin { .. }
        | SignalNode::Cos { .. }
        | SignalNode::Tan { .. }
        | SignalNode::Asin { .. }
        | SignalNode::Acos { .. }
        | SignalNode::Atan { .. }
        | SignalNode::Atan2 { .. } => TransformType::Trig,

        // Exponential/Logarithmic
        SignalNode::Sqrt { .. }
        | SignalNode::Exp { .. }
        | SignalNode::Ln { .. }
        | SignalNode::Log { .. } => TransformType::ExpLog,

        // Modular/Periodic
        SignalNode::Mod { .. }
        | SignalNode::Rem { .. }
        | SignalNode::Wrap { .. }
        | SignalNode::Fract { .. } => TransformType::Modular,

        // Mapping/Shaping
        SignalNode::Map { .. }
        | SignalNode::Smoothstep { .. }
        | SignalNode::Lerp { .. } => TransformType::Mapping,

        // Time shifting
        SignalNode::Delay { .. } | SignalNode::Anticipate { .. } => TransformType::TimeShift,

        // Rate/Accumulation
        SignalNode::Diff { .. } | SignalNode::Integrate { .. } => TransformType::RateChange,

        // Debug
        SignalNode::Debug { .. } => TransformType::Debug,
    }
}


/// Create a TransformStep from a Signal.
pub fn signal_to_step(signal: &Signal) -> TransformStep {
    TransformStep {
        description: signal.describe(),
        transform_type: node_transform_type(&signal.node),
        signal_id: signal.id.0,
    }
}

/// Extract the primary source signal from a SignalNode (for chain traversal).
/// Returns None for leaf nodes (sources).
fn get_primary_source(node: &SignalNode) -> Option<&Signal> {
    match node {
        // Leaf nodes - no source
        SignalNode::Input { .. }
        | SignalNode::BandInput { .. }
        | SignalNode::StemInput { .. }
        | SignalNode::Constant(_)
        | SignalNode::Generator(_)
        | SignalNode::EventStreamSource { .. }
        | SignalNode::EventStreamEnvelope { .. } => None,

        // Unary transforms - single source
        SignalNode::Smooth { source, .. }
        | SignalNode::Normalise { source, .. }
        | SignalNode::Gate { source, .. }
        | SignalNode::Scale { source, .. }
        | SignalNode::Debug { source, .. }
        | SignalNode::Sigmoid { source, .. }
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
        | SignalNode::Anticipate { source, .. } => Some(source),

        // Binary ops - follow the first operand as the primary chain
        SignalNode::Add(a, _)
        | SignalNode::Sub(a, _)
        | SignalNode::Mul(a, _)
        | SignalNode::Div(a, _)
        | SignalNode::Mix { a, .. }
        | SignalNode::Lerp { a, .. } => Some(a),

        // Atan2 - y is primary
        SignalNode::Atan2 { y, .. } => Some(y),
    }
}

/// Extract the transform chain from a signal to its root(s).
/// Returns steps ordered from root (source) first to final transform last.
pub fn extract_chain(signal: &Signal) -> Vec<TransformStep> {
    let mut steps = Vec::new();
    collect_chain_steps(signal, &mut steps);
    steps.reverse(); // Root first
    steps
}

fn collect_chain_steps(signal: &Signal, steps: &mut Vec<TransformStep>) {
    steps.push(signal_to_step(signal));

    // Recurse into source signal(s)
    if let Some(source) = get_primary_source(&signal.node) {
        collect_chain_steps(source, steps);
    }
}

/// Reconstruct a signal at a specific step index in its chain.
/// This allows sampling intermediate values in the chain.
pub fn reconstruct_signal_at_step(signal: &Signal, step_index: usize) -> Signal {
    let chain = extract_chain(signal);
    if step_index >= chain.len() {
        return signal.clone();
    }

    // We need to rebuild the signal up to the given step
    // The chain is root-first, so we traverse from root up to step_index

    // Collect signals in order (root first)
    let mut signals = Vec::new();
    collect_signals_in_chain(signal, &mut signals);
    signals.reverse(); // Now root first

    if step_index < signals.len() {
        signals[step_index].clone()
    } else {
        signal.clone()
    }
}

fn collect_signals_in_chain(signal: &Signal, signals: &mut Vec<Signal>) {
    signals.push(signal.clone());

    if let Some(source) = get_primary_source(&signal.node) {
        collect_signals_in_chain(source, signals);
    }
}

/// Sample a signal at multiple time points and compute statistics.
pub fn sample_signal(
    signal: &Signal,
    times: &[f32],
    dt: f32,
    input_signals: &HashMap<String, InputSignal>,
    band_signals: &HashMap<String, HashMap<String, InputSignal>>,
    stem_signals: &HashMap<String, HashMap<String, InputSignal>>,
    statistics: &StatisticsCache,
    state: &mut SignalState,
    musical_time: Option<&MusicalTimeStructure>,
    frame_count: u64,
) -> StepSamples {
    let mut values = Vec::with_capacity(times.len());
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut sum = 0.0f32;

    let _center_time = if times.is_empty() {
        0.0
    } else {
        times[times.len() / 2]
    };
    let mut current_value = 0.0f32;

    for (i, &time) in times.iter().enumerate() {
        let mut ctx = EvalContext::new(
            time,
            dt,
            frame_count,
            musical_time,
            input_signals,
            band_signals,
            stem_signals,
            statistics,
            state,
        );

        let value = signal.evaluate(&mut ctx);
        values.push(value);

        if value < min {
            min = value;
        }
        if value > max {
            max = value;
        }
        sum += value;

        // Track center value
        if i == times.len() / 2 {
            current_value = value;
        }
    }

    let mean = if times.is_empty() {
        0.0
    } else {
        sum / times.len() as f32
    };

    StepSamples {
        times: times.to_vec(),
        values,
        stats: StepStatistics {
            min: if min.is_infinite() { 0.0 } else { min },
            max: if max.is_infinite() { 0.0 } else { max },
            mean,
            current_value,
        },
    }
}

/// Sample a complete signal chain at multiple time points.
/// Returns samples for each step in the chain.
pub fn sample_signal_chain(
    signal: &Signal,
    center_time: f32,
    window_beats: f32,
    sample_count: usize,
    input_signals: &HashMap<String, InputSignal>,
    band_signals: &HashMap<String, HashMap<String, InputSignal>>,
    stem_signals: &HashMap<String, HashMap<String, InputSignal>>,
    statistics: &StatisticsCache,
    state: &mut SignalState,
    musical_time: Option<&MusicalTimeStructure>,
) -> SignalChainAnalysis {
    // Convert beats to seconds using BPM at center_time
    let bpm = musical_time
        .and_then(|mt| mt.segment_at(center_time))
        .map(|s| s.bpm)
        .unwrap_or(120.0);
    let window_sec = window_beats * 60.0 / bpm;

    let start_time = (center_time - window_sec).max(0.0);
    let end_time = center_time + window_sec;

    // Generate sample times
    let mut times = Vec::with_capacity(sample_count);
    if sample_count > 1 {
        let dt = (end_time - start_time) / (sample_count - 1) as f32;
        for i in 0..sample_count {
            times.push(start_time + i as f32 * dt);
        }
    } else if sample_count == 1 {
        times.push(center_time);
    }

    let frame_dt = if sample_count > 1 {
        (end_time - start_time) / (sample_count - 1) as f32
    } else {
        1.0 / 60.0 // Default 60fps
    };

    // Extract the chain
    let steps = extract_chain(signal);

    // Collect all signals in the chain (root first)
    let mut chain_signals = Vec::new();
    collect_signals_in_chain(signal, &mut chain_signals);
    chain_signals.reverse();

    // Sample each step
    let samples: Vec<StepSamples> = chain_signals
        .iter()
        .map(|sig| {
            sample_signal(
                sig,
                &times,
                frame_dt,
                input_signals,
                band_signals,
                stem_signals,
                statistics,
                state,
                musical_time,
                0, // Frame count not critical for sampling
            )
        })
        .collect();

    SignalChainAnalysis {
        steps,
        samples,
        time_range: (start_time, end_time),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::{SmoothParams, NormaliseParams};

    #[test]
    fn test_extract_chain_simple() {
        let input = Signal::input("energy");
        let chain = extract_chain(&input);

        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].transform_type, TransformType::Source);
        assert!(chain[0].description.contains("Input"));
    }

    #[test]
    fn test_extract_chain_with_transforms() {
        let input = Signal::input("energy");
        let smoothed = input.smooth(SmoothParams::Exponential {
            attack_beats: 0.5,
            release_beats: 2.0,
        });
        let normalized = smoothed.normalise(NormaliseParams::Robust);

        let chain = extract_chain(&normalized);

        assert_eq!(chain.len(), 3);
        assert_eq!(chain[0].transform_type, TransformType::Source); // Input
        assert_eq!(chain[1].transform_type, TransformType::Smooth); // Smooth
        assert_eq!(chain[2].transform_type, TransformType::Normalise); // Normalise
    }

    #[test]
    fn test_transform_type_classification() {
        let input = Signal::input("test");
        assert_eq!(node_transform_type(&input.node), TransformType::Source);

        let constant = Signal::constant(1.0);
        assert_eq!(node_transform_type(&constant.node), TransformType::Source);

        let added = input.add(constant);
        assert_eq!(node_transform_type(&added.node), TransformType::Arithmetic);

        let smoothed = Signal::input("test").smooth(SmoothParams::MovingAverage { window_beats: 0.5 });
        assert_eq!(node_transform_type(&smoothed.node), TransformType::Smooth);
    }
}
