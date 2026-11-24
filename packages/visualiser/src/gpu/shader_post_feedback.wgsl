// Frame feedback post-processing effect
// Provides Milkdrop-style temporal visual memory with spatial warping,
// colour transforms, and blend modes.
//
// Pipeline: previous_frame -> warp₁ -> warp₂ -> ... -> color₁ -> color₂ -> ... -> blend(current) -> output

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// GPU warp step (32 bytes = 2 × 16-byte blocks)
struct GpuWarpStep {
    // Block 1
    warp_type: u32,
    strength: f32,
    scale: f32,
    rotation: f32,
    // Block 2
    translate_x: f32,
    translate_y: f32,
    frequency: f32,
    falloff: f32,
}

// GPU color step (32 bytes = 2 × 16-byte blocks)
struct GpuColorStep {
    // Block 1
    color_type: u32,
    decay_rate: f32,
    posterize_levels: f32,
    hsv_h: f32,
    // Block 2
    hsv_s: f32,
    hsv_v: f32,
    offset_x: f32,
    offset_y: f32,
}

// Main uniforms structure
// Header (16 bytes) + limit (16 bytes) + 4 warp steps (128 bytes) + 4 color steps (128 bytes) = 288 bytes,
// then the same chains again for the other scene of a transition (16 + 128 + 128) = 560 bytes
struct FeedbackUniforms {
    // Header (16 bytes)
    warp_count: u32,
    color_count: u32,
    blend_mode: u32,
    opacity: f32,

    // Limit on the feedback sample (16 bytes); a ceiling of 0 means no limit
    limit_knee: f32,
    limit_ceiling: f32,
    // During a transition: how much of the picture still belongs to the scene
    // on its way out. 0 outside a transition.
    other_share: f32,
    // How many thirtieths of a second this step lasts; 0 is read as 1
    step_share: f32,

    // Warp steps array (4 × 32 = 128 bytes)
    warp_steps: array<GpuWarpStep, 4>,

    // Color steps array (4 × 32 = 128 bytes)
    color_steps: array<GpuColorStep, 4>,

    // The outgoing scene's chains, used only while other_share > 0
    other_warp_count: u32,
    other_color_count: u32,
    // Where the warps are centred, as an offset from the middle of the frame
    centre_x: f32,
    centre_y: f32,
    other_warp_steps: array<GpuWarpStep, 4>,
    other_color_steps: array<GpuColorStep, 4>,
}

@group(0) @binding(0) var current_texture: texture_2d<f32>;
@group(0) @binding(1) var feedback_texture: texture_2d<f32>;
@group(0) @binding(2) var tex_sampler: sampler;
// What the outgoing scene drew this frame, during a transition. Outside one this
// is bound to the same texture as current_texture.
@group(0) @binding(3) var other_texture: texture_2d<f32>;
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
// Spatial warp operators (single step)
// ============================================================================

