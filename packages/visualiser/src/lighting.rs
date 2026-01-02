//! Global lighting configuration with Signal support.
//!
//! Provides a simple lighting model for Rhai scripts:
//! - One directional light with direction, intensity, and color
//! - Ambient term
//! - Rim lighting (view-normal based edge highlighting)
//!
//! All numeric parameters can be either static values or dynamic Signals
//! evaluated each frame.
//!
//! ## Philosophy
//!
//! "Lighting is a depth cue, not a physical simulation."
//!
//! This system provides stylized, controllable lighting that improves
//! visual depth and legibility without the complexity of PBR or shadow maps.

use bytemuck::{Pod, Zeroable};

use crate::camera::Vec3Signal;
use crate::feedback::SignalOrF32;
use crate::signal_eval::EvalContext;

// ============================================================================
// Lighting Configuration
// ============================================================================

/// Global lighting configuration with signal-or-scalar parameters.
///
/// All numeric properties can be either constant values or audio-reactive
/// Signals that are evaluated each frame.
#[derive(Clone, Debug)]
pub struct LightingConfig {
    /// Whether lighting is enabled globally.
    pub enabled: bool,

    /// Light direction (normalized, world space).
    /// Points FROM the light source (like a sun direction).
    pub direction: Vec3Signal,

    /// Light intensity multiplier.
    pub intensity: SignalOrF32,

    /// Light color (RGB, 0-1 range).
    pub color: Vec3Signal,

    /// Ambient light intensity (adds to all surfaces equally).
    pub ambient: SignalOrF32,

    /// Rim lighting intensity (highlights edges facing away from camera).
    pub rim_intensity: SignalOrF32,

    /// Rim lighting power (higher = sharper rim effect).
    pub rim_power: SignalOrF32,
}

impl Default for LightingConfig {
    fn default() -> Self {
        Self {
            enabled: false, // Lighting off by default for backwards compatibility
            // Default direction: from upper-left-front (classic 3-point key light position)
            direction: Vec3Signal::new(-0.3, -1.0, -0.5),
            intensity: SignalOrF32::Scalar(1.0),
            color: Vec3Signal::new(1.0, 1.0, 1.0),
            ambient: SignalOrF32::Scalar(0.3),
            rim_intensity: SignalOrF32::Scalar(0.0),
            rim_power: SignalOrF32::Scalar(2.0),
        }
    }
}

impl LightingConfig {
    /// Create a new lighting config with default settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Evaluate all signals to produce GPU-ready uniforms.
    ///
    /// This method resolves any Signal values to their current f32 values
    /// using the provided evaluation context.
    pub fn to_uniforms(&self, ctx: &mut EvalContext) -> LightingUniforms {
        // Evaluate direction and normalize
        let dir = self.direction.evaluate(ctx);
        let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
        let dir_normalized = if len > 0.001 {
            [dir[0] / len, dir[1] / len, dir[2] / len, 0.0]
        } else {
            // Fallback to down direction
            [0.0, -1.0, 0.0, 0.0]
        };

        // Evaluate color
        let color = self.color.evaluate(ctx);

        LightingUniforms {
            direction: dir_normalized,
            color: [color[0], color[1], color[2], 1.0],
            intensity: self.intensity.evaluate(ctx),
            ambient: self.ambient.evaluate(ctx),
            rim_intensity: self.rim_intensity.evaluate(ctx),
            rim_power: self.rim_power.evaluate(ctx),
            enabled: if self.enabled { 1 } else { 0 },
            _padding: [0; 3],
        }
    }

    /// Check if any parameter is signal-driven.
    pub fn has_signals(&self) -> bool {
        self.direction.has_signals()
            || !self.intensity.is_scalar()
            || self.color.has_signals()
            || !self.ambient.is_scalar()
            || !self.rim_intensity.is_scalar()
            || !self.rim_power.is_scalar()
    }
}

// ============================================================================
// GPU Uniforms
// ============================================================================

/// GPU-ready lighting uniforms.
///
/// This struct is laid out for direct upload to a uniform buffer.
/// Total size: 64 bytes (16-byte aligned).
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct LightingUniforms {
    /// Light direction (normalized, xyz), w unused.
    pub direction: [f32; 4], // 16 bytes

    /// Light color (rgb), a = 1.0.
    pub color: [f32; 4], // 16 bytes

    /// Light intensity multiplier.
    pub intensity: f32, // 4 bytes

    /// Ambient light intensity.
    pub ambient: f32, // 4 bytes

    /// Rim lighting intensity.
    pub rim_intensity: f32, // 4 bytes

    /// Rim lighting power.
    pub rim_power: f32, // 4 bytes

    /// Whether lighting is enabled (0 or 1).
    pub enabled: u32, // 4 bytes

    /// Padding for alignment.
    pub _padding: [u32; 3], // 12 bytes
} // Total: 64 bytes

impl Default for LightingUniforms {
    fn default() -> Self {
        Self {
            direction: [0.0, -1.0, 0.0, 0.0],
            color: [1.0, 1.0, 1.0, 1.0],
            intensity: 1.0,
            ambient: 0.3,
            rim_intensity: 0.0,
            rim_power: 2.0,
            enabled: 0,
            _padding: [0; 3],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal_state::SignalState;
    use std::collections::HashMap;

    #[test]
    fn test_default_config() {
        let config = LightingConfig::default();
        assert!(!config.enabled);

        let mut signal_state = SignalState::default();
        let mut cache = HashMap::new();
        let mut ctx = EvalContext::new(&mut signal_state, &mut cache, 0.0, 0.0, 0);

        let uniforms = config.to_uniforms(&mut ctx);
        assert_eq!(uniforms.enabled, 0);
        assert!((uniforms.intensity - 1.0).abs() < 0.001);
        assert!((uniforms.ambient - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_direction_normalization() {
        let mut config = LightingConfig::default();
        config.direction = Vec3Signal::new(2.0, 0.0, 0.0); // Not normalized

        let mut signal_state = SignalState::default();
        let mut cache = HashMap::new();
        let mut ctx = EvalContext::new(&mut signal_state, &mut cache, 0.0, 0.0, 0);

        let uniforms = config.to_uniforms(&mut ctx);
        // Should be normalized to [1, 0, 0]
        assert!((uniforms.direction[0] - 1.0).abs() < 0.001);
        assert!(uniforms.direction[1].abs() < 0.001);
        assert!(uniforms.direction[2].abs() < 0.001);
    }

    #[test]
    fn test_uniforms_size() {
        assert_eq!(std::mem::size_of::<LightingUniforms>(), 64);
    }
}
