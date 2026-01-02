// Chromatic Aberration post-processing effect
// RGB channel separation for color fringing

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct ChromaticAberrationUniforms {
    amount: f32,   // Separation amount
    angle: f32,    // Separation direction in radians
    _padding: vec2<f32>, // Alignment padding
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: ChromaticAberrationUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Early exit if no aberration
    if (params.amount <= 0.0) {
        return textureSample(input_texture, input_sampler, in.uv);
    }

    // Calculate offset direction from angle
    let dir = vec2<f32>(cos(params.angle), sin(params.angle));

    // Get texture size to convert amount to UV space
    let tex_size = vec2<f32>(textureDimensions(input_texture));
    let offset = dir * params.amount / tex_size;

    // Sample each channel at different positions
    // Red shifted in +direction, Blue shifted in -direction, Green at center
    let r = textureSample(input_texture, input_sampler, in.uv + offset).r;
    let g = textureSample(input_texture, input_sampler, in.uv).g;
    let b = textureSample(input_texture, input_sampler, in.uv - offset).b;
    let a = textureSample(input_texture, input_sampler, in.uv).a;

    return vec4<f32>(r, g, b, a);
}
