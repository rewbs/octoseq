// Bloom blur pass - separable Gaussian blur
// Used for both horizontal and vertical passes via the direction uniform

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct BlurUniforms {
    // xy = direction (1,0 for horizontal, 0,1 for vertical)
    // z = radius
    // w = unused (padding)
    direction_and_radius: vec4<f32>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> blur: BlurUniforms;

// Gaussian weights (approximation using hardcoded weights for radius up to 16)
// These are pre-computed Gaussian weights for sigma = radius/3
fn gaussian_weight(offset: f32, sigma: f32) -> f32 {
    let x = offset / sigma;
    return exp(-0.5 * x * x);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(input_texture));
    let pixel_size = 1.0 / dims;

    let direction = blur.direction_and_radius.xy;
    let radius = blur.direction_and_radius.z;

    // Clamp radius to safe maximum
    let safe_radius = min(radius, 32.0);
    let samples = i32(ceil(safe_radius));

    // Sigma for Gaussian (rule of thumb: sigma = radius/3 gives good coverage)
    let sigma = max(safe_radius / 3.0, 0.5);

    var color = vec3<f32>(0.0);
    var total_weight = 0.0;

    // Sample along the blur direction
    for (var i = -samples; i <= samples; i++) {
        let offset = f32(i);
        let weight = gaussian_weight(offset, sigma);
        let sample_uv = in.uv + direction * offset * pixel_size;

        // Clamp to edge
        let clamped_uv = clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(1.0));
        let sample_color = textureSample(input_texture, input_sampler, clamped_uv).rgb;

        color += sample_color * weight;
        total_weight += weight;
    }

    color /= total_weight;

    return vec4<f32>(color, 1.0);
}
