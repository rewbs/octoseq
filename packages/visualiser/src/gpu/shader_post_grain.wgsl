// Film Grain post-processing effect
// Deterministic noise overlay for texture

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct GrainUniforms {
    amount: f32,   // Grain intensity
    scale: f32,    // Grain scale (smaller = finer)
    seed: f32,     // Random seed for reproducibility
    _padding: f32, // Alignment padding
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: GrainUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// Deterministic hash function for reproducible noise
// Based on the classic "hash without sin" approach
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2D noise based on hash
fn noise2d(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);

    // Four corners
    let a = hash21(i);
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));

    // Smooth interpolation
    let u = f * f * (3.0 - 2.0 * f);

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(input_texture, input_sampler, in.uv);

    // Early exit if no grain
    if (params.amount <= 0.0) {
        return color;
    }

    // Generate deterministic noise based on UV, scale, and seed
    let noise_coord = in.uv * params.scale * 100.0 + vec2<f32>(params.seed * 0.1234, params.seed * 0.5678);
    let noise = noise2d(noise_coord) * 2.0 - 1.0; // -1 to 1 range

    // Apply grain as additive noise
    let grain = vec3<f32>(noise * params.amount);

    return vec4<f32>(color.rgb + grain, color.a);
}
