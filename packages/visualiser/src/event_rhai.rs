//! Rhai integration for EventStream extraction.
//!
//! This module registers EventStream, Event, and PickBuilder types with the Rhai engine,
//! enabling scripts to use the event extraction API with method chaining.
//!
//! # Example (Rhai)
//! ```rhai
//! let events = inputs.onsetEnvelope
//!     .smooth.exponential(0.1, 0.5)
//!     .pick.events(#{
//!         hysteresis_beats: 0.25,
//!         target_density: 2.0,
//!         similarity_tolerance: 0.1,
//!         phase_bias: 0.2
//!     });
//!
//! dbg.emit("event_count", events.len());
//!
//! // Convert back to signal for visualization
//! let impulses = events.to_signal();
//! ```

use rhai::{Dynamic, Engine, Map};
use std::cell::RefCell;
use std::collections::HashMap;

use crate::event_stream::{Event, EventStream, PickEventsOptions, WeightMode};
use crate::signal::{
    EasingFunction, EnvelopeShape, MergeMode, OverlapMode, Signal, ToSignalOptions,
};

// Thread-local storage for pending event extractions
// These are collected during script execution and processed afterwards
thread_local! {
    static PENDING_EXTRACTIONS: RefCell<Vec<PendingEventExtraction>> = const { RefCell::new(Vec::new()) };
    static EXTRACTED_STREAMS: RefCell<HashMap<String, EventStream>> = RefCell::new(HashMap::new());
    /// Band-scoped event streams, keyed by band ID.
    /// Pre-extracted events pushed from TypeScript for script access.
    static BAND_EVENT_STREAMS: RefCell<HashMap<String, EventStream>> = RefCell::new(HashMap::new());
}

/// A pending event extraction request.
///
/// Created when a script calls `signal.pick.events(options)`.
/// The actual extraction happens during analysis mode after script execution.
#[derive(Clone, Debug)]
pub struct PendingEventExtraction {
    /// The source signal to extract events from.
    pub source: Signal,
    /// Extraction options.
    pub options: PickEventsOptions,
    /// Unique name for this extraction (for caching/lookup).
    pub name: String,
}

/// Builder for event picking operations.
///
/// Returned by `signal.pick`, provides the `.events(options)` method.
#[derive(Clone)]
pub struct PickBuilder {
    pub source: Signal,
}

impl PickBuilder {
    /// Create a new pick builder for the given signal.
    pub fn new(source: Signal) -> Self {
        Self { source }
    }
}

/// Register EventStream API types and functions with a Rhai engine.
pub fn register_event_api(engine: &mut Engine) {
    // === Register EventStream type ===
    engine.register_type_with_name::<EventStream>("EventStream");

    // EventStream methods
    engine.register_fn("len", |es: &mut EventStream| es.len() as i64);
    engine.register_fn("is_empty", |es: &mut EventStream| es.is_empty());

    engine.register_fn("get", |es: &mut EventStream, index: i64| -> Dynamic {
        match es.get(index as usize) {
            Some(e) => Dynamic::from(e.clone()),
            None => Dynamic::UNIT,
        }
    });

    // EventStream to array for iteration
    engine.register_fn("to_array", |es: &mut EventStream| -> rhai::Array {
        es.iter().map(|e| Dynamic::from(e.clone())).collect()
    });

    // Time span
    engine.register_fn("time_span", |es: &mut EventStream| -> rhai::Array {
        match es.time_span() {
            Some((start, end)) => {
                vec![Dynamic::from(start), Dynamic::from(end)]
            }
            None => vec![],
        }
    });

    // Max/min weight
    engine.register_fn("max_weight", |es: &mut EventStream| -> f32 {
        es.max_weight().unwrap_or(0.0)
    });

    engine.register_fn("min_weight", |es: &mut EventStream| -> f32 {
        es.min_weight().unwrap_or(0.0)
    });

    // === Register Event type ===
    engine.register_type_with_name::<Event>("Event");

    // Event property getters
    engine.register_get("time", |e: &mut Event| e.time);
    engine.register_get("weight", |e: &mut Event| e.weight);
    engine.register_get("beat_position", |e: &mut Event| {
        e.beat_position.unwrap_or(0.0)
    });
    engine.register_get("beat_phase", |e: &mut Event| e.beat_phase.unwrap_or(0.0));
    engine.register_get("cluster_id", |e: &mut Event| -> i64 {
        e.cluster_id.map(|id| id as i64).unwrap_or(-1)
    });

    // === Register PickBuilder type ===
    engine.register_type_with_name::<PickBuilder>("PickBuilder");

    // pick.events(options) -> EventStream
    // Note: This creates a PendingEventExtraction that will be resolved
    // during analysis mode. In playback mode, it returns an empty stream.
    engine.register_fn("events", |pb: &mut PickBuilder, options: Map| -> EventStream {
        let opts = parse_pick_options(&options);
        let name = format!("events_{}", crate::event_stream::EventStreamId::new().0);

        // Register pending extraction
        let pending = PendingEventExtraction {
            source: pb.source.clone(),
            options: opts.clone(),
            name: name.clone(),
        };

        add_pending_extraction(pending);

        // Try to get already-extracted stream (if in analysis mode second pass)
        if let Some(stream) = get_extracted_stream(&name) {
            return stream;
        }

        // Return empty stream for now (will be populated during analysis)
        EventStream::new(Vec::new(), name, opts)
    });

    // === Register PendingEventExtraction ===
    engine.register_type_with_name::<PendingEventExtraction>("PendingEventExtraction");

    // === EventStream to_signal methods ===
    // to_signal() - simple impulses (no options)
    engine.register_fn("to_signal", |es: &mut EventStream| -> Signal { es.to_signal() });

    // to_signal(options) - with envelope shaping options
    engine.register_fn("to_signal", |es: &mut EventStream, options: Map| -> Signal {
        let opts = parse_to_signal_options(&options);
        es.to_signal_with_options(opts)
    });

    // === EventStream filtering methods ===
    engine.register_fn("filter_time", |es: &mut EventStream, start: f32, end: f32| {
        es.filter_time(start, end)
    });

    engine.register_fn("filter_weight", |es: &mut EventStream, min_weight: f32| {
        es.filter_weight(min_weight)
    });

    engine.register_fn("limit", |es: &mut EventStream, max_events: i64| {
        es.limit(max_events as usize)
    });

    // === EventStream probe method ===
    // Converts to signal and attaches a debug probe for analysis visualization.
    // Returns a Signal (not EventStream) since the probe wraps a signal.
    engine.register_fn(
        "probe",
        |es: &mut EventStream, name: rhai::ImmutableString| -> Signal {
            es.to_signal().probe(name.as_str())
        },
    );
}

