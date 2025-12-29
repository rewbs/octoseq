//! Rhai integration for the Signal API.
//!
//! This module registers Signal and its fluent builders with the Rhai engine,
//! enabling scripts to use the Signal API with method chaining.

use std::cell::RefCell;
use std::collections::HashMap;

use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString};

use crate::event_rhai::{register_event_api, PickBuilder};
use crate::input::InputSignal;
use crate::signal::{
    GateBuilder, GeneratorNode, NormaliseBuilder, NoiseType, Signal, SignalNode, SignalParam,
    SmoothBuilder,
};

// Thread-local storage for input signals during script execution.
// Used by sample_at to access raw signal data at specific times.
thread_local! {
    static CURRENT_INPUT_SIGNALS: RefCell<Option<HashMap<String, InputSignal>>> = const { RefCell::new(None) };
    static CURRENT_BAND_SIGNALS: RefCell<Option<HashMap<String, HashMap<String, InputSignal>>>> = const { RefCell::new(None) };
}

/// Set the input signals for the current thread (call before script execution).
pub fn set_current_input_signals(
    inputs: HashMap<String, InputSignal>,
    bands: HashMap<String, HashMap<String, InputSignal>>,
) {
    CURRENT_INPUT_SIGNALS.with(|cell| {
        *cell.borrow_mut() = Some(inputs);
    });
    CURRENT_BAND_SIGNALS.with(|cell| {
        *cell.borrow_mut() = Some(bands);
    });
}

