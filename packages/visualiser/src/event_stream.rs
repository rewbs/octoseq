//! Event stream types for sparse, time-ordered events extracted from signals.
//!
//! EventStreams represent discrete, musically meaningful moments extracted from
//! continuous signals. They are immutable, time-ordered, and support conversion
//! back to signals for visualization and chaining.
//!
//! # Example (Rhai)
//! ```rhai
//! let events = inputs.onsetEnvelope
//!     .smooth.exponential(0.1, 0.5)
//!     .pick.events(#{
//!         hysteresis_beats: 0.25,
//!         target_density: 2.0
//!     });
//!
//! let impulses = events.to_signal();
//! ```

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Global counter for generating unique EventStream IDs.
static EVENT_STREAM_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Unique identifier for an EventStream.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct EventStreamId(pub u64);

impl EventStreamId {
    /// Generate a new unique EventStream ID.
    pub fn new() -> Self {
        Self(EVENT_STREAM_ID_COUNTER.fetch_add(1, Ordering::Relaxed))
    }
}

impl Default for EventStreamId {
    fn default() -> Self {
        Self::new()
    }
}

/// An immutable, time-ordered stream of events extracted from a signal.
///
/// EventStreams are produced by the peak picking pipeline and represent
/// musically meaningful moments (peaks, onsets, etc.) with associated weights.
#[derive(Clone, Debug)]
pub struct EventStream {
    /// Unique identifier for caching.
    pub id: EventStreamId,

    /// Events in time order.
    pub events: Arc<Vec<Event>>,

    /// Source signal description (for debugging).
    pub source_description: String,

    /// Extraction options used (for reproducibility).
    pub options: PickEventsOptions,
}

