pub mod gpu;
pub mod input;
pub mod visualiser;
pub mod sparkline;
pub mod scripting;
pub mod scene_graph;
pub mod script_log;

#[cfg(not(target_arch = "wasm32"))]
pub mod cli;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
