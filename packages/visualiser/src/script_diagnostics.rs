//! Structured script diagnostics.
//!
//! Rhai provides rich error types (parse + runtime) with positions. Octoseq wraps
//! those into a stable, JSON-serializable diagnostic format that the UI can
//! surface without requiring access to Rust logs.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScriptDiagnosticKind {
    /// Syntax/parse errors (compile time).
    ParseError,
    /// Runtime errors in user code.
    RuntimeError,
    /// Script attempted to use the host API incorrectly (missing members, wrong types, etc).
    HostApiMisuse,
    /// Internal/host error (e.g. the injected prelude failed).
    HostError,
    /// Lint warning (not an error, but potentially problematic).
    Warning,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScriptPhase {
    Compile,
    Init,
    Update,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptLocation {
    /// 1-based line number in the user script (not the injected prelude).
    pub line: u32,
    /// 1-based column number.
    pub column: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptDiagnostic {
    pub kind: ScriptDiagnosticKind,
    pub phase: ScriptPhase,
    pub message: String,
    pub location: Option<ScriptLocation>,
    /// Raw engine error string (useful for bug reports).
    #[serde(default)]
    pub raw: Option<String>,
}

fn classify_message(message: &str) -> ScriptDiagnosticKind {
    // Rhai error strings are fairly stable; this provides a pragmatic
    // classification without depending on Rhai's internal enum variants.
    let lower = message.to_ascii_lowercase();

    // Common "you used the API wrong" cases.
    if lower.contains("property not found")
        || lower.contains("variable not found")
        || lower.contains("function not found")
        || lower.contains("index")
        || lower.contains("array index")
        || lower.contains("map key")
        || lower.contains("mismatched types")
        || lower.contains("invalid")
    {
        return ScriptDiagnosticKind::HostApiMisuse;
    }

    ScriptDiagnosticKind::RuntimeError
}

fn map_position_to_user(
    line: u32,
    column: u32,
    user_line_offset: usize,
) -> Option<ScriptLocation> {
    let offset = user_line_offset as u32;
    if line == 0 {
        return None;
    }
    if line <= offset {
        return None;
    }
    Some(ScriptLocation {
        line: line - offset,
        column: column.max(1),
    })
}

pub fn from_parse_error(
    err: &rhai::ParseError,
    user_line_offset: usize,
) -> ScriptDiagnostic {
    let raw = err.to_string();

    // Rhai's ParseError exposes a Position.
    let pos = err.position();
    let line = pos.line().unwrap_or(0) as u32;
    let column = pos.position().unwrap_or(0) as u32;
    let location = map_position_to_user(line, column, user_line_offset);

    ScriptDiagnostic {
        kind: ScriptDiagnosticKind::ParseError,
        phase: ScriptPhase::Compile,
        message: raw.clone(),
        location,
        raw: Some(raw),
    }
}

pub fn from_eval_error(
    phase: ScriptPhase,
    err: &rhai::EvalAltResult,
    user_line_offset: usize,
) -> ScriptDiagnostic {
    let raw = err.to_string();
    let kind = classify_message(&raw);

    let pos = err.position();
    let line = pos.line().unwrap_or(0) as u32;
    let column = pos.position().unwrap_or(0) as u32;
    let location = map_position_to_user(line, column, user_line_offset);

    ScriptDiagnostic {
        kind,
        phase,
        message: raw.clone(),
        location,
        raw: Some(raw),
    }
}

/// Lint the script source for common issues and return warnings.
///
/// Currently checks for:
/// - `scene.add()` calls outside of `init()` function
pub fn lint_script(source: &str) -> Vec<ScriptDiagnostic> {
    let mut warnings = Vec::new();

    // Track if we're inside a function definition
    let mut in_init_fn = false;
    let mut brace_depth = 0;
    let mut init_fn_brace_depth = 0;

    for (line_idx, line) in source.lines().enumerate() {
        let line_num = (line_idx + 1) as u32;
        let trimmed = line.trim();

        // Check for function definition start
        if trimmed.starts_with("fn init") && trimmed.contains('(') {
            in_init_fn = true;
            // Count opening braces on this line to set the depth
            init_fn_brace_depth = brace_depth + trimmed.matches('{').count();
        }

        // Track brace depth
        brace_depth += trimmed.matches('{').count();
        brace_depth = brace_depth.saturating_sub(trimmed.matches('}').count());

        // Check if we've exited the init function
        if in_init_fn && brace_depth < init_fn_brace_depth {
            in_init_fn = false;
        }

        // Check for scene.add() outside of init()
        if !in_init_fn && trimmed.contains("scene.add(") {
            // Find the column position
            let column = line.find("scene.add(").map(|c| c as u32 + 1).unwrap_or(1);

            warnings.push(ScriptDiagnostic {
                kind: ScriptDiagnosticKind::Warning,
                phase: ScriptPhase::Compile,
                message: "scene.add() called outside of init() - entities may accumulate on script re-evaluation. Consider moving to init() or calling scene.clear() first.".to_string(),
                location: Some(ScriptLocation { line: line_num, column }),
                raw: None,
            });
        }
    }

    warnings
}
