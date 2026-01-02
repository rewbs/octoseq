//! Camera configuration with Signal support.
//!
//! Provides first-class camera controls for Rhai scripts, following the same
//! signal-or-scalar pattern as the feedback system. Camera properties can be
//! either static values or dynamic Signals evaluated each frame.
//!
//! The camera supports two coordinate modes:
//! - **Euler mode**: Uses position + rotation (pitch, yaw, roll)
//! - **LookAt mode**: Uses position + target (auto-derives orientation)
//!
//! Mode is determined automatically: if `target` is set, LookAt is used.

use bytemuck::{Pod, Zeroable};

use crate::feedback::SignalOrF32;
use crate::signal::Signal;
use crate::signal_eval::EvalContext;

// ============================================================================
// Vec3 with Signal Support
// ============================================================================

/// A 3D vector where each component can be a static f32 or a dynamic Signal.
///
/// This allows camera position, rotation, and target to be audio-reactive
/// on a per-component basis.
#[derive(Clone, Debug)]
pub struct Vec3Signal {
    pub x: SignalOrF32,
    pub y: SignalOrF32,
    pub z: SignalOrF32,
}

impl Vec3Signal {
    /// Create a new Vec3Signal with static values.
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self {
            x: SignalOrF32::Scalar(x),
            y: SignalOrF32::Scalar(y),
            z: SignalOrF32::Scalar(z),
        }
    }

    /// Create a zero vector.
    pub fn zero() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }

    /// Evaluate all components to produce a static [f32; 3].
    pub fn evaluate(&self, ctx: &mut EvalContext) -> [f32; 3] {
        [
            self.x.evaluate(ctx),
            self.y.evaluate(ctx),
            self.z.evaluate(ctx),
        ]
    }

    /// Check if any component is signal-driven.
    pub fn has_signals(&self) -> bool {
        !self.x.is_scalar() || !self.y.is_scalar() || !self.z.is_scalar()
    }

    /// Collect all Signal values from this vector.
    pub fn collect_signals(&self) -> Vec<Signal> {
        let mut signals = Vec::new();
        if let SignalOrF32::Signal(s) = &self.x {
            signals.push(s.clone());
        }
        if let SignalOrF32::Signal(s) = &self.y {
            signals.push(s.clone());
        }
        if let SignalOrF32::Signal(s) = &self.z {
            signals.push(s.clone());
        }
        signals
    }
}

impl Default for Vec3Signal {
    fn default() -> Self {
        Self::zero()
    }
}

// ============================================================================
// Camera Configuration
// ============================================================================

/// Camera configuration with signal-or-scalar parameters.
///
/// All numeric properties can be either constant values or audio-reactive
/// Signals that are evaluated each frame.
#[derive(Clone, Debug)]
pub struct CameraConfig {
    /// Camera position in world space.
    pub position: Vec3Signal,

    /// Camera rotation in Euler angles (pitch, yaw, roll) in radians.
    /// Used in Euler mode (when target is None).
    pub rotation: Vec3Signal,

    /// Look-at target position. If set, enables LookAt mode and
    /// camera orientation is derived automatically.
    pub target: Option<Vec3Signal>,

    /// Up vector for LookAt mode. Defaults to Y-up (0, 1, 0).
    pub up: Vec3Signal,

    /// Field of view in degrees.
    pub fov: SignalOrF32,

    /// Near clip plane distance.
    pub near: SignalOrF32,

    /// Far clip plane distance.
    pub far: SignalOrF32,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            // Default position: isometric-style view (matches old hardcoded camera)
            position: Vec3Signal::new(4.0, 2.0, 4.0),
            rotation: Vec3Signal::zero(),
            target: None,
            up: Vec3Signal::new(0.0, 1.0, 0.0),
            fov: SignalOrF32::Scalar(45.0),
            near: SignalOrF32::Scalar(0.1),
            far: SignalOrF32::Scalar(100.0),
        }
    }
}

impl CameraConfig {
    /// Create a new camera with default settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if camera is in LookAt mode (target is set).
    pub fn is_look_at(&self) -> bool {
        self.target.is_some()
    }

