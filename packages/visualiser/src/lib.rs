pub mod gpu;
pub mod input;
pub mod visualiser;
pub mod sparkline;

#[cfg(not(target_arch = "wasm32"))]
pub mod cli;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
