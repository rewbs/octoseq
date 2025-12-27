//! Debug marker system for visualizing events in the 3D scene.
//!
//! This module provides infrastructure for rendering debug markers that help
//! visualize event timing and distribution in the scene.

use crate::event_stream::EventStream;
use std::cell::RefCell;
use std::sync::Arc;

/// A single debug marker to be rendered in the scene.
#[derive(Debug, Clone)]
pub struct DebugMarker {
    /// World-space position of the marker
    pub position: [f32; 3],
    /// RGBA color of the marker
    pub color: [f32; 4],
    /// Size/radius of the marker
    pub size: f32,
    /// Time at which the marker should disappear (in beats)
    pub expire_at_beat: f32,
}

/// How markers should be spread in space when multiple events occur.
#[derive(Debug, Clone, Copy, Default)]
pub enum MarkerSpreadMode {
    /// Spread markers horizontally (along X axis)
    #[default]
    Horizontal,
    /// Spread markers vertically (along Y axis)
    Vertical,
    /// Spread markers along the time axis (Z axis)
    Time,
    /// No spread - all markers at origin
    None,
}

impl MarkerSpreadMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "horizontal" | "h" | "x" => MarkerSpreadMode::Horizontal,
            "vertical" | "v" | "y" => MarkerSpreadMode::Vertical,
            "time" | "t" | "z" => MarkerSpreadMode::Time,
            "none" | "n" => MarkerSpreadMode::None,
            _ => MarkerSpreadMode::default(),
        }
    }
}

/// Options for configuring debug marker display.
#[derive(Debug, Clone)]
pub struct ShowEventsOptions {
    /// RGBA color for the markers
    pub color: [f32; 4],
    /// Size of each marker
    pub size: f32,
    /// How long markers should remain visible (in beats)
    pub duration_beats: f32,
    /// How markers should be spread in space
    pub spread: MarkerSpreadMode,
    /// Spacing between markers when spread
    pub spread_spacing: f32,
}

impl Default for ShowEventsOptions {
    fn default() -> Self {
        Self {
            color: [1.0, 0.5, 0.0, 1.0], // Orange
            size: 0.05,
            duration_beats: 0.25,
            spread: MarkerSpreadMode::default(),
            spread_spacing: 0.1,
        }
    }
}

/// A request to show debug markers for a set of events.
#[derive(Debug, Clone)]
pub struct DebugMarkerRequest {
    pub events: Arc<EventStream>,
    pub options: ShowEventsOptions,
}

thread_local! {
    static PENDING_MARKER_REQUESTS: RefCell<Vec<DebugMarkerRequest>> = RefCell::new(Vec::new());
}

/// Add a marker request to be processed in the next frame.
pub fn add_marker_request(request: DebugMarkerRequest) {
    PENDING_MARKER_REQUESTS.with(|requests| {
        requests.borrow_mut().push(request);
    });
}

/// Take all pending marker requests, clearing the queue.
pub fn take_pending_requests() -> Vec<DebugMarkerRequest> {
    PENDING_MARKER_REQUESTS.with(|requests| std::mem::take(&mut *requests.borrow_mut()))
}

/// Manages debug markers for the visualiser.
#[derive(Debug, Default)]
pub struct DebugMarkerLayer {
    /// Currently active markers
    markers: Vec<DebugMarker>,
}

impl DebugMarkerLayer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get all currently active markers.
    pub fn markers(&self) -> &[DebugMarker] {
        &self.markers
    }

    /// Update markers: remove expired ones and add new ones from requests.
    pub fn update(&mut self, current_beat: f32, bpm: f32) {
        // Remove expired markers
        self.markers.retain(|m| m.expire_at_beat > current_beat);

        // Process pending requests
        let requests = take_pending_requests();
        for request in requests {
            Self::generate_markers_for_request(
                &mut self.markers,
                &request,
                current_beat,
                bpm,
            );
        }
    }

    /// Clear all markers.
    pub fn clear(&mut self) {
        self.markers.clear();
    }

    fn generate_markers_for_request(
        markers: &mut Vec<DebugMarker>,
        request: &DebugMarkerRequest,
        current_beat: f32,
        bpm: f32,
    ) {
        let events = &request.events.events;
        let options = &request.options;

        // Convert current beat position to time for comparison
        let seconds_per_beat = 60.0 / bpm;
        let lookback_seconds = options.duration_beats * seconds_per_beat;
        let current_time = current_beat * seconds_per_beat;

        // Find events within the lookback window
        let recent_events: Vec<_> = events
            .iter()
            .enumerate()
            .filter(|(_, e)| {
                let event_time = e.time;
                event_time <= current_time && event_time >= current_time - lookback_seconds
            })
            .collect();

        for (idx, event) in recent_events {
            let position = Self::calculate_marker_position(
                idx,
                events.len(),
                &options.spread,
                options.spread_spacing,
            );

            // Calculate remaining duration based on event age
            let event_age = current_time - event.time;
            let remaining_beats = options.duration_beats - (event_age / seconds_per_beat);

            if remaining_beats > 0.0 {
                // Scale alpha based on remaining time
                let alpha_scale = remaining_beats / options.duration_beats;
                let mut color = options.color;
                color[3] *= alpha_scale;

                markers.push(DebugMarker {
                    position,
                    color,
                    size: options.size * (0.5 + 0.5 * alpha_scale),
                    expire_at_beat: current_beat + remaining_beats,
                });
            }
        }
    }

    fn calculate_marker_position(
        index: usize,
        total: usize,
        spread: &MarkerSpreadMode,
        spacing: f32,
    ) -> [f32; 3] {
        let offset = if total > 1 {
            let normalized = (index as f32) / (total as f32 - 1.0) - 0.5;
            normalized * spacing * (total as f32 - 1.0)
        } else {
            0.0
        };

        match spread {
            MarkerSpreadMode::Horizontal => [offset, 0.5, 0.0],
            MarkerSpreadMode::Vertical => [0.0, 0.5 + offset, 0.0],
            MarkerSpreadMode::Time => [0.0, 0.5, offset],
            MarkerSpreadMode::None => [0.0, 0.5, 0.0],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_marker_spread_mode_from_str() {
        assert!(matches!(
            MarkerSpreadMode::from_str("horizontal"),
            MarkerSpreadMode::Horizontal
        ));
        assert!(matches!(
            MarkerSpreadMode::from_str("vertical"),
            MarkerSpreadMode::Vertical
        ));
        assert!(matches!(
            MarkerSpreadMode::from_str("time"),
            MarkerSpreadMode::Time
        ));
        assert!(matches!(
            MarkerSpreadMode::from_str("none"),
            MarkerSpreadMode::None
        ));
        assert!(matches!(
            MarkerSpreadMode::from_str("unknown"),
            MarkerSpreadMode::Horizontal
        ));
    }

    #[test]
    fn test_default_options() {
        let opts = ShowEventsOptions::default();
        assert_eq!(opts.color, [1.0, 0.5, 0.0, 1.0]);
        assert_eq!(opts.size, 0.05);
        assert_eq!(opts.duration_beats, 0.25);
    }

    #[test]
    fn test_debug_marker_layer_new() {
        let layer = DebugMarkerLayer::new();
        assert!(layer.markers().is_empty());
    }
}