/// Clear the input signals for the current thread (call after script execution).
pub fn clear_current_input_signals() {
    CURRENT_INPUT_SIGNALS.with(|cell| {
        *cell.borrow_mut() = None;
    });
    CURRENT_BAND_SIGNALS.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

/// Convert a Rhai Dynamic value to SignalParam.
///
/// Accepts:
/// - f32/f64: Converts to SignalParam::Scalar
/// - i64/i32: Converts to SignalParam::Scalar
/// - Signal: Converts to SignalParam::Signal
fn to_signal_param(value: Dynamic) -> Result<SignalParam, Box<EvalAltResult>> {
    // Try f64 (Rhai's default float type)
    if let Some(f) = value.clone().try_cast::<f64>() {
        return Ok(SignalParam::Scalar(f as f32));
    }

    // Try f32 (in case a Rust f32 is passed through)
    if let Some(f) = value.clone().try_cast::<f32>() {
        return Ok(SignalParam::Scalar(f));
    }

    // Try i64 (Rhai's default integer type)
    if let Some(i) = value.clone().try_cast::<i64>() {
        return Ok(SignalParam::Scalar(i as f32));
    }

    // Try i32 (in case a Rust i32 is passed through)
    if let Some(i) = value.clone().try_cast::<i32>() {
        return Ok(SignalParam::Scalar(i as f32));
    }

    // Try Signal
    if let Some(signal) = value.clone().try_cast::<Signal>() {
        return Ok(SignalParam::Signal(Box::new(signal)));
    }

    Err(format!(
        "Expected number or Signal for signal parameter, got {}",
        value.type_name()
    )
    .into())
}

/// Register Signal API types and functions with a Rhai engine.
pub fn register_signal_api(engine: &mut Engine) {
    // === Register Signal type ===
    engine.register_type_with_name::<Signal>("Signal");

    // === Arithmetic methods on Signal ===
    engine.register_fn("add", |s: &mut Signal, other: Signal| s.add(other));
    engine.register_fn("add", |s: &mut Signal, value: f32| s.add_scalar(value));
    engine.register_fn("mul", |s: &mut Signal, other: Signal| s.mul(other));
    engine.register_fn(
        "scale",
        |s: &mut Signal, factor: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.scale(to_signal_param(factor)?))
        },
    );
    engine.register_fn(
        "mix",
        |s: &mut Signal, other: Signal, weight: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.mix(other, to_signal_param(weight)?))
        },
    );

    // === Debug methods ===
    engine.register_fn("probe", |s: &mut Signal, name: ImmutableString| {
        s.probe(name.as_str())
    });
    engine.register_fn("describe", |s: &mut Signal| -> ImmutableString {
        s.describe().into()
    });

    // === Math primitives ===
    engine.register_fn(
        "clamp",
        |s: &mut Signal, min: Dynamic, max: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.clamp(to_signal_param(min)?, to_signal_param(max)?))
        },
    );
    engine.register_fn("floor", |s: &mut Signal| s.floor());
    engine.register_fn("ceil", |s: &mut Signal| s.ceil());
    engine.register_fn("abs", |s: &mut Signal| s.abs());
    engine.register_fn(
        "sigmoid",
        |s: &mut Signal, k: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.sigmoid(to_signal_param(k)?))
        },
    );
    engine.register_fn("round", |s: &mut Signal| s.round());
    engine.register_fn("sign", |s: &mut Signal| s.sign());
    engine.register_fn("neg", |s: &mut Signal| s.neg());

    // === Extended arithmetic ===
    engine.register_fn("sub", |s: &mut Signal, other: Signal| s.sub(other));
    engine.register_fn("sub", |s: &mut Signal, value: f32| s.sub_scalar(value));
    engine.register_fn("div", |s: &mut Signal, other: Signal| s.div(other));
    engine.register_fn("div", |s: &mut Signal, value: f32| s.div_scalar(value));
    engine.register_fn(
        "pow",
        |s: &mut Signal, exponent: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.pow(to_signal_param(exponent)?))
        },
    );
    engine.register_fn(
        "offset",
        |s: &mut Signal, amount: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.offset(to_signal_param(amount)?))
        },
    );

    // === Trigonometric (value transformation) ===
    // Note: These transform the signal VALUE, unlike gen.sin() which generates oscillators
    engine.register_fn("sin", |s: &mut Signal| s.sin());
    engine.register_fn("cos", |s: &mut Signal| s.cos());
    engine.register_fn("tan", |s: &mut Signal| s.tan());
    engine.register_fn("asin", |s: &mut Signal| s.asin());
    engine.register_fn("acos", |s: &mut Signal| s.acos());
    engine.register_fn("atan", |s: &mut Signal| s.atan());
    engine.register_fn("atan2", |s: &mut Signal, x: Signal| s.atan2(x));

    // === Exponential and logarithmic ===
    engine.register_fn("sqrt", |s: &mut Signal| s.sqrt());
    engine.register_fn("exp", |s: &mut Signal| s.exp());
    engine.register_fn("ln", |s: &mut Signal| s.ln());
    engine.register_fn(
        "log",
        |s: &mut Signal, base: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.log(to_signal_param(base)?))
        },
    );

    // === Modular / periodic ===
    engine.register_fn(
        "modulo",
        |s: &mut Signal, divisor: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.modulo(to_signal_param(divisor)?))
        },
    );
    engine.register_fn(
        "rem",
        |s: &mut Signal, divisor: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.rem(to_signal_param(divisor)?))
        },
    );
    engine.register_fn(
        "wrap",
        |s: &mut Signal, min: Dynamic, max: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.wrap(to_signal_param(min)?, to_signal_param(max)?))
        },
    );
    engine.register_fn("fract", |s: &mut Signal| s.fract());

    // === Mapping / shaping ===
    engine.register_fn(
        "map",
        |s: &mut Signal,
         in_min: Dynamic,
         in_max: Dynamic,
         out_min: Dynamic,
         out_max: Dynamic|
         -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.map(
                to_signal_param(in_min)?,
                to_signal_param(in_max)?,
                to_signal_param(out_min)?,
                to_signal_param(out_max)?,
            ))
        },
    );
    engine.register_fn(
        "smoothstep",
        |s: &mut Signal, edge0: Dynamic, edge1: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.smoothstep(to_signal_param(edge0)?, to_signal_param(edge1)?))
        },
    );
    engine.register_fn(
        "lerp",
        |s: &mut Signal, other: Signal, t: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.lerp(other, to_signal_param(t)?))
        },
    );

    // === Rate and accumulation ===
    engine.register_fn("diff", |s: &mut Signal| s.diff());
    engine.register_fn(
        "integrate",
        |s: &mut Signal, decay_beats: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.integrate(to_signal_param(decay_beats)?))
        },
    );

    // === Time shifting ===
    engine.register_fn(
        "delay",
        |s: &mut Signal, beats: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.delay(to_signal_param(beats)?))
        },
    );
    engine.register_fn(
        "anticipate",
        |s: &mut Signal, beats: Dynamic| -> Result<Signal, Box<EvalAltResult>> {
            Ok(s.anticipate(to_signal_param(beats)?))
        },
    );

    // === Explicit sampling (escape hatch) ===
    // WARNING: This is an imperative escape hatch. Only works reliably on Input/BandInput signals.
    // For most use cases, prefer declarative transformations.
    engine.register_fn("sample_at", |s: &mut Signal, time: f32| -> f32 {
        match &*s.node {
            SignalNode::Input { name, .. } => {
                // Handle special time signals
                match name.as_str() {
                    "time" | "time.seconds" => time,
                    "time.dt" | "dt" => 0.016, // Default dt assumption
                    "time.frames" => 0.0, // Cannot determine frame count from time alone
                    "time.beats" | "time.phase" | "time.bpm" => {
                        log::warn!(
                            "sample_at: Cannot sample time.{} without musical context",
                            name
                        );
                        0.0
                    }
                    _ => {
                        // Try to sample from stored input signals
                        CURRENT_INPUT_SIGNALS.with(|cell| {
                            if let Some(ref inputs) = *cell.borrow() {
                                if let Some(sig) = inputs.get(name) {
                                    return sig.sample(time);
                                }
                            }
                            log::warn!("sample_at: Input '{}' not available for sampling", name);
                            0.0
                        })
                    }
                }
            }
            SignalNode::BandInput {
                band_key, feature, ..
            } => CURRENT_BAND_SIGNALS.with(|cell| {
                if let Some(ref bands) = *cell.borrow() {
                    if let Some(features) = bands.get(band_key) {
                        if let Some(sig) = features.get(feature) {
                            return sig.sample(time);
                        }
                    }
                }
                log::warn!(
                    "sample_at: Band '{}' feature '{}' not available for sampling",
                    band_key,
                    feature
                );
                0.0
            }),
            SignalNode::Constant(v) => *v,
            _ => {
                log::warn!(
                    "sample_at: Only Input/BandInput/Constant signals can be sampled. \
                     For composed signals, this returns 0.0. \
                     Prefer declarative signal bindings instead."
                );
                0.0
            }
        }
    });

    // === Sampling configuration ===
    // Change from default peak-preserving to linear interpolation
    engine.register_fn("interpolate", |s: &mut Signal| s.interpolate());
    // Explicitly use peak-preserving with frame dt (same as default)
    engine.register_fn("peak", |s: &mut Signal| s.peak());
    // Peak-preserving with custom window in beats
    engine.register_fn("peak_window", |s: &mut Signal, beats: f32| {
        s.peak_window_beats(beats)
    });
    // Peak-preserving with custom window in seconds
    engine.register_fn("peak_window_sec", |s: &mut Signal, seconds: f32| {
        s.peak_window_seconds(seconds)
    });

    // === Fluent namespace getters ===
    // signal.smooth -> SmoothBuilder
    engine.register_type_with_name::<SmoothBuilder>("SmoothBuilder");
    engine.register_get("smooth", |s: &mut Signal| SmoothBuilder::new(s.clone()));

    // signal.normalise -> NormaliseBuilder
    engine.register_type_with_name::<NormaliseBuilder>("NormaliseBuilder");
    engine.register_get("normalise", |s: &mut Signal| NormaliseBuilder::new(s.clone()));

    // signal.gate -> GateBuilder
    engine.register_type_with_name::<GateBuilder>("GateBuilder");
    engine.register_get("gate", |s: &mut Signal| GateBuilder::new(s.clone()));

    // === SmoothBuilder methods ===
    engine.register_fn("moving_average", |b: &mut SmoothBuilder, beats: f32| {
        b.clone().moving_average(beats)
    });
    engine.register_fn(
        "exponential",
        |b: &mut SmoothBuilder, attack: f32, release: f32| b.clone().exponential(attack, release),
    );
    engine.register_fn("gaussian", |b: &mut SmoothBuilder, sigma: f32| {
        b.clone().gaussian(sigma)
    });

    // === NormaliseBuilder methods ===
    engine.register_fn("global", |b: &mut NormaliseBuilder| b.clone().global());
    engine.register_fn("robust", |b: &mut NormaliseBuilder| b.clone().robust());
    engine.register_fn("to_range", |b: &mut NormaliseBuilder, min: f32, max: f32| {
        b.clone().to_range(min, max)
    });

    // === GateBuilder methods ===
    engine.register_fn("threshold", |b: &mut GateBuilder, threshold: f32| {
        b.clone().threshold(threshold)
    });
    engine.register_fn("hysteresis", |b: &mut GateBuilder, on: f32, off: f32| {
        b.clone().hysteresis(on, off)
    });

    // === PickBuilder ===
    // signal.pick -> PickBuilder (for event extraction)
    engine.register_type_with_name::<PickBuilder>("PickBuilder");
    engine.register_get("pick", |s: &mut Signal| PickBuilder::new(s.clone()));

    // === Register Event API ===
    register_event_api(engine);

    // === Generator functions (standalone) ===
    // These are registered as functions, not methods, since they create new Signals

    engine.register_fn("__gen_sin", |freq: f32, phase: f32| {
        Signal::generator(GeneratorNode::Sin {
            freq_beats: freq,
            phase,
        })
    });

    engine.register_fn("__gen_square", |freq: f32, phase: f32, duty: f32| {
        Signal::generator(GeneratorNode::Square {
            freq_beats: freq,
            phase,
            duty,
        })
    });

    engine.register_fn("__gen_triangle", |freq: f32, phase: f32| {
        Signal::generator(GeneratorNode::Triangle {
            freq_beats: freq,
            phase,
        })
    });

    engine.register_fn("__gen_saw", |freq: f32, phase: f32| {
        Signal::generator(GeneratorNode::Saw {
            freq_beats: freq,
            phase,
        })
    });

    engine.register_fn("__gen_noise", |noise_type: ImmutableString, seed: i64| {
        let nt = match noise_type.as_str() {
            "pink" => NoiseType::Pink,
            _ => NoiseType::White,
        };
        Signal::generator(GeneratorNode::Noise {
            noise_type: nt,
            seed: seed as u64,
        })
    });

    engine.register_fn("__gen_perlin", |scale: f32, seed: i64| {
        Signal::generator(GeneratorNode::Perlin {
            scale_beats: scale,
            seed: seed as u64,
        })
    });

    // === Input signal accessor ===
    engine.register_fn("__signal_input", |name: ImmutableString| {
        Signal::input(name.as_str())
    });

    // === Band input signal accessor ===
    engine.register_fn(
        "__band_signal_input",
        |band_key: ImmutableString, feature: ImmutableString| {
            Signal::band_input(band_key.as_str(), feature.as_str())
        },
    );

    // === Band events accessor ===
    // Returns pre-extracted EventStream for a band, or empty if not available.
    engine.register_fn("__band_events_get", |band_id: ImmutableString| {
        use crate::event_rhai::get_band_event_stream;
        use crate::event_stream::{EventStream, PickEventsOptions};

        get_band_event_stream(band_id.as_str()).unwrap_or_else(|| {
            EventStream::new(
                Vec::new(),
                format!("band_events:{}", band_id),
                PickEventsOptions::default(),
            )
        })
    });

    // === Constant signal ===
    engine.register_fn("__signal_constant", |value: f32| Signal::constant(value));
}

