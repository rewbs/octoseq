//! Runtime state for stateful signal operations.
//!
//! Some signal operations (smoothing, hysteresis gates) require state
//! that persists across frames. This module provides the state containers.

use std::collections::{HashMap, HashSet};

use crate::signal::SignalId;

/// Runtime state for all stateful signal operations.
#[derive(Default)]
pub struct SignalState {
    /// State for exponential smoothers (last output value).
    pub exp_smooth_state: HashMap<SignalId, f32>,

    /// State for hysteresis gates (is gate currently on?).
    pub gate_state: HashMap<SignalId, bool>,

    /// Ring buffers for moving average smoothing.
    pub ma_buffers: HashMap<SignalId, RingBuffer>,

    /// State for pink noise generators (Voss-McCartney algorithm).
    pub pink_noise_state: HashMap<SignalId, PinkNoiseState>,

    /// State for diff operation (previous value).
    pub diff_state: HashMap<SignalId, f32>,

    /// State for integrate operation (accumulated value).
    pub integrate_state: HashMap<SignalId, f32>,

    /// Ring buffers for delay operation.
    pub delay_buffers: HashMap<SignalId, DelayBuffer>,

    /// Whether a "no musical time" warning has been logged.
    pub warned_no_musical_time: bool,

    /// Tracks band/feature combinations that have been warned about being missing.
    /// Format: "band_key:feature"
    pub warned_missing_bands: HashSet<String>,

    /// Tracks stem/feature combinations that have been warned about being missing.
    /// Format: "stem_id:feature"
    pub warned_missing_stems: HashSet<String>,

    /// Tracks signals that have warned about missing statistics.
    pub warned_missing_stats: HashSet<SignalId>,
}

impl SignalState {
    /// Create a new empty state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Clear all state (e.g., when script is reloaded).
    pub fn clear(&mut self) {
        self.exp_smooth_state.clear();
        self.gate_state.clear();
        self.ma_buffers.clear();
        self.pink_noise_state.clear();
        self.diff_state.clear();
        self.integrate_state.clear();
        self.delay_buffers.clear();
        self.warned_no_musical_time = false;
        self.warned_missing_bands.clear();
        self.warned_missing_stems.clear();
        self.warned_missing_stats.clear();
    }

    /// Warn once about a missing band/feature combination.
    /// Logs a warning if this band/feature hasn't been warned about yet.
    pub fn warn_missing_band(&mut self, band_key: &str, feature: &str) {
        let key = format!("{}:{}", band_key, feature);
        if self.warned_missing_bands.insert(key) {
            log::warn!(
                "Band signal not found: inputs.bands[\"{}\"].{} - returning 0.0",
                band_key,
                feature
            );
        }
    }

    /// Warn once about a missing stem/feature combination.
    /// Logs a warning if this stem/feature hasn't been warned about yet.
    pub fn warn_missing_stem(&mut self, stem_id: &str, feature: &str) {
        let key = format!("{}:{}", stem_id, feature);
        if self.warned_missing_stems.insert(key) {
            log::warn!(
                "Stem signal not found: inputs.stems[\"{}\"].{} - returning 0.0",
                stem_id,
                feature
            );
        }
    }

    /// Warn once about missing statistics for a signal.
    /// Returns true if this is the first warning for this signal.
    pub fn warn_missing_stats_once(&mut self, signal_id: SignalId, norm_type: &str) -> bool {
        if self.warned_missing_stats.insert(signal_id) {
            log::warn!(
                "No statistics available for {} normalization (signal {:?}) - returning raw value. \
                 Use .normalise.to_range(min, max) for analysis mode, or ensure statistics are pre-computed.",
                norm_type,
                signal_id
            );
            true
        } else {
            false
        }
    }

    /// Get or create exponential smoother state.
    pub fn get_exp_smooth(&mut self, id: SignalId, initial: f32) -> f32 {
        *self.exp_smooth_state.entry(id).or_insert(initial)
    }

    /// Set exponential smoother state.
    pub fn set_exp_smooth(&mut self, id: SignalId, value: f32) {
        self.exp_smooth_state.insert(id, value);
    }

    /// Get or create gate state.
    pub fn get_gate(&mut self, id: SignalId) -> bool {
        *self.gate_state.entry(id).or_insert(false)
    }

    /// Set gate state.
    pub fn set_gate(&mut self, id: SignalId, is_on: bool) {
        self.gate_state.insert(id, is_on);
    }

