// ASCII: the picture as rows of characters, each chosen for how much ink it has against how bright the picture is there.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct AsciiUniforms {
    rows: f32,   // rows of characters down the frame
    colour: f32, // 0 = white characters; 1 = each in the colour of the picture under it
    gain: f32,   // the picture's brightness is multiplied by this before a character is chosen
    amount: f32, // 0 = the picture as it was, 1 = all characters
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: AsciiUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// Eleven characters from least ink to most:  (space) . : - = + * o # % @
// Each is five dots wide and seven tall; a row is five bits, the leftmost dot the
// highest. Drawn for this file.
fn glyph_row(glyph: i32, row: i32) -> u32 {
    var rows = array<u32, 77>(
        0u, 0u, 0u, 0u, 0u, 0u, 0u,        // space
        0u, 0u, 0u, 0u, 0u, 4u, 0u,        // .
        0u, 0u, 4u, 0u, 0u, 4u, 0u,        // :
        0u, 0u, 0u, 14u, 0u, 0u, 0u,       // -
        0u, 0u, 14u, 0u, 14u, 0u, 0u,      // =
        0u, 4u, 4u, 31u, 4u, 4u, 0u,       // +
        0u, 4u, 21u, 14u, 21u, 4u, 0u,     // *
        0u, 0u, 14u, 17u, 17u, 14u, 0u,    // o
        0u, 10u, 31u, 10u, 31u, 10u, 0u,   // #
        25u, 26u, 2u, 4u, 8u, 11u, 19u,    // %
        14u, 17u, 23u, 21u, 23u, 16u, 14u  // @
    );
    return rows[glyph * 7 + row];
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let original = textureSampleLevel(input_texture, input_sampler, in.uv, 0.0);
    if (params.amount <= 0.0) {
        return original;
    }
    let dims = vec2<f32>(textureDimensions(input_texture));
    let high = dims.y / max(params.rows, 4.0);
    // A character's box is six dots by eight: the character and a dot of space to its right and below.
    let box = vec2<f32>(high * 0.75, high);
    let at = in.uv * dims / box;
    let cell = floor(at);
    // What the picture is doing under the box: the average of four points in it.
    var under = vec3<f32>(0.0);
    for (var i = 0; i < 4; i++) {
        let corner = vec2<f32>(0.25 + 0.5 * f32(i % 2), 0.25 + 0.5 * f32(i / 2));
        under += textureSampleLevel(input_texture, input_sampler, (cell + corner) * box / dims, 0.0).rgb;
    }
    under = under * 0.25;
    let peak = max(under.r, max(under.g, under.b));
    let value = clamp(peak * params.gain, 0.0, 1.0);
    let glyph = i32(clamp(floor(pow(value, 0.8) * 11.0), 0.0, 10.0));
    let within = fract(at);
    let column = i32(floor(within.x * 6.0));
    let row = i32(floor(within.y * 8.0));
    var ink = 0.0;
    if (column < 5 && row < 7) {
        ink = f32((glyph_row(glyph, row) >> u32(4 - column)) & 1u);
    }
    let own = under / max(peak, 0.05);
    let pen = mix(vec3<f32>(1.0), own, clamp(params.colour, 0.0, 1.0)) * (0.55 + 0.45 * value);
    let colour = clamp(pen * ink, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(mix(original.rgb, colour, clamp(params.amount, 0.0, 1.0)), original.a);
}
