//! Rhai registration for the fluent feedback builder API.

use rhai::{Dynamic, Engine, EvalAltResult};

use crate::feedback::{
    BlendBuilder, ColorBuilder, FeedbackBuilder, FeedbackConfig, SignalOrF32, WarpBuilder,
};
use crate::signal::Signal;

/// Convert a Rhai Dynamic value to SignalOrF32.
///
/// Accepts:
/// - f32/f64: Converts to SignalOrF32::Scalar
/// - i64: Converts to SignalOrF32::Scalar
/// - Signal: Converts to SignalOrF32::Signal
fn to_signal_or_f32(value: Dynamic) -> Result<SignalOrF32, Box<EvalAltResult>> {
    // Try f64 (Rhai's default float type)
    if let Some(f) = value.clone().try_cast::<f64>() {
        return Ok(SignalOrF32::Scalar(f as f32));
    }

    // Try f32 (in case a Rust f32 is passed through)
    if let Some(f) = value.clone().try_cast::<f32>() {
        return Ok(SignalOrF32::Scalar(f));
    }

    // Try i64 (Rhai's default integer type)
    if let Some(i) = value.clone().try_cast::<i64>() {
        return Ok(SignalOrF32::Scalar(i as f32));
    }

    // Try i32 (in case a Rust i32 is passed through)
    if let Some(i) = value.clone().try_cast::<i32>() {
        return Ok(SignalOrF32::Scalar(i as f32));
    }

    // Try Signal
    if let Some(signal) = value.clone().try_cast::<Signal>() {
        return Ok(SignalOrF32::Signal(signal));
    }

    Err(format!(
        "Expected number or Signal for feedback parameter, got {}",
        value.type_name()
    )
    .into())
}

