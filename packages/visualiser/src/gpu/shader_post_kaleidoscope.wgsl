// Kaleidoscope: one wedge of the picture, mirrored round a centre.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct KaleidoscopeUniforms {
    segments: f32,     // how many wedges; under 2 leaves the picture alone
    angle: f32,        // which way the first wedge points, in radians
    center: vec2<f32>, // the middle, in normalized coordinates
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: KaleidoscopeUniforms;

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
    let aspect = dims.x / dims.y;
    let p = (in.uv - params.center) * vec2<f32>(aspect, 1.0);
    let r = length(p);
    var a = atan2(p.y, p.x) - params.angle;
    if (params.segments >= 2.0) {
        let sector = 6.2831853 / params.segments;
        a = a - sector * floor(a / sector);
        a = abs(a - sector * 0.5);
    }
    a = a + params.angle;
    let q = vec2<f32>(cos(a), sin(a)) * r / vec2<f32>(aspect, 1.0) + params.center;
    // Past the edge the picture is folded back in, so no wedge runs out of picture.
    let folded = vec2<f32>(1.0) - abs(vec2<f32>(1.0) - abs(q - 2.0 * floor(q * 0.5)));
    return textureSampleLevel(input_texture, input_sampler, clamp(folded, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
}