impl EventStream {
    /// Create a new EventStream from a list of events.
    ///
    /// Events will be sorted by time if not already ordered.
    pub fn new(
        mut events: Vec<Event>,
        source_description: String,
        options: PickEventsOptions,
    ) -> Self {
        // Ensure events are sorted by time
        events.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));

        Self {
            id: EventStreamId::new(),
            events: Arc::new(events),
            source_description,
            options,
        }
    }

    /// Create an empty EventStream.
    pub fn empty() -> Self {
        Self {
            id: EventStreamId::new(),
            events: Arc::new(Vec::new()),
            source_description: String::new(),
            options: PickEventsOptions::default(),
        }
    }

    /// Get the number of events.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Check if the stream is empty.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Get an event by index.
    pub fn get(&self, index: usize) -> Option<&Event> {
        self.events.get(index)
    }

    /// Iterate over events.
    pub fn iter(&self) -> impl Iterator<Item = &Event> {
        self.events.iter()
    }

    /// Find events within a time range.
    pub fn events_in_range(&self, start: f32, end: f32) -> impl Iterator<Item = &Event> {
        self.events.iter().filter(move |e| e.time >= start && e.time < end)
    }

    /// Find the nearest event to a given time.
    pub fn nearest_event(&self, time: f32) -> Option<&Event> {
        if self.events.is_empty() {
            return None;
        }

        let mut nearest = &self.events[0];
        let mut min_dist = (nearest.time - time).abs();

        for event in self.events.iter().skip(1) {
            let dist = (event.time - time).abs();
            if dist < min_dist {
                min_dist = dist;
                nearest = event;
            } else if event.time > time {
                // Events are sorted, so we can stop early
                break;
            }
        }

        Some(nearest)
    }

    /// Get the time span of the events.
    pub fn time_span(&self) -> Option<(f32, f32)> {
        if self.events.is_empty() {
            return None;
        }
        let first = self.events.first()?.time;
        let last = self.events.last()?.time;
        Some((first, last))
    }

    /// Get the maximum weight in the stream.
    pub fn max_weight(&self) -> Option<f32> {
        self.events.iter().map(|e| e.weight).reduce(f32::max)
    }

    /// Get the minimum weight in the stream.
    pub fn min_weight(&self) -> Option<f32> {
        self.events.iter().map(|e| e.weight).reduce(f32::min)
    }

    /// Convert this EventStream to a Signal with impulses at event times.
    ///
    /// The resulting signal produces impulses (spikes) at each event's time,
    /// with height equal to the event's weight. This is useful for:
    /// - Visualization of events on a timeline
    /// - Chaining with smoothing operations to create envelopes
    /// - Using events as triggers for other effects
    ///
    /// # Example (Rhai)
    /// ```rhai
    /// let events = inputs.energy.pick.events(#{ target_density: 2.0 });
    /// let impulses = events.to_signal();
    /// let envelope = impulses.smooth.exponential(0.01, 0.1);
    /// ```
    pub fn to_signal(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events(self.events.clone())
    }

    /// Convert this EventStream to a Signal with envelope shaping options.
    ///
    /// Each event generates an envelope according to the options (shape, attack,
    /// decay, etc.), and contributions are combined using the overlap mode.
    ///
    /// # Example (Rhai)
    /// ```rhai
    /// let events = inputs.energy.pick.events(#{ target_density: 2.0 });
    /// let envelope = events.to_signal(#{
    ///     envelope: "attack_decay",
    ///     attack_beats: 0.05,
    ///     decay_beats: 0.5,
    ///     easing: "exponential_out"
    /// });
    /// ```
    pub fn to_signal_with_options(
        &self,
        options: crate::signal::ToSignalOptions,
    ) -> crate::signal::Signal {
        crate::signal::Signal::from_events_with_options(self.events.clone(), options)
    }

    /// Alias for to_signal() that explicitly indicates impulse generation.
    ///
    /// Returns 1.0 at each event time, 0.0 elsewhere.
    /// Multiple coincident events sum additively.
    pub fn impulse(&self) -> crate::signal::Signal {
        self.to_signal()
    }

    // =========================================================================
    // Temporal Distance Methods
    // =========================================================================

    /// Signal representing beats elapsed since previous event.
    /// Returns 0 at event time, grows linearly until next event.
    /// Before first event: returns distance to first event.
    pub fn beats_from_prev(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_from_prev(
            self.events.clone(),
            crate::signal::TimeUnit::Beats,
        )
    }

    /// Signal representing beats remaining until next event.
    /// Decreases linearly to 0 at next event time.
    /// After last event: returns distance to track end.
    pub fn beats_to_next(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_to_next(
            self.events.clone(),
            crate::signal::TimeUnit::Beats,
        )
    }

    /// Signal representing seconds elapsed since previous event.
    pub fn seconds_from_prev(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_from_prev(
            self.events.clone(),
            crate::signal::TimeUnit::Seconds,
        )
    }

    /// Signal representing seconds remaining until next event.
    pub fn seconds_to_next(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_to_next(
            self.events.clone(),
            crate::signal::TimeUnit::Seconds,
        )
    }

    /// Signal representing frames elapsed since previous event.
    pub fn frames_from_prev(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_from_prev(
            self.events.clone(),
            crate::signal::TimeUnit::Frames,
        )
    }

    /// Signal representing frames remaining until next event.
    pub fn frames_to_next(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_distance_to_next(
            self.events.clone(),
            crate::signal::TimeUnit::Frames,
        )
    }

    // =========================================================================
    // Event Count Methods
    // =========================================================================

    /// Count events in the previous N beats.
    pub fn count_prev_beats(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Beats,
            crate::signal::WindowDirection::Prev,
        )
    }

    /// Count events in the next N beats.
    pub fn count_next_beats(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Beats,
            crate::signal::WindowDirection::Next,
        )
    }

    /// Count events in the previous N seconds.
    pub fn count_prev_seconds(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Seconds,
            crate::signal::WindowDirection::Prev,
        )
    }

    /// Count events in the next N seconds.
    pub fn count_next_seconds(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Seconds,
            crate::signal::WindowDirection::Next,
        )
    }

    /// Count events in the previous N frames.
    pub fn count_prev_frames(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Frames,
            crate::signal::WindowDirection::Prev,
        )
    }

    /// Count events in the next N frames.
    pub fn count_next_frames(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_count_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Frames,
            crate::signal::WindowDirection::Next,
        )
    }

    // =========================================================================
    // Event Density Methods
    // =========================================================================

    /// Event density (events per beat) in the previous N beats.
    pub fn density_prev_beats(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_density_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Beats,
            crate::signal::WindowDirection::Prev,
        )
    }

    /// Event density (events per beat) in the next N beats.
    pub fn density_next_beats(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_density_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Beats,
            crate::signal::WindowDirection::Next,
        )
    }

    /// Event density (events per second) in the previous N seconds.
    pub fn density_prev_seconds(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_density_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Seconds,
            crate::signal::WindowDirection::Prev,
        )
    }

    /// Event density (events per second) in the next N seconds.
    pub fn density_next_seconds(&self, window: impl Into<crate::signal::SignalParam>) -> crate::signal::Signal {
        crate::signal::Signal::from_events_density_in_window(
            self.events.clone(),
            window,
            crate::signal::TimeUnit::Seconds,
            crate::signal::WindowDirection::Next,
        )
    }

    // =========================================================================
    // Phase Method
    // =========================================================================

    /// Phase between adjacent events: 0 at previous event, 1 at next event.
    /// Useful for smooth animations that reset at each event.
    pub fn beat_phase_between(&self) -> crate::signal::Signal {
        crate::signal::Signal::from_events_phase_between(self.events.clone())
    }

    // =========================================================================
    // Filtering Methods
    // =========================================================================

    /// Filter events to a time range [start, end).
    ///
    /// Returns a new EventStream containing only events within the range.
    pub fn filter_time(&self, start: f32, end: f32) -> EventStream {
        let filtered: Vec<Event> = self
            .events
            .iter()
            .filter(|e| e.time >= start && e.time < end)
            .cloned()
            .collect();

        EventStream {
            id: EventStreamId::new(),
            events: Arc::new(filtered),
            source_description: format!("{} [time {:.2}-{:.2}]", self.source_description, start, end),
            options: self.options.clone(),
        }
    }

    /// Filter events by minimum weight.
    ///
    /// Returns a new EventStream containing only events with weight >= min_weight.
    pub fn filter_weight(&self, min_weight: f32) -> EventStream {
        let filtered: Vec<Event> = self
            .events
            .iter()
            .filter(|e| e.weight >= min_weight)
            .cloned()
            .collect();

        EventStream {
            id: EventStreamId::new(),
            events: Arc::new(filtered),
            source_description: format!("{} [weight>={:.2}]", self.source_description, min_weight),
            options: self.options.clone(),
        }
    }

    /// Limit to the first N events.
    ///
    /// Returns a new EventStream with at most max_events events.
    pub fn limit(&self, max_events: usize) -> EventStream {
        let limited: Vec<Event> = self.events.iter().take(max_events).cloned().collect();

        EventStream {
            id: EventStreamId::new(),
            events: Arc::new(limited),
            source_description: format!("{} [limit {}]", self.source_description, max_events),
            options: self.options.clone(),
        }
    }
}

