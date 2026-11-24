// Halftone: the picture as a screen of dots, each as big as the picture is bright there.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct HalftoneUniforms {
    cells: f32,  // dots down the frame
    angle: f32,  // which way the screen of dots is turned, in radians
    colour: f32, // 0 = one screen, each dot in the picture's colour there; 1 = a screen each for red, green and blue, turned apart
    amount: f32, // 0 = the picture as it was, 1 = all dots
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: HalftoneUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// For one screen turned by `angle`: the picture at the middle of the dot this
// point falls in (rgb), and how far the point is from that middle, in dots (a).
fn dot_at(uv: vec2<f32>, dims: vec2<f32>, angle: f32) -> vec4<f32> {
    let pitch = dims.y / max(params.cells, 4.0);
    let c = cos(angle);
    let s = sin(angle);
    let px = uv * dims - dims * 0.5;
    let turned = vec2<f32>(px.x * c + px.y * s, -px.x * s + px.y * c) / pitch;
    let middle = floor(turned) + 0.5;
    let back = vec2<f32>(middle.x * c - middle.y * s, middle.x * s + middle.y * c) * pitch + dims * 0.5;
    let there = textureSampleLevel(input_texture, input_sampler, clamp(back / dims, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    return vec4<f32>(there, length(turned - middle));
}

// How much of a dot covers a point `distance` dots from its middle, for a picture
// of brightness `value` there. A dot's area follows the brightness; at full
// brightness neighbouring dots meet and close the gaps.
fn cover(value: f32, distance: f32, pitch: f32) -> f32 {
    let radius = sqrt(clamp(value, 0.0, 1.0)) * 0.72;
    let soft = 1.0 / max(pitch, 1.0);
    return smoothstep(radius + soft, radius - soft, distance);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let original = textureSampleLevel(input_texture, input_sampler, in.uv, 0.0);
    if (params.amount <= 0.0) {
        return original;
    }
    let dims = vec2<f32>(textureDimensions(input_texture));
    let pitch = dims.y / max(params.cells, 4.0);
    var colour: vec3<f32>;
    if (params.colour > 0.5) {
        let r = dot_at(in.uv, dims, params.angle + 0.2618);
        let g = dot_at(in.uv, dims, params.angle + 1.309);
        let b = dot_at(in.uv, dims, params.angle);
        colour = vec3<f32>(cover(r.r, r.a, pitch), cover(g.g, g.a, pitch), cover(b.b, b.a, pitch));
    } else {
        let d = dot_at(in.uv, dims, params.angle);
        let value = max(d.r, max(d.g, d.b));
        colour = d.rgb / max(value, 0.05) * cover(value, d.a, pitch);
    }
    colour = clamp(colour, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(mix(original.rgb, colour, clamp(params.amount, 0.0, 1.0)), original.a);
}
