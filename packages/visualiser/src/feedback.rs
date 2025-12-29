//! Frame feedback system for temporal visual memory.
//!
//! Provides Milkdrop-style feedback effects (trails, accumulation, warping)
//! while preserving determinism and the declarative scripting philosophy.
//!
//! The feedback pipeline supports chained transforms:
//! ```text
//! previous_frame → warp₁ → warp₂ → ... → color₁ → color₂ → ... → blend(current) → output
//! ```
//!
//! Feedback parameters can be either static f32 values or dynamic Signals that
//! are evaluated each frame for audio-reactive effects.

use bytemuck::{Pod, Zeroable};

use crate::signal::Signal;
use crate::signal_eval::EvalContext;

/// Maximum number of warp operations in a chain.
pub const MAX_WARP_CHAIN: usize = 4;
/// Maximum number of color operations in a chain.
pub const MAX_COLOR_CHAIN: usize = 4;

// ============================================================================
// Signal-or-Scalar Type for Dynamic Parameters
// ============================================================================

/// A value that can be either a static f32 or a dynamic Signal.
///
/// This allows feedback parameters to be either constant values or
/// audio-reactive signals that are evaluated each frame.
#[derive(Clone, Debug)]
pub enum SignalOrF32 {
    /// A static scalar value.
    Scalar(f32),
    /// A dynamic signal that will be evaluated each frame.
    Signal(Signal),
}

impl SignalOrF32 {
    /// Create from a scalar value.
    pub fn scalar(value: f32) -> Self {
        SignalOrF32::Scalar(value)
    }

    /// Create from a signal.
    pub fn signal(signal: Signal) -> Self {
        SignalOrF32::Signal(signal)
    }

    /// Evaluate to an f32 value.
    ///
    /// For scalars, returns the value directly.
    /// For signals, evaluates the signal using the provided context.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> f32 {
        match self {
            SignalOrF32::Scalar(v) => *v,
            SignalOrF32::Signal(s) => s.evaluate(ctx),
        }
    }

    /// Check if this is a static scalar (no signal evaluation needed).
    pub fn is_scalar(&self) -> bool {
        matches!(self, SignalOrF32::Scalar(_))
    }
}

impl Default for SignalOrF32 {
    fn default() -> Self {
        SignalOrF32::Scalar(0.0)
    }
}

impl From<f32> for SignalOrF32 {
    fn from(value: f32) -> Self {
        SignalOrF32::Scalar(value)
    }
}

impl From<Signal> for SignalOrF32 {
    fn from(signal: Signal) -> Self {
        SignalOrF32::Signal(signal)
    }
}

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
///
/// All numeric parameters can be either static f32 values or dynamic Signals.
#[derive(Clone, Debug)]
pub struct WarpParams {
    /// Overall warp strength (0 = no warp, 1 = full effect).
    pub strength: SignalOrF32,
    /// Scale factor for affine/spiral warps.
    pub scale: SignalOrF32,
    /// Rotation angle for affine/spiral warps (radians).
    pub rotation: SignalOrF32,
    /// Translation for affine warp [x, y].
    pub translate: [SignalOrF32; 2],
    /// Frequency for noise warp.
    pub frequency: SignalOrF32,
    /// Edge falloff (0 = no falloff, 1 = fade at edges).
    pub falloff: SignalOrF32,
    /// Seed for deterministic noise warp (always static).
    pub seed: u32,
}

impl WarpParams {
    /// Evaluate all parameters to produce static values for GPU upload.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> EvaluatedWarpParams {
        EvaluatedWarpParams {
            strength: self.strength.evaluate(ctx),
            scale: self.scale.evaluate(ctx),
            rotation: self.rotation.evaluate(ctx),
            translate: [self.translate[0].evaluate(ctx), self.translate[1].evaluate(ctx)],
            frequency: self.frequency.evaluate(ctx),
            falloff: self.falloff.evaluate(ctx),
            seed: self.seed,
        }
    }
}

