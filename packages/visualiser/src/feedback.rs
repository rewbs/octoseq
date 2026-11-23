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
    /// Four drifting sine waves bending the frame (Milkdrop's warp).
    Waves,
    /// A zoom that depends on direction from the centre.
    Petals,
    /// A zoom that depends on distance from the centre.
    Ripple,
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
            WarpOperator::Waves => 6,
            WarpOperator::Petals => 7,
            WarpOperator::Ripple => 8,
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
            "waves" => WarpOperator::Waves,
            "petals" => WarpOperator::Petals,
            "ripple" => WarpOperator::Ripple,
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
    /// This frame's content drawn over the previous frame.
    ///
    /// The previous frame is the base layer and shows through wherever this
    /// frame drew nothing, so everything drawn leaves a trail that the warp
    /// carries away. The scene is rendered on a transparent background for
    /// this mode; the other modes blend whole frames, background included.
    Over,
}

/// When in the pipeline feedback samples from.
///
/// This is a creative choice that affects how feedback interacts with post-processing:
/// - `PreFx`: Feedback samples the raw scene render before any effects (trails remain crisp)
/// - `PostFx`: Feedback samples after all effects (bloom, blur, etc. accumulate over time)
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FeedbackSamplingMode {
    /// Sample scene render before post-FX (default, current behavior).
    #[default]
    PreFx,
    /// Sample after all post-processing effects.
    PostFx,
}

impl FeedbackSamplingMode {
    /// Convert to GPU-compatible u32.
    pub fn to_u32(self) -> u32 {
        match self {
            FeedbackSamplingMode::PreFx => 0,
            FeedbackSamplingMode::PostFx => 1,
        }
    }

    /// Parse from string (for script API).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "post_fx" | "postfx" | "post" | "after" | "after_effects" => {
                FeedbackSamplingMode::PostFx
            }
            _ => FeedbackSamplingMode::PreFx,
        }
    }
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
            FeedbackBlend::Over => 7,
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
            "over" | "trails" => FeedbackBlend::Over,
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
            translate: [
                self.translate[0].evaluate(ctx),
                self.translate[1].evaluate(ctx),
            ],
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

/// How bright the previous frame is allowed to come back.
///
/// A feedback loop adds this frame to a copy of the last one, and anything in
/// the loop that brightens (a screen or additive blend, bloom or a colour grade
/// sampled after effects) is applied again every frame. Without a bound the
/// picture climbs to white and stays there. The limit is applied to the
/// feedback sample only, never to the scene drawn this frame: below `knee` the
/// sample is untouched, above it brightness is compressed so that it approaches
/// `ceiling` and never reaches it. Hue is kept: all three channels are scaled
/// together.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FeedbackLimit {
    /// Brightness (of the brightest channel) up to which the sample is left alone.
    pub knee: f32,
    /// Brightness the sample can approach but not reach. 0 turns the limit off.
    pub ceiling: f32,
}

impl FeedbackLimit {
    /// No limit: the loop is free to run away. For scenes that manage their own decay.
    pub const OFF: Self = Self { knee: 0.0, ceiling: 0.0 };
}

impl Default for FeedbackLimit {
    /// Bounded by default.
    fn default() -> Self {
        Self { knee: 0.6, ceiling: 0.85 }
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

    /// Where in the pipeline feedback samples from.
    pub sampling_mode: FeedbackSamplingMode,

    /// How bright the previous frame may come back. Bounded unless turned off.
    pub limit: FeedbackLimit,
    /// Where the warps are centred, as an offset from the middle of the frame.
    pub centre: [SignalOrF32; 2],
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
        self.warp_chain
            .push(WarpStep::new(warp, WarpParams::default()));
        self
    }

    /// Builder: set warp parameters for the first (or only) warp in the chain.
    pub fn with_warp_params(mut self, params: WarpParams) -> Self {
        if let Some(step) = self.warp_chain.first_mut() {
            step.params = params;
        } else {
            self.warp_chain
                .push(WarpStep::new(WarpOperator::None, params));
        }
        self
    }

