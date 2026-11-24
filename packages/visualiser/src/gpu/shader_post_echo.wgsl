// Echo: a second copy of the picture laid over it, larger or smaller, turned, and
// flipped if asked. Milkdrop's video echo. With a flip it makes a picture that
// is symmetrical about the middle without the scene having to be.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct EchoUniforms {
    alpha: f32, // how much of the copy shows, 0 to 1
    zoom: f32,  // the copy's size against the picture's
    flip: f32,  // 0 none, 1 left to right, 2 top to bottom, 3 both
    angle: f32, // the copy's turn, in radians
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: EchoUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let base = textureSampleLevel(input_texture, input_sampler, in.uv, 0.0);
    let dims = vec2<f32>(textureDimensions(input_texture));
    let aspect = dims.x / dims.y;
    var p = (in.uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0) / max(params.zoom, 0.01);
    let c = cos(params.angle);
    let s = sin(params.angle);
    p = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
    let flip = i32(round(params.flip));
    p = vec2<f32>(select(p.x, -p.x, flip == 1 || flip == 3), select(p.y, -p.y, flip >= 2));
    let at = p / vec2<f32>(aspect, 1.0) + vec2<f32>(0.5);
    // Where the copy has run out of picture (it is smaller than the frame, or
    // turned) there is no copy: the picture shows through untouched.
    let within = step(0.0, at.x) * step(at.x, 1.0) * step(0.0, at.y) * step(at.y, 1.0);
    let copy = textureSampleLevel(input_texture, input_sampler, clamp(at, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    return vec4<f32>(mix(base.rgb, copy.rgb, clamp(params.alpha, 0.0, 1.0) * within), base.a);
}