impl Default for WarpParams {
    fn default() -> Self {
        Self {
            strength: SignalOrF32::Scalar(0.0),
            scale: SignalOrF32::Scalar(1.0),
            rotation: SignalOrF32::Scalar(0.0),
            translate: [SignalOrF32::Scalar(0.0), SignalOrF32::Scalar(0.0)],
            frequency: SignalOrF32::Scalar(1.0),
            falloff: SignalOrF32::Scalar(0.0),
            seed: 0,
        }
    }
}

/// Evaluated warp parameters (all signals resolved to f32).
#[derive(Clone, Debug, Default)]
pub struct EvaluatedWarpParams {
    pub strength: f32,
    pub scale: f32,
    pub rotation: f32,
    pub translate: [f32; 2],
    pub frequency: f32,
    pub falloff: f32,
    pub seed: u32,
}

/// Colour transform parameters that can be signal-driven.
///
/// All numeric parameters can be either static f32 values or dynamic Signals.
#[derive(Clone, Debug)]
pub struct ColorParams {
    /// Decay rate for exponential fade (0.95 = slow decay, 0.5 = fast decay).
    pub decay_rate: SignalOrF32,
    /// HSV shift values [hue, saturation, value] (hue in 0-1 range).
    pub hsv_shift: [SignalOrF32; 3],
    /// Number of levels for posterize effect.
    pub posterize_levels: SignalOrF32,
    /// Channel offset amount [x, y] for chromatic aberration.
    pub channel_offset: [SignalOrF32; 2],
}

impl ColorParams {
    /// Evaluate all parameters to produce static values for GPU upload.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> EvaluatedColorParams {
        EvaluatedColorParams {
            decay_rate: self.decay_rate.evaluate(ctx),
            hsv_shift: [
                self.hsv_shift[0].evaluate(ctx),
                self.hsv_shift[1].evaluate(ctx),
                self.hsv_shift[2].evaluate(ctx),
            ],
            posterize_levels: self.posterize_levels.evaluate(ctx),
            channel_offset: [
                self.channel_offset[0].evaluate(ctx),
                self.channel_offset[1].evaluate(ctx),
            ],
        }
    }
}

impl Default for ColorParams {
    fn default() -> Self {
        Self {
            decay_rate: SignalOrF32::Scalar(0.95),
            hsv_shift: [
                SignalOrF32::Scalar(0.0),
                SignalOrF32::Scalar(0.0),
                SignalOrF32::Scalar(0.0),
            ],
            posterize_levels: SignalOrF32::Scalar(8.0),
            channel_offset: [SignalOrF32::Scalar(0.0), SignalOrF32::Scalar(0.0)],
        }
    }
}

/// Evaluated color parameters (all signals resolved to f32).
#[derive(Clone, Debug, Default)]
pub struct EvaluatedColorParams {
    pub decay_rate: f32,
    pub hsv_shift: [f32; 3],
    pub posterize_levels: f32,
    pub channel_offset: [f32; 2],
}

/// A single warp operation in a chain.
#[derive(Clone, Debug, Default)]
pub struct WarpStep {
    pub operator: WarpOperator,
    pub params: WarpParams,
}

impl WarpStep {
    pub fn new(operator: WarpOperator, params: WarpParams) -> Self {
        Self { operator, params }
    }
}

/// A single color operation in a chain.
#[derive(Clone, Debug, Default)]
pub struct ColorStep {
    pub operator: ColorOperator,
    pub params: ColorParams,
}

impl ColorStep {
    pub fn new(operator: ColorOperator, params: ColorParams) -> Self {
        Self { operator, params }
    }
}

/// Complete feedback configuration with support for chained transforms.
#[derive(Clone, Debug, Default)]
pub struct FeedbackConfig {
    /// Whether feedback is enabled.
    pub enabled: bool,

    /// Chain of warp operations applied in sequence.
    pub warp_chain: Vec<WarpStep>,

    /// Chain of color operations applied in sequence.
    pub color_chain: Vec<ColorStep>,