fn apply_warp_step(uv: vec2<f32>, step: GpuWarpStep) -> vec2<f32> {
    let center = vec2<f32>(0.5 + params.centre_x, 0.5 + params.centre_y);
    let centered = uv - center;
    let strength = step.strength;

    // UVs run 0 to 1 across a frame that is usually wider than it is tall, so a
    // rotation done in UVs shears: circles come back as tilted ellipses. Warps
    // that turn the picture work in square units and convert back.
    let dims = vec2<f32>(textureDimensions(feedback_texture));
    let aspect = vec2<f32>(dims.x / dims.y, 1.0);
    let square = centered * aspect;

    // Calculate edge falloff
    let edge_dist = 1.0 - max(abs(centered.x), abs(centered.y)) * 2.0;
    let falloff_factor = mix(1.0, saturate(edge_dist * 2.0), step.falloff);
    let effective_strength = strength * falloff_factor;

    switch step.warp_type {
        // None
        case 0u: {
            return uv;
        }
        // Affine (scale, rotate, translate)
        case 1u: {
            let s = step.scale;
            let c = cos(step.rotation * effective_strength);
            let sn = sin(step.rotation * effective_strength);

            // Scale
            var transformed = square / mix(1.0, s, effective_strength);

            // Rotate
            transformed = vec2<f32>(
                transformed.x * c - transformed.y * sn,
                transformed.x * sn + transformed.y * c
            );

            // Back to UVs, then translate
            transformed = transformed / aspect + vec2<f32>(step.translate_x, step.translate_y) * effective_strength;

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
            let dist = length(square);
            let angle = atan2(square.y, square.x);

            // Rotation proportional to distance and strength
            let new_angle = angle + step.rotation * dist * effective_strength;

            // Scale
            let new_dist = dist * (1.0 + (step.scale - 1.0) * effective_strength);

            return center + vec2<f32>(cos(new_angle), sin(new_angle)) * new_dist / aspect;
        }
        // Noise displacement
        case 4u: {
            let n = noise2d(uv * step.frequency, 0u);
            return uv + n * effective_strength * 0.1;
        }
        // Shear
        case 5u: {
            return vec2<f32>(
                uv.x + centered.y * effective_strength,
                uv.y + centered.x * effective_strength * step.scale
            );
        }
        // Waves: Milkdrop's own warp. Four slow sine waves cross the frame, each
        // bending it a little, their spacing drifting. `rotation` carries the
        // phase (time, or anything that advances) and `frequency` how many
        // waves cross the frame. No two parts of the picture move alike.
        case 6u: {
            let t = step.rotation;
            let p = square * 2.0;
            let f = vec4<f32>(
                11.68 + 4.0 * cos(t * 1.413 + 10.0),
                8.77 + 3.0 * cos(t * 1.113 + 7.0),
                10.54 + 3.0 * cos(t * 1.233 + 3.0),
                11.49 + 4.0 * cos(t * 0.933 + 5.0)
            ) * step.frequency;
            let d = vec2<f32>(
                sin(t * 0.333 + (p.x * f.x - p.y * f.w)) + cos(t * 0.753 - (p.x * f.y - p.y * f.z)),
                cos(t * 0.375 - (p.x * f.z + p.y * f.y)) + sin(t * 0.825 + (p.x * f.x + p.y * f.w))
            );
            return uv + d * effective_strength * 0.0035;
        }
        // Petals: a zoom that depends on direction, in and out `frequency` times
        // round the centre. `rotation` turns the pattern.
        case 7u: {
            let dist = length(square);
            let angle = atan2(square.y, square.x);
            let new_dist = dist * (1.0 + effective_strength * sin(step.frequency * angle + step.rotation));
            return center + vec2<f32>(cos(angle), sin(angle)) * new_dist / aspect;
        }
        // Ripple: a zoom that depends on distance, in and out in `frequency`
        // rings from the centre to the frame's edge. `rotation` moves the rings.
        case 8u: {
            let dist = length(square);
            let angle = atan2(square.y, square.x);
            let new_dist = dist * (1.0 + effective_strength * sin(step.frequency * 12.566 * dist - step.rotation));
            return center + vec2<f32>(cos(angle), sin(angle)) * new_dist / aspect;
        }
        // Tile: the last frame `frequency` by `frequency` times, in a grid about
        // the centre with no copy on it: what was at the centre comes back at the
        // middle of each tile.
        case 9u: {
            let n = floor(step.frequency + 0.5);
            if (n < 2.0) {
                return uv;
            }
            return fract(fract(centered * n) - vec2<f32>(0.5) + center);
        }
        // Whirls: `frequency` small whirlpools on a ring about the centre, each
        // turning the picture round itself, the opposite way to its neighbours.
        // `rotation` carries the ring round.
        case 10u: {
            let n = clamp(floor(step.frequency + 0.5), 1.0, 12.0);
            let reach = 0.42 / sqrt(n);
            var moved = square;
            for (var i = 0.0; i < n; i += 1.0) {
                let a = step.rotation + i * 6.2831853 / n;
                let d = square - vec2<f32>(cos(a), sin(a)) * 0.3;
                let turn = effective_strength * exp(-dot(d, d) / (reach * reach)) * (1.0 - 2.0 * (i % 2.0));
                let c = cos(turn);
                let sn = sin(turn);
                moved += vec2<f32>(d.x * c - d.y * sn, d.x * sn + d.y * c) - d;
            }
            return center + moved / aspect;
        }
        // Fold: the picture folded into `frequency` equal wedges about the centre,
        // each the mirror of its neighbours. `rotation` turns the folds. Folding
        // twice is folding once, so it does not matter how often it is done.
        case 11u: {
            let n = floor(step.frequency + 0.5);
            if (n < 2.0) {
                return uv;
            }
            let wedge = 6.2831853 / n;
            var a = atan2(square.y, square.x) - step.rotation;
            a = a - wedge * floor(a / wedge);
            a = abs(a - wedge * 0.5) + step.rotation;
            return center + vec2<f32>(cos(a), sin(a)) * length(square) / aspect;
        }
        // Flow: the picture carried along a field of slow eddies, like smoke.
        // `frequency` is how many eddies cross the frame and `rotation` what the
        // field drifts with. The field runs along the contours of a smooth surface
        // of hills and hollows, so nothing is squeezed: what flows in flows out.
        case 12u: {
            let at = square * step.frequency + vec2<f32>(step.rotation * 0.37, step.rotation * 0.23);
            let e = 0.35;
            let across = noise2d(at + vec2<f32>(e, 0.0), 0u).x - noise2d(at - vec2<f32>(e, 0.0), 0u).x;
            let up = noise2d(at + vec2<f32>(0.0, e), 0u).x - noise2d(at - vec2<f32>(0.0, e), 0u).x;
            return uv + vec2<f32>(up, -across) / aspect * effective_strength * 0.02;
        }
        // Blocks: the frame cut into `frequency` by `frequency` blocks, each pushed
        // its own way. `rotation` says which arrangement; each whole number is another.
        case 13u: {
            let n = max(1.0, floor(step.frequency + 0.5));
            let block = floor(square * n + vec2<f32>(0.5));
            let deal = floor(step.rotation);
            let way = hash21(block + vec2<f32>(deal * 17.0, deal * 31.0)) * 6.2831853;
            return uv + vec2<f32>(cos(way), sin(way)) / aspect * effective_strength * 0.01;
        }
        // Slices: the frame cut into `frequency` bands that slide past one another,
        // each the opposite way to its neighbours. `rotation` is the way the bands lie.
        case 14u: {
            let n = max(1.0, floor(step.frequency + 0.5));
            let c = cos(step.rotation);
            let sn = sin(step.rotation);
            let band = floor((-square.x * sn + square.y * c) * n + 0.5);
            let way = 1.0 - 2.0 * (band - 2.0 * floor(band * 0.5));
            return uv + vec2<f32>(c, sn) / aspect * way * effective_strength * 0.01;
        }
        default: {
            return uv;
        }
    }
}