/// A single event in an EventStream.
///
/// Events represent discrete moments extracted from a continuous signal,
/// such as peaks, onsets, or other musically significant points.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    /// Time in seconds from track start.
    pub time: f32,

    /// Weight/salience (0.0-1.0, higher = more prominent).
    pub weight: f32,

    /// Optional cluster identifier (for grouped events).
    pub cluster_id: Option<u32>,

    /// Optional source identifier (e.g., "peak", "onset").
    pub source: Option<String>,

    /// Beat position at event time (if musical time available).
    pub beat_position: Option<f32>,

    /// Phase within beat (0.0-1.0, if musical time available).
    pub beat_phase: Option<f32>,
}

impl Event {
    /// Create a new event with minimal fields.
    pub fn new(time: f32, weight: f32) -> Self {
        Self {
            time,
            weight,
            cluster_id: None,
            source: None,
            beat_position: None,
            beat_phase: None,
        }
    }

    /// Create an event with beat information.
    pub fn with_beat_info(time: f32, weight: f32, beat_position: f32, beat_phase: f32) -> Self {
        Self {
            time,
            weight,
            cluster_id: None,
            source: None,
            beat_position: Some(beat_position),
            beat_phase: Some(beat_phase),
        }
    }

    /// Set the cluster ID.
    pub fn with_cluster(mut self, cluster_id: u32) -> Self {
        self.cluster_id = Some(cluster_id);
        self
    }

    /// Set the source.
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }
}

