//! Musical time structures mirroring TypeScript definitions.
//!
//! This module provides Rust types that match the TypeScript MusicalTimeStructure
//! and related types from `packages/mir/src/types.ts`.

use serde::Deserialize;

/// The authoritative musical time structure for a track.
///
/// This is the Rust equivalent of the TypeScript `MusicalTimeStructure` type.
/// It is deserialized from JSON passed via WASM.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicalTimeStructure {
    /// Schema version for future migrations.
    pub version: u32,

    /// Ordered list of musical time segments (by startTime ascending).
    pub segments: Vec<MusicalTimeSegment>,

    /// ISO timestamp when the structure was created.
    pub created_at: String,

    /// ISO timestamp when the structure was last modified.
    pub modified_at: String,
}

impl MusicalTimeStructure {
    /// Find the segment containing the given time.
    pub fn segment_at(&self, time: f32) -> Option<&MusicalTimeSegment> {
        self.segments
            .iter()
            .find(|seg| time >= seg.start_time && time < seg.end_time)
    }

    /// Get the BPM at a given time, or None if no segment covers that time.
    pub fn bpm_at(&self, time: f32) -> Option<f32> {
        self.segment_at(time).map(|seg| seg.bpm)
    }

    /// Compute the beat position at a given time.
    ///
    /// Returns None if no segment covers that time.
    pub fn beat_position_at(&self, time: f32) -> Option<BeatPosition> {
        let segment = self.segment_at(time)?;
        Some(segment.beat_position_at(time))
    }

    /// Check if the structure has any segments.
    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }
}

impl Default for MusicalTimeStructure {
    fn default() -> Self {
        Self {
            version: 1,
            segments: Vec::new(),
            created_at: String::new(),
            modified_at: String::new(),
        }
    }
}

/// A single segment of musical time with explicit boundaries.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicalTimeSegment {
    /// Unique identifier for this segment.
    pub id: String,

    /// Tempo in beats per minute.
    pub bpm: f32,

    /// Phase offset in seconds - first beat time relative to segment start.
    pub phase_offset: f32,

    /// Segment start boundary in seconds (inclusive).
    pub start_time: f32,

    /// Segment end boundary in seconds (exclusive).
    pub end_time: f32,

    /// Confidence score frozen at lock time (optional, for display).
    pub confidence: Option<f32>,

    /// Provenance metadata.
    pub provenance: MusicalTimeProvenance,
}

impl MusicalTimeSegment {
    /// Compute the beat position at a given time within this segment.
    pub fn beat_position_at(&self, time: f32) -> BeatPosition {
        let period = 60.0 / self.bpm;
        let beats_from_phase = (time - self.phase_offset) / period;

        let beat_index = beats_from_phase.floor() as i32;
        let beat_phase = beats_from_phase.fract();

        // Handle negative phase (before first beat)
        let (beat_index, beat_phase) = if beat_phase < 0.0 {
            (beat_index - 1, beat_phase + 1.0)
        } else {
            (beat_index, beat_phase)
        };

        BeatPosition {
            segment_id: self.id.clone(),
            beat_index,
            beat_phase,
            beat_position: beats_from_phase,
            bpm: self.bpm,
        }
    }

    /// Convert a duration in beats to seconds using this segment's BPM.
    pub fn beats_to_seconds(&self, beats: f32) -> f32 {
        beats * 60.0 / self.bpm
    }

    /// Convert a duration in seconds to beats using this segment's BPM.
    pub fn seconds_to_beats(&self, seconds: f32) -> f32 {
        seconds * self.bpm / 60.0
    }

    /// Get the time of a specific beat number.
    pub fn beat_time(&self, beat_index: i32) -> f32 {
        let period = 60.0 / self.bpm;
        self.phase_offset + beat_index as f32 * period
    }
}

/// Provenance metadata for a musical time segment.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicalTimeProvenance {
    /// How this segment was created.
    pub source: String,

    /// Reference to the original TempoHypothesis (if promoted).
    pub source_hypothesis_id: Option<String>,

    /// ISO timestamp when the segment was created/promoted.
    pub promoted_at: String,

    /// User nudge value preserved from promotion (for provenance).
    pub user_nudge: Option<f32>,
}

/// Computed beat position at a given time.
#[derive(Clone, Debug)]
pub struct BeatPosition {
    /// The segment this position is within.
    pub segment_id: String,

    /// Integer beat number from segment start (can be negative).
    pub beat_index: i32,

    /// Phase within the current beat (0-1).
    pub beat_phase: f32,

    /// Continuous beat position (beatIndex + beatPhase).
    pub beat_position: f32,

    /// BPM of the containing segment.
    pub bpm: f32,
}

