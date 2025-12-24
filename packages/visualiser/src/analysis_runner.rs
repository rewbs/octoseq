//! Analysis-mode script execution.
//!
//! Runs scripts headlessly to collect debug signals without rendering.
//! This is used to extract script-derived signals for the full track duration.

use std::collections::HashMap;

use crate::debug_collector::{
    install_collector, remove_collector, set_collector_time, DebugCollector, DebugSignal,
};
use crate::event_extractor::EventExtractor;
use crate::event_rhai::{
    clear_extracted_streams, clear_pending_extractions, store_extracted_stream,
    take_pending_extractions,
};
use crate::event_stream::{EventExtractionDebug, EventStream};
use crate::input::InputSignal;
use crate::musical_time::MusicalTimeStructure;
use crate::scripting::ScriptEngine;

/// Configuration for an analysis run.
#[derive(Debug, Clone)]
pub struct AnalysisConfig {
    /// Total duration in seconds.
    pub duration: f32,
    /// Time step between updates (default ~10ms).
    pub time_step: f32,
}

impl Default for AnalysisConfig {
    fn default() -> Self {
        Self {
            duration: 10.0,
            time_step: 0.01, // 10ms = 100 steps per second
        }
    }
}

impl AnalysisConfig {
    /// Create config with specified duration and default time step.
    pub fn with_duration(duration: f32) -> Self {
        Self {
            duration,
            ..Default::default()
        }
    }

    /// Create config with specified duration and time step.
    pub fn new(duration: f32, time_step: f32) -> Self {
        Self { duration, time_step }
    }
}

/// Result of an analysis run.
#[derive(Debug)]
pub struct AnalysisResult {
    /// Debug signals collected during analysis.
    pub debug_signals: HashMap<String, DebugSignal>,
    /// Number of time steps executed.
    pub step_count: usize,
    /// Total duration analyzed.
    pub duration: f32,
}

/// Run script in analysis mode, collecting debug.emit() calls.
///
/// This function:
/// 1. Creates a fresh script engine (no shared state)
/// 2. Loads the script
/// 3. Installs a debug collector
/// 4. Calls init(ctx) at time=0
/// 5. Iterates through the time grid, calling update(dt, inputs) at each step
/// 6. Collects all debug.emit() calls
///
/// No rendering or GPU operations occur.
pub fn run_analysis(
    script: &str,
    signals: &HashMap<String, InputSignal>,
    config: AnalysisConfig,
) -> Result<AnalysisResult, String> {
    // Validate config
    if config.duration <= 0.0 {
        return Err("Duration must be positive".to_string());
    }
    if config.time_step <= 0.0 {
        return Err("Time step must be positive".to_string());
    }

    // Create fresh script engine
    let mut engine = ScriptEngine::new();

    // Load script
    if !engine.load_script(script) {
        return Err(engine
            .last_error
            .clone()
            .unwrap_or_else(|| "Unknown script error".to_string()));
    }

    // Install debug collector
    let collector = DebugCollector::new();
    install_collector(collector);

    // Calculate steps
    let step_count = ((config.duration / config.time_step).ceil() as usize).max(1);
    let dt = config.time_step;

    // Run init at time=0
    set_collector_time(0.0);
    engine.call_init();

    // Run update loop
    for step in 0..step_count {
        let time = step as f32 * dt;
        set_collector_time(time);

        // Sample all input signals at this time
        let mut sampled: HashMap<String, f32> = HashMap::new();
        sampled.insert("time".to_string(), time);
        sampled.insert("dt".to_string(), dt);

        for (name, signal) in signals {
            // Use sample_window with dt as window size (matches playback behavior)
            let value = signal.sample_window(time, dt);
            sampled.insert(name.clone(), value);
        }

        // Call update (scene graph changes are ignored)
        engine.update(dt, &sampled);
    }

    // Collect results
    let mut collector = remove_collector().unwrap_or_default();
    let debug_signals = collector.take_signals();

    log::info!(
        "Analysis complete: {} steps, {} signals, {} total emissions",
        step_count,
        debug_signals.len(),
        debug_signals.values().map(|s| s.emissions.len()).sum::<usize>()
    );

    Ok(AnalysisResult {
        debug_signals,
        step_count,
        duration: config.duration,
    })
}

