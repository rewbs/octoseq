//! Script logging module for Rhai scripts.
//!
//! Provides a `log` global object to Rhai scripts with `info`, `warn`, and `error` methods.
//! Logs are dispatched to the appropriate output based on the build target:
//! - WASM: browser console (console.log/warn/error)
//! - Native: stdout/stderr with level prefixes

use std::sync::atomic::{AtomicU32, Ordering};

/// Maximum number of log messages allowed per frame to prevent spam.
const MAX_LOGS_PER_FRAME: u32 = 100;

/// Global counter for log messages in the current frame.
static LOG_COUNT: AtomicU32 = AtomicU32::new(0);

/// Whether we've already warned about exceeding the log limit this frame.
static WARNED_LIMIT: AtomicU32 = AtomicU32::new(0);

/// Log level for script messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    /// Get the prefix string for CLI output.
    #[cfg(not(target_arch = "wasm32"))]
    fn prefix(&self) -> &'static str {
        match self {
            LogLevel::Info => "[INFO]",
            LogLevel::Warn => "[WARN]",
            LogLevel::Error => "[ERROR]",
        }
    }
}

/// Reset the per-frame log counter. Call this at the start of each frame.
pub fn reset_frame_log_count() {
    LOG_COUNT.store(0, Ordering::Relaxed);
    WARNED_LIMIT.store(0, Ordering::Relaxed);
}

/// Check if we can log another message this frame.
/// Returns true if under the limit, false if exceeded.
fn can_log() -> bool {
    let count = LOG_COUNT.fetch_add(1, Ordering::Relaxed);
    if count >= MAX_LOGS_PER_FRAME {
        // Only warn once per frame about exceeding limit
        if WARNED_LIMIT.swap(1, Ordering::Relaxed) == 0 {
            emit_log(
                LogLevel::Warn,
                &format!(
                    "Script log limit exceeded ({} messages/frame). Further logs dropped.",
                    MAX_LOGS_PER_FRAME
                ),
            );
        }
        false
    } else {
        true
    }
}

/// Emit a log message at the given level.
/// This is the host function that dispatches to the appropriate output.
pub fn emit_log(level: LogLevel, message: &str) {
    #[cfg(target_arch = "wasm32")]
    emit_log_wasm(level, message);

    #[cfg(not(target_arch = "wasm32"))]
    emit_log_native(level, message);
}

/// Emit a log message in WASM (browser console).
#[cfg(target_arch = "wasm32")]
fn emit_log_wasm(level: LogLevel, message: &str) {
    use wasm_bindgen::JsValue;
    use web_sys::console;

    let js_msg = JsValue::from_str(message);
    match level {
        LogLevel::Info => console::log_1(&js_msg),
        LogLevel::Warn => console::warn_1(&js_msg),
        LogLevel::Error => console::error_1(&js_msg),
    }
}

/// Emit a log message in native CLI (stdout/stderr).
#[cfg(not(target_arch = "wasm32"))]
fn emit_log_native(level: LogLevel, message: &str) {
    match level {
        LogLevel::Info => {
            println!("{} {}", level.prefix(), message);
        }
        LogLevel::Warn | LogLevel::Error => {
            eprintln!("{} {}", level.prefix(), message);
        }
    }
}

/// Log a message from a script, respecting the per-frame limit.
pub fn script_log(level: LogLevel, message: &str) {
    if can_log() {
        emit_log(level, message);
    }
}

/// Convert a Rhai Dynamic value to a string safely.
/// Never panics, handles all types gracefully.
pub fn stringify_dynamic(value: &rhai::Dynamic) -> String {
    // Try to get string directly first
    if let Ok(s) = value.clone().into_string() {
        return s;
    }

    // For arrays, stringify each element
    if value.is_array() {
        if let Some(arr) = value.clone().try_cast::<rhai::Array>() {
            let parts: Vec<String> = arr.iter().map(stringify_dynamic).collect();
            return parts.join(" ");
        }
    }

    // For maps, format as key-value pairs
    if value.is_map() {
        if let Some(map) = value.clone().try_cast::<rhai::Map>() {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{}: {}", k, stringify_dynamic(v)))
                .collect();
            return format!("{{{}}}", parts.join(", "));
        }
    }

    // For numbers and other types, use debug format
    if value.is_int() {
        if let Ok(i) = value.as_int() {
            return i.to_string();
        }
    }

    if value.is_float() {
        if let Ok(f) = value.as_float() {
            return format!("{}", f);
        }
    }

    if value.is_bool() {
        if let Ok(b) = value.as_bool() {
            return b.to_string();
        }
    }

    if value.is_unit() {
        return "()".to_string();
    }

    // Fallback: debug format
    format!("{:?}", value)
}

/// Logger type that gets registered with Rhai.
/// This is a simple struct that holds no state - all logging goes through the global functions.
#[derive(Debug, Clone)]
pub struct ScriptLogger;

impl ScriptLogger {
    pub fn new() -> Self {
        Self
    }

    /// Log an info message.
    pub fn info(&self, value: rhai::Dynamic) {
        let message = stringify_dynamic(&value);
        script_log(LogLevel::Info, &message);
    }

    /// Log a warning message.
    pub fn warn(&self, value: rhai::Dynamic) {
        let message = stringify_dynamic(&value);
        script_log(LogLevel::Warn, &message);
    }

    /// Log an error message.
    pub fn error(&self, value: rhai::Dynamic) {
        let message = stringify_dynamic(&value);
        script_log(LogLevel::Error, &message);
    }
}

impl Default for ScriptLogger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stringify_string() {
        let value = rhai::Dynamic::from("hello");
        assert_eq!(stringify_dynamic(&value), "hello");
    }

    #[test]
    fn test_stringify_int() {
        let value = rhai::Dynamic::from(42_i64);
        assert_eq!(stringify_dynamic(&value), "42");
    }

    #[test]
    fn test_stringify_float() {
        let value = rhai::Dynamic::from(3.14_f32);
        assert_eq!(stringify_dynamic(&value), "3.14");
    }

    #[test]
    fn test_stringify_bool() {
        let value = rhai::Dynamic::from(true);
        assert_eq!(stringify_dynamic(&value), "true");
    }

    #[test]
    fn test_stringify_array() {
        let mut arr = rhai::Array::new();
        arr.push(rhai::Dynamic::from("energy"));
        arr.push(rhai::Dynamic::from(0.5_f32));
        let value = rhai::Dynamic::from(arr);
        assert_eq!(stringify_dynamic(&value), "energy 0.5");
    }

    #[test]
    fn test_log_level_prefix() {
        assert_eq!(LogLevel::Info.prefix(), "[INFO]");
        assert_eq!(LogLevel::Warn.prefix(), "[WARN]");
        assert_eq!(LogLevel::Error.prefix(), "[ERROR]");
    }

    #[test]
    fn test_frame_log_limit() {
        reset_frame_log_count();

        // Should be able to log up to the limit
        for _ in 0..MAX_LOGS_PER_FRAME {
            assert!(can_log());
        }

        // Next one should fail
        assert!(!can_log());

        // Reset and should work again
        reset_frame_log_count();
        assert!(can_log());
    }
}