    /// Builder: set colour operator (convenience for single color).
    /// Clears any existing color chain and sets a single color.
    pub fn with_color(mut self, color: ColorOperator) -> Self {
        self.color_chain.clear();
        self.color_chain
            .push(ColorStep::new(color, ColorParams::default()));
        self
    }

    /// Builder: set colour parameters for the first (or only) color in the chain.
    pub fn with_color_params(mut self, params: ColorParams) -> Self {
        if let Some(step) = self.color_chain.first_mut() {
            step.params = params;
        } else {
            self.color_chain
                .push(ColorStep::new(ColorOperator::None, params));
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

        // The loop runs once a frame, so anything it does a little of each time
        // (fade, grow, turn, slide, bend) would happen four times as fast at 120
        // frames a second as at 30. Settings are therefore read as "per thirtieth
        // of a second" and scaled to the frame's real length: `k` is how many
        // thirtieths this frame lasts. At 30 fps it is exactly 1 and nothing changes.
        let k = if ctx.dt > 0.0 { ctx.dt * FEEDBACK_REFERENCE_FPS } else { 1.0 };

        // Header
        uniforms.warp_count = self.warp_chain.len().min(MAX_WARP_CHAIN) as u32;
        uniforms.color_count = self.color_chain.len().min(MAX_COLOR_CHAIN) as u32;
        uniforms.blend_mode = self.blend.to_u32();
        uniforms.opacity = self.opacity.evaluate(ctx);
        uniforms.limit_knee = self.limit.knee;
        uniforms.limit_ceiling = self.limit.ceiling;
        uniforms.centre = [self.centre[0].evaluate(ctx), self.centre[1].evaluate(ctx)];

        // Fill warp steps - evaluate each parameter
        for (i, step) in self.warp_chain.iter().take(MAX_WARP_CHAIN).enumerate() {
            let mut params = step.params.evaluate(ctx);
            match step.operator {
                // Affine applies its scale, turn and slide in full each frame.
                WarpOperator::Affine => {
                    params.scale = params.scale.max(1e-6).powf(k);
                    params.rotation *= k;
                    params.translate = [params.translate[0] * k, params.translate[1] * k];
                }
                // The rest move the picture in proportion to their strength.
                // (For the three field warps `rotation` is a phase, not a rate.)
                WarpOperator::None => {}
                _ => params.strength *= k,
            }
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
                decay_rate: params.decay_rate.max(0.0).powf(k),
                posterize_levels: params.posterize_levels,
                hsv_h: params.hsv_shift[0] * k,
                hsv_s: params.hsv_shift[1] * k,
                hsv_v: params.hsv_shift[2] * k,
                offset_x: params.channel_offset[0],
                offset_y: params.channel_offset[1],
            };
        }

        uniforms
    }