    /// Evaluate all signals to produce GPU-ready uniforms.
    ///
    /// This method resolves any Signal values to their current f32 values
    /// using the provided evaluation context.
    pub fn to_uniforms(&self, ctx: &mut EvalContext) -> CameraUniforms {
        let position = self.position.evaluate(ctx);
        let rotation = self.rotation.evaluate(ctx);
        let up = self.up.evaluate(ctx);
        let fov = self.fov.evaluate(ctx);
        let near = self.near.evaluate(ctx);
        let far = self.far.evaluate(ctx);

        let (target, mode) = if let Some(ref t) = self.target {
            (t.evaluate(ctx), 1) // LookAt mode
        } else {
            ([0.0, 0.0, 0.0], 0) // Euler mode
        };

        CameraUniforms {
            position: [position[0], position[1], position[2], 1.0],
            rotation: [rotation[0], rotation[1], rotation[2], 0.0],
            target: [target[0], target[1], target[2], 1.0],
            up: [up[0], up[1], up[2], 0.0],
            fov,
            near,
            far,
            mode,
        }
    }

    /// Check if any parameter is signal-driven.
    pub fn has_signals(&self) -> bool {
        self.position.has_signals()
            || self.rotation.has_signals()
            || self.target.as_ref().map(|t| t.has_signals()).unwrap_or(false)
            || self.up.has_signals()
            || !self.fov.is_scalar()
            || !self.near.is_scalar()
            || !self.far.is_scalar()
    }

    /// Collect all Signal values from this config.
    ///
    /// Used for statistics pre-computation to find signals that need stats.
    pub fn collect_signals(&self) -> Vec<Signal> {
        let mut signals = Vec::new();

        signals.extend(self.position.collect_signals());
        signals.extend(self.rotation.collect_signals());
        if let Some(ref t) = self.target {
            signals.extend(t.collect_signals());
        }
        signals.extend(self.up.collect_signals());

        if let SignalOrF32::Signal(s) = &self.fov {
            signals.push(s.clone());
        }
        if let SignalOrF32::Signal(s) = &self.near {
            signals.push(s.clone());
        }
        if let SignalOrF32::Signal(s) = &self.far {
            signals.push(s.clone());
        }

        signals
    }
}

// ============================================================================
// Camera Uniforms (GPU-ready evaluated values)
// ============================================================================

/// Evaluated camera parameters ready for GPU.
///
/// All signals have been resolved to f32 values. This struct is sent to
/// the renderer for view/projection matrix computation.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct CameraUniforms {
    /// Camera position in world space (vec4, w unused).
    pub position: [f32; 4],

    /// Camera rotation (pitch, yaw, roll) in radians (vec4, w unused).
    /// Used in Euler mode.
    pub rotation: [f32; 4],

    /// Look-at target position (vec4, w unused).
    /// Zero if in Euler mode.
    pub target: [f32; 4],

    /// Up vector (vec4, w unused).
    pub up: [f32; 4],

    /// Field of view in degrees.
    pub fov: f32,

    /// Near clip plane distance.
    pub near: f32,

    /// Far clip plane distance.
    pub far: f32,

    /// Camera mode: 0 = Euler, 1 = LookAt.
    pub mode: u32,
}

impl CameraUniforms {
    /// Create default camera uniforms (matches CameraConfig::default()).
    pub fn new() -> Self {
        Self {
            position: [4.0, 2.0, 4.0, 1.0],
            rotation: [0.0, 0.0, 0.0, 0.0],
            target: [0.0, 0.0, 0.0, 1.0],
            up: [0.0, 1.0, 0.0, 0.0],
            fov: 45.0,
            near: 0.1,
            far: 100.0,
            mode: 0,
        }
    }

    /// Get position as glam::Vec3.
    pub fn position_vec3(&self) -> glam::Vec3 {
        glam::Vec3::new(self.position[0], self.position[1], self.position[2])
    }

