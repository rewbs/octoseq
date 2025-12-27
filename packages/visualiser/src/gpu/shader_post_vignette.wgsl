// Vignette post-processing effect

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct VignetteUniforms {
    intensity: f32,
    smoothness: f32,
    _padding: vec2<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> vignette: VignetteUniforms;

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

    // Calculate distance from center
    let center = vec2<f32>(0.5, 0.5);
    let dist = distance(in.uv, center);

    // Calculate vignette factor
    let outer_radius = 0.7;
    let inner_radius = outer_radius - vignette.smoothness * 0.5;
    let vignette_factor = 1.0 - smoothstep(inner_radius, outer_radius, dist) * vignette.intensity;

    // Mix original color with vignette color
    let final_color = mix(vignette.color.rgb, color.rgb, vignette_factor);

    return vec4<f32>(final_color, color.a);
}
