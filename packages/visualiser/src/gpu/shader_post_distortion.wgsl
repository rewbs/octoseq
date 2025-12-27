// Distortion post-processing effect
// Barrel/pincushion distortion

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct DistortionUniforms {
    amount: f32,
    _padding: f32,
    center: vec2<f32>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> distortion: DistortionUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Calculate offset from center
    let centered = in.uv - distortion.center;

    // Calculate distance from center
    let dist = length(centered);

    // Apply barrel/pincushion distortion
    // Positive amount = pincushion, negative = barrel
    let factor = 1.0 + distortion.amount * dist * dist;

    // Apply distortion
    let distorted_uv = distortion.center + centered * factor;

    // Clamp to valid UV range
    let clamped_uv = clamp(distorted_uv, vec2<f32>(0.0), vec2<f32>(1.0));

    // Sample with distorted coordinates
    let color = textureSample(input_texture, input_sampler, clamped_uv);

    // Fade to black at edges if we went out of bounds
    let out_of_bounds = any(distorted_uv != clamped_uv);
    if (out_of_bounds) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    return color;
}
