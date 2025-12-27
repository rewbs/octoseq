// Frame feedback post-processing effect
// Provides Milkdrop-style temporal visual memory with spatial warping,
// colour transforms, and blend modes.
//
// Pipeline: previous_frame -> spatial_warp -> colour_transform -> blend(current) -> output

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct FeedbackUniforms {
    // Warp params
    warp_type: u32,
    warp_strength: f32,
    warp_scale: f32,
    warp_rotation: f32,

    warp_translate: vec2<f32>,
    warp_frequency: f32,
    warp_falloff: f32,

    warp_seed: u32,
    _pad0: vec3<u32>,

    // Colour params
    color_type: u32,
    color_decay_rate: f32,
    color_posterize_levels: f32,
    _pad1: f32,

    color_hsv_shift: vec4<f32>,
    color_channel_offset: vec4<f32>,

    // Blend params
    blend_mode: u32,
    opacity: f32,
    _pad2: vec2<f32>,
}

@group(0) @binding(0) var current_texture: texture_2d<f32>;
@group(0) @binding(1) var feedback_texture: texture_2d<f32>;
@group(0) @binding(2) var tex_sampler: sampler;
@group(1) @binding(0) var<uniform> params: FeedbackUniforms;

// ============================================================================
// Utility functions
// ============================================================================

// Hash function for deterministic noise
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2D noise function (value noise)
fn noise2d(p: vec2<f32>, seed: u32) -> vec2<f32> {
    let s = f32(seed) * 0.1234;
    let ps = p + vec2<f32>(s, s * 1.5);

    let i = floor(ps);
    let f = fract(ps);

    // Smooth interpolation
    let u = f * f * (3.0 - 2.0 * f);

    let a = hash21(i + vec2<f32>(0.0, 0.0));
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));

    let x = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);

    // Second layer for y component
    let a2 = hash21(i + vec2<f32>(0.5, 0.5));
    let b2 = hash21(i + vec2<f32>(1.5, 0.5));
    let c2 = hash21(i + vec2<f32>(0.5, 1.5));
    let d2 = hash21(i + vec2<f32>(1.5, 1.5));

    let y = mix(mix(a2, b2, u.x), mix(c2, d2, u.x), u.y);

    return vec2<f32>(x, y) * 2.0 - 1.0;
}

// RGB to HSV conversion
fn rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let cmax = max(max(rgb.r, rgb.g), rgb.b);
    let cmin = min(min(rgb.r, rgb.g), rgb.b);
    let delta = cmax - cmin;

    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let v = cmax;

    if (delta > 0.00001) {
        s = delta / cmax;

        if (cmax == rgb.r) {
            h = (rgb.g - rgb.b) / delta;
        } else if (cmax == rgb.g) {
            h = 2.0 + (rgb.b - rgb.r) / delta;
        } else {
            h = 4.0 + (rgb.r - rgb.g) / delta;
        }

        h /= 6.0;
        if (h < 0.0) {
            h += 1.0;
        }
    }

    return vec3<f32>(h, s, v);
}

// HSV to RGB conversion
fn hsv_to_rgb(hsv: vec3<f32>) -> vec3<f32> {
    let h = hsv.x * 6.0;
    let s = hsv.y;
    let v = hsv.z;

    let i = floor(h);
    let f = h - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));

    let ii = i32(i) % 6;

    if (ii == 0) { return vec3<f32>(v, t, p); }
    if (ii == 1) { return vec3<f32>(q, v, p); }
    if (ii == 2) { return vec3<f32>(p, v, t); }
    if (ii == 3) { return vec3<f32>(p, q, v); }
    if (ii == 4) { return vec3<f32>(t, p, v); }
    return vec3<f32>(v, p, q);
}

// ============================================================================
// Spatial warp operators
// ============================================================================

fn apply_warp(uv: vec2<f32>) -> vec2<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let centered = uv - center;
    let strength = params.warp_strength;

    // Calculate edge falloff
    let edge_dist = 1.0 - max(abs(centered.x), abs(centered.y)) * 2.0;
    let falloff_factor = mix(1.0, saturate(edge_dist * 2.0), params.warp_falloff);
    let effective_strength = strength * falloff_factor;

    switch params.warp_type {
        // None
        case 0u: {
            return uv;
        }
        // Affine (scale, rotate, translate)
        case 1u: {
            let s = params.warp_scale;
            let c = cos(params.warp_rotation * effective_strength);
            let sn = sin(params.warp_rotation * effective_strength);

            // Scale
            var transformed = centered / mix(1.0, s, effective_strength);

            // Rotate
            transformed = vec2<f32>(
                transformed.x * c - transformed.y * sn,
                transformed.x * sn + transformed.y * c
            );

            // Translate
            transformed += params.warp_translate * effective_strength;

            return transformed + center;
        }
        // Radial (zoom in/out from center)
        case 2u: {
            let dist = length(centered);
            let dir = select(vec2<f32>(0.0), centered / dist, dist > 0.0001);

            // Positive strength = zoom out (edges move outward), negative = zoom in
            let new_dist = dist * (1.0 + effective_strength * 0.1);
            return center + dir * new_dist;
        }
        // Spiral (radial + rotation)
        case 3u: {
            let dist = length(centered);
            let angle = atan2(centered.y, centered.x);

            // Rotation proportional to distance and strength
            let new_angle = angle + params.warp_rotation * dist * effective_strength;

            // Scale
            let new_dist = dist * (1.0 + (params.warp_scale - 1.0) * effective_strength);

            return center + vec2<f32>(cos(new_angle), sin(new_angle)) * new_dist;
        }
        // Noise displacement
        case 4u: {
            let n = noise2d(uv * params.warp_frequency, params.warp_seed);
            return uv + n * effective_strength * 0.1;
        }
        // Shear
        case 5u: {
            return vec2<f32>(
                uv.x + centered.y * effective_strength,
                uv.y + centered.x * effective_strength * params.warp_scale
            );
        }
        default: {
            return uv;
        }
    }
}

