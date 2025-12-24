pub mod gpu;
pub mod input;
pub mod visualiser;
pub mod sparkline;
pub mod scripting;
pub mod scene_graph;
pub mod script_log;
pub mod debug_collector;
pub mod analysis_runner;

// Signal API modules
pub mod signal;
pub mod signal_stats;
pub mod signal_state;
pub mod signal_eval;
pub mod signal_rhai;
pub mod musical_time;

// Event extraction modules
pub mod event_stream;
pub mod event_extractor;
pub mod event_rhai;

#[cfg(not(target_arch = "wasm32"))]
pub mod cli;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
