//! Event extraction from signals.
//!
//! This module implements the peak picking pipeline that transforms continuous
//! signals into discrete EventStreams. The pipeline operates with whole-track
//! visibility and applies musically-aware constraints.
//!
//! # Pipeline Stages
//!
//! 1. **Evaluate Signal Grid**: Sample source signal at analysis resolution
//! 2. **Compute Adaptive Threshold**: `threshold = mean + adaptive_factor * std`
//! 3. **Find Candidates**: Local maxima above threshold
//! 4. **Apply Hysteresis**: Beat-aware suppression of nearby peaks
//! 5. **Cluster Similar Peaks**: Group by amplitude similarity
//! 6. **Apply Density Constraint**: Soft limit per beat window
//! 7. **Apply Phase Bias**: Adjust weights based on beat position
//! 8. **Normalize Weights**: Scale to 0-1

use std::collections::HashMap;

use crate::event_stream::{
    Event, EventCluster, EventExtractionDebug, EventStream, PickEventsOptions, WeightMode,
};
use crate::input::InputSignal;
use crate::musical_time::{MusicalTimeStructure, DEFAULT_BPM};
use crate::signal::Signal;
use crate::signal_eval::EvalContext;
use crate::signal_state::SignalState;
use crate::signal_stats::StatisticsCache;

/// Event extractor that transforms signals into EventStreams.
pub struct EventExtractor {
    source: Signal,
    options: PickEventsOptions,
    musical_time: Option<MusicalTimeStructure>,
    duration: f32,
    time_step: f32,
    collect_debug: bool,
    /// Band-scoped input signals (optional).
    band_signals: HashMap<String, HashMap<String, InputSignal>>,
    /// Stem-scoped input signals (optional).
    stem_signals: HashMap<String, HashMap<String, InputSignal>>,
}

impl EventExtractor {
    /// Create a new event extractor.
    pub fn new(
        source: Signal,
        options: PickEventsOptions,
        musical_time: Option<&MusicalTimeStructure>,
        duration: f32,
        time_step: f32,
    ) -> Self {
        Self {
            source,
            options,
            musical_time: musical_time.cloned(),
            duration,
            time_step,
            collect_debug: false,
            band_signals: HashMap::new(),
            stem_signals: HashMap::new(),
        }
    }

    /// Set band-scoped input signals for evaluation.
    pub fn with_band_signals(
        mut self,
        band_signals: HashMap<String, HashMap<String, InputSignal>>,
    ) -> Self {
        self.band_signals = band_signals;
        self
    }

    /// Set stem-scoped input signals for evaluation.
    pub fn with_stem_signals(
        mut self,
        stem_signals: HashMap<String, HashMap<String, InputSignal>>,
    ) -> Self {
        self.stem_signals = stem_signals;
        self
    }

    /// Enable debug data collection.
    pub fn with_debug(mut self) -> Self {
        self.collect_debug = true;
        self
    }