/// Options for event extraction via pick.events().
///
/// These options control the peak picking pipeline, including hysteresis,
/// density constraints, similarity clustering, and phase biasing.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PickEventsOptions {
    /// Minimum time between events in beats (beat-aware hysteresis).
    /// Default: 0.25 beats (16th note at any tempo).
    pub hysteresis_beats: f32,

    /// Target event density: events per beat (soft constraint).
    /// Similarity can override this constraint.
    /// Default: 1.0 (one event per beat on average).
    pub target_density: f32,

    /// Tolerance for grouping similar peaks (0.0-1.0).
    /// Peaks within this amplitude ratio are considered similar.
    /// Default: 0.15
    pub similarity_tolerance: f32,

    /// Phase bias strength (0.0-1.0).
    /// Higher values prefer events near beat positions.
    /// 0.0 = no bias, 1.0 = strong preference for on-beat events.
    /// Default: 0.0 (no phase bias)
    pub phase_bias: f32,

    /// Weight mode: how to assign event weights.
    /// Default: PeakHeight
    pub weight_mode: WeightMode,

    /// Minimum absolute threshold (after normalization).
    /// Default: 0.1
    pub min_threshold: f32,

    /// Adaptive threshold factor (mean + factor * std).
    /// Default: 0.5
    pub adaptive_factor: f32,
}

impl Default for PickEventsOptions {
    fn default() -> Self {
        Self {
            hysteresis_beats: 0.25,
            target_density: 1.0,
            similarity_tolerance: 0.15,
            phase_bias: 0.0,
            weight_mode: WeightMode::default(),
            min_threshold: 0.1,
            adaptive_factor: 0.5,
        }
    }
}

/// How to compute event weights.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub enum WeightMode {
    /// Use the peak height directly.
    #[default]
    PeakHeight,

    /// Integrate signal energy around the peak.
    IntegratedEnergy {
        /// Window size in beats for integration.
        window_beats: f32,
    },
}

/// Debug data for the event extraction pipeline.
///
/// This provides visibility into each stage of the pipeline for tuning and trust.
#[derive(Clone, Debug, Serialize)]
pub struct EventExtractionDebug {
    /// Raw candidates before any filtering.
    pub raw_candidates: Vec<Event>,

    /// Candidates after hysteresis filtering.
    pub post_hysteresis: Vec<Event>,

    /// Cluster information.
    pub clusters: Vec<EventCluster>,

    /// Final accepted events.
    pub accepted: Vec<Event>,

    /// Events rejected by density constraint.
    pub rejected_density: Vec<Event>,

    /// Events merged/rejected by similarity clustering.
    pub rejected_similarity: Vec<Event>,
}

impl Default for EventExtractionDebug {
    fn default() -> Self {
        Self {
            raw_candidates: Vec::new(),
            post_hysteresis: Vec::new(),
            clusters: Vec::new(),
            accepted: Vec::new(),
            rejected_density: Vec::new(),
            rejected_similarity: Vec::new(),
        }
    }
}

/// A cluster of similar events.
#[derive(Clone, Debug, Serialize)]
pub struct EventCluster {
    /// Cluster identifier.
    pub id: u32,

    /// Representative time (centroid).
    pub representative_time: f32,

    /// Number of members in the cluster.
    pub member_count: usize,