/// Rhai code to inject at script load time for the Signal API.
///
/// This provides the `gen` namespace, `time` namespace, and `inputs` object.
pub const SIGNAL_API_RHAI: &str = r#"
// === Signal Generators Namespace ===
let gen = #{};
gen.__type = "gen_namespace";
gen.sin = |freq, phase| __gen_sin(freq, phase);
gen.square = |freq, phase, duty| __gen_square(freq, phase, duty);
gen.triangle = |freq, phase| __gen_triangle(freq, phase);
gen.saw = |freq, phase| __gen_saw(freq, phase);
gen.noise = |noise_type, seed| __gen_noise(noise_type, seed);
gen.perlin = |scale, seed| __gen_perlin(scale, seed);
gen.constant = |value| __signal_constant(value);

// === Time Namespace ===
// Canonical time signals for declarative time-based animation.
// These are Signals, not numbers - use them in signal graphs.
let time = #{};
time.__type = "time_namespace";
time.seconds = __signal_input("time.seconds");
time.frames = __signal_input("time.frames");
time.beats = __signal_input("time.beats");
time.phase = __signal_input("time.phase");
time.bpm = __signal_input("time.bpm");
time.dt = __signal_input("time.dt");

// === Inputs Namespace ===
// This object provides Signal-returning accessors for input signals.
// Each available signal is added dynamically at script load time.
// Scripts access signals as: inputs.energy, inputs.spectralCentroid, etc.
"#;

