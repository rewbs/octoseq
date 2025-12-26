//! Test that all Rhai code blocks in scripting.md parse correctly.
//!
//! Run with: cargo test --test scripting_docs

use std::fs;
use visualiser::scripting::ScriptEngine;

/// Extract all Rhai code blocks from markdown content
fn extract_rhai_blocks(content: &str) -> Vec<(usize, String)> {
    let mut blocks = Vec::new();
    let mut in_rhai_block = false;
    let mut current_block = String::new();
    let mut block_start_line = 0;

    for (line_num, line) in content.lines().enumerate() {
        if line.trim().starts_with("```rhai") {
            in_rhai_block = true;
            block_start_line = line_num + 1;
            current_block.clear();
        } else if in_rhai_block && line.trim() == "```" {
            in_rhai_block = false;
            blocks.push((block_start_line, current_block.clone()));
        } else if in_rhai_block {
            current_block.push_str(line);
            current_block.push('\n');
        }
    }

    blocks
}

fn wrap_snippet_for_execution(snippet: &str) -> String {
    // Many documentation blocks are fragments (not full scripts). To validate that
    // they remain compatible with the host API, we execute them inside a function
    // with a small set of placeholder bindings.
    //
    // Full scripts (those defining init/update) are executed as-is.
    let trimmed = snippet.trim();
    if trimmed.contains("fn init") || trimmed.contains("fn update") {
        return snippet.to_string();
    }

    // Some docs blocks assume a non-empty EventStream and index into the span array.
    // In playback mode, `pick.events()` yields an empty stream, so we provide a tiny
    // fake `events` object only for those snippets to avoid out-of-bounds errors.
    let needs_non_empty_events = snippet.contains("events.time_span()") && snippet.contains("span[0]");

    let events_binding = if needs_non_empty_events {
        r#"
// Fake non-empty events object for docs snippets that index into time_span()
let events = #{};
events.len = || 1;
events.is_empty = || false;
events.get = |idx| #{
    time: 0.0,
    weight: 1.0,
    beat_position: 0.0,
    beat_phase: 0.0,
    cluster_id: -1
};
events.to_array = || [this.get(0)];
events.time_span = || [0.0, 1.0];
events.max_weight = || 1.0;
events.min_weight = || 1.0;
events.filter_time = |start, end| this;
events.filter_weight = |min_weight| this;
events.limit = |max_events| this;
events.to_signal = || gen.constant(0.0);
"#
    } else {
        r#"let events = inputs.time.pick.events(#{});"#
    };

    format!(
        r#"
// Common placeholders used in docs
let cube = mesh.cube();
let entity = cube;
let sparkline = line.strip(#{{ max_points: 8 }});
let value = 0.0;

// Signal placeholders
let signal = inputs.time;
let signal1 = inputs.time;
let signal2 = inputs.time;
let sig1 = inputs.time;
let sig2 = inputs.time;
{events_binding}

{snippet}
"#,
        events_binding = events_binding,
        snippet = snippet,
    )
}

#[test]
fn test_all_rhai_blocks_parse() {
    // Read the scripting.md file
    let scripting_md_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripting.md");
    let content = fs::read_to_string(scripting_md_path)
        .expect("Failed to read scripting.md");

    let blocks = extract_rhai_blocks(&content);
    assert!(!blocks.is_empty(), "No Rhai code blocks found in scripting.md");

    let mut errors = Vec::new();

    // Common signal names used in documentation
    let signal_names: Vec<String> = vec![
        "time",
        "dt",
        "amplitude",
        "spectralCentroid",
        "spectralFlux",
        "onsetEnvelope",
        "beatPosition",
        "beatIndex",
        "beatPhase",
        "bpm",
        "energy",
        "brightness",
        "bass",
        "mids",
        "highs",
    ]
    .into_iter()
    .map(|s| s.to_string())
    .collect();

    for (line_num, block) in &blocks {
        // Create a fresh ScriptEngine for each block (uses proper configuration)
        let mut engine = ScriptEngine::new();

        // Set up common signal names so inputs.xxx works
        engine.set_available_signals(signal_names.clone());

        let script = wrap_snippet_for_execution(block);

        // Try to load the script (this compiles and validates it)
        if !engine.load_script(&script) {
            let error_msg = engine.last_error.clone().unwrap_or("Unknown error".to_string());
            errors.push(format!(
                "Block starting at line {} failed to parse:\n{}\nError: {}",
                line_num,
                block.lines().take(3).collect::<Vec<_>>().join("\n"),
                error_msg
            ));
        }
    }

    if !errors.is_empty() {
        panic!(
            "Found {} parsing error(s) in scripting.md:\n\n{}",
            errors.len(),
            errors.join("\n\n---\n\n")
        );
    }

    println!("Successfully parsed {} Rhai code blocks", blocks.len());
}
