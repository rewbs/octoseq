// Bloom post-processing effect
// Simple box blur approximation for bloom

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct BloomUniforms {
    threshold: f32,
    intensity: f32,
    radius: f32,
    _padding: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> bloom: BloomUniforms;

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

    // Sample original color
    let original = textureSample(input_texture, input_sampler, in.uv);

    // Simple box blur for bloom
    var bloom_color = vec3<f32>(0.0);
    let samples = i32(bloom.radius);
    var sample_count = 0.0;

    for (var x = -samples; x <= samples; x++) {
        for (var y = -samples; y <= samples; y++) {
            let offset = vec2<f32>(f32(x), f32(y)) * pixel_size;
            let sample_color = textureSample(input_texture, input_sampler, in.uv + offset);

            // Only include bright pixels
            let brightness = max(max(sample_color.r, sample_color.g), sample_color.b);
            if (brightness > bloom.threshold) {
                bloom_color += sample_color.rgb * (brightness - bloom.threshold);
                sample_count += 1.0;
            }
        }
    }

    if (sample_count > 0.0) {
        bloom_color /= sample_count;
    }

    // Combine original with bloom
    let final_color = original.rgb + bloom_color * bloom.intensity;

    return vec4<f32>(final_color, original.a);
}