    /// Mean weight of cluster members.
    pub mean_weight: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_stream_id_uniqueness() {
        let id1 = EventStreamId::new();
        let id2 = EventStreamId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_event_creation() {
        let event = Event::new(1.5, 0.8);
        assert!((event.time - 1.5).abs() < 0.001);
        assert!((event.weight - 0.8).abs() < 0.001);
        assert!(event.cluster_id.is_none());
        assert!(event.beat_position.is_none());
    }

    #[test]
    fn test_event_with_beat_info() {
        let event = Event::with_beat_info(1.5, 0.8, 3.0, 0.25);
        assert!((event.beat_position.unwrap() - 3.0).abs() < 0.001);
        assert!((event.beat_phase.unwrap() - 0.25).abs() < 0.001);
    }

    #[test]
    fn test_event_builder_methods() {
        let event = Event::new(1.0, 0.5)
            .with_cluster(42)
            .with_source("peak");

        assert_eq!(event.cluster_id, Some(42));
        assert_eq!(event.source, Some("peak".to_string()));
    }

    #[test]
    fn test_event_stream_creation() {
        let events = vec![
            Event::new(0.5, 0.8),
            Event::new(1.0, 0.6),
            Event::new(1.5, 0.9),
        ];

        let stream = EventStream::new(
            events,
            "test signal".to_string(),
            PickEventsOptions::default(),
        );

        assert_eq!(stream.len(), 3);
        assert!(!stream.is_empty());
    }

    #[test]
    fn test_event_stream_sorts_events() {
        // Events out of order
        let events = vec![
            Event::new(1.5, 0.9),
            Event::new(0.5, 0.8),
            Event::new(1.0, 0.6),
        ];

        let stream = EventStream::new(
            events,
            "test".to_string(),
            PickEventsOptions::default(),
        );

        // Should be sorted by time
        assert!((stream.get(0).unwrap().time - 0.5).abs() < 0.001);
        assert!((stream.get(1).unwrap().time - 1.0).abs() < 0.001);
        assert!((stream.get(2).unwrap().time - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_event_stream_empty() {
        let stream = EventStream::empty();
        assert!(stream.is_empty());
        assert_eq!(stream.len(), 0);
        assert!(stream.time_span().is_none());
        assert!(stream.max_weight().is_none());
    }

    #[test]
    fn test_events_in_range() {
        let events = vec![
            Event::new(0.5, 0.8),
            Event::new(1.0, 0.6),
            Event::new(1.5, 0.9),
            Event::new(2.0, 0.7),
        ];

        let stream = EventStream::new(
            events,
            "test".to_string(),
            PickEventsOptions::default(),
        );

        let in_range: Vec<_> = stream.events_in_range(0.8, 1.8).collect();
        assert_eq!(in_range.len(), 2);
        assert!((in_range[0].time - 1.0).abs() < 0.001);
        assert!((in_range[1].time - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_nearest_event() {
        let events = vec![
            Event::new(0.5, 0.8),
            Event::new(1.0, 0.6),
            Event::new(2.0, 0.9),
        ];

        let stream = EventStream::new(
            events,
            "test".to_string(),
            PickEventsOptions::default(),
        );

        let nearest = stream.nearest_event(0.6).unwrap();
        assert!((nearest.time - 0.5).abs() < 0.001);

        let nearest = stream.nearest_event(1.6).unwrap();
        assert!((nearest.time - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_time_span() {
        let events = vec![
            Event::new(0.5, 0.8),
            Event::new(1.0, 0.6),
            Event::new(2.5, 0.9),
        ];

        let stream = EventStream::new(
            events,
            "test".to_string(),
            PickEventsOptions::default(),
        );

        let (start, end) = stream.time_span().unwrap();
        assert!((start - 0.5).abs() < 0.001);
        assert!((end - 2.5).abs() < 0.001);
    }

    #[test]
    fn test_max_min_weight() {
        let events = vec![
            Event::new(0.5, 0.3),
            Event::new(1.0, 0.9),
            Event::new(1.5, 0.6),
        ];

        let stream = EventStream::new(
            events,
            "test".to_string(),
            PickEventsOptions::default(),
        );

        assert!((stream.max_weight().unwrap() - 0.9).abs() < 0.001);
        assert!((stream.min_weight().unwrap() - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_pick_events_options_default() {
        let opts = PickEventsOptions::default();
        assert!((opts.hysteresis_beats - 0.25).abs() < 0.001);
        assert!((opts.target_density - 1.0).abs() < 0.001);
        assert!((opts.similarity_tolerance - 0.15).abs() < 0.001);
        assert!((opts.phase_bias - 0.0).abs() < 0.001);
        assert!(matches!(opts.weight_mode, WeightMode::PeakHeight));
        assert!((opts.min_threshold - 0.1).abs() < 0.001);
        assert!((opts.adaptive_factor - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_weight_mode_serialization() {
        let mode = WeightMode::IntegratedEnergy { window_beats: 0.5 };
        let json = serde_json::to_string(&mode).unwrap();
        assert!(json.contains("IntegratedEnergy"));
        assert!(json.contains("0.5"));

        let mode2: WeightMode = serde_json::from_str(&json).unwrap();
        assert_eq!(mode, mode2);
    }
}
