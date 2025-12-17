#[cfg(not(target_arch = "wasm32"))]
use visualiser::cli;

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    env_logger::init();
    if let Err(e) = cli::run() {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {}