    /// Extract events from the signal.
    ///
    /// Returns the EventStream and optionally debug data if enabled.
    pub fn extract(
        &self,
        signals: &HashMap<String, InputSignal>,
    ) -> Result<(EventStream, Option<EventExtractionDebug>), String> {
        // Step 1: Evaluate signal across time grid
        let (times, values) = self.evaluate_signal_grid(signals)?;

        if values.is_empty() {
            return Ok((EventStream::empty(), None));
        }

        // Step 2: Compute adaptive threshold
        let threshold = self.compute_threshold(&values);

        // Step 3: Find raw candidates
        let raw_candidates = self.find_candidates(&times, &values, threshold);

        // Initialize debug if enabled
        let mut debug = if self.collect_debug {
            Some(EventExtractionDebug {
                raw_candidates: raw_candidates.clone(),
                ..Default::default()
            })
        } else {
            None
        };

        // Step 4: Apply hysteresis
        let post_hysteresis = self.apply_hysteresis(&raw_candidates);
        if let Some(ref mut d) = debug {
            d.post_hysteresis = post_hysteresis.clone();
        }

        // Step 5: Cluster similar peaks
        let (clustered, clusters, rejected_similarity) = self.cluster_similar(&post_hysteresis);
        if let Some(ref mut d) = debug {
            d.clusters = clusters;
            d.rejected_similarity = rejected_similarity;
        }

        // Step 6: Apply density constraint
        let (density_filtered, rejected_density) = self.apply_density_constraint(&clustered);
        if let Some(ref mut d) = debug {
            d.rejected_density = rejected_density;
        }

        // Step 7: Apply phase bias
        let phase_adjusted = self.apply_phase_bias(&density_filtered);

        // Step 8: Assign final weights
        let weighted = self.assign_weights(&phase_adjusted, &values, &times);

        // Step 9: Normalize weights
        let final_events = self.normalize_weights(weighted);

        if let Some(ref mut d) = debug {
            d.accepted = final_events.clone();
        }

        let stream = EventStream::new(
            final_events,
            format!("{:?}", self.source),
            self.options.clone(),
        );

        Ok((stream, debug))
    }

    /// Evaluate the source signal across the entire time grid.
    fn evaluate_signal_grid(
        &self,
        signals: &HashMap<String, InputSignal>,
    ) -> Result<(Vec<f32>, Vec<f32>), String> {
        let step_count = ((self.duration / self.time_step).ceil() as usize).max(1);
        let mut times = Vec::with_capacity(step_count);
        let mut values = Vec::with_capacity(step_count);

        // Create evaluation context components
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();
        // Custom signals not yet supported in event extractor
        let empty_custom_signals: std::collections::HashMap<String, crate::input::InputSignal> =
            std::collections::HashMap::new();

        for i in 0..step_count {
            let t = i as f32 * self.time_step;
            times.push(t);

            let mut ctx = EvalContext::new(
                t,
                self.time_step,
                i as u64,
                self.musical_time.as_ref(),
                signals,
                &self.band_signals,
                &self.stem_signals,
                &empty_custom_signals,
                &stats,
                &mut state,
            );

            let value = self.source.evaluate(&mut ctx);
            values.push(value);
        }

        Ok((times, values))
    }

    /// Compute adaptive threshold from signal statistics.
    fn compute_threshold(&self, values: &[f32]) -> f32 {
        if values.is_empty() {
            return self.options.min_threshold;
        }

        let n = values.len() as f32;

        // Compute mean
        let mean: f32 = values.iter().sum::<f32>() / n;

        // Compute standard deviation
        let variance: f32 = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n;
        let std = variance.sqrt();

        // Adaptive threshold
        let threshold = mean + self.options.adaptive_factor * std;

        // Ensure minimum threshold
        threshold.max(self.options.min_threshold)
    }

    /// Find local maxima candidates above threshold.
    fn find_candidates(&self, times: &[f32], values: &[f32], threshold: f32) -> Vec<Event> {
        let mut candidates = Vec::new();

        if values.len() < 3 {
            return candidates;
        }

        for i in 1..values.len() - 1 {
            let value = values[i];
            let prev = values[i - 1];
            let next = values[i + 1];

            // Strict local maximum check
            if value > prev && value > next && value >= threshold {
                let time = times[i];

                // Get beat information if available
                let (beat_position, beat_phase) = self.get_beat_info(time);

                let event = Event {
                    time,
                    weight: value,
                    cluster_id: None,
                    source: Some("raw_peak".to_string()),
                    beat_position,
                    beat_phase,
                };

                candidates.push(event);
            }
        }

        candidates
    }