/// Register the feedback builder API with the Rhai engine.
pub fn register_feedback_builder_api(engine: &mut Engine) {
    // Register builder types
    engine.register_type_with_name::<FeedbackBuilder>("FeedbackBuilder");
    engine.register_type_with_name::<WarpBuilder>("WarpBuilder");
    engine.register_type_with_name::<ColorBuilder>("ColorBuilder");
    engine.register_type_with_name::<BlendBuilder>("BlendBuilder");
    engine.register_type_with_name::<FeedbackConfig>("FeedbackConfig");

    // Factory function for creating a new builder
    engine.register_fn("__feedback_builder_new", FeedbackBuilder::new);

    // ========================================================================
    // FeedbackBuilder property accessors (return sub-builders)
    // ========================================================================

    engine.register_get("warp", |fb: &mut FeedbackBuilder| {
        WarpBuilder(fb.clone())
    });

    engine.register_get("color", |fb: &mut FeedbackBuilder| {
        ColorBuilder(fb.clone())
    });

    engine.register_get("blend", |fb: &mut FeedbackBuilder| {
        BlendBuilder(fb.clone())
    });

    // ========================================================================
    // FeedbackBuilder methods
    // ========================================================================

    // opacity(val) - accepts f32/i64 or Signal
    engine.register_fn(
        "opacity",
        |fb: &mut FeedbackBuilder, val: Dynamic| -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            let mut fb = fb.clone();
            fb.set_opacity_signal(to_signal_or_f32(val)?);
            Ok(fb)
        },
    );

    engine.register_fn("build", |fb: &mut FeedbackBuilder| fb.build());

    // ========================================================================
    // WarpBuilder methods - each returns FeedbackBuilder for chaining
    // All methods accept f32/i64 or Signal for each parameter
    // ========================================================================

    // spiral(strength, rotation)
    engine.register_fn(
        "spiral",
        |wb: &mut WarpBuilder,
         strength: Dynamic,
         rotation: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb
                .clone()
                .spiral(to_signal_or_f32(strength)?, to_signal_or_f32(rotation)?))
        },
    );

    // spiral(strength, rotation, scale)
    engine.register_fn(
        "spiral",
        |wb: &mut WarpBuilder,
         strength: Dynamic,
         rotation: Dynamic,
         scale: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb.clone().spiral_with_scale(
                to_signal_or_f32(strength)?,
                to_signal_or_f32(rotation)?,
                to_signal_or_f32(scale)?,
            ))
        },
    );

    // radial(strength)
    engine.register_fn(
        "radial",
        |wb: &mut WarpBuilder, strength: Dynamic| -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb.clone().radial(to_signal_or_f32(strength)?))
        },
    );

    // radial(strength, scale)
    engine.register_fn(
        "radial",
        |wb: &mut WarpBuilder,
         strength: Dynamic,
         scale: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb
                .clone()
                .radial_with_scale(to_signal_or_f32(strength)?, to_signal_or_f32(scale)?))
        },
    );

    // affine(scale, rotation)
    engine.register_fn(
        "affine",
        |wb: &mut WarpBuilder,
         scale: Dynamic,
         rotation: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb
                .clone()
                .affine(to_signal_or_f32(scale)?, to_signal_or_f32(rotation)?))
        },
    );

    // affine(scale, rotation, tx, ty)
    engine.register_fn(
        "affine",
        |wb: &mut WarpBuilder,
         scale: Dynamic,
         rotation: Dynamic,
         tx: Dynamic,
         ty: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb.clone().affine_with_translate(
                to_signal_or_f32(scale)?,
                to_signal_or_f32(rotation)?,
                to_signal_or_f32(tx)?,
                to_signal_or_f32(ty)?,
            ))
        },
    );

    // noise(strength, frequency)
    engine.register_fn(
        "noise",
        |wb: &mut WarpBuilder,
         strength: Dynamic,
         frequency: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb
                .clone()
                .noise(to_signal_or_f32(strength)?, to_signal_or_f32(frequency)?))
        },
    );

    // shear(strength)
    engine.register_fn(
        "shear",
        |wb: &mut WarpBuilder, strength: Dynamic| -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(wb.clone().shear(to_signal_or_f32(strength)?))
        },
    );

    // ========================================================================
    // ColorBuilder methods - each returns FeedbackBuilder for chaining
    // All methods accept f32/i64 or Signal for each parameter
    // ========================================================================

    // decay(rate)
    engine.register_fn(
        "decay",
        |cb: &mut ColorBuilder, rate: Dynamic| -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(cb.clone().decay(to_signal_or_f32(rate)?))
        },
    );

    // hsv(h, s, v)
    engine.register_fn(
        "hsv",
        |cb: &mut ColorBuilder,
         h: Dynamic,
         s: Dynamic,
         v: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(cb.clone().hsv(
                to_signal_or_f32(h)?,
                to_signal_or_f32(s)?,
                to_signal_or_f32(v)?,
            ))
        },
    );

    // posterize(levels)
    engine.register_fn(
        "posterize",
        |cb: &mut ColorBuilder, levels: Dynamic| -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(cb.clone().posterize(to_signal_or_f32(levels)?))
        },
    );

    // channel_offset(x, y)
    engine.register_fn(
        "channel_offset",
        |cb: &mut ColorBuilder,
         x: Dynamic,
         y: Dynamic|
         -> Result<FeedbackBuilder, Box<EvalAltResult>> {
            Ok(cb
                .clone()
                .channel_offset(to_signal_or_f32(x)?, to_signal_or_f32(y)?))
        },
    );

    // ========================================================================
    // BlendBuilder methods - each returns FeedbackBuilder for chaining
    // ========================================================================

    engine.register_fn("alpha", |bb: &mut BlendBuilder| bb.clone().alpha());
    engine.register_fn("add", |bb: &mut BlendBuilder| bb.clone().add());
    engine.register_fn("multiply", |bb: &mut BlendBuilder| bb.clone().multiply());
    engine.register_fn("screen", |bb: &mut BlendBuilder| bb.clone().screen());
    engine.register_fn("overlay", |bb: &mut BlendBuilder| bb.clone().overlay());
    engine.register_fn("difference", |bb: &mut BlendBuilder| {
        bb.clone().difference()
    });
    engine.register_fn("max", |bb: &mut BlendBuilder| bb.clone().max());
}