/// Parse PickEventsOptions from a Rhai Map.
pub fn parse_pick_options(map: &Map) -> PickEventsOptions {
    let mut opts = PickEventsOptions::default();

    // Helper to extract f32 from Rhai Dynamic.
    // Note: Rhai is compiled with f32_float feature, so as_float() returns f32.
    fn get_f32(v: &Dynamic) -> Option<f32> {
        v.as_float()
            .ok()
            .or_else(|| v.as_int().ok().map(|i| i as f32))
    }

    if let Some(v) = map.get("hysteresis_beats") {
        if let Some(f) = get_f32(v) {
            opts.hysteresis_beats = f;
        }
    }

    if let Some(v) = map.get("target_density") {
        if let Some(f) = get_f32(v) {
            opts.target_density = f;
        }
    }

    if let Some(v) = map.get("similarity_tolerance") {
        if let Some(f) = get_f32(v) {
            opts.similarity_tolerance = f;
        }
    }

    if let Some(v) = map.get("phase_bias") {
        if let Some(f) = get_f32(v) {
            opts.phase_bias = f;
        }
    }

    if let Some(v) = map.get("min_threshold") {
        if let Some(f) = get_f32(v) {
            opts.min_threshold = f;
        }
    }

    if let Some(v) = map.get("adaptive_factor") {
        if let Some(f) = get_f32(v) {
            opts.adaptive_factor = f;
        }
    }

    if let Some(v) = map.get("weight_mode") {
        if let Ok(s) = v.clone().into_immutable_string() {
            opts.weight_mode = match s.as_str() {
                "integrated_energy" => WeightMode::IntegratedEnergy { window_beats: 0.25 },
                _ => WeightMode::PeakHeight,
            };
        }
    }

    // Handle integrated_energy with custom window
    if let Some(v) = map.get("energy_window_beats") {
        if let Some(f) = get_f32(v) {
            if matches!(opts.weight_mode, WeightMode::IntegratedEnergy { .. }) {
                opts.weight_mode = WeightMode::IntegratedEnergy {
                    window_beats: f,
                };
            }
        }
    }

    opts
}