/// Extended result of an analysis run including event streams.
#[derive(Debug)]
pub struct ExtendedAnalysisResult {
    /// Debug signals collected during analysis.
    pub debug_signals: HashMap<String, DebugSignal>,
    /// Event streams extracted from signals.
    pub event_streams: HashMap<String, EventStream>,
    /// Debug data from event extraction (if enabled).
    pub event_debug: HashMap<String, EventExtractionDebug>,
    /// Number of time steps executed.
    pub step_count: usize,
    /// Total duration analyzed.
    pub duration: f32,
}

/// Run script in analysis mode with event extraction support.
///
/// This function:
/// 1. Creates a fresh script engine
/// 2. Loads the script
/// 3. Installs debug and event collection
/// 4. Runs the analysis loop
/// 5. Processes pending event extractions
/// 6. Returns debug signals AND event streams
pub fn run_analysis_with_events(
    script: &str,
    signals: &HashMap<String, InputSignal>,
    musical_time: Option<&MusicalTimeStructure>,
    config: AnalysisConfig,
    collect_event_debug: bool,
) -> Result<ExtendedAnalysisResult, String> {
    // Validate config
    if config.duration <= 0.0 {
        return Err("Duration must be positive".to_string());
    }
    if config.time_step <= 0.0 {
        return Err("Time step must be positive".to_string());
    }

    // Clear any previous pending extractions
    clear_pending_extractions();
    clear_extracted_streams();

    // Create fresh script engine
    let mut engine = ScriptEngine::new();

    // Load script
    if !engine.load_script(script) {
        return Err(engine
            .last_error
            .clone()
            .unwrap_or_else(|| "Unknown script error".to_string()));
    }

    // Install debug collector
    let collector = DebugCollector::new();
    install_collector(collector);

    // Calculate steps
    let step_count = ((config.duration / config.time_step).ceil() as usize).max(1);
    let dt = config.time_step;

    // Run init at time=0
    set_collector_time(0.0);
    engine.call_init();

    // Run update loop
    for step in 0..step_count {
        let time = step as f32 * dt;
        set_collector_time(time);

        // Sample all input signals at this time
        let mut sampled: HashMap<String, f32> = HashMap::new();
        sampled.insert("time".to_string(), time);
        sampled.insert("dt".to_string(), dt);

        for (name, signal) in signals {
            let value = signal.sample_window(time, dt);
            sampled.insert(name.clone(), value);
        }

        // Call update
        engine.update(dt, &sampled);
    }

    // Collect debug signals
    let mut collector = remove_collector().unwrap_or_default();
    let debug_signals = collector.take_signals();

    // Process pending event extractions
    let pending = take_pending_extractions();
    let mut event_streams = HashMap::new();
    let mut event_debug = HashMap::new();

    for pending_extraction in pending {
        let mut extractor = EventExtractor::new(
            pending_extraction.source,
            pending_extraction.options,
            musical_time,
            config.duration,
            config.time_step,
        );

        if collect_event_debug {
            extractor = extractor.with_debug();
        }

        match extractor.extract(signals) {
            Ok((stream, debug)) => {
                let name = pending_extraction.name.clone();

                // Store for potential second pass (if script queries events)
                store_extracted_stream(name.clone(), stream.clone());

                event_streams.insert(name.clone(), stream);

                if let Some(d) = debug {
                    event_debug.insert(name, d);
                }
            }
            Err(e) => {
                log::warn!("Event extraction failed for {}: {}", pending_extraction.name, e);
            }
        }
    }

    log::info!(
        "Extended analysis complete: {} steps, {} signals, {} event streams",
        step_count,
        debug_signals.len(),
        event_streams.len()
    );

    Ok(ExtendedAnalysisResult {
        debug_signals,
        event_streams,
        event_debug,
        step_count,
        duration: config.duration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_signal(values: Vec<f32>, sample_rate: f32) -> InputSignal {
        InputSignal::new(values, sample_rate)
    }

    #[test]
    fn test_basic_analysis() {
        let script = r#"
            fn init(ctx) {
                // Nothing to init
            }

            fn update(dt, inputs) {
                dbg.emit("time_signal", inputs.time);
                dbg.emit("energy", inputs.amplitude * 2.0);
            }
        "#;

        let mut signals = HashMap::new();
        // Create a simple amplitude signal: 0.5 for 1 second at 100Hz
        signals.insert(
            "amplitude".to_string(),
            make_test_signal(vec![0.5; 100], 100.0),
        );

        let config = AnalysisConfig::new(1.0, 0.01); // 1 second, 10ms steps = 100 steps
        let result = run_analysis(script, &signals, config).unwrap();

        assert_eq!(result.step_count, 100);
        assert_eq!(result.debug_signals.len(), 2);

        // Check time_signal
        let time_sig = result.debug_signals.get("time_signal").unwrap();
        assert_eq!(time_sig.emissions.len(), 100);
        assert!((time_sig.emissions[0].value - 0.0).abs() < 0.001);
        assert!((time_sig.emissions[99].value - 0.99).abs() < 0.01);

        // Check energy (should be amplitude * 2 = 1.0)
        let energy = result.debug_signals.get("energy").unwrap();
        assert_eq!(energy.emissions.len(), 100);
        // Value should be close to 1.0 (0.5 * 2)
        assert!((energy.emissions[50].value - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_analysis_with_varying_signal() {
        let script = r#"
            fn init(ctx) {}

            fn update(dt, inputs) {
                if inputs.amplitude > 0.5 {
                    dbg.emit("gate", 1.0);
                } else {
                    dbg.emit("gate", 0.0);
                }
            }
        "#;

        let mut signals = HashMap::new();
        // Signal that ramps from 0 to 1
        let values: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        signals.insert("amplitude".to_string(), make_test_signal(values, 100.0));

        let config = AnalysisConfig::new(1.0, 0.01);
        let result = run_analysis(script, &signals, config).unwrap();

        let gate = result.debug_signals.get("gate").unwrap();
        assert_eq!(gate.emissions.len(), 100);

        // First half should be 0, second half should be 1
        assert!((gate.emissions[25].value - 0.0).abs() < 0.001);
        assert!((gate.emissions[75].value - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_analysis_no_signals() {
        let script = r#"
            fn init(ctx) {}
            fn update(dt, inputs) {
                dbg.emit("constant", 42.0);
            }
        "#;

        let signals = HashMap::new();
        let config = AnalysisConfig::new(0.1, 0.01); // 10 steps
        let result = run_analysis(script, &signals, config).unwrap();

        assert_eq!(result.step_count, 10);
        let constant = result.debug_signals.get("constant").unwrap();
        assert_eq!(constant.emissions.len(), 10);
    }

    #[test]
    fn test_analysis_script_error() {
        let script = "this is not valid rhai {{{";
        let signals = HashMap::new();
        let config = AnalysisConfig::default();

        let result = run_analysis(script, &signals, config);
        assert!(result.is_err());
    }

    #[test]
    fn test_analysis_invalid_config() {
        let script = r#"fn init(ctx) {} fn update(dt, inputs) {}"#;
        let signals = HashMap::new();

        let result = run_analysis(script, &signals, AnalysisConfig::new(-1.0, 0.01));
        assert!(result.is_err());

        let result = run_analysis(script, &signals, AnalysisConfig::new(1.0, 0.0));
        assert!(result.is_err());
    }
}
