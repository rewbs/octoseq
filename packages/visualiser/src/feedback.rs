//! Frame feedback system for temporal visual memory.
//!
//! Provides Milkdrop-style feedback effects (trails, accumulation, warping)
//! while preserving determinism and the declarative scripting philosophy.
//!
//! The feedback pipeline:
//! ```text
//! previous_frame → spatial_warp → colour_transform → blend(current_frame) → output
//! ```

use bytemuck::{Pod, Zeroable};

/// Spatial warp operator applied to the feedback texture.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WarpOperator {
    /// No spatial transformation.
    #[default]
    None,
    /// Affine transform: scale, rotate, translate.
    Affine,
    /// Radial warp: inward or outward from center.
    Radial,
    /// Spiral: combination of radial scaling and rotation.
    Spiral,
    /// Noise-based displacement (deterministic, seeded).
    Noise,
    /// Shear transformation.
    Shear,
}

impl WarpOperator {
    /// Convert to GPU-compatible u32.
    pub fn to_u32(self) -> u32 {
        match self {
            WarpOperator::None => 0,
            WarpOperator::Affine => 1,
            WarpOperator::Radial => 2,
            WarpOperator::Spiral => 3,
            WarpOperator::Noise => 4,
            WarpOperator::Shear => 5,
        }
    }

    /// Parse from string (for script API).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "affine" => WarpOperator::Affine,
            "radial" => WarpOperator::Radial,
            "spiral" => WarpOperator::Spiral,
            "noise" => WarpOperator::Noise,
            "shear" => WarpOperator::Shear,
            _ => WarpOperator::None,
        }
    }
}

/// Colour transform operator applied to the warped feedback.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ColorOperator {
    /// No colour transformation.
    #[default]
    None,
    /// Exponential decay (fade to black).
    Decay,
    /// HSV shift: hue rotation, saturation/value adjustment.
    HsvShift,
    /// Posterize: reduce colour levels.
    Posterize,
    /// Channel offset: RGB split / chromatic aberration.
    ChannelOffset,
}

impl ColorOperator {
    /// Convert to GPU-compatible u32.
    pub fn to_u32(self) -> u32 {
        match self {
            ColorOperator::None => 0,
            ColorOperator::Decay => 1,
            ColorOperator::HsvShift => 2,
            ColorOperator::Posterize => 3,
            ColorOperator::ChannelOffset => 4,
        }
    }

    /// Parse from string (for script API).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "decay" => ColorOperator::Decay,
            "hsv_shift" | "hsvshift" | "hsv" => ColorOperator::HsvShift,
            "posterize" => ColorOperator::Posterize,
            "channel_offset" | "channeloffset" | "rgb_split" | "chromatic" => {
                ColorOperator::ChannelOffset
            }
            _ => ColorOperator::None,
        }
    }
}

/// Blend mode for combining feedback with current frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FeedbackBlend {
    /// Alpha blending (linear interpolation).
    #[default]
    Alpha,
    /// Additive blending.
    Add,
    /// Multiplicative blending.
    Multiply,
    /// Screen blending (inverse multiply).
    Screen,
    /// Overlay blending.
    Overlay,
    /// Difference blending.
    Difference,
    /// Maximum of both values.
    Max,
}

impl FeedbackBlend {
    /// Convert to GPU-compatible u32.
    pub fn to_u32(self) -> u32 {
        match self {
            FeedbackBlend::Alpha => 0,
            FeedbackBlend::Add => 1,
            FeedbackBlend::Multiply => 2,
            FeedbackBlend::Screen => 3,
            FeedbackBlend::Overlay => 4,
            FeedbackBlend::Difference => 5,
            FeedbackBlend::Max => 6,
        }
    }

    /// Parse from string (for script API).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "add" | "additive" => FeedbackBlend::Add,
            "multiply" | "mul" => FeedbackBlend::Multiply,
            "screen" => FeedbackBlend::Screen,
            "overlay" => FeedbackBlend::Overlay,
            "difference" | "diff" => FeedbackBlend::Difference,
            "max" => FeedbackBlend::Max,
            _ => FeedbackBlend::Alpha,
        }
    }
}