// Apply all warp steps in sequence
fn apply_warp_chain(uv: vec2<f32>) -> vec2<f32> {
    var result = uv;
    let count = min(params.warp_count, 4u);

    for (var i: u32 = 0u; i < count; i++) {
        result = apply_warp_step(result, params.warp_steps[i]);
    }

    return result;
}

// The outgoing scene's warp chain, during a transition
fn apply_other_warp_chain(uv: vec2<f32>) -> vec2<f32> {
    var result = uv;
    let count = min(params.other_warp_count, 4u);

    for (var i: u32 = 0u; i < count; i++) {
        result = apply_warp_step(result, params.other_warp_steps[i]);
    }

    return result;
}

// ============================================================================
// Colour transform operators (single step)
// ============================================================================

fn apply_color_step(color: vec4<f32>, step: GpuColorStep) -> vec4<f32> {
    switch step.color_type {
        // None
        case 0u: {
            return color;
        }
        // Decay (exponential fade)
        case 1u: {
            return vec4<f32>(color.rgb * step.decay_rate, color.a);
        }
        // HSV shift
        case 2u: {
            var hsv = rgb_to_hsv(color.rgb);
            hsv.x = fract(hsv.x + step.hsv_h);
            hsv.y = saturate(hsv.y + step.hsv_s);
            hsv.z = saturate(hsv.z + step.hsv_v);
            return vec4<f32>(hsv_to_rgb(hsv), color.a);
        }
        // Posterize
        case 3u: {
            let levels = step.posterize_levels;
            return vec4<f32>(floor(color.rgb * levels) / levels, color.a);
        }
        // Channel offset - handled specially in main
        case 4u: {
            return color;
        }
        default: {
            return color;
        }
    }
}

