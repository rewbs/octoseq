//! Frequency band structures mirroring TypeScript definitions.
//!
//! This module provides Rust types that match the TypeScript FrequencyBandStructure
//! and related types from `packages/mir/src/types.ts`.
//!
//! Frequency bands are semantic regions of the frequency spectrum that can vary
//! over time. They are used for band-isolated analysis and processing.

use serde::{Deserialize, Serialize};

/// Time scope for a frequency band.
///
/// - Global: Band applies to entire track
/// - Sectioned: Band applies only to explicit start/end times
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FrequencyBandTimeScope {
    Global,
    #[serde(rename_all = "camelCase")]
    Sectioned {
        start_time: f32,
        end_time: f32,
    },
}

/// A single time segment of a piecewise-linear frequency range.
///
/// Segments define how the band's frequency boundaries vary over time.
/// Between segment boundaries, linear interpolation is used.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencySegment {
    /// Start time of this segment in seconds (inclusive).
    pub start_time: f32,
    /// End time of this segment in seconds (exclusive).
    pub end_time: f32,
    /// Lower frequency bound in Hz at segment start.
    pub low_hz_start: f32,
    /// Upper frequency bound in Hz at segment start.
    pub high_hz_start: f32,
    /// Lower frequency bound in Hz at segment end.
    pub low_hz_end: f32,
    /// Upper frequency bound in Hz at segment end.
    pub high_hz_end: f32,
}

impl FrequencySegment {
    /// Interpolate frequency bounds at a given time within this segment.
    ///
    /// Returns (low_hz, high_hz) tuple.
    /// If time is outside segment bounds, returns the nearest boundary values.
    pub fn interpolate_at(&self, time: f32) -> (f32, f32) {
        if time <= self.start_time {
            return (self.low_hz_start, self.high_hz_start);
        }
        if time >= self.end_time {
            return (self.low_hz_end, self.high_hz_end);
        }

        // Linear interpolation
        let t = (time - self.start_time) / (self.end_time - self.start_time);
        let low = self.low_hz_start + (self.low_hz_end - self.low_hz_start) * t;
        let high = self.high_hz_start + (self.high_hz_end - self.high_hz_start) * t;
        (low, high)
    }

    /// Check if a time falls within this segment's time range.
    pub fn contains_time(&self, time: f32) -> bool {
        time >= self.start_time && time < self.end_time
    }
}

/// Provenance metadata for a frequency band.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyBandProvenance {
    /// How this band was created ("manual", "imported", "preset").
    pub source: String,
    /// ISO timestamp when the band was created.
    pub created_at: String,
    /// Optional preset name if source is "preset".
    pub preset_name: Option<String>,
}

/// A frequency band definition.
///
/// Bands define semantic frequency regions for band-isolated analysis
/// (e.g., bass, mids, highs, or "kick-like", "snare-like").
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyBand {
    /// Unique identifier for this band.
    pub id: String,
    /// Human-readable label (editable).
    pub label: String,
    /// Whether the band is currently active for processing.
    pub enabled: bool,
    /// Time scope for this band.
    pub time_scope: FrequencyBandTimeScope,
    /// Piecewise-linear frequency shape over time.
    pub frequency_shape: Vec<FrequencySegment>,
    /// Stable sort order (not insertion order).
    pub sort_order: i32,
    /// Provenance metadata.
    pub provenance: FrequencyBandProvenance,
}

impl FrequencyBand {
    /// Check if this band is active at the given time.
    ///
    /// A band is active if:
    /// - It is enabled
    /// - The time falls within its time scope
    pub fn is_active_at(&self, time: f32) -> bool {
        if !self.enabled {
            return false;
        }
        match &self.time_scope {
            FrequencyBandTimeScope::Global => true,
            FrequencyBandTimeScope::Sectioned {
                start_time,
                end_time,
            } => time >= *start_time && time < *end_time,
        }
    }