    /// Get rotation as glam::Vec3.
    pub fn rotation_vec3(&self) -> glam::Vec3 {
        glam::Vec3::new(self.rotation[0], self.rotation[1], self.rotation[2])
    }

    /// Get target as glam::Vec3.
    pub fn target_vec3(&self) -> glam::Vec3 {
        glam::Vec3::new(self.target[0], self.target[1], self.target[2])
    }

    /// Get up vector as glam::Vec3.
    pub fn up_vec3(&self) -> glam::Vec3 {
        glam::Vec3::new(self.up[0], self.up[1], self.up[2])
    }

    /// Check if camera is in LookAt mode.
    pub fn is_look_at(&self) -> bool {
        self.mode == 1
    }

    /// Compute the view matrix from camera parameters.
    pub fn view_matrix(&self) -> glam::Mat4 {
        let eye = self.position_vec3();
        let up = self.up_vec3();

        if self.is_look_at() {
            // LookAt mode: derive orientation from target
            glam::Mat4::look_at_rh(eye, self.target_vec3(), up)
        } else {
            // Euler mode: apply rotation directly
            // Order: YXZ (yaw, pitch, roll) for natural camera control
            let pitch = self.rotation[0];
            let yaw = self.rotation[1];
            let roll = self.rotation[2];

            let rotation = glam::Mat4::from_euler(glam::EulerRot::YXZ, yaw, pitch, roll);
            let translation = glam::Mat4::from_translation(-eye);

            rotation * translation
        }
    }

    /// Compute the projection matrix from camera parameters.
    pub fn projection_matrix(&self, aspect: f32) -> glam::Mat4 {
        glam::Mat4::perspective_rh(self.fov.to_radians(), aspect, self.near, self.far)
    }

    /// Compute the combined view-projection matrix.
    pub fn view_projection_matrix(&self, aspect: f32) -> glam::Mat4 {
        self.projection_matrix(aspect) * self.view_matrix()
    }

    /// Compute the forward direction vector.
    ///
    /// In LookAt mode, this is the normalized direction from position to target.
    /// In Euler mode, this is derived from rotation angles.
    pub fn forward(&self) -> glam::Vec3 {
        if self.is_look_at() {
            (self.target_vec3() - self.position_vec3()).normalize()
        } else {
            // Forward from Euler angles (YXZ order)
            let pitch = self.rotation[0];
            let yaw = self.rotation[1];

            glam::Vec3::new(
                yaw.sin() * pitch.cos(),
                -pitch.sin(),
                yaw.cos() * pitch.cos(),
            )
        }
    }

    /// Compute the right direction vector.
    pub fn right(&self) -> glam::Vec3 {
        self.forward().cross(self.up_vec3()).normalize()
    }

    /// Compute the camera's actual up vector (may differ from world up).
    pub fn camera_up(&self) -> glam::Vec3 {
        self.right().cross(self.forward())
    }
}

// ============================================================================
// Signal Flags for Inspector
// ============================================================================

/// Flags indicating which camera properties are signal-bound.
///
/// Used by the inspector to visually indicate dynamic properties.
#[derive(Clone, Debug, Default)]
pub struct CameraSignalFlags {
    pub position_x: bool,
    pub position_y: bool,
    pub position_z: bool,
    pub rotation_x: bool,
    pub rotation_y: bool,
    pub rotation_z: bool,
    pub target_x: bool,
    pub target_y: bool,
    pub target_z: bool,
    pub fov: bool,
    pub near: bool,
    pub far: bool,
}

