//! Rhai registration and namespace generation for lighting controls.
//!
//! The lighting system is exposed as a global Map in Rhai scripts, with properties
//! that can be set to either numeric literals or Signal graphs.

use rhai::Dynamic;

use crate::camera::Vec3Signal;
use crate::feedback::SignalOrF32;
use crate::lighting::{LightingConfig, LightingUniforms};
use crate::signal::Signal;
use crate::signal_eval::EvalContext;

/// Generate the lighting namespace Rhai code.
///
/// This creates a global `lighting` Map with default properties that scripts
/// can modify. Properties accept either literals or Signals.
pub fn generate_lighting_namespace() -> String {
    r#"
// === Lighting Namespace ===
let lighting = #{};
lighting.__type = "lighting";

// Enable/disable lighting globally
lighting.enabled = false;

// Light direction (points FROM light source, like sun direction)
// Default: from upper-left-front (classic key light position)
lighting.direction = #{ x: -0.3, y: -1.0, z: -0.5 };

// Light intensity multiplier (0.0 - 2.0+)
lighting.intensity = 1.0;

// Light color (RGB, 0.0 - 1.0)
lighting.color = #{ x: 1.0, y: 1.0, z: 1.0 };

// Ambient light intensity (adds to all surfaces equally)
lighting.ambient = 0.3;

// Rim lighting intensity (highlights edges facing away from camera)
// Set to 0 to disable rim lighting
lighting.rim_intensity = 0.0;

// Rim lighting power (higher = sharper rim effect)
lighting.rim_power = 2.0;

// === Lighting Helper Methods ===

// enable() - Enable lighting
lighting.enable = || {
    this.enabled = true;
};

// disable() - Disable lighting
lighting.disable = || {
    this.enabled = false;
};

// setDirection(x, y, z) - Set light direction
lighting.setDirection = |x, y, z| {
    this.direction = #{ x: x, y: y, z: z };
};

// setColor(r, g, b) - Set light color
lighting.setColor = |r, g, b| {
    this.color = #{ x: r, y: g, z: b };
};
"#
    .to_string()
}

/// Convert a Dynamic value to SignalOrF32.
fn to_signal_or_f32(value: &Dynamic) -> Option<SignalOrF32> {
    // Try f64 (Rhai's default numeric type)
    if let Some(f) = value.clone().try_cast::<f64>() {
        return Some(SignalOrF32::Scalar(f as f32));
    }

    // Try f32
    if let Some(f) = value.clone().try_cast::<f32>() {
        return Some(SignalOrF32::Scalar(f));
    }

    // Try i64 (Rhai integers)
    if let Some(i) = value.clone().try_cast::<i64>() {
        return Some(SignalOrF32::Scalar(i as f32));
    }

    // Try i32
    if let Some(i) = value.clone().try_cast::<i32>() {
        return Some(SignalOrF32::Scalar(i as f32));
    }

    // Try Signal
    if let Some(signal) = value.clone().try_cast::<Signal>() {
        return Some(SignalOrF32::Signal(signal));
    }

    None
}

/// Parse a Vec3 from a Rhai Map, converting each component to SignalOrF32.
fn parse_vec3_from_map(map: &rhai::Map) -> Option<Vec3Signal> {
    let x = map.get("x").and_then(to_signal_or_f32)?;
    let y = map.get("y").and_then(to_signal_or_f32)?;
    let z = map.get("z").and_then(to_signal_or_f32)?;
    Some(Vec3Signal { x, y, z })
}

/// Sync lighting configuration from the Rhai scope.
///
/// Reads the `lighting` Map from scope and converts it to LightingConfig.
/// Returns the config and evaluated uniforms.
pub fn sync_lighting_from_scope(
    scope: &rhai::Scope<'static>,
    eval_ctx: &mut EvalContext<'_>,
) -> (LightingConfig, LightingUniforms) {
    // Get the lighting Map from scope
    let lighting_map = match scope.get_value::<rhai::Map>("lighting") {
        Some(m) => m,
        None => {
            // No lighting in scope, return defaults
            let config = LightingConfig::default();
            let uniforms = config.to_uniforms(eval_ctx);
            return (config, uniforms);
        }
    };

    let mut config = LightingConfig::default();

    // Parse enabled
    if let Some(enabled) = lighting_map.get("enabled").and_then(|d| d.as_bool().ok()) {
        config.enabled = enabled;
    }

    // Parse direction
    if let Some(dir) = lighting_map
        .get("direction")
        .and_then(|d| d.clone().try_cast::<rhai::Map>())
    {
        if let Some(vec3) = parse_vec3_from_map(&dir) {
            config.direction = vec3;
        }
    }

    // Parse intensity
    if let Some(intensity) = lighting_map.get("intensity").and_then(to_signal_or_f32) {
        config.intensity = intensity;
    }

    // Parse color
    if let Some(color) = lighting_map
        .get("color")
        .and_then(|d| d.clone().try_cast::<rhai::Map>())
    {
        if let Some(vec3) = parse_vec3_from_map(&color) {
            config.color = vec3;
        }
    }

    // Parse ambient
    if let Some(ambient) = lighting_map.get("ambient").and_then(to_signal_or_f32) {
        config.ambient = ambient;
    }

    // Parse rim_intensity
    if let Some(rim_intensity) = lighting_map.get("rim_intensity").and_then(to_signal_or_f32) {
        config.rim_intensity = rim_intensity;
    }

    // Parse rim_power
    if let Some(rim_power) = lighting_map.get("rim_power").and_then(to_signal_or_f32) {
        config.rim_power = rim_power;
    }

    // Evaluate signals to produce uniforms
    let uniforms = config.to_uniforms(eval_ctx);

    (config, uniforms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_lighting_namespace() {
        let ns = generate_lighting_namespace();
        assert!(ns.contains("let lighting = #{};"));
        assert!(ns.contains("lighting.enabled"));
        assert!(ns.contains("lighting.direction"));
        assert!(ns.contains("lighting.intensity"));
        assert!(ns.contains("lighting.color"));
        assert!(ns.contains("lighting.ambient"));
        assert!(ns.contains("lighting.rim_intensity"));
        assert!(ns.contains("lighting.rim_power"));
    }
}
