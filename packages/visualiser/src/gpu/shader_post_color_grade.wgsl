// Color grading post-processing effect

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct ColorGradeUniforms {
    brightness: f32,
    contrast: f32,
    saturation: f32,
    gamma: f32,
    tint: vec4<f32>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> grade: ColorGradeUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(input_texture, input_sampler, in.uv);

    // Brightness
    color = vec4<f32>(color.rgb + grade.brightness, color.a);

    // Contrast
    color = vec4<f32>((color.rgb - 0.5) * grade.contrast + 0.5, color.a);

    // Saturation
    let luminance = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    color = vec4<f32>(mix(vec3<f32>(luminance), color.rgb, grade.saturation), color.a);

    // Gamma
    color = vec4<f32>(pow(max(color.rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / grade.gamma)), color.a);

    // Tint (multiply)
    color = vec4<f32>(color.rgb * grade.tint.rgb, color.a);

    return color;
}