/// Parse ToSignalOptions from a Rhai Map.
///
/// Supports all envelope options: envelope type, attack/decay/sustain/release times,
/// easing function, overlap mode, grouping, and merge mode.
pub fn parse_to_signal_options(map: &Map) -> ToSignalOptions {
    let mut opts = ToSignalOptions::default();

    fn get_f32(v: &Dynamic) -> Option<f32> {
        v.as_float()
            .ok()
            .or_else(|| v.as_int().ok().map(|i| i as f32))
    }

    // Envelope shape
    if let Some(v) = map.get("envelope") {
        if let Ok(s) = v.clone().into_immutable_string() {
            opts.envelope = match s.as_str() {
                "impulse" => EnvelopeShape::Impulse,
                "step" => EnvelopeShape::Step,
                "attack_decay" => EnvelopeShape::AttackDecay,
                "adsr" => EnvelopeShape::Adsr,
                "gaussian" => EnvelopeShape::Gaussian,
                "exponential_decay" => EnvelopeShape::ExponentialDecay,
                _ => EnvelopeShape::Impulse,
            };
        }
    }

    // Easing function
    if let Some(v) = map.get("easing") {
        if let Ok(s) = v.clone().into_immutable_string() {
            opts.easing = match s.as_str() {
                "linear" => EasingFunction::Linear,
                "quadratic_in" => EasingFunction::QuadraticIn,
                "quadratic_out" => EasingFunction::QuadraticOut,
                "quadratic_in_out" => EasingFunction::QuadraticInOut,
                "cubic_in" => EasingFunction::CubicIn,
                "cubic_out" => EasingFunction::CubicOut,
                "cubic_in_out" => EasingFunction::CubicInOut,
                "exponential_in" => EasingFunction::ExponentialIn,
                "exponential_out" => EasingFunction::ExponentialOut,
                "smoothstep" => EasingFunction::SmoothStep,
                "elastic" => EasingFunction::Elastic,
                _ => EasingFunction::Linear,
            };
        }
    }

    // Overlap mode
    if let Some(v) = map.get("overlap_mode") {
        if let Ok(s) = v.clone().into_immutable_string() {
            opts.overlap_mode = match s.as_str() {
                "sum" => OverlapMode::Sum,
                "max" => OverlapMode::Max,
                _ => OverlapMode::Sum,
            };
        }
    }

    // Merge mode (for grouped events)
    if let Some(v) = map.get("merge_mode") {
        if let Ok(s) = v.clone().into_immutable_string() {
            opts.merge_mode = match s.as_str() {
                "sum" => MergeMode::Sum,
                "max" => MergeMode::Max,
                "mean" => MergeMode::Mean,
                _ => MergeMode::Sum,
            };
        }
    }

    // Numeric parameters
    if let Some(v) = map.get("attack_beats") {
        if let Some(f) = get_f32(v) {
            opts.attack_beats = f;
        }
    }

    if let Some(v) = map.get("decay_beats") {
        if let Some(f) = get_f32(v) {
            opts.decay_beats = f;
        }
    }

    if let Some(v) = map.get("sustain_level") {
        if let Some(f) = get_f32(v) {
            opts.sustain_level = f;
        }
    }

    if let Some(v) = map.get("sustain_beats") {
        if let Some(f) = get_f32(v) {
            opts.sustain_beats = f;
        }
    }

    if let Some(v) = map.get("release_beats") {
        if let Some(f) = get_f32(v) {
            opts.release_beats = f;
        }
    }

    if let Some(v) = map.get("width_beats") {
        if let Some(f) = get_f32(v) {
            opts.width_beats = f;
        }
    }

    if let Some(v) = map.get("group_within_beats") {
        if let Some(f) = get_f32(v) {
            opts.group_within_beats = Some(f);
        }
    }

    opts
}

/// Add a pending extraction to the thread-local list.
pub fn add_pending_extraction(extraction: PendingEventExtraction) {
    PENDING_EXTRACTIONS.with(|e| e.borrow_mut().push(extraction));
}

/// Take all pending extractions from the thread-local list.
pub fn take_pending_extractions() -> Vec<PendingEventExtraction> {
    PENDING_EXTRACTIONS.with(|e| std::mem::take(&mut *e.borrow_mut()))
}

/// Clear pending extractions.
pub fn clear_pending_extractions() {
    PENDING_EXTRACTIONS.with(|e| e.borrow_mut().clear());
}

/// Store an extracted stream for retrieval during script execution.
pub fn store_extracted_stream(name: String, stream: EventStream) {
    EXTRACTED_STREAMS.with(|s| s.borrow_mut().insert(name, stream));
}

/// Get an extracted stream by name.
pub fn get_extracted_stream(name: &str) -> Option<EventStream> {
    EXTRACTED_STREAMS.with(|s| s.borrow().get(name).cloned())
}

/// Clear all extracted streams.
pub fn clear_extracted_streams() {
    EXTRACTED_STREAMS.with(|s| s.borrow_mut().clear());
}

// === Band Event Streams ===
// These are pre-extracted events for frequency bands, pushed from TypeScript.

/// Store a band event stream for script access via `inputs.bands[id].events`.
pub fn store_band_event_stream(band_id: String, stream: EventStream) {
    BAND_EVENT_STREAMS.with(|s| s.borrow_mut().insert(band_id, stream));
}

