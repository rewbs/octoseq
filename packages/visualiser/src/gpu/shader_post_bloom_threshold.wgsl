// Bloom threshold pass - extract bright pixels for bloom processing

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct ThresholdUniforms {
    threshold: f32,
    soft_knee: f32,  // Softness of threshold (0 = hard, higher = softer)
    _padding0: f32,
    _padding1: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: ThresholdUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(input_texture, input_sampler, in.uv);

    // Calculate luminance
    let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));

    // Soft threshold using smooth step
    let knee = params.soft_knee * 0.5;
    let soft = luminance - params.threshold + knee;
    let contribution = clamp(soft / (2.0 * knee + 0.00001), 0.0, 1.0);
    let factor = contribution * contribution;

    // Extract bright portion
    let bright = color.rgb * factor;

    return vec4<f32>(bright, color.a);
}