// Apply all color steps in sequence
fn apply_color_chain(color: vec4<f32>) -> vec4<f32> {
    var result = color;
    let count = min(params.color_count, 4u);

    for (var i: u32 = 0u; i < count; i++) {
        result = apply_color_step(result, params.color_steps[i]);
    }

    return result;
}

// The outgoing scene's colour chain, during a transition. A channel offset in
// it is left out: it needs three extra samples, for a look that is on its way out.
fn apply_other_color_chain(color: vec4<f32>) -> vec4<f32> {
    var result = color;
    let count = min(params.other_color_count, 4u);

    for (var i: u32 = 0u; i < count; i++) {
        result = apply_color_step(result, params.other_color_steps[i]);
    }

    return result;
}

// Where in the colour chain a step of this kind sits, or -1. Sharpen and inset
// need more of the last frame than the one point the other steps work on, so the
// main function runs them itself, on the raw sample, before the rest of the chain.
fn loop_step_of(kind: u32) -> i32 {
    let count = min(params.color_count, 4u);
    for (var i: u32 = 0u; i < count; i++) {
        if (params.color_steps[i].color_type == kind) {
            return i32(i);
        }
    }
    return -1;
}

// Sharpen (5): offset_x is the amount, offset_y the radius in frame heights, and
// hsv_h what is compared: 0 each colour on its own, 1 brightness alone.
// The point is compared with the average of eight around it, on two rings.
fn sharpened(uv: vec2<f32>, color: vec4<f32>, op: GpuColorStep) -> vec4<f32> {
    let dims = vec2<f32>(textureDimensions(feedback_texture));
    let reach = vec2<f32>(op.offset_y * dims.y / dims.x, op.offset_y);
    var sum = color.rgb;
    for (var i: i32 = 0; i < 8; i++) {
        let a = f32(i) * 0.7853982;
        let ring = select(1.0, 0.5, (i % 2) == 1);
        let at = clamp(uv + vec2<f32>(cos(a), sin(a)) * reach * ring, vec2<f32>(0.001), vec2<f32>(0.999));
        sum += textureSampleLevel(feedback_texture, tex_sampler, at, 0.0).rgb;
    }
    let each = color.rgb - sum / 9.0;
    // By brightness the colour is scaled, not added to: a ridge is a brighter
    // shade of what was there, and not a step towards white.
    let weights = vec3<f32>(0.2126, 0.7152, 0.0722);
    let together = color.rgb * (dot(each, weights) / max(dot(color.rgb, weights), 0.05));
    let push = mix(each, together, clamp(op.hsv_h, 0.0, 1.0));
    return vec4<f32>(max(color.rgb + push * op.offset_x, vec3<f32>(0.0)), color.a);
}

