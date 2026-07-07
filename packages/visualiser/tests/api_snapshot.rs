//! Script API metadata snapshot.
//!
//! The web app's Monaco registry is checked against a snapshot of the Rust
//! script API metadata (apps/web/src/lib/scripting/registry/rust-api-metadata.json)
//! by a vitest drift test. This test keeps that snapshot in sync with the
//! Rust source of truth:
//!
//! - `cargo test --test api_snapshot` fails if the snapshot is stale.
//! - `UPDATE_API_SNAPSHOT=1 cargo test --test api_snapshot` regenerates it.

use std::fs;
use std::path::PathBuf;

use visualiser::script_api::script_api_metadata_json;

fn snapshot_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/src/lib/scripting/registry/rust-api-metadata.json")
}

fn pretty(json: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(json).expect("metadata JSON is valid");
    let mut out = serde_json::to_string_pretty(&value).expect("re-serialization succeeds");
    out.push('\n');
    out
}

#[test]
fn api_snapshot_up_to_date() {
    let current = pretty(&script_api_metadata_json());
    let path = snapshot_path();

    if std::env::var("UPDATE_API_SNAPSHOT").is_ok() {
        fs::write(&path, &current).expect("failed to write snapshot");
        println!("Snapshot regenerated at {:?}", path);
        return;
    }

    let on_disk = fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "Missing snapshot at {:?}.\nRun: UPDATE_API_SNAPSHOT=1 cargo test --test api_snapshot",
            path
        )
    });

    assert_eq!(
        on_disk, current,
        "Rust script API metadata changed but the snapshot is stale.\n\
         Run: UPDATE_API_SNAPSHOT=1 cargo test --test api_snapshot\n\
         Then fix any registry drift the web tests report."
    );
}