    /// Blend mode for combining feedback with current frame.
    pub blend: FeedbackBlend,
    /// Blend opacity (0 = no feedback visible, 1 = full feedback).
    pub opacity: SignalOrF32,
}

impl FeedbackConfig {
    /// Create a new enabled feedback config with default parameters.
    pub fn new() -> Self {
        Self {
            enabled: true,
            opacity: SignalOrF32::Scalar(0.8),
            ..Default::default()
        }
    }

    /// Builder: add a warp step to the chain.
    pub fn add_warp(mut self, operator: WarpOperator, params: WarpParams) -> Self {
        if self.warp_chain.len() < MAX_WARP_CHAIN {
            self.warp_chain.push(WarpStep::new(operator, params));
        }
        self
    }

    /// Builder: add a color step to the chain.
    pub fn add_color(mut self, operator: ColorOperator, params: ColorParams) -> Self {
        if self.color_chain.len() < MAX_COLOR_CHAIN {
            self.color_chain.push(ColorStep::new(operator, params));
        }
        self
    }

    /// Builder: set warp operator (convenience for single warp).
    /// Clears any existing warp chain and sets a single warp.
    pub fn with_warp(mut self, warp: WarpOperator) -> Self {
        self.warp_chain.clear();
        self.warp_chain.push(WarpStep::new(warp, WarpParams::default()));
        self
    }

    /// Builder: set warp parameters for the first (or only) warp in the chain.
    pub fn with_warp_params(mut self, params: WarpParams) -> Self {
        if let Some(step) = self.warp_chain.first_mut() {
            step.params = params;
        } else {
            self.warp_chain.push(WarpStep::new(WarpOperator::None, params));
        }
        self
    }

    /// Builder: set colour operator (convenience for single color).
    /// Clears any existing color chain and sets a single color.
    pub fn with_color(mut self, color: ColorOperator) -> Self {
        self.color_chain.clear();
        self.color_chain.push(ColorStep::new(color, ColorParams::default()));
        self
    }

    /// Builder: set colour parameters for the first (or only) color in the chain.
    pub fn with_color_params(mut self, params: ColorParams) -> Self {
        if let Some(step) = self.color_chain.first_mut() {
            step.params = params;
        } else {
            self.color_chain.push(ColorStep::new(ColorOperator::None, params));
        }
        self
    }

    /// Builder: set blend mode.
    pub fn with_blend(mut self, blend: FeedbackBlend) -> Self {
        self.blend = blend;
        self
    }

    /// Builder: set opacity (accepts f32 or Signal).
    pub fn with_opacity(mut self, opacity: impl Into<SignalOrF32>) -> Self {
        self.opacity = opacity.into();
        self
    }

    /// Convert to GPU uniforms by evaluating all signal parameters.
    ///
    /// This method resolves any Signal values to their current f32 values
    /// using the provided evaluation context.
    pub fn to_uniforms(&self, ctx: &mut EvalContext) -> FeedbackUniforms {
        let mut uniforms = FeedbackUniforms::zeroed();

        // Header
        uniforms.warp_count = self.warp_chain.len().min(MAX_WARP_CHAIN) as u32;
        uniforms.color_count = self.color_chain.len().min(MAX_COLOR_CHAIN) as u32;
        uniforms.blend_mode = self.blend.to_u32();
        uniforms.opacity = self.opacity.evaluate(ctx);

        // Fill warp steps - evaluate each parameter
        for (i, step) in self.warp_chain.iter().take(MAX_WARP_CHAIN).enumerate() {
            let params = step.params.evaluate(ctx);
            uniforms.warp_steps[i] = GpuWarpStep {
                warp_type: step.operator.to_u32(),
                strength: params.strength,
                scale: params.scale,
                rotation: params.rotation,
                translate_x: params.translate[0],
                translate_y: params.translate[1],
                frequency: params.frequency,
                falloff: params.falloff,
            };
        }

        // Fill color steps - evaluate each parameter
        for (i, step) in self.color_chain.iter().take(MAX_COLOR_CHAIN).enumerate() {
            let params = step.params.evaluate(ctx);
            uniforms.color_steps[i] = GpuColorStep {
                color_type: step.operator.to_u32(),
                decay_rate: params.decay_rate,
                posterize_levels: params.posterize_levels,
                hsv_h: params.hsv_shift[0],
                hsv_s: params.hsv_shift[1],
                hsv_v: params.hsv_shift[2],
                offset_x: params.channel_offset[0],
                offset_y: params.channel_offset[1],
            };
        }

        uniforms
    }