/// Warp parameters that can be signal-driven.
#[derive(Clone, Debug)]
pub struct WarpParams {
    /// Overall warp strength (0 = no warp, 1 = full effect).
    pub strength: f32,
    /// Scale factor for affine/spiral warps.
    pub scale: f32,
    /// Rotation angle for affine/spiral warps (radians).
    pub rotation: f32,
    /// Translation for affine warp [x, y].
    pub translate: [f32; 2],
    /// Frequency for noise warp.
    pub frequency: f32,
    /// Edge falloff (0 = no falloff, 1 = fade at edges).
    pub falloff: f32,
    /// Seed for deterministic noise warp.
    pub seed: u32,
}

impl Default for WarpParams {
    fn default() -> Self {
        Self {
            strength: 0.0,
            scale: 1.0,
            rotation: 0.0,
            translate: [0.0, 0.0],
            frequency: 1.0,
            falloff: 0.0,
            seed: 0,
        }
    }
}

/// Colour transform parameters that can be signal-driven.
#[derive(Clone, Debug)]
pub struct ColorParams {
    /// Decay rate for exponential fade (0.95 = slow decay, 0.5 = fast decay).
    pub decay_rate: f32,
    /// HSV shift values [hue, saturation, value] (hue in 0-1 range).
    pub hsv_shift: [f32; 3],
    /// Number of levels for posterize effect.
    pub posterize_levels: f32,
    /// Channel offset amount [x, y] for chromatic aberration.
    pub channel_offset: [f32; 2],
}

impl Default for ColorParams {
    fn default() -> Self {
        Self {
            decay_rate: 0.95,
            hsv_shift: [0.0, 0.0, 0.0],
            posterize_levels: 8.0,
            channel_offset: [0.0, 0.0],
        }
    }
}

/// Complete feedback configuration.
#[derive(Clone, Debug, Default)]
pub struct FeedbackConfig {
    /// Whether feedback is enabled.
    pub enabled: bool,

    /// Spatial warp operator.
    pub warp: WarpOperator,
    /// Warp parameters.
    pub warp_params: WarpParams,

    /// Colour transform operator.
    pub color: ColorOperator,
    /// Colour parameters.
    pub color_params: ColorParams,

    /// Blend mode for combining feedback with current frame.
    pub blend: FeedbackBlend,
    /// Blend opacity (0 = no feedback visible, 1 = full feedback).
    pub opacity: f32,
}

impl FeedbackConfig {
    /// Create a new enabled feedback config with default parameters.
    pub fn new() -> Self {
        Self {
            enabled: true,
            opacity: 0.8,
            ..Default::default()
        }
    }

    /// Builder: set warp operator.
    pub fn with_warp(mut self, warp: WarpOperator) -> Self {
        self.warp = warp;
        self
    }

    /// Builder: set warp parameters.
    pub fn with_warp_params(mut self, params: WarpParams) -> Self {
        self.warp_params = params;
        self
    }

    /// Builder: set colour operator.
    pub fn with_color(mut self, color: ColorOperator) -> Self {
        self.color = color;
        self
    }

    /// Builder: set colour parameters.
    pub fn with_color_params(mut self, params: ColorParams) -> Self {
        self.color_params = params;
        self
    }

    /// Builder: set blend mode.
    pub fn with_blend(mut self, blend: FeedbackBlend) -> Self {
        self.blend = blend;
        self
    }

    /// Builder: set opacity.
    pub fn with_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity;
        self
    }

    /// Convert to GPU uniforms.
    pub fn to_uniforms(&self) -> FeedbackUniforms {
        FeedbackUniforms {
            // Warp params
            warp_type: self.warp.to_u32(),
            warp_strength: self.warp_params.strength,
            warp_scale: self.warp_params.scale,
            warp_rotation: self.warp_params.rotation,

            warp_translate: self.warp_params.translate,
            warp_frequency: self.warp_params.frequency,
            warp_falloff: self.warp_params.falloff,

            warp_seed: self.warp_params.seed,
            _pad0: [0; 3],

            // Colour params
            color_type: self.color.to_u32(),
            color_decay_rate: self.color_params.decay_rate,
            color_posterize_levels: self.color_params.posterize_levels,
            _pad1: 0.0,

            color_hsv_shift: [
                self.color_params.hsv_shift[0],
                self.color_params.hsv_shift[1],
                self.color_params.hsv_shift[2],
                0.0,
            ],
            color_channel_offset: [
                self.color_params.channel_offset[0],
                self.color_params.channel_offset[1],
                0.0,
                0.0,
            ],

            // Blend params
            blend_mode: self.blend.to_u32(),
            opacity: self.opacity,
            _pad2: [0.0; 2],
        }
    }
}

