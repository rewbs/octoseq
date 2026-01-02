// Radial Blur post-processing effect
// Motion blur radiating from a center point

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct RadialBlurUniforms {
    strength: f32,     // Blur strength (0-1)
    samples: f32,      // Number of samples
    center: vec2<f32>, // Blur center in normalized coordinates
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: RadialBlurUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Early exit if no blur
    if (params.strength <= 0.0) {
        return textureSample(input_texture, input_sampler, in.uv);
    }

    let sample_count = i32(clamp(params.samples, 2.0, 32.0));
    let dir = in.uv - params.center;

    var color = vec4<f32>(0.0);
    var total_weight = 0.0;

    for (var i = 0; i < sample_count; i++) {
        let t = f32(i) / f32(sample_count - 1);
        // Sample from current position back towards center
        let sample_uv = params.center + dir * (1.0 - t * params.strength);

        // Simple box blur weight (can be changed to gaussian if needed)
        let weight = 1.0;
        color += textureSample(input_texture, input_sampler, sample_uv) * weight;
        total_weight += weight;
    }

    return color / total_weight;
}