impl CameraSignalFlags {
    /// Create flags from a CameraConfig.
    pub fn from_config(config: &CameraConfig) -> Self {
        Self {
            position_x: !config.position.x.is_scalar(),
            position_y: !config.position.y.is_scalar(),
            position_z: !config.position.z.is_scalar(),
            rotation_x: !config.rotation.x.is_scalar(),
            rotation_y: !config.rotation.y.is_scalar(),
            rotation_z: !config.rotation.z.is_scalar(),
            target_x: config
                .target
                .as_ref()
                .map(|t| !t.x.is_scalar())
                .unwrap_or(false),
            target_y: config
                .target
                .as_ref()
                .map(|t| !t.y.is_scalar())
                .unwrap_or(false),
            target_z: config
                .target
                .as_ref()
                .map(|t| !t.z.is_scalar())
                .unwrap_or(false),
            fov: !config.fov.is_scalar(),
            near: !config.near.is_scalar(),
            far: !config.far.is_scalar(),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal_state::SignalState;
    use crate::signal_stats::StatisticsCache;
    use std::collections::HashMap;

    fn test_eval_ctx() -> (SignalState, StatisticsCache) {
        (SignalState::new(), StatisticsCache::new())
    }

    #[test]
    fn test_default_camera() {
        let config = CameraConfig::default();
        assert!(!config.is_look_at());
        assert!(!config.has_signals());
    }

    #[test]
    fn test_camera_to_uniforms_euler() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let stems = HashMap::new();
        let custom_signals = HashMap::new();
        let mut ctx =
            EvalContext::new(0.0, 0.016, 0, None, &inputs, &bands, &stems, &custom_signals, &stats, &mut state, None);

        let config = CameraConfig {
            position: Vec3Signal::new(5.0, 3.0, 5.0),
            rotation: Vec3Signal::new(0.1, 0.2, 0.0),
            target: None,
            up: Vec3Signal::new(0.0, 1.0, 0.0),
            fov: SignalOrF32::Scalar(60.0),
            near: SignalOrF32::Scalar(0.5),
            far: SignalOrF32::Scalar(50.0),
        };

        let uniforms = config.to_uniforms(&mut ctx);

        assert_eq!(uniforms.position[0], 5.0);
        assert_eq!(uniforms.position[1], 3.0);
        assert_eq!(uniforms.position[2], 5.0);
        assert_eq!(uniforms.rotation[0], 0.1);
        assert_eq!(uniforms.rotation[1], 0.2);
        assert_eq!(uniforms.fov, 60.0);
        assert_eq!(uniforms.near, 0.5);
        assert_eq!(uniforms.far, 50.0);
        assert_eq!(uniforms.mode, 0); // Euler mode
    }

    #[test]
    fn test_camera_to_uniforms_lookat() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let stems = HashMap::new();
        let custom_signals = HashMap::new();
        let mut ctx =
            EvalContext::new(0.0, 0.016, 0, None, &inputs, &bands, &stems, &custom_signals, &stats, &mut state, None);

        let config = CameraConfig {
            position: Vec3Signal::new(5.0, 3.0, 5.0),
            rotation: Vec3Signal::zero(),
            target: Some(Vec3Signal::new(0.0, 0.0, 0.0)),
            up: Vec3Signal::new(0.0, 1.0, 0.0),
            fov: SignalOrF32::Scalar(45.0),
            near: SignalOrF32::Scalar(0.1),
            far: SignalOrF32::Scalar(100.0),
        };

        let uniforms = config.to_uniforms(&mut ctx);

        assert_eq!(uniforms.target[0], 0.0);
        assert_eq!(uniforms.target[1], 0.0);
        assert_eq!(uniforms.target[2], 0.0);
        assert_eq!(uniforms.mode, 1); // LookAt mode
    }

    #[test]
    fn test_uniform_size() {
        // Ensure proper alignment for GPU
        assert_eq!(std::mem::size_of::<CameraUniforms>(), 80);
    }

    #[test]
    fn test_view_matrix_lookat() {
        let uniforms = CameraUniforms {
            position: [5.0, 5.0, 5.0, 1.0],
            rotation: [0.0, 0.0, 0.0, 0.0],
            target: [0.0, 0.0, 0.0, 1.0],
            up: [0.0, 1.0, 0.0, 0.0],
            fov: 45.0,
            near: 0.1,
            far: 100.0,
            mode: 1, // LookAt
        };

        let view = uniforms.view_matrix();
        // The view matrix should transform the origin to be in front of the camera
        let origin_in_view = view.transform_point3(glam::Vec3::ZERO);
        assert!(origin_in_view.z < 0.0); // Origin should be in front (negative Z in view space)
    }
}
