#![allow(clippy::too_many_arguments)]
#![allow(clippy::should_implement_trait)]
#![allow(clippy::ptr_arg)]

pub mod analysis_runner;
pub mod debug_collector;
pub mod gpu;
pub mod input;
pub mod scene_graph;
pub mod script_api;
pub mod script_diagnostics;
pub mod script_introspection;
pub mod script_log;
pub mod scripting;
pub mod sparkline;
pub mod visualiser;

// Signal API modules
pub mod frequency_band;
pub mod musical_time;
pub mod signal;
pub mod signal_eval;
pub mod signal_explorer;
pub mod signal_rhai;
pub mod signal_state;
pub mod signal_stats;

// Event extraction modules
pub mod event_extractor;
pub mod event_rhai;
pub mod event_stream;

// Interpretation package loading (Phase 3: the wasm push contract, serialized)
pub mod interpretation_package;

// Musical roles: what scenes ask for and bundles bind
pub mod roles;

// Shows: which scene plays when (read from disk, so native only)
#[cfg(not(target_arch = "wasm32"))]
pub mod show;

// Mesh asset modules
pub mod deformation;
pub mod glb_loader;
pub mod mesh_asset;
pub mod rig_loader;

// Material system
pub mod material;

// Post-processing
pub mod post_processing;

// Frame feedback (V7)
pub mod feedback;
pub mod feedback_rhai;

// Camera control
pub mod camera;
pub mod camera_rhai;

// Lighting control
pub mod lighting;
pub mod lighting_rhai;

// Debug visualization
pub mod debug_markers;

// Performance profiling
pub mod perf_profiling;

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
