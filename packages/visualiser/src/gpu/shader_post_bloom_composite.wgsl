// Bloom composite pass - blend blurred bloom with original scene

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct CompositeUniforms {
    intensity: f32,
    _padding0: f32,
    _padding1: f32,
    _padding2: f32,
}

// Group 0: Combined textures (scene + bloom)
@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var bloom_texture: texture_2d<f32>;
@group(0) @binding(3) var bloom_sampler: sampler;

// Group 1: Uniforms
@group(1) @binding(0) var<uniform> params: CompositeUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);
    let bloom = textureSample(bloom_texture, bloom_sampler, in.uv);

    // Additive blend
    let final_color = scene.rgb + bloom.rgb * params.intensity;

    return vec4<f32>(final_color, scene.a);
}
