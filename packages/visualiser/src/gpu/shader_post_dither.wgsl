// Dither: the picture in a few shades, on a coarse grid, the missing shades made up by an ordered pattern of dots.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct DitherUniforms {
    levels: f32, // shades of each colour, 2 and up
    pixel: f32,  // the side of one picture element, in 270ths of the frame's height
    mono: f32,   // 0 = each colour dithered on its own; 1 = brightness only, each element black or its own colour
    amount: f32, // 0 = the picture as it was, 1 = all dither
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: DitherUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

// The 4 by 4 Bayer matrix: where in a block of sixteen an element sits decides
// how bright the picture must be there before the element is lit.
fn threshold(cell: vec2<f32>) -> f32 {
    var order = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    let x = i32(cell.x) % 4;
    let y = i32(cell.y) % 4;
    return (order[y * 4 + x] + 0.5) / 16.0 - 0.5;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let original = textureSampleLevel(input_texture, input_sampler, in.uv, 0.0);
    if (params.amount <= 0.0) {
        return original;
    }
    let dims = vec2<f32>(textureDimensions(input_texture));
    // Sized against the frame's height, so the look is the same at any resolution.
    let side = max(1.0, round(params.pixel * dims.y / 270.0));
    let cell = floor(in.uv * dims / side);
    let source = textureSampleLevel(input_texture, input_sampler, (cell + 0.5) * side / dims, 0.0).rgb;
    let steps = max(1.0, params.levels - 1.0);
    let lift = threshold(cell);
    var colour: vec3<f32>;
    if (params.mono > 0.5) {
        let value = max(source.r, max(source.g, source.b));
        let lit = clamp(floor(value * steps + 0.5 + lift) / steps, 0.0, 1.0);
        colour = source / max(value, 0.02) * lit;
    } else {
        colour = floor(clamp(source, vec3<f32>(0.0), vec3<f32>(1.0)) * steps + 0.5 + lift) / steps;
    }
    colour = clamp(colour, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(mix(original.rgb, colour, clamp(params.amount, 0.0, 1.0)), original.a);
}