    /// Whether the scene should be drawn on a transparent background.
    ///
    /// True when feedback is on in `Over` mode: the previous frame is then the
    /// background, and the scene's alpha says where this frame drew something.
    pub fn wants_transparent_scene(&self) -> bool {
        self.enabled && self.blend == FeedbackBlend::Over
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
        extract(&self.centre[0], &mut signals);
        extract(&self.centre[1], &mut signals);

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
///     .sample_after_effects()
///     .build();
/// ```
#[derive(Clone, Debug, Default)]
pub struct FeedbackBuilder {
    warp_chain: Vec<WarpStep>,
    color_chain: Vec<ColorStep>,
    blend: FeedbackBlend,
    opacity: SignalOrF32,
    sampling_mode: FeedbackSamplingMode,
    limit: FeedbackLimit,
    centre: [SignalOrF32; 2],
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

    /// Move the point the warps are centred on away from the middle of the
    /// frame: `x` to the right and `y` down, in frame widths and heights.
    pub fn set_centre(&mut self, x: SignalOrF32, y: SignalOrF32) {
        self.centre = [x, y];
    }

    /// Set the sampling mode.
    pub fn set_sampling_mode(&mut self, mode: FeedbackSamplingMode) {
        self.sampling_mode = mode;
    }

    /// Set how bright the previous frame may come back.
    pub fn set_limit(&mut self, limit: FeedbackLimit) {
        self.limit = limit;
    }

    /// Set feedback to sample before post-processing effects (default).
    ///
    /// Trails remain crisp; post-FX are applied fresh each frame.
    pub fn sample_before_effects(mut self) -> Self {
        self.sampling_mode = FeedbackSamplingMode::PreFx;
        self
    }

    /// Set feedback to sample after all post-processing effects.
    ///
    /// Bloom, blur, and other effects accumulate over time in trails.
    pub fn sample_after_effects(mut self) -> Self {
        self.sampling_mode = FeedbackSamplingMode::PostFx;
        self
    }

    /// Build the final FeedbackConfig.
    pub fn build(&self) -> FeedbackConfig {
        FeedbackConfig {
            enabled: true,
            warp_chain: self.warp_chain.clone(),
            color_chain: self.color_chain.clone(),
            blend: self.blend,
            opacity: self.opacity.clone(),
            sampling_mode: self.sampling_mode,
            limit: self.limit,
            centre: self.centre.clone(),
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

    /// Add Milkdrop's warp: four slow sine waves crossing the frame, each bending
    /// it a little, so that no two parts of the picture move alike.
    ///
    /// `amount` 1.0 moves the picture by up to 0.7% of the frame per frame,
    /// Milkdrop's `warp = 1`. `scale` is how many waves cross the frame (1.0 is
    /// Milkdrop's). `phase` moves the waves: give it time, or a signal that
    /// advances faster when the music is loud.
    pub fn waves(
        mut self,
        amount: impl Into<SignalOrF32>,
        scale: impl Into<SignalOrF32>,
        phase: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Waves,
            WarpParams {
                strength: amount.into(),
                frequency: scale.into(),
                rotation: phase.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a zoom that depends on direction: in and out `count` times round the
    /// centre, by `amount` of the distance. `phase` turns the pattern.
    pub fn petals(
        mut self,
        amount: impl Into<SignalOrF32>,
        count: impl Into<SignalOrF32>,
        phase: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Petals,
            WarpParams {
                strength: amount.into(),
                frequency: count.into(),
                rotation: phase.into(),
                ..Default::default()
            },
        ));
        self.0
    }

    /// Add a zoom that depends on distance: in and out in `rings` rings between
    /// the centre and the edge of the frame, by `amount` of the distance.
    /// `phase` moves the rings outwards.
    pub fn ripple(
        mut self,
        amount: impl Into<SignalOrF32>,
        rings: impl Into<SignalOrF32>,
        phase: impl Into<SignalOrF32>,
    ) -> FeedbackBuilder {
        self.0.push_warp(WarpStep::new(
            WarpOperator::Ripple,
            WarpParams {
                strength: amount.into(),
                frequency: rings.into(),
                rotation: phase.into(),
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

    /// Draw this frame's content over the previous frame (see [`FeedbackBlend::Over`]).
    pub fn over(mut self) -> FeedbackBuilder {
        self.0.set_blend(FeedbackBlend::Over);
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
/// Layout: header (16 bytes) + limit (16 bytes) + 4 warp steps (128 bytes) + 4 color steps (128 bytes) = 288 bytes,
/// then the chains of the other scene of a transition (16 + 128 + 128) = 560 bytes.
/// All blocks are 16-byte aligned for WGSL compatibility.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct FeedbackUniforms {
    // Header (16 bytes)
    pub warp_count: u32,
    pub color_count: u32,
    pub blend_mode: u32,
    pub opacity: f32,

    // Limit on the feedback sample (16 bytes); a ceiling of 0 means no limit
    pub limit_knee: f32,
    pub limit_ceiling: f32,
    /// During a transition, how much of the picture still belongs to the scene
    /// on its way out (1 at the start, 0 at the end). 0 outside a transition.
    pub other_share: f32,
    pub _pad: f32,

    // Warp steps array (4 × 32 = 128 bytes)
    pub warp_steps: [GpuWarpStep; MAX_WARP_CHAIN],

    // Color steps array (4 × 32 = 128 bytes)
    pub color_steps: [GpuColorStep; MAX_COLOR_CHAIN],

    // The outgoing scene's chains (16 + 128 + 128 bytes), used while other_share > 0
    pub other_warp_count: u32,
    pub other_color_count: u32,
    /// Where the warps are centred: an offset from the middle of the frame, in
    /// frame widths and heights (x to the right, y down).
    pub centre: [f32; 2],
    pub other_warp_steps: [GpuWarpStep; MAX_WARP_CHAIN],
    pub other_color_steps: [GpuColorStep; MAX_COLOR_CHAIN],
}

/// The frame rate the feedback loop's settings are written for: a decay of 0.96
/// means "keep 96% every thirtieth of a second", whatever the real frame rate.
pub const FEEDBACK_REFERENCE_FPS: f32 = 30.0;

impl FeedbackUniforms {
    /// The uniforms for a frame in which this scene is taking over from another.
    ///
    /// `other_share` is how much of the picture still belongs to the outgoing
    /// scene: 1 when the transition starts, 0 when it is over. The feedback
    /// pass mixes the two scenes' warp fields and colour chains by it, so the
    /// previous frame is pulled partly each scene's way, and mixes what the two
    /// scenes drew. Opacity and the limit are mixed here. The blend mode cannot
    /// be mixed and is the incoming scene's throughout.
    pub fn taking_over_from(&self, outgoing: &FeedbackUniforms, other_share: f32) -> FeedbackUniforms {
        let share = other_share.clamp(0.0, 1.0);
        // Written so that the ends are exact: all the other's at 1, all its own at 0.
        let mix = |own: f32, other: f32| own * (1.0 - share) + other * share;
        let mut uniforms = *self;
        uniforms.other_share = share;
        uniforms.opacity = mix(self.opacity, outgoing.opacity);
        // One centre serves both scenes' warps during the blend: it travels from the old to the new.
        uniforms.centre = [mix(self.centre[0], outgoing.centre[0]), mix(self.centre[1], outgoing.centre[1])];
        // A ceiling of 0 means no limit; mixing with it would make one up.
        if self.limit_ceiling > 0.0 && outgoing.limit_ceiling > 0.0 {
            uniforms.limit_knee = mix(self.limit_knee, outgoing.limit_knee);
            uniforms.limit_ceiling = mix(self.limit_ceiling, outgoing.limit_ceiling);
        }
        uniforms.other_warp_count = outgoing.warp_count;
        uniforms.other_color_count = outgoing.color_count;
        uniforms.other_warp_steps = outgoing.warp_steps;
        uniforms.other_color_steps = outgoing.color_steps;
        uniforms
    }
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
    use crate::signal_eval::EvalContext;
    use crate::signal_state::SignalState;
    use crate::signal_stats::StatisticsCache;
    use std::collections::HashMap;

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
        assert_eq!(
            ColorOperator::from_str("hsv_shift"),
            ColorOperator::HsvShift
        );
        assert_eq!(
            ColorOperator::from_str("posterize"),
            ColorOperator::Posterize
        );
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
        assert_eq!(
            FeedbackBlend::from_str("difference"),
            FeedbackBlend::Difference
        );
        assert_eq!(FeedbackBlend::from_str("max"), FeedbackBlend::Max);
        assert_eq!(FeedbackBlend::from_str("over"), FeedbackBlend::Over);
        assert_eq!(FeedbackBlend::Over.to_u32(), 7);
        assert_eq!(FeedbackBlend::from_str("alpha"), FeedbackBlend::Alpha);
    }

    #[test]
    fn feedback_is_bounded_by_default() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let stems = HashMap::new();
        let custom = HashMap::new();
        let composed = HashMap::new();
        let mut ctx = EvalContext::new(0.0, 0.016, 0, None, &inputs, &bands, &stems, &custom, &composed, &stats, &mut state, None);

        // A config made any of the usual ways carries the default limit to the GPU.
        let default_limit = FeedbackLimit::default();
        assert!(default_limit.knee > 0.0 && default_limit.knee < default_limit.ceiling && default_limit.ceiling < 1.0);
        for config in [FeedbackConfig::new(), FeedbackBuilder::new().build()] {
            let uniforms = config.to_uniforms(&mut ctx);
            assert_eq!(uniforms.limit_knee, default_limit.knee);
            assert_eq!(uniforms.limit_ceiling, default_limit.ceiling);
        }

        // A scene can set its own limit, or switch it off (a ceiling of 0 means no limit in the shader).
        let mut builder = FeedbackBuilder::new();
        builder.set_limit(FeedbackLimit { knee: 0.3, ceiling: 0.7 });
        let uniforms = builder.build().to_uniforms(&mut ctx);
        assert_eq!((uniforms.limit_knee, uniforms.limit_ceiling), (0.3, 0.7));
        builder.set_limit(FeedbackLimit::OFF);
        assert_eq!(builder.build().to_uniforms(&mut ctx).limit_ceiling, 0.0);
    }

    #[test]
    fn a_transition_carries_both_scenes_chains() {
        let mut incoming = FeedbackUniforms::zeroed();
        incoming.warp_count = 1;
        incoming.warp_steps[0].strength = 0.2;
        incoming.opacity = 1.0;
        incoming.limit_knee = 0.6;
        incoming.limit_ceiling = 0.8;
        let mut outgoing = FeedbackUniforms::zeroed();
        outgoing.warp_count = 2;
        outgoing.warp_steps[1].strength = 0.9;
        outgoing.color_count = 1;
        outgoing.color_steps[0].decay_rate = 0.5;
        outgoing.opacity = 0.5;
        outgoing.limit_knee = 0.2;
        outgoing.limit_ceiling = 0.4;

        let start = incoming.taking_over_from(&outgoing, 1.0);
        assert_eq!(start.other_share, 1.0);
        assert_eq!((start.warp_count, start.other_warp_count), (1, 2));
        assert_eq!(start.warp_steps[0].strength, 0.2);
        assert_eq!(start.other_warp_steps[1].strength, 0.9);
        assert_eq!(start.other_color_steps[0].decay_rate, 0.5);
        assert_eq!((start.opacity, start.limit_knee, start.limit_ceiling), (0.5, 0.2, 0.4));

        let half = incoming.taking_over_from(&outgoing, 0.5);
        assert!((half.opacity - 0.75).abs() < 1e-6);
        assert!((half.limit_ceiling - 0.6).abs() < 1e-6);

        let end = incoming.taking_over_from(&outgoing, 0.0);
        assert_eq!(end.other_share, 0.0);
        assert_eq!((end.opacity, end.limit_knee, end.limit_ceiling), (1.0, 0.6, 0.8));

        // An unbounded scene on either side keeps the incoming scene's limit as it is.
        outgoing.limit_ceiling = 0.0;
        assert_eq!(incoming.taking_over_from(&outgoing, 1.0).limit_ceiling, 0.8);
        // Out of range shares are clamped.
        assert_eq!(incoming.taking_over_from(&outgoing, 3.0).other_share, 1.0);
    }

    #[test]
    fn settings_mean_the_same_per_second_at_any_frame_rate() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let stems = HashMap::new();
        let custom = HashMap::new();
        let composed = HashMap::new();
        let builder = WarpBuilder(FeedbackBuilder::new()).affine_with_translate(1.02, 0.01, 0.004, 0.0);
        let builder = WarpBuilder(builder).waves(2.0, 1.0, 0.5);
        let builder = ColorBuilder(builder).decay(0.96);
        let config = ColorBuilder(builder).hsv(0.004, 0.0, 0.0).build();
        let mut at = |dt: f32| {
            let mut ctx = EvalContext::new(0.0, dt, 0, None, &inputs, &bands, &stems, &custom, &composed, &stats, &mut state, None);
            config.to_uniforms(&mut ctx)
        };
        let thirty = at(1.0 / 30.0);
        // At 30 fps the settings are used exactly as written.
        assert_eq!(thirty.warp_steps[0].scale, 1.02);
        assert_eq!(thirty.warp_steps[0].rotation, 0.01);
        assert_eq!(thirty.warp_steps[1].strength, 2.0);
        assert_eq!(thirty.color_steps[0].decay_rate, 0.96);
        // At 120 fps four frames do what one did.
        let fast = at(1.0 / 120.0);
        assert!((fast.warp_steps[0].scale.powi(4) - 1.02).abs() < 1e-5);
        assert!((fast.warp_steps[0].rotation * 4.0 - 0.01).abs() < 1e-7);
        assert!((fast.warp_steps[0].translate_x * 4.0 - 0.004).abs() < 1e-7);
        assert!((fast.warp_steps[1].strength * 4.0 - 2.0).abs() < 1e-5);
        assert!((fast.color_steps[0].decay_rate.powi(4) - 0.96).abs() < 1e-5);
        assert!((fast.color_steps[1].hsv_h * 4.0 - 0.004).abs() < 1e-7);
        // The waves' phase is a position, not a rate, and is left alone.
        assert_eq!(fast.warp_steps[1].rotation, 0.5);
    }

    #[test]
    fn test_uniform_size() {
        // Header (16) + limit (16) + 4 warp steps (128) + 4 color steps (128) = 288 bytes,
        // then the other scene's counts (16) and chains (128 + 128) = 560 bytes
        assert_eq!(std::mem::size_of::<FeedbackUniforms>(), 560);
        assert_eq!(std::mem::size_of::<GpuWarpStep>(), 32);
        assert_eq!(std::mem::size_of::<GpuColorStep>(), 32);
    }

    #[test]
    fn test_config_to_uniforms_single() {
        let (mut state, stats) = test_eval_ctx();
        let inputs = HashMap::new();
        let bands = HashMap::new();
        let stems = HashMap::new();
        let custom_signals = HashMap::new();
        let composed_signals = HashMap::new();
        let mut ctx = EvalContext::new(
            0.0,
            1.0 / 30.0,
            0,
            None,
            &inputs,
            &bands,
            &stems,
            &custom_signals,
            &composed_signals,
            &stats,
            &mut state,
            None,
        );

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
        let stems = HashMap::new();
        let custom_signals = HashMap::new();
        let composed_signals = HashMap::new();
        let mut ctx = EvalContext::new(
            0.0,
            1.0 / 30.0,
            0,
            None,
            &inputs,
            &bands,
            &stems,
            &custom_signals,
            &composed_signals,
            &stats,
            &mut state,
            None,
        );

        let config = FeedbackConfig::new()
            .add_warp(
                WarpOperator::Spiral,
                WarpParams {
                    strength: 0.5.into(),
                    rotation: 0.02.into(),
                    ..Default::default()
                },
            )
            .add_warp(
                WarpOperator::Radial,
                WarpParams {
                    strength: 0.3.into(),
                    scale: 1.01.into(),
                    ..Default::default()
                },
            )
            .add_color(
                ColorOperator::Decay,
                ColorParams {
                    decay_rate: 0.95.into(),
                    ..Default::default()
                },
            )
            .add_color(
                ColorOperator::HsvShift,
                ColorParams {
                    hsv_shift: [0.01.into(), 0.0.into(), (-0.02f32).into()],
                    ..Default::default()
                },
            )
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
