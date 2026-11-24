// CRT: the picture as an old tube or a worn tape would show it. Scan lines, a
// colour mask, colour that smears sideways, lines that wobble, a curved face.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct CrtUniforms {
    lines: f32,  // how dark the gaps between scan lines are, 0 to 1
    mask: f32,   // how strongly each column of the screen shows only red, green or blue, 0 to 1
    bleed: f32,  // how far colour smears sideways; 1 is plain
    wobble: f32, // how far each line is knocked sideways from moment to moment; 1 is plain
    curve: f32,  // how far the face of the tube bulges; 0 is flat
    phase: f32,  // the time in seconds: what the wobble changes with
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: CrtUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

const LINES: f32 = 135.0; // scan lines down the frame, whatever its resolution

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(input_texture));
    // The curved face: points are pushed outwards more the further they are from the middle.
    let from_middle = in.uv - vec2<f32>(0.5);
    var uv = vec2<f32>(0.5) + from_middle * (1.0 + params.curve * dot(from_middle, from_middle));
    let outside = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;

    // Each scan line is knocked sideways a little, differently twenty-four times a
    // second, and a band that rolls slowly up the frame is knocked much further.
    let line = floor(uv.y * LINES);
    let tick = floor(params.phase * 24.0);
    let band = fract(params.phase * 0.11);
    let near_band = smoothstep(0.06, 0.0, abs(uv.y - band));
    let knock = (hash21(vec2<f32>(line, tick)) - 0.5) * (0.0015 + 0.02 * near_band) * params.wobble;
    uv.x = uv.x + knock;

    // Colour smears sideways, and red and blue part a little either side of green.
    let reach = params.bleed * 0.0035;
    var smear = vec3<f32>(0.0);
    for (var i = -2; i <= 2; i++) {
        smear += textureSampleLevel(input_texture, input_sampler, uv + vec2<f32>(f32(i) * reach, 0.0), 0.0).rgb;
    }
    smear = smear * 0.2;
    let sharp = textureSampleLevel(input_texture, input_sampler, uv, 0.0);
    var colour = vec3<f32>(
        textureSampleLevel(input_texture, input_sampler, uv - vec2<f32>(reach, 0.0), 0.0).r,
        sharp.g,
        textureSampleLevel(input_texture, input_sampler, uv + vec2<f32>(reach, 0.0), 0.0).b,
    );
    colour = mix(colour, smear, 0.5 * clamp(params.bleed, 0.0, 1.0));

    // Scan lines: bright along the middle of each, dark between.
    let along = 0.5 - 0.5 * cos(uv.y * LINES * 6.2831853);
    colour = colour * (1.0 - clamp(params.lines, 0.0, 1.0) * (1.0 - along));

    // The mask: columns in threes, each showing mostly one colour.
    let column = floor(in.uv.x * dims.x / max(1.0, round(dims.y / 270.0)));
    let third = i32(column) % 3;
    var show = vec3<f32>(1.0 - params.mask);
    if (third == 0) { show.r = 1.0; } else if (third == 1) { show.g = 1.0; } else { show.b = 1.0; }
    // Made up for in brightness, so that the mask colours the picture and does not only darken it.
    colour = colour * show * (1.0 + params.mask * 0.8) * (1.0 + clamp(params.lines, 0.0, 1.0) * 0.6);

    if (outside) {
        colour = vec3<f32>(0.0);
    }
    return vec4<f32>(clamp(colour, vec3<f32>(0.0), vec3<f32>(1.0)), sharp.a);
}
