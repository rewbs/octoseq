// The last pass: the finished picture, from float to what a screen can show.
//
// Everything before this is drawn in 16-bit float, where a light can be brighter
// than white. A screen cannot show that, and simply cutting each channel off at
// white turns a bright red into orange and then yellow as its smaller channels
// catch up. So brightness is eased towards white instead of cut: below KNEE the
// picture is shown exactly as drawn; above it the brightest channel approaches
// white without reaching it, and the other two are scaled with it, which keeps the
// colour. What is far too bright to show pales towards white, as it does in a
// camera, so a light four times over white reads as hotter than one just over.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;

// Up to here nothing changes. High, so that a picture with nothing brighter than
// white looks as it did before there was a tone map.
const KNEE: f32 = 0.9;
// How many times white a light must be before it has paled all the way.
const WHITE_HOT: f32 = 6.0;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

fn tone_map(drawn: vec3<f32>) -> vec3<f32> {
    let colour = max(drawn, vec3<f32>(0.0));
    let peak = max(colour.r, max(colour.g, colour.b));
    if (peak <= KNEE) {
        return colour;
    }
    let room = 1.0 - KNEE;
    let over = peak - KNEE;
    let shown = KNEE + room * over / (over + room);
    let kept = colour * (shown / peak);
    return mix(kept, vec3<f32>(shown), smoothstep(1.0, WHITE_HOT, peak));
}

@fragment
fn fs_present(in: VertexOutput) -> @location(0) vec4<f32> {
    let drawn = textureSample(input_texture, input_sampler, in.uv);
    return vec4<f32>(tone_map(drawn.rgb), clamp(drawn.a, 0.0, 1.0));
}

// A plain copy, for adding one step of an exposure to the others: the pipeline
// that uses it weights what it writes by a blend constant.
@fragment
fn fs_copy(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(input_texture, input_sampler, in.uv);
}