// Inset (6): offset_x is the shape's radius in frame heights, offset_y how much of
// the frame it holds, hsv_h its angle, hsv_s how solid it is, posterize_levels its
// number of sides (under 3 is a circle). It sits at the loop's centre.
fn inset(uv: vec2<f32>, color: vec4<f32>, op: GpuColorStep) -> vec4<f32> {
    let dims = vec2<f32>(textureDimensions(feedback_texture));
    let aspect = dims.x / dims.y;
    let centre = vec2<f32>(0.5 + params.centre_x, 0.5 + params.centre_y);
    let p = (uv - centre) * vec2<f32>(aspect, 1.0);
    let c = cos(op.hsv_h);
    let s = sin(op.hsv_h);
    let turned = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
    var edge = length(turned);
    if (op.posterize_levels >= 3.0) {
        let sector = 6.2831853 / op.posterize_levels;
        let ang = atan2(turned.y, turned.x);
        edge = edge * cos(ang - sector * floor(ang / sector + 0.5));
    }
    let radius = max(op.offset_x, 0.0001);
    let inside = 1.0 - smoothstep(radius * 0.96, radius, edge);
    // The frame's top and bottom land on the shape's edge when it holds all of it.
    let src = vec2<f32>(0.5) + turned / vec2<f32>(aspect, 1.0) * (0.5 / radius) * max(op.offset_y, 0.0001);
    let within = step(0.0, src.x) * step(src.x, 1.0) * step(0.0, src.y) * step(src.y, 1.0);
    let copy = textureSampleLevel(feedback_texture, tex_sampler, clamp(src, vec2<f32>(0.001), vec2<f32>(0.999)), 0.0);
    return mix(color, copy, inside * within * clamp(op.hsv_s, 0.0, 1.0));
}

// Check if any color step uses channel offset (needs special handling)
fn has_channel_offset() -> bool {
    let count = min(params.color_count, 4u);
    for (var i: u32 = 0u; i < count; i++) {
        if (params.color_steps[i].color_type == 4u) {
            return true;
        }
    }
    return false;
}

// Apply channel offset for the first color step that uses it
fn apply_channel_offset(warped_uv: vec2<f32>) -> vec4<f32> {
    // Find the first channel offset step
    var offset = vec2<f32>(0.0, 0.0);
    let count = min(params.color_count, 4u);
    for (var i: u32 = 0u; i < count; i++) {
        if (params.color_steps[i].color_type == 4u) {
            offset = vec2<f32>(params.color_steps[i].offset_x, params.color_steps[i].offset_y) * 0.01;
            break;
        }
    }

    let r = textureSample(feedback_texture, tex_sampler, warped_uv + offset).r;
    let g = textureSample(feedback_texture, tex_sampler, warped_uv).g;
    let b = textureSample(feedback_texture, tex_sampler, warped_uv - offset).b;
    let a = textureSample(feedback_texture, tex_sampler, warped_uv).a;

    return vec4<f32>(r, g, b, a);
}

// ============================================================================
// Bounding the loop
// ============================================================================

// Limit how bright the previous frame comes back. Below the knee the sample is
// untouched; above it, brightness is compressed towards the ceiling and never
// reaches it. All three channels are scaled together, so hue is kept. This is
// what stops a brightening loop (screen or additive blends, bloom sampled after
// effects) from climbing to white and staying there.
fn limit_feedback(feedback: vec4<f32>) -> vec4<f32> {
    let knee = params.limit_knee;
    let ceiling = params.limit_ceiling;
    if (ceiling <= 0.0 || ceiling <= knee) {
        return feedback;
    }
    let peak = max(feedback.r, max(feedback.g, feedback.b));
    if (peak <= knee) {
        return feedback;
    }
    let room = ceiling - knee;
    let over = peak - knee;
    let limited = knee + room * over / (over + room);
    return vec4<f32>(feedback.rgb * (limited / peak), feedback.a);
}

// ============================================================================
// Blend modes
// ============================================================================