/// Default BPM used when no musical time is available.
pub const DEFAULT_BPM: f32 = 120.0;

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_segment() -> MusicalTimeSegment {
        MusicalTimeSegment {
            id: "test-segment".to_string(),
            bpm: 120.0,
            phase_offset: 0.5, // First beat at 0.5 seconds
            start_time: 0.0,
            end_time: 10.0,
            confidence: Some(0.9),
            provenance: MusicalTimeProvenance {
                source: "test".to_string(),
                source_hypothesis_id: None,
                promoted_at: "2024-01-01T00:00:00Z".to_string(),
                user_nudge: None,
            },
        }
    }

    #[test]
    fn test_beat_position_at() {
        let segment = make_test_segment();

        // At 0.5s (first beat)
        let pos = segment.beat_position_at(0.5);
        assert_eq!(pos.beat_index, 0);
        assert!((pos.beat_phase - 0.0).abs() < 0.001);
        assert!((pos.beat_position - 0.0).abs() < 0.001);

        // At 1.0s (halfway through first beat at 120 BPM = 0.5s per beat)
        let pos = segment.beat_position_at(1.0);
        assert_eq!(pos.beat_index, 1);
        assert!((pos.beat_phase - 0.0).abs() < 0.001);

        // At 0.75s (halfway through beat 0)
        let pos = segment.beat_position_at(0.75);
        assert_eq!(pos.beat_index, 0);
        assert!((pos.beat_phase - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_beat_position_before_first_beat() {
        let segment = make_test_segment();

        // At 0.0s (before first beat at 0.5s)
        let pos = segment.beat_position_at(0.0);
        assert_eq!(pos.beat_index, -1);
        // Phase should be 0.0s into a 0.5s beat = 0.0
        // Actually: (0.0 - 0.5) / 0.5 = -1.0, which means beat_index = -1, phase = 0.0
        assert!(pos.beat_phase >= 0.0 && pos.beat_phase < 1.0);
    }

    #[test]
    fn test_beats_to_seconds() {
        let segment = make_test_segment();

        // At 120 BPM, 1 beat = 0.5 seconds
        assert!((segment.beats_to_seconds(1.0) - 0.5).abs() < 0.001);
        assert!((segment.beats_to_seconds(2.0) - 1.0).abs() < 0.001);
        assert!((segment.beats_to_seconds(0.5) - 0.25).abs() < 0.001);
    }

    #[test]
    fn test_seconds_to_beats() {
        let segment = make_test_segment();

        // At 120 BPM, 0.5 seconds = 1 beat
        assert!((segment.seconds_to_beats(0.5) - 1.0).abs() < 0.001);
        assert!((segment.seconds_to_beats(1.0) - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_beat_time() {
        let segment = make_test_segment();

        // Beat 0 at phase_offset (0.5s)
        assert!((segment.beat_time(0) - 0.5).abs() < 0.001);

        // Beat 1 at 0.5 + 0.5 = 1.0s
        assert!((segment.beat_time(1) - 1.0).abs() < 0.001);

        // Beat -1 at 0.5 - 0.5 = 0.0s
        assert!((segment.beat_time(-1) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_musical_time_structure() {
        let structure = MusicalTimeStructure {
            version: 1,
            segments: vec![make_test_segment()],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            modified_at: "2024-01-01T00:00:00Z".to_string(),
        };

        // Time within segment
        assert!(structure.segment_at(5.0).is_some());
        assert!((structure.bpm_at(5.0).unwrap() - 120.0).abs() < 0.001);

        // Time outside segment
        assert!(structure.segment_at(15.0).is_none());
        assert!(structure.bpm_at(15.0).is_none());
    }

    #[test]
    fn test_deserialize_from_json() {
        let json = r#"{
            "version": 1,
            "segments": [{
                "id": "seg-1",
                "bpm": 128.0,
                "phaseOffset": 0.2,
                "startTime": 0.0,
                "endTime": 60.0,
                "confidence": 0.95,
                "provenance": {
                    "source": "promoted_from_hypothesis",
                    "sourceHypothesisId": "hyp-0",
                    "promotedAt": "2024-01-01T00:00:00Z",
                    "userNudge": 0.01
                }
            }],
            "createdAt": "2024-01-01T00:00:00Z",
            "modifiedAt": "2024-01-01T00:00:00Z"
        }"#;

        let structure: MusicalTimeStructure = serde_json::from_str(json).unwrap();

        assert_eq!(structure.version, 1);
        assert_eq!(structure.segments.len(), 1);

        let seg = &structure.segments[0];
        assert_eq!(seg.id, "seg-1");
        assert!((seg.bpm - 128.0).abs() < 0.001);
        assert!((seg.phase_offset - 0.2).abs() < 0.001);
        assert_eq!(seg.provenance.source, "promoted_from_hypothesis");
    }
}