/// Generate Rhai code to populate the inputs namespace based on available signals.
///
/// This generates code like:
/// ```rhai
/// inputs.energy = __signal_input("energy");
/// inputs.spectralCentroid = __signal_input("spectralCentroid");
/// ```
pub fn generate_inputs_namespace(signal_names: &[&str]) -> String {
    let mut code = String::from("let inputs = #{};\ninputs.__type = \"inputs_signals\";\n");

    for name in signal_names {
        code.push_str(&format!(
            "inputs.{} = __signal_input(\"{}\");\n",
            name, name
        ));
    }

    code
}

/// Generate Rhai code for the inputs.bands namespace.
///
/// Creates entries for both band IDs and labels for dual-access support.
/// Each band has energy, onset, flux, amplitude (alias for energy), and events properties.
///
/// This generates code like:
/// ```rhai
/// inputs.bands = #{};
/// inputs.bands["band-abc123"] = #{};
/// inputs.bands["band-abc123"].energy = __band_signal_input("band-abc123", "energy");
/// inputs.bands["band-abc123"].onset = __band_signal_input("band-abc123", "onset");
/// inputs.bands["band-abc123"].flux = __band_signal_input("band-abc123", "flux");
/// inputs.bands["band-abc123"].amplitude = __band_signal_input("band-abc123", "energy");
/// inputs.bands["band-abc123"].events = __band_events_get("band-abc123");
/// inputs.bands["Bass"] = inputs.bands["band-abc123"];
/// ```
pub fn generate_bands_namespace(bands: &[(String, String)]) -> String {
    let mut code = String::from("inputs.bands = #{};\ninputs.bands.__type = \"bands_namespace\";\n");

    for (id, label) in bands {
        // Create band object with signal accessors (keyed by ID)
        code.push_str(&format!(
            r#"inputs.bands["{id}"] = #{{}};
inputs.bands["{id}"].__type = "band_signals";
inputs.bands["{id}"].energy = __band_signal_input("{id}", "energy");
inputs.bands["{id}"].onset = __band_signal_input("{id}", "onset");
inputs.bands["{id}"].flux = __band_signal_input("{id}", "flux");
inputs.bands["{id}"].amplitude = __band_signal_input("{id}", "energy");
inputs.bands["{id}"].events = __band_events_get("{id}");
"#,
            id = id
        ));

        // Also register by label if different from ID
        if label != id {
            code.push_str(&format!(
                r#"inputs.bands["{label}"] = inputs.bands["{id}"];
"#,
                label = label,
                id = id
            ));
        }
    }

    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_inputs_namespace() {
        let names = vec!["energy", "spectralCentroid", "onsetEnvelope"];
        let code = generate_inputs_namespace(&names);

        assert!(code.contains("let inputs = #{};"));
        assert!(code.contains("inputs.energy = __signal_input(\"energy\");"));
        assert!(code.contains("inputs.spectralCentroid = __signal_input(\"spectralCentroid\");"));
        assert!(code.contains("inputs.onsetEnvelope = __signal_input(\"onsetEnvelope\");"));
    }

    #[test]
    fn test_register_signal_api() {
        let mut engine = Engine::new();
        register_signal_api(&mut engine);

        // Should compile without error - basic validation that types are registered
        let result = engine.compile("let s = __signal_constant(1.0);");
        assert!(result.is_ok());
    }

    #[test]
    fn test_generate_bands_namespace() {
        let bands = vec![
            ("band-123".to_string(), "Bass".to_string()),
            ("band-456".to_string(), "Mids".to_string()),
        ];
        let code = generate_bands_namespace(&bands);

        // Check structure
        assert!(code.contains("inputs.bands = #{};"));

        // Check band-123 / Bass
        assert!(code.contains(r#"inputs.bands["band-123"] = #{};"#));
        assert!(code.contains(r#"inputs.bands["band-123"].energy = __band_signal_input("band-123", "energy");"#));
        assert!(code.contains(r#"inputs.bands["band-123"].onset = __band_signal_input("band-123", "onset");"#));
        assert!(code.contains(r#"inputs.bands["band-123"].flux = __band_signal_input("band-123", "flux");"#));
        assert!(code.contains(r#"inputs.bands["band-123"].amplitude = __band_signal_input("band-123", "energy");"#));
        assert!(code.contains(r#"inputs.bands["band-123"].events = __band_events_get("band-123");"#));
        assert!(code.contains(r#"inputs.bands["Bass"] = inputs.bands["band-123"];"#));

        // Check band-456 / Mids
        assert!(code.contains(r#"inputs.bands["band-456"] = #{};"#));
        assert!(code.contains(r#"inputs.bands["Mids"] = inputs.bands["band-456"];"#));
    }

    #[test]
    fn test_generate_bands_namespace_same_id_and_label() {
        // Edge case: if ID and label are the same, don't duplicate
        let bands = vec![("MyBand".to_string(), "MyBand".to_string())];
        let code = generate_bands_namespace(&bands);

        // Should have the band object
        assert!(code.contains(r#"inputs.bands["MyBand"] = #{};"#));
        assert!(code.contains(r#"inputs.bands["MyBand"].energy"#));

        // Should NOT have a duplicate alias line
        let alias_count = code.matches(r#"inputs.bands["MyBand"] = inputs.bands["MyBand"]"#).count();
        assert_eq!(alias_count, 0);
    }
}