    /// Get frequency bounds at a given time.
    ///
    /// Returns None if:
    /// - The band is not enabled
    /// - The time is outside the band's time scope
    /// - No frequency segment covers the given time
    pub fn frequency_bounds_at(&self, time: f32) -> Option<(f32, f32)> {
        if !self.is_active_at(time) {
            return None;
        }

        // Find the segment containing this time
        for seg in &self.frequency_shape {
            if seg.contains_time(time) {
                return Some(seg.interpolate_at(time));
            }
        }

        // Edge case: time exactly at end of last segment
        if let Some(last) = self.frequency_shape.last() {
            if (time - last.end_time).abs() < 0.001 {
                return Some((last.low_hz_end, last.high_hz_end));
            }
        }

        None
    }

    /// Find the segment containing a given time.
    pub fn segment_at(&self, time: f32) -> Option<&FrequencySegment> {
        self.frequency_shape.iter().find(|seg| seg.contains_time(time))
    }
}

/// The authoritative frequency band structure for a track.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyBandStructure {
    /// Schema version for future migrations.
    pub version: u32,
    /// Ordered list of frequency bands (by sortOrder).
    pub bands: Vec<FrequencyBand>,
    /// ISO timestamp when the structure was created.
    pub created_at: String,
    /// ISO timestamp when the structure was last modified.
    pub modified_at: String,
}

impl FrequencyBandStructure {
    /// Get all bands that are active at a given time.
    pub fn bands_active_at(&self, time: f32) -> Vec<&FrequencyBand> {
        self.bands.iter().filter(|b| b.is_active_at(time)).collect()
    }

    /// Get enabled bands sorted by sort_order.
    pub fn enabled_bands(&self) -> Vec<&FrequencyBand> {
        let mut bands: Vec<_> = self.bands.iter().filter(|b| b.enabled).collect();
        bands.sort_by_key(|b| b.sort_order);
        bands
    }

    /// Check if the structure is empty (no bands).
    pub fn is_empty(&self) -> bool {
        self.bands.is_empty()
    }

    /// Get a band by its ID.
    pub fn band_by_id(&self, id: &str) -> Option<&FrequencyBand> {
        self.bands.iter().find(|b| b.id == id)
    }

    /// Get all frequency bounds at a given time.
    ///
    /// Returns bounds for all active bands that have defined frequency
    /// at the given time.
    pub fn all_bounds_at(&self, time: f32) -> Vec<FrequencyBoundsAtTime> {
        self.bands
            .iter()
            .filter_map(|band| {
                band.frequency_bounds_at(time).map(|(low, high)| FrequencyBoundsAtTime {
                    band_id: band.id.clone(),
                    label: band.label.clone(),
                    low_hz: low,
                    high_hz: high,
                    enabled: band.enabled,
                })
            })
            .collect()
    }
}

impl Default for FrequencyBandStructure {
    fn default() -> Self {
        Self {
            version: 1,
            bands: Vec::new(),
            created_at: String::new(),
            modified_at: String::new(),
        }
    }
}