    /// Get beat position and phase at a given time.
    fn get_beat_info(&self, time: f32) -> (Option<f32>, Option<f32>) {
        if let Some(ref mt) = self.musical_time {
            if let Some(bp) = mt.beat_position_at(time) {
                return (Some(bp.beat_position), Some(bp.beat_phase));
            }
        }

        // Fall back to default BPM if no musical time
        let default_beat_pos = time * DEFAULT_BPM / 60.0;
        let beat_phase = default_beat_pos.fract();
        (Some(default_beat_pos), Some(beat_phase))
    }

    /// Get BPM at a given time.
    fn get_bpm_at(&self, time: f32) -> f32 {
        if let Some(ref mt) = self.musical_time {
            mt.bpm_at(time).unwrap_or(DEFAULT_BPM)
        } else {
            DEFAULT_BPM
        }
    }

    /// Convert beats to seconds using BPM at a given time.
    fn beats_to_seconds(&self, beats: f32, time: f32) -> f32 {
        let bpm = self.get_bpm_at(time);
        beats * 60.0 / bpm
    }

    /// Apply beat-aware hysteresis to suppress nearby peaks.
    ///
    /// If multiple peaks occur within `hysteresis_beats` of each other,
    /// only the strongest is kept.
    fn apply_hysteresis(&self, candidates: &[Event]) -> Vec<Event> {
        if candidates.is_empty() {
            return Vec::new();
        }

        let mut result: Vec<Event> = Vec::new();
        let hysteresis_beats = self.options.hysteresis_beats;

        for candidate in candidates {
            let beat_pos = candidate.beat_position.unwrap_or_else(|| {
                // Fall back to time-based calculation
                candidate.time * DEFAULT_BPM / 60.0
            });

            if result.is_empty() {
                result.push(candidate.clone());
                continue;
            }

            let last = result.last().unwrap();
            let last_beat_pos = last.beat_position.unwrap_or_else(|| {
                last.time * DEFAULT_BPM / 60.0
            });

            let beat_diff = beat_pos - last_beat_pos;

            if beat_diff >= hysteresis_beats {
                // Outside hysteresis window - accept
                result.push(candidate.clone());
            } else if candidate.weight > last.weight {
                // Within window but stronger - replace
                *result.last_mut().unwrap() = candidate.clone();
            }
            // Otherwise: within window and weaker - ignore
        }

        result
    }