    /// Check if this config contains any signals that need evaluation.
    pub fn has_signals(&self) -> bool {
        // Check opacity
        if !self.opacity.is_scalar() {
            return true;
        }

        // Check warp chain
        for step in &self.warp_chain {
            if !step.params.strength.is_scalar()
                || !step.params.scale.is_scalar()
                || !step.params.rotation.is_scalar()
                || !step.params.translate[0].is_scalar()
                || !step.params.translate[1].is_scalar()
                || !step.params.frequency.is_scalar()
                || !step.params.falloff.is_scalar()
            {
                return true;
            }
        }

        // Check color chain
        for step in &self.color_chain {
            if !step.params.decay_rate.is_scalar()
                || !step.params.posterize_levels.is_scalar()
                || !step.params.hsv_shift[0].is_scalar()
                || !step.params.hsv_shift[1].is_scalar()
                || !step.params.hsv_shift[2].is_scalar()
                || !step.params.channel_offset[0].is_scalar()
                || !step.params.channel_offset[1].is_scalar()
            {
                return true;
            }
        }

        false
    }

    /// Collect all Signal values from this config.
    ///
    /// Used for statistics pre-computation to find signals that need stats.
    pub fn collect_signals(&self) -> Vec<Signal> {
        let mut signals = Vec::new();

        // Helper to extract signal from SignalOrF32
        fn extract(s: &SignalOrF32, signals: &mut Vec<Signal>) {
            if let SignalOrF32::Signal(sig) = s {
                signals.push(sig.clone());
            }
        }

        // Opacity
        extract(&self.opacity, &mut signals);

        // Warp chain
        for step in &self.warp_chain {
            extract(&step.params.strength, &mut signals);
            extract(&step.params.scale, &mut signals);
            extract(&step.params.rotation, &mut signals);
            extract(&step.params.translate[0], &mut signals);
            extract(&step.params.translate[1], &mut signals);
            extract(&step.params.frequency, &mut signals);
            extract(&step.params.falloff, &mut signals);
        }

        // Color chain
        for step in &self.color_chain {
            extract(&step.params.decay_rate, &mut signals);
            extract(&step.params.posterize_levels, &mut signals);
            extract(&step.params.hsv_shift[0], &mut signals);
            extract(&step.params.hsv_shift[1], &mut signals);
            extract(&step.params.hsv_shift[2], &mut signals);
            extract(&step.params.channel_offset[0], &mut signals);
            extract(&step.params.channel_offset[1], &mut signals);
        }

        signals
    }
}

// ============================================================================
// Fluent Builder API for Rhai scripting
// ============================================================================

/// Fluent builder for constructing feedback configurations.
///
/// Used from Rhai scripts:
/// ```rhai
/// let fb = feedback.builder()
///     .warp.spiral(0.5, 0.02)
///     .warp.radial(0.3)
///     .color.decay(0.95)
///     .blend.add()
///     .opacity(0.9)
///     .build();
/// ```
#[derive(Clone, Debug, Default)]
pub struct FeedbackBuilder {
    warp_chain: Vec<WarpStep>,
    color_chain: Vec<ColorStep>,
    blend: FeedbackBlend,
    opacity: SignalOrF32,
}

impl FeedbackBuilder {
    /// Create a new builder with default opacity.
    pub fn new() -> Self {
        Self {
            opacity: SignalOrF32::Scalar(0.8),
            ..Default::default()
        }
    }

