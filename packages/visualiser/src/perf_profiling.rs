//! Performance profiling utilities for diagnosing performance degradation.
//!
//! This module provides:
//! - Console timing wrappers for WASM (using `console.time`/`console.timeEnd`)
//! - Collection size tracking to detect memory growth
//! - Toggle mechanism to enable/disable profiling at runtime
//!
//! All profiling is optional and controlled via `set_profiling_enabled()`.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Global flag to enable/disable performance profiling.
static PROFILING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Frame counter for periodic logging (every N frames).
static FRAME_COUNTER: AtomicU64 = AtomicU64::new(0);

/// How often to log collection sizes (every N frames).
const COLLECTION_LOG_INTERVAL: u64 = 300; // ~5 seconds at 60fps

/// Check if profiling is currently enabled.
pub fn is_profiling_enabled() -> bool {
    PROFILING_ENABLED.load(Ordering::Relaxed)
}

/// Enable or disable performance profiling.
pub fn set_profiling_enabled(enabled: bool) {
    PROFILING_ENABLED.store(enabled, Ordering::Relaxed);
    if enabled {
        log::info!("Performance profiling ENABLED");
    } else {
        log::info!("Performance profiling DISABLED");
    }
}

/// Increment frame counter and return true if we should log this frame.
pub fn should_log_collections() -> bool {
    if !is_profiling_enabled() {
        return false;
    }
    let frame = FRAME_COUNTER.fetch_add(1, Ordering::Relaxed);
    frame % COLLECTION_LOG_INTERVAL == 0
}

/// Reset the frame counter (e.g., on script reload).
pub fn reset_frame_counter() {
    FRAME_COUNTER.store(0, Ordering::Relaxed);
}

// ============================================================================
// Console Timing (WASM only)
// ============================================================================

#[cfg(target_arch = "wasm32")]
mod wasm_timing {
    use super::is_profiling_enabled;
    use web_sys::console;

    /// Start a console timer with the given label.
    /// No-op if profiling is disabled.
    pub fn time_start(label: &str) {
        if is_profiling_enabled() {
            console::time_with_label(label);
        }
    }

    /// End a console timer with the given label.
    /// No-op if profiling is disabled.
    pub fn time_end(label: &str) {
        if is_profiling_enabled() {
            console::time_end_with_label(label);
        }
    }

    /// Execute a closure with console timing around it.
    /// Returns the closure's result.
    pub fn timed<T, F: FnOnce() -> T>(label: &str, f: F) -> T {
        if is_profiling_enabled() {
            console::time_with_label(label);
            let result = f();
            console::time_end_with_label(label);
            result
        } else {
            f()
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod wasm_timing {
    use super::is_profiling_enabled;
    use std::time::Instant;

    /// Start a console timer (native: logs start).
    pub fn time_start(label: &str) {
        if is_profiling_enabled() {
            log::debug!("[PERF] {} - start", label);
        }
    }

    /// End a console timer (native: no-op, use timed() instead).
    pub fn time_end(label: &str) {
        if is_profiling_enabled() {
            log::debug!("[PERF] {} - end", label);
        }
    }

    /// Execute a closure with timing around it (native: uses Instant).
    pub fn timed<T, F: FnOnce() -> T>(label: &str, f: F) -> T {
        if is_profiling_enabled() {
            let start = Instant::now();
            let result = f();
            let elapsed = start.elapsed();
            log::info!("[PERF] {}: {:.2}ms", label, elapsed.as_secs_f64() * 1000.0);
            result
        } else {
            f()
        }
    }
}

pub use wasm_timing::{time_start, time_end, timed};

// ============================================================================
// Collection Size Tracking
// ============================================================================

/// Statistics about collection sizes in the system.
#[derive(Debug, Default, Clone)]
pub struct CollectionStats {
    // SignalState collections
    pub exp_smooth_state: usize,
    pub gate_state: usize,
    pub ma_buffers: usize,
    pub pink_noise_state: usize,
    pub diff_state: usize,
    pub integrate_state: usize,
    pub delay_buffers: usize,
    pub warned_missing_bands: usize,
    pub warned_missing_stems: usize,
    pub warned_missing_custom: usize,
    pub warned_missing_stats: usize,

    // Scene graph collections
    pub scene_entities: usize,
    pub scene_meshes: usize,
    pub scene_lines: usize,
    pub scene_point_clouds: usize,
    pub scene_ribbons: usize,

    // Script engine collections
    pub rhai_variables: usize,

    // Input signals
    pub input_signals: usize,
    pub band_signals: usize,
    pub stem_signals: usize,
    pub custom_signals: usize,
}

impl CollectionStats {
    /// Log the current collection sizes.
    pub fn log(&self, frame: u64) {
        log::info!(
            "[PERF] Frame {} Collection Sizes:\n\
             Signal State: exp_smooth={}, gate={}, ma_buf={}, pink={}, diff={}, integrate={}, delay={}\n\
             Warnings: bands={}, stems={}, custom={}, stats={}\n\
             Scene: entities={}, meshes={}, lines={}, clouds={}, ribbons={}\n\
             Inputs: signals={}, bands={}, stems={}, custom={}",
            frame,
            self.exp_smooth_state, self.gate_state, self.ma_buffers,
            self.pink_noise_state, self.diff_state, self.integrate_state, self.delay_buffers,
            self.warned_missing_bands, self.warned_missing_stems,
            self.warned_missing_custom, self.warned_missing_stats,
            self.scene_entities, self.scene_meshes, self.scene_lines,
            self.scene_point_clouds, self.scene_ribbons,
            self.input_signals, self.band_signals, self.stem_signals, self.custom_signals
        );
    }

    /// Check if any collection appears to be growing abnormally.
    /// Returns a warning message if so.
    pub fn check_growth(&self, prev: &CollectionStats) -> Option<String> {
        let mut warnings = Vec::new();

        // Check for significant growth (>10% increase)
        let check = |name: &str, current: usize, previous: usize| -> Option<String> {
            if previous > 0 && current > previous {
                let growth = (current - previous) as f64 / previous as f64;
                if growth > 0.1 {
                    return Some(format!("{}: {} -> {} (+{:.0}%)", name, previous, current, growth * 100.0));
                }
            }
            None
        };

        if let Some(w) = check("exp_smooth_state", self.exp_smooth_state, prev.exp_smooth_state) {
            warnings.push(w);
        }
        if let Some(w) = check("ma_buffers", self.ma_buffers, prev.ma_buffers) {
            warnings.push(w);
        }
        if let Some(w) = check("delay_buffers", self.delay_buffers, prev.delay_buffers) {
            warnings.push(w);
        }
        if let Some(w) = check("integrate_state", self.integrate_state, prev.integrate_state) {
            warnings.push(w);
        }

        if warnings.is_empty() {
            None
        } else {
            Some(format!("[PERF WARNING] Collections growing: {}", warnings.join(", ")))
        }
    }
}

/// Macro to easily time a block of code.
/// Usage: `perf_time!("label", { expensive_operation() })`
#[macro_export]
macro_rules! perf_time {
    ($label:expr, $body:expr) => {
        $crate::perf_profiling::timed($label, || $body)
    };
}
