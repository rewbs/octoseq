// Directional Blur post-processing effect
// Motion blur in a specific direction

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct DirectionalBlurUniforms {
    amount: f32,   // Blur amount in pixels
    angle: f32,    // Blur direction in radians
    samples: f32,  // Number of samples
    _padding: f32, // Alignment padding
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: DirectionalBlurUniforms;

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
    if (params.amount <= 0.0) {
        return textureSample(input_texture, input_sampler, in.uv);
    }

    let sample_count = i32(clamp(params.samples, 2.0, 32.0));

    // Calculate blur direction from angle
    let dir = vec2<f32>(cos(params.angle), sin(params.angle));

    // Get texture size to convert pixel amount to UV space
    let tex_size = vec2<f32>(textureDimensions(input_texture));
    let step = dir * params.amount / tex_size;

    var color = vec4<f32>(0.0);
    var total_weight = 0.0;

    for (var i = 0; i < sample_count; i++) {
        // Sample along the blur direction, centered on the current pixel
        let offset = (f32(i) - f32(sample_count - 1) * 0.5) / f32(sample_count - 1);
        let sample_uv = in.uv + step * offset;

        let weight = 1.0;
        color += textureSample(input_texture, input_sampler, sample_uv) * weight;
        total_weight += weight;
    }

    return color / total_weight;
}
