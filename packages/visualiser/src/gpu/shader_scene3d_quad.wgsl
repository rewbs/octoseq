// Fullscreen conditioning channel display & 2x2 AI conditioning quad packer.
// Top-Left: Flat Albedo | Top-Right: Depth
// Bot-Left: View Normal | Bot-Right: Wireframe

struct QuadParams {
    // mode: 0 = single texture copy (tex0), 1 = 2x2 quad pack (tex0=flat, tex1=depth, tex2=normal, tex3=wire)
    mode: u32,
    convert_srgb_to_linear: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> qp: QuadParams;
@group(0) @binding(1) var tex0: texture_2d<f32>;
@group(0) @binding(2) var tex1: texture_2d<f32>;
@group(0) @binding(3) var tex2: texture_2d<f32>;
@group(0) @binding(4) var tex3: texture_2d<f32>;
@group(0) @binding(5) var tex_sampler: sampler;

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

fn srgb_to_linear_ch(c: f32) -> f32 {
    if c <= 0.04045 {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn srgb_to_linear(rgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        srgb_to_linear_ch(rgb.x),
        srgb_to_linear_ch(rgb.y),
        srgb_to_linear_ch(rgb.z)
    );
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VertexOutput {
    let x = select(-1.0, 3.0, vid == 1u);
    let y = select(-1.0, 3.0, vid == 2u);
    var out: VertexOutput;
    out.clip_pos = vec4<f32>(x, y, 0.0, 1.0);
    // WebGPU UV y=0 at top, y=1 at bottom
    out.uv = vec2<f32>(x * 0.5 + 0.5, 0.5 - y * 0.5);
    return out;
}

@fragment
fn fs_quad(in: VertexOutput) -> @location(0) vec4<f32> {
    let sub_uv = fract(in.uv * 2.0);
    let c0_single = textureSample(tex0, tex_sampler, in.uv).rgb;
    let c0 = textureSample(tex0, tex_sampler, sub_uv).rgb;
    let c1 = textureSample(tex1, tex_sampler, sub_uv).rgb;
    let c2 = textureSample(tex2, tex_sampler, sub_uv).rgb;
    let c3 = textureSample(tex3, tex_sampler, sub_uv).rgb;

    var rgb = c0_single;
    if qp.mode == 1u {
        if in.uv.y < 0.5 {
            rgb = select(c1, c0, in.uv.x < 0.5);
        } else {
            rgb = select(c3, c2, in.uv.x < 0.5);
        }
    }

    let out_rgb = select(rgb, srgb_to_linear(rgb), qp.convert_srgb_to_linear != 0u);
    return vec4<f32>(out_rgb, 1.0);
}