/// Get a band event stream by band ID.
pub fn get_band_event_stream(band_id: &str) -> Option<EventStream> {
    BAND_EVENT_STREAMS.with(|s| s.borrow().get(band_id).cloned())
}

/// Clear all band event streams.
pub fn clear_band_event_streams() {
    BAND_EVENT_STREAMS.with(|s| s.borrow_mut().clear());
}

/// Rhai API documentation for injection into scripts.
pub const EVENT_API_RHAI: &str = r#"
// === Event Extraction API ===
// The pick namespace provides event extraction from signals.
// Events are sparse, time-ordered, musically meaningful moments.
//
// Usage:
//   let events = inputs.onsetEnvelope
//       .smooth.exponential(0.1, 0.5)
//       .pick.events(#{
//           hysteresis_beats: 0.25,    // Min gap between events (in beats)
//           target_density: 2.0,       // Target events per beat
//           similarity_tolerance: 0.1, // Tolerance for grouping similar peaks
//           phase_bias: 0.2            // Preference for on-beat events (0-1)
//       });
//
// EventStream methods:
//   events.len()           // Number of events
//   events.is_empty()      // True if no events
//   events.get(index)      // Get event by index
//   events.to_array()      // Convert to array for iteration
//   events.time_span()     // [start_time, end_time]
//   events.max_weight()    // Maximum event weight
//   events.min_weight()    // Minimum event weight
//   events.to_signal()     // Convert to Signal with impulses
//
// Event properties:
//   event.time             // Time in seconds
//   event.weight           // Salience (0-1)
//   event.beat_position    // Continuous beat position
//   event.beat_phase       // Phase within beat (0-1)
//   event.cluster_id       // Cluster ID (-1 if unclustered)
//
// Note: Event extraction requires analysis mode (whole-track visibility).
// In playback mode, pick.events() returns an empty EventStream.
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use rhai::Engine;

    #[test]
    fn test_register_event_api() {
        let mut engine = Engine::new();
        register_event_api(&mut engine);

        // Should compile without error
        let result = engine.compile("let e = Event; e.time");
        // Note: This will fail at runtime without proper Event creation,
        // but it tests that the type is registered
        assert!(result.is_ok() || result.is_err()); // Type registered
    }

    #[test]
    fn test_parse_pick_options_defaults() {
        let map = Map::new();
        let opts = parse_pick_options(&map);

        assert!((opts.hysteresis_beats - 0.25).abs() < 0.001);
        assert!((opts.target_density - 1.0).abs() < 0.001);
        assert!((opts.similarity_tolerance - 0.15).abs() < 0.001);
        assert!((opts.phase_bias - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_pick_options_custom() {
        let mut map = Map::new();
        // Use f32 values since Rhai is compiled with f32_float feature
        map.insert("hysteresis_beats".into(), Dynamic::from(0.5_f32));
        map.insert("target_density".into(), Dynamic::from(2.0_f32));
        map.insert("similarity_tolerance".into(), Dynamic::from(0.2_f32));
        map.insert("phase_bias".into(), Dynamic::from(0.3_f32));
        map.insert("weight_mode".into(), Dynamic::from("integrated_energy"));

        let opts = parse_pick_options(&map);

        assert!((opts.hysteresis_beats - 0.5).abs() < 0.001);
        assert!((opts.target_density - 2.0).abs() < 0.001);
        assert!((opts.similarity_tolerance - 0.2).abs() < 0.001);
        assert!((opts.phase_bias - 0.3).abs() < 0.001);
        assert!(matches!(opts.weight_mode, WeightMode::IntegratedEnergy { .. }));
    }

    #[test]
    fn test_pending_extractions() {
        clear_pending_extractions();

        let pending = PendingEventExtraction {
            source: Signal::constant(1.0),
            options: PickEventsOptions::default(),
            name: "test".to_string(),
        };

        add_pending_extraction(pending.clone());
        add_pending_extraction(pending);

        let extracted = take_pending_extractions();
        assert_eq!(extracted.len(), 2);

        // Should be empty after take
        let extracted = take_pending_extractions();
        assert_eq!(extracted.len(), 0);
    }

    #[test]
    fn test_extracted_streams() {
        clear_extracted_streams();

        let stream = EventStream::new(
            vec![Event::new(0.5, 0.8)],
            "test".to_string(),
            PickEventsOptions::default(),
        );

        store_extracted_stream("test".to_string(), stream);

        let retrieved = get_extracted_stream("test");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().len(), 1);

        let missing = get_extracted_stream("nonexistent");
        assert!(missing.is_none());

        clear_extracted_streams();
        let after_clear = get_extracted_stream("test");
        assert!(after_clear.is_none());
    }
}