    /// Cluster similar peaks together.
    ///
    /// Peaks are considered similar if their weights are within `similarity_tolerance`
    /// of each other. The cluster representative is the centroid.
    ///
    /// Returns: (clustered events, cluster info, rejected events)
    fn cluster_similar(
        &self,
        events: &[Event],
    ) -> (Vec<Event>, Vec<EventCluster>, Vec<Event>) {
        if events.is_empty() {
            return (Vec::new(), Vec::new(), Vec::new());
        }

        let tolerance = self.options.similarity_tolerance;

        // Sort by weight descending to process strongest first
        let mut sorted: Vec<_> = events.iter().cloned().collect();
        sorted.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));

        struct Cluster {
            members: Vec<Event>,
            centroid_time: f32,
            mean_weight: f32,
        }

        let mut clusters: Vec<Cluster> = Vec::new();
        let mut rejected: Vec<Event> = Vec::new();

        for event in sorted {
            let mut found_cluster = false;

            for cluster in clusters.iter_mut() {
                // Check similarity: weight ratio and time proximity
                let weight_ratio = event.weight.min(cluster.mean_weight)
                    / event.weight.max(cluster.mean_weight);

                // Beat-based time proximity (within 0.5 beats)
                let event_beat = event.beat_position.unwrap_or(event.time * 2.0);
                let cluster_beat = cluster.members.first()
                    .and_then(|e| e.beat_position)
                    .unwrap_or(cluster.centroid_time * 2.0);
                let beat_diff = (event_beat - cluster_beat).abs();

                if weight_ratio >= (1.0 - tolerance) && beat_diff < 0.5 {
                    // Similar enough - add to cluster
                    cluster.members.push(event.clone());

                    // Update centroid
                    let n = cluster.members.len() as f32;
                    cluster.centroid_time = cluster.members.iter().map(|e| e.time).sum::<f32>() / n;
                    cluster.mean_weight = cluster.members.iter().map(|e| e.weight).sum::<f32>() / n;

                    // Track as rejected (merged into cluster)
                    rejected.push(event.clone());
                    found_cluster = true;
                    break;
                }
            }

            if !found_cluster {
                // Create new cluster
                let event_time = event.time;
                let event_weight = event.weight;
                clusters.push(Cluster {
                    members: vec![event],
                    centroid_time: event_time,
                    mean_weight: event_weight,
                });
            }
        }

        // Convert clusters to events and info
        let mut clustered_events: Vec<Event> = Vec::new();
        let mut cluster_info: Vec<EventCluster> = Vec::new();

        for (i, cluster) in clusters.iter().enumerate() {
            let cluster_id = i as u32;

            // Create representative event at centroid
            let (beat_pos, beat_phase) = self.get_beat_info(cluster.centroid_time);

            clustered_events.push(Event {
                time: cluster.centroid_time,
                weight: cluster.mean_weight,
                cluster_id: Some(cluster_id),
                source: Some("clustered".to_string()),
                beat_position: beat_pos,
                beat_phase: beat_phase,
            });

            cluster_info.push(EventCluster {
                id: cluster_id,
                representative_time: cluster.centroid_time,
                member_count: cluster.members.len(),
                mean_weight: cluster.mean_weight,
            });
        }

        // Sort by time
        clustered_events.sort_by(|a, b| {
            a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal)
        });

        (clustered_events, cluster_info, rejected)
    }

    /// Apply soft density constraint.
    ///
    /// Groups events by 4-beat windows and keeps the strongest events up to
    /// the target density, plus any similar events.
    ///
    /// Returns: (kept events, rejected events)
    fn apply_density_constraint(&self, events: &[Event]) -> (Vec<Event>, Vec<Event>) {
        if events.is_empty() {
            return (Vec::new(), Vec::new());
        }

        let target_density = self.options.target_density;
        let tolerance = self.options.similarity_tolerance;
        let window_beats = 4.0; // 4-beat windows

        // Group events by beat window
        let mut windows: HashMap<i32, Vec<Event>> = HashMap::new();

        for event in events {
            let beat_pos = event.beat_position.unwrap_or(event.time * 2.0);
            let window_idx = (beat_pos / window_beats).floor() as i32;
            windows.entry(window_idx).or_default().push(event.clone());
        }

        let mut kept: Vec<Event> = Vec::new();
        let mut rejected: Vec<Event> = Vec::new();

        for (_window_idx, mut window_events) in windows {
            let target_count = (target_density * window_beats).ceil() as usize;

            if window_events.len() <= target_count {
                // Under target - keep all
                kept.extend(window_events);
            } else {
                // Over target - keep strongest, plus similar ones
                window_events.sort_by(|a, b| {
                    b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal)
                });

                let mut window_kept: Vec<Event> = Vec::new();

                for event in window_events {
                    if window_kept.len() < target_count {
                        // Under target - keep
                        window_kept.push(event);
                    } else {
                        // Over target - check if similar to any kept event
                        let has_similar = window_kept.iter().any(|k| {
                            let ratio = event.weight.min(k.weight) / event.weight.max(k.weight);
                            ratio >= (1.0 - tolerance)
                        });

                        if has_similar {
                            // Preserve similar peaks
                            window_kept.push(event);
                        } else {
                            rejected.push(event);
                        }
                    }
                }

                kept.extend(window_kept);
            }
        }

        // Sort by time
        kept.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));

        (kept, rejected)
    }

    /// Apply phase bias to adjust weights.
    ///
    /// Events closer to integer beat positions get higher weights.
    /// This influences selection but never removes events.
    fn apply_phase_bias(&self, events: &[Event]) -> Vec<Event> {
        let bias = self.options.phase_bias;

        if bias <= 0.0 {
            return events.to_vec();
        }

        events
            .iter()
            .map(|e| {
                let phase = e.beat_phase.unwrap_or(0.0);

                // Distance to nearest beat (0 = on beat, 0.5 = maximally off beat)
                let on_beat_distance = phase.min(1.0 - phase);

                // Cosine-based bias factor (1.0 on beat, lower off beat)
                let phase_factor = (on_beat_distance * std::f32::consts::PI).cos();
                let phase_factor = (phase_factor + 1.0) / 2.0; // Map to 0-1

                // Blend original weight with phase-biased weight
                let adjusted_weight = e.weight * (1.0 - bias + bias * phase_factor);

                Event {
                    weight: adjusted_weight,
                    ..e.clone()
                }
            })
            .collect()
    }

    /// Assign final weights based on weight mode.
    fn assign_weights(
        &self,
        events: &[Event],
        values: &[f32],
        times: &[f32],
    ) -> Vec<Event> {
        match &self.options.weight_mode {
            WeightMode::PeakHeight => {
                // Already using peak height
                events.to_vec()
            }
            WeightMode::IntegratedEnergy { window_beats } => {
                // Integrate signal energy around each event
                events
                    .iter()
                    .map(|e| {
                        let window_sec = self.beats_to_seconds(*window_beats, e.time);
                        let half_window = window_sec / 2.0;

                        let start_time = (e.time - half_window).max(0.0);
                        let end_time = (e.time + half_window).min(self.duration);

                        // Sum squared values in window
                        let mut energy = 0.0;
                        let mut count = 0;

                        for (i, &t) in times.iter().enumerate() {
                            if t >= start_time && t <= end_time {
                                energy += values[i] * values[i];
                                count += 1;
                            }
                        }

                        let integrated = if count > 0 {
                            (energy / count as f32).sqrt()
                        } else {
                            e.weight
                        };

                        Event {
                            weight: integrated,
                            ..e.clone()
                        }
                    })
                    .collect()
            }
        }
    }

    /// Normalize weights to 0-1 range.
    fn normalize_weights(&self, mut events: Vec<Event>) -> Vec<Event> {
        if events.is_empty() {
            return events;
        }

        let max_weight = events
            .iter()
            .map(|e| e.weight)
            .fold(f32::NEG_INFINITY, f32::max);

        let min_weight = events
            .iter()
            .map(|e| e.weight)
            .fold(f32::INFINITY, f32::min);

        let range = max_weight - min_weight;

        if range > 0.0 {
            for event in events.iter_mut() {
                event.weight = (event.weight - min_weight) / range;
            }
        } else {
            // All same weight - normalize to 1.0
            for event in events.iter_mut() {
                event.weight = 1.0;
            }
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::Signal;

    fn make_test_signal(values: Vec<f32>, sample_rate: f32) -> HashMap<String, InputSignal> {
        let mut signals = HashMap::new();
        signals.insert("test".to_string(), InputSignal::new(values, sample_rate));
        signals
    }

    #[test]
    fn test_empty_signal() {
        let signals = HashMap::new();
        let signal = Signal::input("test");
        let options = PickEventsOptions::default();

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01);
        let (stream, _) = extractor.extract(&signals).unwrap();

        assert!(stream.is_empty());
    }

    #[test]
    fn test_single_peak() {
        // Signal with a single triangular peak at 0.5s
        // Uses a clear peak shape (not a plateau)
        let values: Vec<f32> = (0..100)
            .map(|i| {
                let t = i as f32 / 100.0;
                // Triangular peak centered at 0.5
                let dist = (t - 0.5).abs();
                if dist < 0.1 {
                    1.0 - dist * 5.0 // Peaks at 1.0, slopes down
                } else {
                    0.1
                }
            })
            .collect();

        let signals = make_test_signal(values, 100.0);
        let signal = Signal::input("test");
        let options = PickEventsOptions {
            min_threshold: 0.0,
            adaptive_factor: 0.0,
            ..Default::default()
        };

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01);
        let (stream, _) = extractor.extract(&signals).unwrap();

        assert_eq!(stream.len(), 1);
        assert!((stream.get(0).unwrap().time - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_multiple_peaks() {
        // Signal with triangular peaks at 0.25s, 0.5s, 0.75s
        fn triangular_peak(t: f32, center: f32) -> f32 {
            let dist = (t - center).abs();
            if dist < 0.05 {
                1.0 - dist * 10.0 // Sharp triangular peak
            } else {
                0.0
            }
        }

        let values: Vec<f32> = (0..100)
            .map(|i| {
                let t = i as f32 / 100.0;
                let p1 = triangular_peak(t, 0.25);
                let p2 = triangular_peak(t, 0.50);
                let p3 = triangular_peak(t, 0.75);
                0.1 + p1.max(p2).max(p3)
            })
            .collect();

        let signals = make_test_signal(values, 100.0);
        // Use interpolate() for peak detection tests since we want exact signal values
        let signal = Signal::input("test").interpolate();
        let options = PickEventsOptions {
            min_threshold: 0.0,
            adaptive_factor: 0.0,
            hysteresis_beats: 0.1, // Very short hysteresis
            ..Default::default()
        };

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01);
        let (stream, _) = extractor.extract(&signals).unwrap();

        // Should have 3 peaks
        assert_eq!(stream.len(), 3);
    }

    #[test]
    fn test_hysteresis_suppression() {
        // Two triangular peaks close together at 0.50s and 0.55s
        let values: Vec<f32> = (0..100)
            .map(|i| {
                let t = i as f32 / 100.0;
                // First peak at 0.50
                let dist1 = (t - 0.50).abs();
                let p1 = if dist1 < 0.02 { 1.0 - dist1 * 25.0 } else { 0.0 };
                // Second peak at 0.55 (slightly weaker)
                let dist2 = (t - 0.55).abs();
                let p2 = if dist2 < 0.02 { 0.9 - dist2 * 25.0 } else { 0.0 };
                0.1 + p1.max(0.0).max(p2.max(0.0))
            })
            .collect();

        let signals = make_test_signal(values, 100.0);
        // Use interpolate() for peak detection tests since we want exact signal values
        let signal = Signal::input("test").interpolate();
        let options = PickEventsOptions {
            min_threshold: 0.0,
            adaptive_factor: 0.0,
            hysteresis_beats: 0.5, // 0.25s at 120 BPM
            ..Default::default()
        };

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01);
        let (stream, _) = extractor.extract(&signals).unwrap();

        // Should have only 1 peak (second suppressed by hysteresis)
        assert_eq!(stream.len(), 1);
    }

    #[test]
    fn test_phase_bias() {
        let events = vec![
            Event::with_beat_info(0.5, 0.8, 1.0, 0.0),  // On beat
            Event::with_beat_info(0.75, 0.8, 1.5, 0.5), // Off beat
        ];

        let options = PickEventsOptions {
            phase_bias: 0.5,
            ..Default::default()
        };

        let extractor = EventExtractor::new(
            Signal::constant(0.0),
            options,
            None,
            1.0,
            0.01,
        );

        let adjusted = extractor.apply_phase_bias(&events);

        // On-beat event should have higher weight than off-beat
        assert!(adjusted[0].weight > adjusted[1].weight);
    }

    #[test]
    fn test_weight_normalization() {
        let events = vec![
            Event::new(0.5, 0.5),
            Event::new(1.0, 1.0),
            Event::new(1.5, 0.75),
        ];

        let extractor = EventExtractor::new(
            Signal::constant(0.0),
            PickEventsOptions::default(),
            None,
            1.0,
            0.01,
        );

        let normalized = extractor.normalize_weights(events);

        // Should be normalized to 0-1
        assert!((normalized[0].weight - 0.0).abs() < 0.001); // min -> 0
        assert!((normalized[1].weight - 1.0).abs() < 0.001); // max -> 1
        assert!((normalized[2].weight - 0.5).abs() < 0.001); // mid -> 0.5
    }

    #[test]
    fn test_extraction_determinism() {
        let values: Vec<f32> = (0..100)
            .map(|i| {
                let t = i as f32 / 100.0;
                (t * 10.0).sin().abs()
            })
            .collect();

        let signals = make_test_signal(values, 100.0);
        let signal = Signal::input("test");
        let options = PickEventsOptions::default();

        let extractor = EventExtractor::new(signal.clone(), options.clone(), None, 1.0, 0.01);
        let (stream1, _) = extractor.extract(&signals).unwrap();

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01);
        let (stream2, _) = extractor.extract(&signals).unwrap();

        // Should produce identical results
        assert_eq!(stream1.len(), stream2.len());
        for (e1, e2) in stream1.iter().zip(stream2.iter()) {
            assert!((e1.time - e2.time).abs() < 0.0001);
            assert!((e1.weight - e2.weight).abs() < 0.0001);
        }
    }

    #[test]
    fn test_debug_collection() {
        // Triangular peak at 0.5s
        let values: Vec<f32> = (0..100)
            .map(|i| {
                let t = i as f32 / 100.0;
                let dist = (t - 0.5).abs();
                if dist < 0.1 {
                    1.0 - dist * 5.0
                } else {
                    0.1
                }
            })
            .collect();

        let signals = make_test_signal(values, 100.0);
        let signal = Signal::input("test");
        let options = PickEventsOptions {
            min_threshold: 0.0,
            adaptive_factor: 0.0,
            ..Default::default()
        };

        let extractor = EventExtractor::new(signal, options, None, 1.0, 0.01).with_debug();
        let (_, debug) = extractor.extract(&signals).unwrap();

        let debug = debug.unwrap();
        assert!(!debug.raw_candidates.is_empty());
        assert!(!debug.accepted.is_empty());
    }

    #[test]
    fn test_similarity_clustering() {
        // Two very similar peaks
        let events = vec![
            Event::with_beat_info(0.5, 0.80, 1.0, 0.0),
            Event::with_beat_info(0.52, 0.79, 1.04, 0.04), // Similar weight, close in time
            Event::with_beat_info(1.0, 0.50, 2.0, 0.0),     // Different weight
        ];

        let options = PickEventsOptions {
            similarity_tolerance: 0.15,
            ..Default::default()
        };

        let extractor = EventExtractor::new(
            Signal::constant(0.0),
            options,
            None,
            2.0,
            0.01,
        );

        let (clustered, clusters, _rejected) = extractor.cluster_similar(&events);

        // First two should be clustered together
        assert_eq!(clustered.len(), 2); // Two clusters
        assert_eq!(clusters.len(), 2);

        // One cluster should have 2 members
        let multi_member_cluster = clusters.iter().find(|c| c.member_count > 1);
        assert!(multi_member_cluster.is_some());
    }

    #[test]
    fn test_density_constraint() {
        // Many peaks in a short window
        let events: Vec<_> = (0..10)
            .map(|i| {
                let t = i as f32 * 0.1;
                let beat = t * 2.0; // 120 BPM
                Event::with_beat_info(t, 0.8 + (i as f32 * 0.02), beat, beat.fract())
            })
            .collect();

        let options = PickEventsOptions {
            target_density: 1.0, // 1 per beat = 4 per window
            similarity_tolerance: 0.01, // Low tolerance
            ..Default::default()
        };

        let extractor = EventExtractor::new(
            Signal::constant(0.0),
            options,
            None,
            2.0,
            0.01,
        );

        let (kept, rejected) = extractor.apply_density_constraint(&events);

        // Should have kept some and rejected some
        assert!(kept.len() < events.len());
        assert!(!rejected.is_empty());
    }
}