/// GPU-compatible uniform buffer for feedback shader.
///
/// Layout is carefully aligned to 16-byte boundaries for WGSL compatibility.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct FeedbackUniforms {
    // Warp params (16 bytes)
    pub warp_type: u32,
    pub warp_strength: f32,
    pub warp_scale: f32,
    pub warp_rotation: f32,

    // Warp params continued (16 bytes)
    pub warp_translate: [f32; 2],
    pub warp_frequency: f32,
    pub warp_falloff: f32,

    // Warp params continued (16 bytes)
    pub warp_seed: u32,
    pub _pad0: [u32; 3],

    // Colour params (16 bytes)
    pub color_type: u32,
    pub color_decay_rate: f32,
    pub color_posterize_levels: f32,
    pub _pad1: f32,

    // HSV shift (16 bytes)
    pub color_hsv_shift: [f32; 4],

    // Channel offset (16 bytes)
    pub color_channel_offset: [f32; 4],

    // Blend params (16 bytes)
    pub blend_mode: u32,
    pub opacity: f32,
    pub _pad2: [f32; 2],
}

impl Default for FeedbackUniforms {
    fn default() -> Self {
        FeedbackConfig::default().to_uniforms()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_warp_operator_from_str() {
        assert_eq!(WarpOperator::from_str("affine"), WarpOperator::Affine);
        assert_eq!(WarpOperator::from_str("RADIAL"), WarpOperator::Radial);
        assert_eq!(WarpOperator::from_str("spiral"), WarpOperator::Spiral);
        assert_eq!(WarpOperator::from_str("noise"), WarpOperator::Noise);
        assert_eq!(WarpOperator::from_str("shear"), WarpOperator::Shear);
        assert_eq!(WarpOperator::from_str("unknown"), WarpOperator::None);
    }

    #[test]
    fn test_color_operator_from_str() {
        assert_eq!(ColorOperator::from_str("decay"), ColorOperator::Decay);
        assert_eq!(ColorOperator::from_str("hsv_shift"), ColorOperator::HsvShift);
        assert_eq!(ColorOperator::from_str("posterize"), ColorOperator::Posterize);
        assert_eq!(
            ColorOperator::from_str("channel_offset"),
            ColorOperator::ChannelOffset
        );
    }

    #[test]
    fn test_blend_from_str() {
        assert_eq!(FeedbackBlend::from_str("add"), FeedbackBlend::Add);
        assert_eq!(FeedbackBlend::from_str("multiply"), FeedbackBlend::Multiply);
        assert_eq!(FeedbackBlend::from_str("screen"), FeedbackBlend::Screen);
        assert_eq!(FeedbackBlend::from_str("overlay"), FeedbackBlend::Overlay);
        assert_eq!(FeedbackBlend::from_str("difference"), FeedbackBlend::Difference);
        assert_eq!(FeedbackBlend::from_str("max"), FeedbackBlend::Max);
        assert_eq!(FeedbackBlend::from_str("alpha"), FeedbackBlend::Alpha);
    }

    #[test]
    fn test_uniform_size() {
        // Ensure uniforms are 112 bytes (7 * 16-byte aligned blocks)
        assert_eq!(std::mem::size_of::<FeedbackUniforms>(), 112);
    }

    #[test]
    fn test_config_to_uniforms() {
        let config = FeedbackConfig::new()
            .with_warp(WarpOperator::Spiral)
            .with_warp_params(WarpParams {
                strength: 0.5,
                scale: 1.02,
                rotation: 0.01,
                ..Default::default()
            })
            .with_color(ColorOperator::Decay)
            .with_color_params(ColorParams {
                decay_rate: 0.92,
                ..Default::default()
            })
            .with_blend(FeedbackBlend::Add)
            .with_opacity(0.7);

        let uniforms = config.to_uniforms();
        assert_eq!(uniforms.warp_type, 3); // Spiral
        assert_eq!(uniforms.warp_strength, 0.5);
        assert_eq!(uniforms.warp_scale, 1.02);
        assert_eq!(uniforms.color_type, 1); // Decay
        assert_eq!(uniforms.color_decay_rate, 0.92);
        assert_eq!(uniforms.blend_mode, 1); // Add
        assert_eq!(uniforms.opacity, 0.7);
    }
}