// ============================================================================
// Colour transform operators
// ============================================================================

fn apply_color(color: vec4<f32>, uv: vec2<f32>) -> vec4<f32> {
    switch params.color_type {
        // None
        case 0u: {
            return color;
        }
        // Decay (exponential fade)
        case 1u: {
            return vec4<f32>(color.rgb * params.color_decay_rate, color.a);
        }
        // HSV shift
        case 2u: {
            var hsv = rgb_to_hsv(color.rgb);
            hsv.x = fract(hsv.x + params.color_hsv_shift.x);
            hsv.y = saturate(hsv.y + params.color_hsv_shift.y);
            hsv.z = saturate(hsv.z + params.color_hsv_shift.z);
            return vec4<f32>(hsv_to_rgb(hsv), color.a);
        }
        // Posterize
        case 3u: {
            let levels = params.color_posterize_levels;
            return vec4<f32>(floor(color.rgb * levels) / levels, color.a);
        }
        // Channel offset (chromatic aberration)
        // This is special: we need to re-sample at offset positions
        case 4u: {
            let offset = params.color_channel_offset.xy * 0.01;
            // Note: this needs the warped UV, which we get from the caller
            // We sample each channel at a different offset
            return color; // Handled specially in fs_main
        }
        default: {
            return color;
        }
    }
}

// Special handler for channel offset that samples the feedback texture
fn apply_channel_offset(warped_uv: vec2<f32>) -> vec4<f32> {
    let offset = params.color_channel_offset.xy * 0.01;

    let r = textureSample(feedback_texture, tex_sampler, warped_uv + offset).r;
    let g = textureSample(feedback_texture, tex_sampler, warped_uv).g;
    let b = textureSample(feedback_texture, tex_sampler, warped_uv - offset).b;
    let a = textureSample(feedback_texture, tex_sampler, warped_uv).a;

    return vec4<f32>(r, g, b, a);
}

// ============================================================================
// Blend modes
// ============================================================================

fn apply_blend(current: vec4<f32>, feedback: vec4<f32>) -> vec4<f32> {
    let opacity = params.opacity;
    let fb = feedback * opacity;

    switch params.blend_mode {
        // Alpha (linear interpolation)
        case 0u: {
            return vec4<f32>(mix(current.rgb, feedback.rgb, opacity), current.a);
        }
        // Add
        case 1u: {
            return vec4<f32>(current.rgb + fb.rgb, current.a);
        }
        // Multiply
        case 2u: {
            return vec4<f32>(mix(current.rgb, current.rgb * feedback.rgb, opacity), current.a);
        }
        // Screen
        case 3u: {
            let screen = 1.0 - (1.0 - current.rgb) * (1.0 - feedback.rgb);
            return vec4<f32>(mix(current.rgb, screen, opacity), current.a);
        }
        // Overlay
        case 4u: {
            let low = 2.0 * current.rgb * feedback.rgb;
            let high = 1.0 - 2.0 * (1.0 - current.rgb) * (1.0 - feedback.rgb);
            let overlay = select(low, high, current.rgb > vec3<f32>(0.5));
            return vec4<f32>(mix(current.rgb, overlay, opacity), current.a);
        }
        // Difference
        case 5u: {
            return vec4<f32>(mix(current.rgb, abs(current.rgb - feedback.rgb), opacity), current.a);
        }
        // Max
        case 6u: {
            return vec4<f32>(mix(current.rgb, max(current.rgb, feedback.rgb), opacity), current.a);
        }
        default: {
            return current;
        }
    }
}

// ============================================================================
// Vertex shader
// ============================================================================

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// ============================================================================
// Fragment shader
// ============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample current frame
    let current = textureSample(current_texture, tex_sampler, in.uv);

    // Apply spatial warp to get feedback UV
    let warped_uv = apply_warp(in.uv);

    // Clamp to valid UV range to prevent edge artifacts
    let clamped_uv = clamp(warped_uv, vec2<f32>(0.001), vec2<f32>(0.999));

    // Sample feedback and apply colour transform
    var feedback: vec4<f32>;

    if (params.color_type == 4u) {
        // Channel offset needs special handling
        feedback = apply_channel_offset(clamped_uv);
    } else {
        feedback = textureSample(feedback_texture, tex_sampler, clamped_uv);
        feedback = apply_color(feedback, clamped_uv);
    }

    // Blend feedback with current frame
    return apply_blend(current, feedback);
}
