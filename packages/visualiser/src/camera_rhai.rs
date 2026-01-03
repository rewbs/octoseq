//! Rhai registration and namespace generation for camera controls.
//!
//! The camera is exposed as a global Map in Rhai scripts, with properties
//! that can be set to either numeric literals or Signal graphs.

use rhai::Dynamic;

use crate::camera::{CameraConfig, CameraUniforms, Vec3Signal};
use crate::feedback::SignalOrF32;
use crate::signal::Signal;
use crate::signal_eval::EvalContext;

/// Generate the camera namespace Rhai code.
///
/// This creates a global `camera` Map with default properties that scripts
/// can modify. Properties accept either literals or Signals.
pub fn generate_camera_namespace() -> String {
    r#"
// === Camera Namespace ===
let camera = #{};
camera.__type = "camera";

// Position in world space
camera.position = #{ x: 4.0, y: 2.0, z: 4.0 };

// Rotation in Euler angles (pitch, yaw, roll) in radians
// Used when target is not set (Euler mode)
camera.rotation = #{ x: 0.0, y: 0.0, z: 0.0 };

// Look-at target position
// If set (not unit), enables LookAt mode and derives orientation automatically
camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

// Up vector for LookAt mode
camera.up = #{ x: 0.0, y: 1.0, z: 0.0 };

// Field of view in degrees
camera.fov = 45.0;

// Near and far clip planes
camera.near = 0.1;
camera.far = 100.0;

// === Camera Helper Methods ===

// lookAt(target) - Set the camera to look at a target position
// Enables LookAt mode by setting camera.target
camera.lookAt = |target| {
    this.target = target;
};

// orbit(center, radius, angle) - Position camera on orbit around center
// center: Vec3 position to orbit around
// radius: Distance from center (can be number or Signal)
// angle: Angle in radians around Y-axis (can be number or Signal)
camera.orbit = |center, radius, angle| {
    // Compute position on circular orbit
    // Note: For Signal inputs, we set the position components to expression results
    // which will be evaluated as Signals during sync
    this.position.x = center.x + radius * cos(angle);
    this.position.y = center.y;
    this.position.z = center.z + radius * sin(angle);
    this.target = center;
};

// dolly(distance) - Move camera forward/backward along view direction
// distance: How far to move (positive = forward, negative = backward)
// Works in both Euler and LookAt modes
camera.dolly = |distance| {
    if this.target != () {
        // LookAt mode: move along direction to target
        let dx = this.target.x - this.position.x;
        let dy = this.target.y - this.position.y;
        let dz = this.target.z - this.position.z;
        let len = sqrt(dx*dx + dy*dy + dz*dz);
        if len > 0.001 {
            let nx = dx / len;
            let ny = dy / len;
            let nz = dz / len;
            this.position.x = this.position.x + nx * distance;
            this.position.y = this.position.y + ny * distance;
            this.position.z = this.position.z + nz * distance;
        }
    } else {
        // Euler mode: compute forward from rotation
        let pitch = this.rotation.x;
        let yaw = this.rotation.y;
        let forward_x = sin(yaw) * cos(pitch);
        let forward_y = -sin(pitch);
        let forward_z = cos(yaw) * cos(pitch);
        this.position.x = this.position.x + forward_x * distance;
        this.position.y = this.position.y + forward_y * distance;
        this.position.z = this.position.z + forward_z * distance;
    }
};

// pan(dx, dy) - Move camera laterally (left/right, up/down)
// dx: Horizontal movement (positive = right)
// dy: Vertical movement (positive = up)
camera.pan = |dx, dy| {
    // For simplicity, pan relative to world Y-up
    // In a more sophisticated system, this would use camera's right/up vectors
    this.position.x = this.position.x + dx;
    this.position.y = this.position.y + dy;
    if this.target != () {
        // Keep target in sync for LookAt mode
        this.target.x = this.target.x + dx;
        this.target.y = this.target.y + dy;
    }
};
"#
    .to_string()
}

/// Convert a Rhai Dynamic value to SignalOrF32.
///
/// Accepts:
/// - f32/f64: Converts to SignalOrF32::Scalar
/// - i64: Converts to SignalOrF32::Scalar
/// - Signal: Converts to SignalOrF32::Signal
fn to_signal_or_f32(value: &Dynamic) -> Option<SignalOrF32> {
    // Try f64 (Rhai's default float type)
    if let Some(f) = value.clone().try_cast::<f64>() {
        return Some(SignalOrF32::Scalar(f as f32));
    }

    // Try f32 (in case a Rust f32 is passed through)
    if let Some(f) = value.clone().try_cast::<f32>() {
        return Some(SignalOrF32::Scalar(f));
    }

    // Try i64 (Rhai's default integer type)
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

/// Sync camera configuration from the Rhai scope.
///
/// Reads the `camera` Map from scope and converts it to CameraConfig.
/// Returns the config and evaluated uniforms.
pub fn sync_camera_from_scope(
    scope: &rhai::Scope<'static>,
    eval_ctx: &mut EvalContext<'_>,
) -> (CameraConfig, CameraUniforms) {
    // Get the camera Map from scope
    let camera_map = match scope.get_value::<rhai::Map>("camera") {
        Some(m) => m,
        None => {
            // No camera in scope, return defaults
            let config = CameraConfig::default();
            let uniforms = config.to_uniforms(eval_ctx);
            return (config, uniforms);
        }
    };

    let mut config = CameraConfig::default();

    // Parse position
    if let Some(pos) = camera_map
        .get("position")
        .and_then(|d| d.clone().try_cast::<rhai::Map>())
    {
        if let Some(vec3) = parse_vec3_from_map(&pos) {
            config.position = vec3;
        }
    }

    // Parse rotation
    if let Some(rot) = camera_map
        .get("rotation")
        .and_then(|d| d.clone().try_cast::<rhai::Map>())
    {
        if let Some(vec3) = parse_vec3_from_map(&rot) {
            config.rotation = vec3;
        }
    }

    // Parse target (if set and not unit)
    if let Some(target_dyn) = camera_map.get("target") {
        if !target_dyn.is_unit() {
            if let Some(target_map) = target_dyn.clone().try_cast::<rhai::Map>() {
                if let Some(vec3) = parse_vec3_from_map(&target_map) {
                    config.target = Some(vec3);
                }
            }
        }
    }

    // Parse up vector
    if let Some(up) = camera_map
        .get("up")
        .and_then(|d| d.clone().try_cast::<rhai::Map>())
    {
        if let Some(vec3) = parse_vec3_from_map(&up) {
            config.up = vec3;
        }
    }

    // Parse FOV
    if let Some(fov) = camera_map.get("fov").and_then(to_signal_or_f32) {
        config.fov = fov;
    }

    // Parse near
    if let Some(near) = camera_map.get("near").and_then(to_signal_or_f32) {
        config.near = near;
    }

    // Parse far
    if let Some(far) = camera_map.get("far").and_then(to_signal_or_f32) {
        config.far = far;
    }

    // Evaluate signals to produce uniforms
    let uniforms = config.to_uniforms(eval_ctx);

    (config, uniforms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_camera_namespace() {
        let ns = generate_camera_namespace();
        assert!(ns.contains("let camera = #{};"));
        assert!(ns.contains("camera.position"));
        assert!(ns.contains("camera.fov"));
        assert!(ns.contains("camera.lookAt"));
        assert!(ns.contains("camera.orbit"));
        assert!(ns.contains("camera.dolly"));
    }
}
