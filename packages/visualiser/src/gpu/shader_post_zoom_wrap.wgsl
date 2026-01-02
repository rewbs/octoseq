// Zoom with Wrap post-processing effect
// Zooms the frame with optional edge wrapping (repeat or mirror)

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct ZoomWrapUniforms {
    amount: f32,       // Zoom scale factor (<1 = zoom in, >1 = zoom out)
    wrap_mode: f32,    // 0 = repeat, 1 = mirror
    center: vec2<f32>, // Zoom center in normalized coordinates
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: ZoomWrapUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// Wrap UV coordinates using repeat mode
fn wrap_repeat(uv: vec2<f32>) -> vec2<f32> {
    return fract(uv);
}

// Wrap UV coordinates using mirror mode
fn wrap_mirror(uv: vec2<f32>) -> vec2<f32> {
    let t = fract(uv * 0.5) * 2.0;
    return abs(t - floor(t + 0.5) * 2.0 + 1.0) - 1.0 + 1.0;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Apply zoom transformation around center
    let centered = in.uv - params.center;
    let zoomed = params.center + centered * params.amount;

    // Apply wrapping based on mode
    var wrapped_uv: vec2<f32>;
    if (params.wrap_mode < 0.5) {
        // Repeat mode
        wrapped_uv = wrap_repeat(zoomed);
    } else {
        // Mirror mode - proper ping-pong
        let t = zoomed;
        let period = floor(t);
        let frac_part = fract(t);
        // If period is odd, reverse the fraction
        let is_odd = fract(period * 0.5) > 0.25;
        wrapped_uv = select(frac_part, 1.0 - frac_part, vec2<bool>(is_odd, is_odd));
    }

    return textureSample(input_texture, input_sampler, wrapped_uv);
}
