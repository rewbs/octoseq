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
