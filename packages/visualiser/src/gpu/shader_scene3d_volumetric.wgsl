// Analytical Fresnel Volumetric Concert Spotlight Cones (rendered to beauty ONLY, depth-test ON, depth-write OFF).

struct VolumetricUniforms {
    model: mat4x4<f32>,
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    beam_color_intensity: vec4<f32>, // rgb = beam color, w = intensity
    params: vec4<f32>,               // x = time, y = convert_srgb_to_linear, z = 0, w = 0
}

@group(0) @binding(0) var<uniform> v: VolumetricUniforms;

struct VertexInput {
    @location(0) pos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) bary: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) view_pos: vec3<f32>,
    @location(1) view_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

fn mat3_from_mat4(m: mat4x4<f32>) -> mat3x3<f32> {
    return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
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
fn vs_volumetric(in: VertexInput) -> VertexOutput {
    let wp = v.model * vec4<f32>(in.pos, 1.0);
    let vp = v.view * wp;
    var out: VertexOutput;
    out.clip_pos = v.proj * vp;
    out.view_pos = vp.xyz;
    out.view_normal = normalize(mat3_from_mat4(v.view) * (mat3_from_mat4(v.model) * in.normal));
    out.uv = in.uv;
    return out;
}

@fragment
fn fs_volumetric(in: VertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(in.view_normal);
    let V = normalize(-in.view_pos);
    let edge_fade = pow(clamp(abs(dot(N, V)), 0.0, 1.0), 1.35);
    let axial_fade = smoothstep(0.0, 0.10, in.uv.y) * pow(clamp(1.0 - in.uv.y, 0.0, 1.0), 1.05);
    let ts = v.params.x;
    let dust = 0.85 + 0.15 * sin(in.uv.x * 18.0 + ts * 1.8) * cos(in.uv.y * 12.0 - ts * 2.2);
    let alpha = clamp(edge_fade * axial_fade * v.beam_color_intensity.w * dust * 0.72, 0.0, 0.58);
    let col = select(v.beam_color_intensity.rgb, srgb_to_linear(v.beam_color_intensity.rgb), v.params.y > 0.5);
    return vec4<f32>(col, alpha);
}
