//! Debug signal collection for analysis mode.
//!
//! Collects `debug.emit()` calls during script execution.
//! Uses thread-local storage to allow Rhai native functions to access the collector.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

/// A single debug emission at a specific time.
#[derive(Debug, Clone)]
pub struct DebugEmission {
    pub time: f32,
    pub value: f32,
}

/// Collected debug signal - a time-series of emitted values.
#[derive(Debug, Clone)]
pub struct DebugSignal {
    pub name: String,
    pub emissions: Vec<DebugEmission>,
}

impl DebugSignal {
    pub fn new(name: String) -> Self {
        Self {
            name,
            emissions: Vec::new(),
        }
    }

    pub fn push(&mut self, time: f32, value: f32) {
        self.emissions.push(DebugEmission { time, value });
    }

    /// Convert to separate arrays for serialization.
    pub fn to_arrays(&self) -> (Vec<f32>, Vec<f32>) {
        let times: Vec<f32> = self.emissions.iter().map(|e| e.time).collect();
        let values: Vec<f32> = self.emissions.iter().map(|e| e.value).collect();
        (times, values)
    }
}

// Thread-local collector for debug emissions during script execution.
thread_local! {
    static DEBUG_COLLECTOR: RefCell<Option<DebugCollector>> = const { RefCell::new(None) };
}

/// Collector that accumulates debug.emit() calls during analysis.
#[derive(Debug, Default)]
pub struct DebugCollector {
    signals: HashMap<String, DebugSignal>,
    current_time: f32,
    enabled: bool,
    /// Maximum emissions per signal (memory bound)
    max_emissions_per_signal: usize,
    /// Tracks (name, time_bits) pairs that have already emitted this frame.
    /// Used for deduplication when the same probe is evaluated multiple times.
    emitted_this_frame: HashSet<(String, u32)>,
}

impl DebugCollector {
    /// Create a new debug collector.
    pub fn new() -> Self {
        Self {
            signals: HashMap::new(),
            current_time: 0.0,
            enabled: true,
            max_emissions_per_signal: 100_000, // ~10 minutes at 10ms steps
            emitted_this_frame: HashSet::new(),
        }
    }

    /// Set the current time for subsequent emissions.
    /// Also clears the per-frame deduplication set.
    pub fn set_time(&mut self, time: f32) {
        // Clear deduplication set when time changes (new frame)
        if (time - self.current_time).abs() > f32::EPSILON {
            self.emitted_this_frame.clear();
        }
        self.current_time = time;
    }

    /// Record a debug emission.
    ///
    /// Emissions are deduplicated per-frame: if the same probe name emits
    /// multiple times at the same time (e.g., because the signal is evaluated
    /// multiple times), only the first emission is recorded.
    pub fn emit(&mut self, name: &str, value: f32) {
        if !self.enabled {
            return;
        }

        // Validate name (must be non-empty, reasonable length)
        if name.is_empty() || name.len() > 64 {
            return;
        }

        // Validate value (must be finite)
        if !value.is_finite() {
            return;
        }

        // Deduplicate: only emit once per (name, time) pair per frame
        let time_bits = self.current_time.to_bits();
        let key = (name.to_string(), time_bits);
        if !self.emitted_this_frame.insert(key) {
            // Already emitted for this probe at this time
            return;
        }

        let signal = self
            .signals
            .entry(name.to_string())
            .or_insert_with(|| DebugSignal::new(name.to_string()));

        // Enforce memory bound
        if signal.emissions.len() < self.max_emissions_per_signal {
            signal.push(self.current_time, value);
        }
    }

    /// Take all collected signals, leaving the collector empty.
    pub fn take_signals(&mut self) -> HashMap<String, DebugSignal> {
        std::mem::take(&mut self.signals)
    }

    /// Get the number of signals collected.
    pub fn signal_count(&self) -> usize {
        self.signals.len()
    }

    /// Get the total number of emissions across all signals.
    pub fn total_emissions(&self) -> usize {
        self.signals.values().map(|s| s.emissions.len()).sum()
    }
}

// Global accessor functions for use from Rhai native functions

/// Install a collector in thread-local storage.
/// Call this before running analysis.
pub fn install_collector(collector: DebugCollector) {
    DEBUG_COLLECTOR.with(|c| *c.borrow_mut() = Some(collector));
}

/// Remove and return the collector from thread-local storage.
/// Call this after analysis completes.
pub fn remove_collector() -> Option<DebugCollector> {
    DEBUG_COLLECTOR.with(|c| c.borrow_mut().take())
}

/// Execute a function with the current collector (if installed).
pub fn with_collector<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut DebugCollector) -> R,
{
    DEBUG_COLLECTOR.with(|c| c.borrow_mut().as_mut().map(f))
}

/// Set the current time on the thread-local collector.
/// Called at each analysis step.
pub fn set_collector_time(time: f32) {
    with_collector(|c| c.set_time(time));
}

/// Record a debug emission on the thread-local collector.
/// Called from Rhai's debug.emit() native function.
pub fn debug_emit(name: &str, value: f32) {
    with_collector(|c| c.emit(name, value));
}

/// Check if a collector is currently installed.
pub fn has_collector() -> bool {
    DEBUG_COLLECTOR.with(|c| c.borrow().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_debug_emission() {
        let mut collector = DebugCollector::new();
        collector.set_time(0.0);
        collector.emit("energy", 0.5);
        collector.set_time(0.01);
        collector.emit("energy", 0.6);
        collector.emit("phase", 1.2);

        assert_eq!(collector.signal_count(), 2);
        assert_eq!(collector.total_emissions(), 3);

        let signals = collector.take_signals();
        assert_eq!(signals.len(), 2);

        let energy = signals.get("energy").unwrap();
        assert_eq!(energy.emissions.len(), 2);
        assert!((energy.emissions[0].value - 0.5).abs() < 0.001);
        assert!((energy.emissions[1].time - 0.01).abs() < 0.001);
    }

    #[test]
    fn test_thread_local_collector() {
        // Install collector
        install_collector(DebugCollector::new());
        assert!(has_collector());

        // Use it
        set_collector_time(0.5);
        debug_emit("test", 1.0);

        // Remove and check
        let collector = remove_collector().unwrap();
        assert_eq!(collector.signal_count(), 1);
        assert!(!has_collector());
    }

    #[test]
    fn test_invalid_emissions() {
        let mut collector = DebugCollector::new();

        // Empty name - should be ignored
        collector.emit("", 1.0);
        assert_eq!(collector.signal_count(), 0);

        // NaN value - should be ignored
        collector.emit("test", f32::NAN);
        assert_eq!(collector.signal_count(), 0);

        // Infinity - should be ignored
        collector.emit("test", f32::INFINITY);
        assert_eq!(collector.signal_count(), 0);

        // Valid emission
        collector.emit("test", 1.0);
        assert_eq!(collector.signal_count(), 1);
    }

    #[test]
    fn test_to_arrays() {
        let mut signal = DebugSignal::new("test".to_string());
        signal.push(0.0, 1.0);
        signal.push(0.01, 2.0);
        signal.push(0.02, 3.0);

        let (times, values) = signal.to_arrays();
        assert_eq!(times, vec![0.0, 0.01, 0.02]);
        assert_eq!(values, vec![1.0, 2.0, 3.0]);
    }
}