    /// Get or create a ring buffer for moving average.
    pub fn get_ma_buffer(&mut self, id: SignalId, capacity: usize) -> &mut RingBuffer {
        self.ma_buffers.entry(id).or_insert_with(|| RingBuffer::new(capacity))
    }

    /// Get or create pink noise state.
    pub fn get_pink_noise(&mut self, id: SignalId) -> &mut PinkNoiseState {
        self.pink_noise_state.entry(id).or_insert_with(PinkNoiseState::new)
    }

    /// Get previous value for diff operation.
    pub fn get_diff_last(&mut self, id: SignalId, initial: f32) -> f32 {
        *self.diff_state.entry(id).or_insert(initial)
    }

    /// Set previous value for diff operation.
    pub fn set_diff_last(&mut self, id: SignalId, value: f32) {
        self.diff_state.insert(id, value);
    }

    /// Get accumulated value for integrate operation.
    pub fn get_integrate(&mut self, id: SignalId, initial: f32) -> f32 {
        *self.integrate_state.entry(id).or_insert(initial)
    }

    /// Set accumulated value for integrate operation.
    pub fn set_integrate(&mut self, id: SignalId, value: f32) {
        self.integrate_state.insert(id, value);
    }

    /// Get or create a delay buffer.
    pub fn get_delay_buffer(&mut self, id: SignalId, capacity: usize) -> &mut DelayBuffer {
        self.delay_buffers
            .entry(id)
            .or_insert_with(|| DelayBuffer::new(capacity))
    }
}

/// Ring buffer for moving average computation.
pub struct RingBuffer {
    data: Vec<f32>,
    cursor: usize,
    count: usize,
}

impl RingBuffer {
    /// Create a new ring buffer with the given capacity.
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity.max(1)],
            cursor: 0,
            count: 0,
        }
    }

    /// Push a new value into the buffer.
    pub fn push(&mut self, value: f32) {
        self.data[self.cursor] = value;
        self.cursor = (self.cursor + 1) % self.data.len();
        if self.count < self.data.len() {
            self.count += 1;
        }
    }

    /// Compute the average of all values in the buffer.
    pub fn average(&self) -> f32 {
        if self.count == 0 {
            return 0.0;
        }
        self.data[..self.count].iter().sum::<f32>() / self.count as f32
    }

    /// Get the current count of values in the buffer.
    pub fn len(&self) -> usize {
        self.count
    }

    /// Check if the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Get the capacity of the buffer.
    pub fn capacity(&self) -> usize {
        self.data.len()
    }

    /// Clear the buffer.
    pub fn clear(&mut self) {
        self.cursor = 0;
        self.count = 0;
    }

    /// Resize the buffer (clears existing data).
    pub fn resize(&mut self, new_capacity: usize) {
        self.data = vec![0.0; new_capacity.max(1)];
        self.cursor = 0;
        self.count = 0;
    }
}

/// Ring buffer for delay operation.
///
/// Stores past values and returns the oldest value for delay effects.
pub struct DelayBuffer {
    data: Vec<f32>,
    write_cursor: usize,
    count: usize,
}

impl DelayBuffer {
    /// Create a new delay buffer with the given capacity.
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity.max(1)],
            write_cursor: 0,
            count: 0,
        }
    }

    /// Push a new value and return the oldest value.
    pub fn push(&mut self, value: f32) -> f32 {
        let oldest = if self.count >= self.data.len() {
            self.data[self.write_cursor]
        } else {
            value // Not enough history yet, return current
        };

        self.data[self.write_cursor] = value;
        self.write_cursor = (self.write_cursor + 1) % self.data.len();
        if self.count < self.data.len() {
            self.count += 1;
        }

        oldest
    }

    /// Get the oldest value in the buffer without pushing.
    pub fn oldest(&self) -> f32 {
        if self.count == 0 {
            return 0.0;
        }
        if self.count < self.data.len() {
            self.data[0]
        } else {
            self.data[self.write_cursor] // Oldest is at write cursor after wraparound
        }
    }

    /// Get the current count of values in the buffer.
    pub fn len(&self) -> usize {
        self.count
    }

    /// Check if the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Get the capacity of the buffer.
    pub fn capacity(&self) -> usize {
        self.data.len()
    }

    /// Resize the buffer (clears existing data).
    pub fn resize(&mut self, new_capacity: usize) {
        self.data = vec![0.0; new_capacity.max(1)];
        self.write_cursor = 0;
        self.count = 0;
    }
}