    /// Add a warp step to the chain.
    pub fn push_warp(&mut self, step: WarpStep) {
        if self.warp_chain.len() < MAX_WARP_CHAIN {
            self.warp_chain.push(step);
        }
    }

    /// Add a color step to the chain.
    pub fn push_color(&mut self, step: ColorStep) {
        if self.color_chain.len() < MAX_COLOR_CHAIN {
            self.color_chain.push(step);
        }
    }

    /// Set the blend mode.
    pub fn set_blend(&mut self, blend: FeedbackBlend) {
        self.blend = blend;
    }

    /// Set the opacity (from f32).
    pub fn set_opacity(&mut self, opacity: f32) {
        self.opacity = SignalOrF32::Scalar(opacity);
    }

    /// Set the opacity (from SignalOrF32 for signal support).
    pub fn set_opacity_signal(&mut self, opacity: SignalOrF32) {
        self.opacity = opacity;
    }

    /// Build the final FeedbackConfig.
    pub fn build(&self) -> FeedbackConfig {
        FeedbackConfig {
            enabled: true,
            warp_chain: self.warp_chain.clone(),
            color_chain: self.color_chain.clone(),
            blend: self.blend,
            opacity: self.opacity.clone(),
        }
    }
}

/// Sub-builder for warp operations. Returned by `builder.warp`.
#[derive(Clone, Debug)]
pub struct WarpBuilder(pub FeedbackBuilder);