// What the scene leaves in the loop, scaled to the step's length (`Over` mode).
//
// A shape that covers half of what is behind it hides half of the previous frame
// every step. Stepped four times as often it would hide fifteen sixteenths in the
// same time: translucent shapes, soft edges and the two scenes of a blend would
// all sit heavier in the loop the faster it ran. Cover is therefore read as "per
// thirtieth of a second": over k thirtieths a shape hides 1 - (1 - cover)^k, and
// its colour is scaled to match. A shape that hides everything still does at any
// step rate. Only what the loop keeps is scaled; the frame shown has the shape as drawn.
fn stamp_for_step(current: vec4<f32>) -> vec4<f32> {
    let k = params.step_share;
    let cover = clamp(current.a, 0.0, 1.0);
    if (cover <= 0.0005) {
        // Light with no cover adds up in proportion to how often it is added.
        return vec4<f32>(current.rgb * k, current.a * k);
    }
    let cover_k = 1.0 - pow(1.0 - cover, k);
    return vec4<f32>(current.rgb * (cover_k / cover), cover_k);
}

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
        // Over: this frame's content on top of the previous frame. The scene was
        // drawn on a transparent background, so its colour is already weighted by
        // its alpha, and its alpha says how much of the previous frame it hides.
        case 7u: {
            let cover = clamp(current.a, 0.0, 1.0);
            return vec4<f32>(current.rgb + fb.rgb * (1.0 - cover), 1.0);
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

const LOOP_MAX: f32 = 64.0;

struct FeedbackOutput {
    // What is shown this step
    @location(0) shown: vec4<f32>,
    // What the loop keeps for the next step
    @location(1) kept: vec4<f32>,
}

@fragment
fn fs_main(in: VertexOutput) -> FeedbackOutput {
    // Sample current frame. In a transition two scenes are drawing: mix what
    // each drew by how far the transition has got.
    let share = clamp(params.other_share, 0.0, 1.0);
    let own = textureSample(current_texture, tex_sampler, in.uv);
    let other = textureSample(other_texture, tex_sampler, in.uv);
    let current = mix(own, other, share);

    // Apply all spatial warps in sequence to get feedback UV. In a transition
    // the two scenes' warp fields are mixed: every point of the previous frame
    // is pulled partly the old scene's way and partly the new one's.
    var warped_uv = apply_warp_chain(in.uv);
    if (share > 0.0) {
        warped_uv = mix(warped_uv, apply_other_warp_chain(in.uv), share);
    }

    // Clamp to valid UV range to prevent edge artifacts
    let clamped_uv = clamp(warped_uv, vec2<f32>(0.001), vec2<f32>(0.999));

    // Sample feedback and apply colour transforms
    var feedback: vec4<f32>;

    if (has_channel_offset()) {
        // Channel offset needs special handling - apply it first, then other colors
        feedback = apply_channel_offset(clamped_uv);
        // Apply remaining non-channel-offset color transforms
        let count = min(params.color_count, 4u);
        for (var i: u32 = 0u; i < count; i++) {
            if (params.color_steps[i].color_type != 4u) {
                feedback = apply_color_step(feedback, params.color_steps[i]);
            }
        }
    } else {
        feedback = textureSample(feedback_texture, tex_sampler, clamped_uv);
        let sharpen_at = loop_step_of(5u);
        if (sharpen_at >= 0) {
            feedback = sharpened(clamped_uv, feedback, params.color_steps[sharpen_at]);
        }
        let inset_at = loop_step_of(6u);
        if (inset_at >= 0) {
            feedback = inset(in.uv, feedback, params.color_steps[inset_at]);
        }
        feedback = apply_color_chain(feedback);
    }

    if (share > 0.0) {
        let raw = textureSample(feedback_texture, tex_sampler, clamped_uv);
        feedback = mix(feedback, apply_other_color_chain(raw), share);
    }

    // Keep the loop bounded, then blend feedback with current frame. The loop is
    // kept in float and may carry light brighter than white from step to step: the
    // limit above holds what comes back from the last frame under its ceiling, and
    // the last pass of all tone-maps the result. LOOP_MAX only keeps a loop with
    // its limit switched off from running to infinity.
    let previous = limit_feedback(feedback);
    var out: FeedbackOutput;
    out.shown = clamp(apply_blend(current, previous), vec4<f32>(0.0), vec4<f32>(LOOP_MAX));
    out.kept = out.shown;
    // At 30 steps a second the two are the same picture, and nothing is scaled.
    let k = params.step_share;
    if (params.blend_mode == 7u && k > 0.0 && abs(k - 1.0) > 0.0005) {
        out.kept = clamp(apply_blend(stamp_for_step(current), previous), vec4<f32>(0.0), vec4<f32>(LOOP_MAX));
    }
    return out;
}