/// Computed frequency bounds at a given time.
///
/// Result of querying a band at a specific time point.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyBoundsAtTime {
    /// The band ID this belongs to.
    pub band_id: String,
    /// The band label.
    pub label: String,
    /// Lower frequency in Hz at this time.
    pub low_hz: f32,
    /// Upper frequency in Hz at this time.
    pub high_hz: f32,
    /// Whether the band is enabled.
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_segment() -> FrequencySegment {
        FrequencySegment {
            start_time: 0.0,
            end_time: 10.0,
            low_hz_start: 100.0,
            high_hz_start: 500.0,
            low_hz_end: 200.0,
            high_hz_end: 1000.0,
        }
    }

    fn make_constant_segment(low_hz: f32, high_hz: f32) -> FrequencySegment {
        FrequencySegment {
            start_time: 0.0,
            end_time: 60.0,
            low_hz_start: low_hz,
            high_hz_start: high_hz,
            low_hz_end: low_hz,
            high_hz_end: high_hz,
        }
    }

    fn make_test_band() -> FrequencyBand {
        FrequencyBand {
            id: "band-bass".to_string(),
            label: "Bass".to_string(),
            enabled: true,
            time_scope: FrequencyBandTimeScope::Global,
            frequency_shape: vec![make_constant_segment(20.0, 250.0)],
            sort_order: 0,
            provenance: FrequencyBandProvenance {
                source: "manual".to_string(),
                created_at: "2024-01-01T00:00:00Z".to_string(),
                preset_name: None,
            },
        }
    }

    #[test]
    fn test_frequency_interpolation_at_boundaries() {
        let seg = make_test_segment();

        // At start
        let (low, high) = seg.interpolate_at(0.0);
        assert!((low - 100.0).abs() < 0.01);
        assert!((high - 500.0).abs() < 0.01);

        // At end
        let (low, high) = seg.interpolate_at(10.0);
        assert!((low - 200.0).abs() < 0.01);
        assert!((high - 1000.0).abs() < 0.01);
    }

    #[test]
    fn test_frequency_interpolation_midpoint() {
        let seg = make_test_segment();

        // At midpoint (5.0 seconds)
        let (low, high) = seg.interpolate_at(5.0);
        // low should be 100 + (200-100) * 0.5 = 150
        assert!((low - 150.0).abs() < 0.01);
        // high should be 500 + (1000-500) * 0.5 = 750
        assert!((high - 750.0).abs() < 0.01);
    }

    #[test]
    fn test_frequency_interpolation_quarter() {
        let seg = make_test_segment();

        // At quarter point (2.5 seconds)
        let (low, high) = seg.interpolate_at(2.5);
        // low should be 100 + (200-100) * 0.25 = 125
        assert!((low - 125.0).abs() < 0.01);
        // high should be 500 + (1000-500) * 0.25 = 625
        assert!((high - 625.0).abs() < 0.01);
    }

    #[test]
    fn test_frequency_interpolation_outside_bounds() {
        let seg = make_test_segment();

        // Before segment start
        let (low, high) = seg.interpolate_at(-1.0);
        assert!((low - 100.0).abs() < 0.01);
        assert!((high - 500.0).abs() < 0.01);

        // After segment end
        let (low, high) = seg.interpolate_at(15.0);
        assert!((low - 200.0).abs() < 0.01);
        assert!((high - 1000.0).abs() < 0.01);
    }

    #[test]
    fn test_segment_contains_time() {
        let seg = make_test_segment();

        assert!(seg.contains_time(0.0));
        assert!(seg.contains_time(5.0));
        assert!(seg.contains_time(9.999));
        assert!(!seg.contains_time(10.0)); // exclusive end
        assert!(!seg.contains_time(-0.001));
    }

    #[test]
    fn test_band_is_active_at_global() {
        let band = make_test_band();

        assert!(band.is_active_at(0.0));
        assert!(band.is_active_at(30.0));
        assert!(band.is_active_at(1000.0));
    }

    #[test]
    fn test_band_is_active_at_sectioned() {
        let band = FrequencyBand {
            time_scope: FrequencyBandTimeScope::Sectioned {
                start_time: 10.0,
                end_time: 20.0,
            },
            ..make_test_band()
        };

        assert!(!band.is_active_at(5.0));
        assert!(band.is_active_at(10.0));
        assert!(band.is_active_at(15.0));
        assert!(!band.is_active_at(20.0)); // exclusive
        assert!(!band.is_active_at(25.0));
    }

    #[test]
    fn test_band_is_active_at_disabled() {
        let band = FrequencyBand {
            enabled: false,
            ..make_test_band()
        };

        assert!(!band.is_active_at(30.0));
    }

    #[test]
    fn test_band_frequency_bounds_at() {
        let band = make_test_band();

        let bounds = band.frequency_bounds_at(30.0);
        assert!(bounds.is_some());
        let (low, high) = bounds.unwrap();
        assert!((low - 20.0).abs() < 0.01);
        assert!((high - 250.0).abs() < 0.01);
    }

    #[test]
    fn test_band_frequency_bounds_at_outside_shape() {
        let band = make_test_band();

        // Time outside the frequency shape (60+ seconds)
        let bounds = band.frequency_bounds_at(100.0);
        assert!(bounds.is_none());
    }

    #[test]
    fn test_structure_bands_active_at() {
        let structure = FrequencyBandStructure {
            version: 1,
            bands: vec![
                make_test_band(),
                FrequencyBand {
                    id: "band-mids".to_string(),
                    label: "Mids".to_string(),
                    enabled: true,
                    time_scope: FrequencyBandTimeScope::Sectioned {
                        start_time: 10.0,
                        end_time: 50.0,
                    },
                    frequency_shape: vec![FrequencySegment {
                        start_time: 10.0,
                        end_time: 50.0,
                        low_hz_start: 250.0,
                        high_hz_start: 2000.0,
                        low_hz_end: 250.0,
                        high_hz_end: 2000.0,
                    }],
                    sort_order: 1,
                    provenance: FrequencyBandProvenance {
                        source: "manual".to_string(),
                        created_at: "2024-01-01T00:00:00Z".to_string(),
                        preset_name: None,
                    },
                },
            ],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            modified_at: "2024-01-01T00:00:00Z".to_string(),
        };

        // At 5 seconds: only bass (global) is active
        let active = structure.bands_active_at(5.0);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "band-bass");

        // At 30 seconds: both are active
        let active = structure.bands_active_at(30.0);
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn test_structure_all_bounds_at() {
        let structure = FrequencyBandStructure {
            version: 1,
            bands: vec![make_test_band()],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            modified_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let bounds = structure.all_bounds_at(30.0);
        assert_eq!(bounds.len(), 1);
        assert_eq!(bounds[0].band_id, "band-bass");
        assert!((bounds[0].low_hz - 20.0).abs() < 0.01);
        assert!((bounds[0].high_hz - 250.0).abs() < 0.01);
    }

    #[test]
    fn test_deserialize_from_json() {
        let json = r#"{
            "version": 1,
            "bands": [{
                "id": "band-test",
                "label": "Test Band",
                "enabled": true,
                "timeScope": { "kind": "global" },
                "frequencyShape": [{
                    "startTime": 0.0,
                    "endTime": 60.0,
                    "lowHzStart": 100.0,
                    "highHzStart": 500.0,
                    "lowHzEnd": 100.0,
                    "highHzEnd": 500.0
                }],
                "sortOrder": 0,
                "provenance": {
                    "source": "manual",
                    "createdAt": "2024-01-01T00:00:00Z"
                }
            }],
            "createdAt": "2024-01-01T00:00:00Z",
            "modifiedAt": "2024-01-01T00:00:00Z"
        }"#;

        let structure: FrequencyBandStructure = serde_json::from_str(json).unwrap();

        assert_eq!(structure.version, 1);
        assert_eq!(structure.bands.len(), 1);

        let band = &structure.bands[0];
        assert_eq!(band.id, "band-test");
        assert_eq!(band.label, "Test Band");
        assert!(band.enabled);
        assert!(matches!(band.time_scope, FrequencyBandTimeScope::Global));
        assert_eq!(band.frequency_shape.len(), 1);
    }

    #[test]
    fn test_deserialize_sectioned_band() {
        let json = r#"{
            "version": 1,
            "bands": [{
                "id": "band-sectioned",
                "label": "Sectioned Band",
                "enabled": true,
                "timeScope": {
                    "kind": "sectioned",
                    "startTime": 10.0,
                    "endTime": 30.0
                },
                "frequencyShape": [{
                    "startTime": 10.0,
                    "endTime": 30.0,
                    "lowHzStart": 200.0,
                    "highHzStart": 800.0,
                    "lowHzEnd": 300.0,
                    "highHzEnd": 1200.0
                }],
                "sortOrder": 1,
                "provenance": {
                    "source": "preset",
                    "createdAt": "2024-01-01T00:00:00Z",
                    "presetName": "Sweep Band"
                }
            }],
            "createdAt": "2024-01-01T00:00:00Z",
            "modifiedAt": "2024-01-01T00:00:00Z"
        }"#;

        let structure: FrequencyBandStructure = serde_json::from_str(json).unwrap();
        let band = &structure.bands[0];

        match &band.time_scope {
            FrequencyBandTimeScope::Sectioned {
                start_time,
                end_time,
            } => {
                assert!((*start_time - 10.0).abs() < 0.01);
                assert!((*end_time - 30.0).abs() < 0.01);
            }
            _ => panic!("Expected sectioned time scope"),
        }

        assert_eq!(band.provenance.preset_name, Some("Sweep Band".to_string()));
    }
}