impl WarpBuilder {
    /// Add a spiral warp (rotation + radial scaling).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn spiral(
        mut self,
        strength: impl Into<SignalOrF32>,
        rotation: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Spiral,
            WarpParams {
                strength: strength.into(),
                rotation: rotation.into(),
                scale: SignalOrF32::Scalar(1.0),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a spiral warp with custom scale.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn spiral_with_scale(
        mut self,
        strength: impl Into<SignalOrF32>,
        rotation: impl Into<SignalOrF32>,
        scale: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Spiral,
            WarpParams {
                strength: strength.into(),
                rotation: rotation.into(),
                scale: scale.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a radial warp (expand/contract from center).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn radial(mut self, strength: impl Into<SignalOrF32>) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Radial,
            WarpParams {
                strength: strength.into(),
                scale: SignalOrF32::Scalar(1.0),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a radial warp with custom scale.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn radial_with_scale(
        mut self,
        strength: impl Into<SignalOrF32>,
        scale: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Radial,
            WarpParams {
                strength: strength.into(),
                scale: scale.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add an affine warp (scale + rotation).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn affine(
        mut self,
        scale: impl Into<SignalOrF32>,
        rotation: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Affine,
            WarpParams {
                strength: SignalOrF32::Scalar(1.0),
                scale: scale.into(),
                rotation: rotation.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add an affine warp with translation.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn affine_with_translate(
        mut self,
        scale: impl Into<SignalOrF32>,
        rotation: impl Into<SignalOrF32>,
        tx: impl Into<SignalOrF32>,
        ty: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Affine,
            WarpParams {
                strength: SignalOrF32::Scalar(1.0),
                scale: scale.into(),
                rotation: rotation.into(),
                translate: [tx.into(), ty.into()],
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a noise displacement warp.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn noise(
        mut self,
        strength: impl Into<SignalOrF32>,
        frequency: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Noise,
            WarpParams {
                strength: strength.into(),
                frequency: frequency.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a shear warp.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn shear(mut self, strength: impl Into<SignalOrF32>) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Shear,
            WarpParams {
                strength: strength.into(),
                ..Default::default()
            },
        ));
        self.0
    }
}

/// Sub-builder for color operations. Returned by `builder.color`.
#[derive(Clone, Debug)]
pub struct ColorBuilder(pub FeedbackBuilder);

impl ColorBuilder {
    /// Add a decay effect (fade to black).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn decay(mut self, rate: impl Into<SignalOrF32>) -> FeedbackBuilder {
        self.0.push_color(ColorStep::new(
            ColorOperator::Decay,
            ColorParams {
                decay_rate: rate.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add an HSV shift effect.
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn hsv(
        mut self,
        h: impl Into<SignalOrF32>,
        s: impl Into<SignalOrF32>,
        v: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_color(ColorStep::new(
            ColorOperator::HsvShift,
            ColorParams {
                hsv_shift: [h.into(), s.into(), v.into()],
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a posterize effect (reduce color levels).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn posterize(mut self, levels: impl Into<SignalOrF32>) -> FeedbackBuilder {
        self.0.push_color(ColorStep::new(
            ColorOperator::Posterize,
            ColorParams {
                posterize_levels: levels.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a channel offset effect (RGB split / chromatic aberration).
    /// Parameters can be f32 or Signal for audio-reactive effects.
    pub fn channel_offset(
        mut self,
        x: impl Into<SignalOrF32>,
        y: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_color(ColorStep::new(
            ColorOperator::ChannelOffset,
            ColorParams {
                channel_offset: [x.into(), y.into()],
                ..Default::default()
            },
        ));
        self.0
    }
}

/// Sub-builder for blend mode selection. Returned by `builder.blend`.
#[derive(Clone, Debug)]
pub struct BlendBuilder(pub FeedbackBuilder);

impl BlendBuilder {
    /// Set blend mode to alpha (linear interpolation).
    pub fn alpha(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Alpha);
        self.0
    }

    /// Set blend mode to additive.
    pub fn add(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Add);
        self.0
    }

    /// Set blend mode to multiply.
    pub fn multiply(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Multiply);
        self.0
    }

    /// Set blend mode to screen.
    pub fn screen(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Screen);
        self.0
    }

    /// Set blend mode to overlay.
    pub fn overlay(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Overlay);
        self.0
    }

    /// Set blend mode to difference.
    pub fn difference(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Difference);
        self.0
    }

    /// Set blend mode to max.
    pub fn max(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Max);
        self.0
    }
}

/// GPU warp step (32 bytes = 2 × 16-byte blocks).
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct GpuWarpStep {
    // Block 1 (16 bytes)
    pub warp_type: u32,
    pub strength: f32,
    pub scale: f32,
    pub rotation: f32,
    // Block 2 (16 bytes)
    pub translate_x: f32,
    pub translate_y: f32,
    pub frequency: f32,
    pub falloff: f32,
}

/// GPU color step (32 bytes = 2 × 16-byte blocks).
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct GpuColorStep {
    // Block 1 (16 bytes)
    pub color_type: u32,
    pub decay_rate: f32,
    pub posterize_levels: f32,
    pub hsv_h: f32,
    // Block 2 (16 bytes)
    pub hsv_s: f32,
    pub hsv_v: f32,
    pub offset_x: f32,
    pub offset_y: f32,
}

/// GPU-compatible uniform buffer for feedback shader with chained transforms.
///
/// Layout: header (16 bytes) + 4 warp steps (128 bytes) + 4 color steps (128 bytes) = 272 bytes.
/// All blocks are 16-byte aligned for WGSL compatibility.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct FeedbackUniforms {
    // Header (16 bytes)
    pub warp_count: u32,
    pub color_count: u32,
    pub blend_mode: u32,
    pub opacity: f32,

    // Warp steps array (4 × 32 = 128 bytes)
    pub warp_steps: [GpuWarpStep; MAX_WARP_CHAIN],

    // Color steps array (4 × 32 = 128 bytes)
    pub color_steps: [GpuColorStep; MAX_COLOR_CHAIN],
}

impl Default for FeedbackUniforms {
    fn default() -> Self {
        // Return a zeroed struct (all values 0, feedback disabled)
        Self::zeroed()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use crate::signal_eval::EvalContext;
    use crate::signal_state::SignalState;
    use crate::signal_stats::StatisticsCache;

    /// Create a minimal EvalContext for testing.
    fn test_eval_ctx() -> (SignalState, StatisticsCache) {
        (SignalState::new(), StatisticsCache::new())
    }

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
        // Header (16) + 4 warp steps (128) + 4 color steps (128) = 272 bytes
        assert_eq!(std::mem::size_of::<FeedbackUniforms>(), 272);
        assert_eq!(std::mem::size_of::<GpuWarpStep>(), 32);
        assert_eq!(std::mem::size_of::<GpuColorStep>(), 32);
    }

    #[test]
    fn test_config_to_uniforms_single() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let mut ctx = EvalContext::new(0.0, 0.016, 0, None, &inputs, &bands, &stats, &mut state);

        let config = FeedbackConfig::new()
            .with_warp(WarpOperator::Spiral)
            .with_warp_params(WarpParams {
                strength: 0.5.into(),
                scale: 1.02.into(),
                rotation: 0.01.into(),
                ..Default::default()
            })
            .with_color(ColorOperator::Decay)
            .with_color_params(ColorParams {
                decay_rate: 0.92.into(),
                ..Default::default()
            })
            .with_blend(FeedbackBlend::Add)
            .with_opacity(0.7);

        let uniforms = config.to_uniforms(&mut ctx);
        assert_eq!(uniforms.warp_count, 1);
        assert_eq!(uniforms.color_count, 1);
        assert_eq!(uniforms.warp_steps[0].warp_type, 3); // Spiral
        assert_eq!(uniforms.warp_steps[0].strength, 0.5);
        assert_eq!(uniforms.warp_steps[0].scale, 1.02);
        assert_eq!(uniforms.color_steps[0].color_type, 1); // Decay
        assert_eq!(uniforms.color_steps[0].decay_rate, 0.92);
        assert_eq!(uniforms.blend_mode, 1); // Add
        assert_eq!(uniforms.opacity, 0.7);
    }

    #[test]
    fn test_config_to_uniforms_chained() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let mut ctx = EvalContext::new(0.0, 0.016, 0, None, &inputs, &bands, &stats, &mut state);

        let config = FeedbackConfig::new()
            .add_warp(WarpOperator::Spiral, WarpParams {
                strength: 0.5.into(),
                rotation: 0.02.into(),
                ..Default::default()
            })
            .add_warp(WarpOperator::Radial, WarpParams {
                strength: 0.3.into(),
                scale: 1.01.into(),
                ..Default::default()
            })
            .add_color(ColorOperator::Decay, ColorParams {
                decay_rate: 0.95.into(),
                ..Default::default()
            })
            .add_color(ColorOperator::HsvShift, ColorParams {
                hsv_shift: [0.01.into(), 0.0.into(), (-0.02f32).into()],
                ..Default::default()
            })
            .with_blend(FeedbackBlend::Screen)
            .with_opacity(0.85);

        let uniforms = config.to_uniforms(&mut ctx);
        assert_eq!(uniforms.warp_count, 2);
        assert_eq!(uniforms.color_count, 2);

        // First warp: spiral
        assert_eq!(uniforms.warp_steps[0].warp_type, 3);
        assert_eq!(uniforms.warp_steps[0].strength, 0.5);
        assert_eq!(uniforms.warp_steps[0].rotation, 0.02);

        // Second warp: radial
        assert_eq!(uniforms.warp_steps[1].warp_type, 2);
        assert_eq!(uniforms.warp_steps[1].strength, 0.3);
        assert_eq!(uniforms.warp_steps[1].scale, 1.01);

        // First color: decay
        assert_eq!(uniforms.color_steps[0].color_type, 1);
        assert_eq!(uniforms.color_steps[0].decay_rate, 0.95);

        // Second color: hsv_shift
        assert_eq!(uniforms.color_steps[1].color_type, 2);
        assert_eq!(uniforms.color_steps[1].hsv_h, 0.01);
        assert_eq!(uniforms.color_steps[1].hsv_v, -0.02);

        assert_eq!(uniforms.blend_mode, 3); // Screen
        assert_eq!(uniforms.opacity, 0.85);
    }
}