/// State for pink noise generation using Voss-McCartney algorithm.
///
/// This uses multiple octaves of white noise that are updated at different rates
/// to produce a 1/f spectrum.
pub struct PinkNoiseState {
    /// Values for each octave (typically 16 octaves).
    octaves: [f32; 16],
    /// Counter for determining which octaves to update.
    counter: u32,
    /// Running sum of octave values.
    running_sum: f32,
}

impl PinkNoiseState {
    /// Create a new pink noise state.
    pub fn new() -> Self {
        Self {
            octaves: [0.0; 16],
            counter: 0,
            running_sum: 0.0,
        }
    }

    /// Generate the next pink noise sample.
    ///
    /// # Arguments
    /// * `white_sample` - A white noise sample to use as input.
    ///
    /// # Returns
    /// A pink noise sample in the range [-1, 1].
    pub fn next(&mut self, white_sample: f32) -> f32 {
        self.counter = self.counter.wrapping_add(1);

        // Update octaves based on counter bits
        // Each octave updates at half the rate of the previous
        let mut k = self.counter;
        let mut octave_idx = 0;

        while k & 1 == 0 && octave_idx < 16 {
            k >>= 1;
            octave_idx += 1;
        }

        if octave_idx < 16 {
            // Update this octave with a new white noise sample
            self.running_sum -= self.octaves[octave_idx];
            self.octaves[octave_idx] = white_sample;
            self.running_sum += white_sample;
        }

        // Normalize by number of active octaves (approximately)
        // The sum of 16 octaves of white noise has higher variance
        (self.running_sum + white_sample) / 17.0
    }

    /// Reset the state.
    pub fn reset(&mut self) {
        self.octaves = [0.0; 16];
        self.counter = 0;
        self.running_sum = 0.0;
    }
}

impl Default for PinkNoiseState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_basic() {
        let mut buf = RingBuffer::new(3);

        assert!(buf.is_empty());
        assert_eq!(buf.len(), 0);
        assert_eq!(buf.capacity(), 3);

        buf.push(1.0);
        assert_eq!(buf.len(), 1);
        assert!((buf.average() - 1.0).abs() < 0.001);

        buf.push(2.0);
        buf.push(3.0);
        assert_eq!(buf.len(), 3);
        assert!((buf.average() - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_ring_buffer_overflow() {
        let mut buf = RingBuffer::new(3);

        buf.push(1.0);
        buf.push(2.0);
        buf.push(3.0);
        assert!((buf.average() - 2.0).abs() < 0.001);

        // Push more values, oldest should be overwritten
        buf.push(4.0);
        assert_eq!(buf.len(), 3);
        assert!((buf.average() - 3.0).abs() < 0.001); // (2 + 3 + 4) / 3 = 3

        buf.push(5.0);
        assert!((buf.average() - 4.0).abs() < 0.001); // (3 + 4 + 5) / 3 = 4
    }

    #[test]
    fn test_signal_state() {
        let mut state = SignalState::new();
        let id = SignalId::new();

        // Exponential smooth state
        assert!((state.get_exp_smooth(id, 5.0) - 5.0).abs() < 0.001);
        state.set_exp_smooth(id, 10.0);
        assert!((state.get_exp_smooth(id, 0.0) - 10.0).abs() < 0.001);

        // Gate state
        assert!(!state.get_gate(id));
        state.set_gate(id, true);
        assert!(state.get_gate(id));
    }

    #[test]
    fn test_pink_noise_state() {
        let mut pink = PinkNoiseState::new();

        // Generate some samples and check they're bounded
        for i in 0..100 {
            // Simulate white noise input
            let white = (i as f32 / 50.0 - 1.0).sin();
            let sample = pink.next(white);

            // Pink noise should be bounded (though not strictly to [-1, 1] due to summation)
            assert!(sample.abs() < 2.0, "Pink noise sample out of expected range: {}", sample);
        }
    }

    #[test]
    fn test_state_clear() {
        let mut state = SignalState::new();
        let id = SignalId::new();

        state.set_exp_smooth(id, 10.0);
        state.set_gate(id, true);
        state.get_ma_buffer(id, 5);

        assert!(!state.exp_smooth_state.is_empty());
        assert!(!state.gate_state.is_empty());
        assert!(!state.ma_buffers.is_empty());

        state.clear();

        assert!(state.exp_smooth_state.is_empty());
        assert!(state.gate_state.is_empty());
        assert!(state.ma_buffers.is_empty());
    }
}
