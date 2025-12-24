//! Rhai integration for the Signal API.
//!
//! This module registers Signal and its fluent builders with the Rhai engine,
//! enabling scripts to use the Signal API with method chaining.

use rhai::{Engine, ImmutableString};

use crate::event_rhai::{register_event_api, PickBuilder};
use crate::signal::{
    GateBuilder, GeneratorNode, NormaliseBuilder, NoiseType, Signal, SmoothBuilder,
};

/// Register Signal API types and functions with a Rhai engine.
pub fn register_signal_api(engine: &mut Engine) {
    // === Register Signal type ===
    engine.register_type_with_name::<Signal>("Signal");

    // === Arithmetic methods on Signal ===
    engine.register_fn("add", |s: &mut Signal, other: Signal| s.add(other));
    engine.register_fn("add", |s: &mut Signal, value: f32| s.add_scalar(value));
    engine.register_fn("mul", |s: &mut Signal, other: Signal| s.mul(other));
    engine.register_fn("scale", |s: &mut Signal, factor: f32| s.scale(factor));
    engine.register_fn("mix", |s: &mut Signal, other: Signal, weight: f32| {
        s.mix(other, weight)
    });

    // === Debug method ===
    engine.register_fn("debug", |s: &mut Signal, name: ImmutableString| {
        s.debug(name.as_str())
    });

    // === Math primitives ===
    engine.register_fn("clamp", |s: &mut Signal, min: f32, max: f32| s.clamp(min, max));
    engine.register_fn("floor", |s: &mut Signal| s.floor());
    engine.register_fn("ceil", |s: &mut Signal| s.ceil());

    // === Rate and accumulation ===
    engine.register_fn("diff", |s: &mut Signal| s.diff());
    engine.register_fn("integrate", |s: &mut Signal, decay_beats: f32| {
        s.integrate(decay_beats)
    });

    // === Time shifting ===
    engine.register_fn("delay", |s: &mut Signal, beats: f32| s.delay(beats));
    engine.register_fn("anticipate", |s: &mut Signal, beats: f32| s.anticipate(beats));

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

    // === Constant signal ===
    engine.register_fn("__signal_constant", |value: f32| Signal::constant(value));
}

/// Rhai code to inject at script load time for the Signal API.
///
/// This provides the `gen` namespace and `inputs` object.
pub const SIGNAL_API_RHAI: &str = r#"
// === Signal Generators Namespace ===
let gen = #{};
gen.sin = |freq, phase| __gen_sin(freq, phase);
gen.square = |freq, phase, duty| __gen_square(freq, phase, duty);
gen.triangle = |freq, phase| __gen_triangle(freq, phase);
gen.saw = |freq, phase| __gen_saw(freq, phase);
gen.noise = |noise_type, seed| __gen_noise(noise_type, seed);
gen.perlin = |scale, seed| __gen_perlin(scale, seed);

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
    let mut code = String::from("let inputs = #{};\n");

    for name in signal_names {
        code.push_str(&format!(
            "inputs.{} = __signal_input(\"{}\");\n",
            name, name
        ));
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
}
