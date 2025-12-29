pub mod gpu;
pub mod input;
pub mod visualiser;
pub mod sparkline;
pub mod scripting;
pub mod scene_graph;
pub mod script_log;
pub mod script_api;
pub mod script_diagnostics;
pub mod script_introspection;
pub mod debug_collector;
pub mod analysis_runner;

// Signal API modules
pub mod signal;
pub mod signal_stats;
pub mod signal_state;
pub mod signal_eval;
pub mod signal_rhai;
pub mod musical_time;
pub mod frequency_band;

// Event extraction modules
pub mod event_stream;
pub mod event_extractor;
pub mod event_rhai;

// Mesh asset modules
pub mod mesh_asset;
pub mod deformation;

// Material system
pub mod material;

// Post-processing
pub mod post_processing;

// Frame feedback (V7)
pub mod feedback;
pub mod feedback_rhai;

// Debug visualization
pub mod debug_markers;

// Particle system modules
pub mod particle;
pub mod particle_eval;
pub mod particle_rhai;

// Native-only modules (CLI, rendering, video encoding)
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
#[cfg(not(target_arch = "wasm32"))]
pub mod render_job;
#[cfg(not(target_arch = "wasm32"))]
pub mod video_encode;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
