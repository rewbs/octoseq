use std::collections::HashMap;
use std::rc::Rc;

/// Type alias for reference-counted InputSignal.
/// Using Rc allows cheap cloning when passing signals between contexts
/// (e.g., to thread-local storage for script execution).
pub type SharedSignal = Rc<InputSignal>;

/// Type alias for a map of named signals.
pub type SignalMap = HashMap<String, SharedSignal>;

/// Type alias for band-scoped signals (band_key -> feature -> signal).
pub type BandSignalMap = HashMap<String, SignalMap>;

/// Represents a 1D signal over time.
#[derive(Clone)]
pub struct InputSignal {
    samples: Vec<f32>,
    sample_rate: f32,
    duration: f32,
}

impl InputSignal {
    pub fn new(samples: Vec<f32>, sample_rate: f32) -> Self {
        let duration = samples.len() as f32 / sample_rate;
        Self {
            samples,
            sample_rate,
            duration,
        }
    }

    pub fn get_duration(&self) -> f32 {
        self.duration
    }

    pub fn sample(&self, time: f32) -> f32 {
        if time < 0.0 || time > self.duration {
            return 0.0;
        }
        let index = time * self.sample_rate;
        let i = index as usize;
        let frac = index.fract();

        if i >= self.samples.len() {
            return 0.0;
        }

        let v0 = self.samples[i];
        let v1 = if i + 1 < self.samples.len() {
            self.samples[i + 1]
        } else {
            v0
        };

        // Linear interpolation
        v0 + (v1 - v0) * frac
    }

    /// Samples the max absolute value within the window [time - window, time]
    /// This is useful for capturing transients when downsampling high-frequency signals (like audio)
    /// to low-frequency frames (60fps).
    pub fn sample_window(&self, time: f32, window: f32) -> f32 {
        if window <= 0.0 {
            return self.sample(time);
        }

        // Convert time range to indices
        let end_idx = (time * self.sample_rate).floor() as isize;
        let start_time = (time - window).max(0.0);
        let start_idx = (start_time * self.sample_rate).floor() as isize;

        // If indices are out of bounds or invalid
        if end_idx < 0 || start_idx >= self.samples.len() as isize || start_idx > end_idx {
             return 0.0;
        }

        // Clamp indices
        let start = start_idx.max(0) as usize;
        let end = (end_idx.min(self.samples.len() as isize - 1)) as usize;

        // If window is smaller than 1 sample, just point sample
        if start == end {
            return self.sample(time);
        }

        // Find max in range
        let mut max_val: f32 = 0.0;
        // Simple scan loop (efficient enough for typical audio rates vs 60fps windows)
        for i in start..=end {
            let v = self.samples[i].abs();
            if v > max_val {
                max_val = v;
            }
        }
        max_val
    }

    pub fn apply_sigmoid(&self, val: f32, k: f32) -> f32 {
        if k == 0.0 { return val; }

        // Sigmoid centered at 0.5
        // f(x) = 1 / (1 + exp(-k * (x - 0.5)))
        let center = 0.5;
        let x = val;
        let den = 1.0 + (-k * (x - center)).exp();
        1.0 / den
    }
}
