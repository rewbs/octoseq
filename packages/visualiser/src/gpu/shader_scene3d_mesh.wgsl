// General Hero / Monolith / Concert Stage / GLB Mesh Shader with deterministic beat-reactive vertex morph,
// embedded albedo texture sampling, stylized shading, and optional 6-target MRT output.

struct Scene3DUniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    prev_view_proj: mat4x4<f32>,
    time_params: vec4<f32>,
    depth_params: vec4<f32>,
    react_params: vec4<f32>,
    grid_params: vec4<u32>,
    col_drums: vec4<f32>,
    col_bass: vec4<f32>,
    col_vocals: vec4<f32>,
    col_other: vec4<f32>,
    musical0: vec4<f32>,
    musical1: vec4<f32>,
    musical2: vec4<f32>,
    musical3: vec4<f32>,
    stem_weights: vec4<f32>,
    answer: vec4<f32>,
    tonal: vec4<f32>,
    v2_gains: vec4<f32>,
}

struct MeshDrawUniforms {
    model: mat4x4<f32>,
    prev_model: mat4x4<f32>,
    color_zone: vec4<f32>,     // rgb = base color, w = zone_id
    morph_params: vec4<f32>,   // x = morph_amp, y = morph_time, z = prev_morph_amp, w = prev_morph_time
    extra_params: vec4<f32>,   // x = emissive_boost, y = use_albedo_tex (0 or 1), z = 0, w = 0
}

@group(0) @binding(0) var<uniform> u: Scene3DUniforms;
@group(0) @binding(1) var albedo_tex: texture_2d<f32>;
@group(0) @binding(2) var albedo_sampler: sampler;
@group(1) @binding(0) var<uniform> d: MeshDrawUniforms;

struct VertexInput {
    @location(0) pos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) bary: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) view_pos: vec3<f32>,
    @location(2) view_normal: vec3<f32>,
    @location(3) uv: vec2<f32>,
    @location(4) bary: vec3<f32>,
    @location(5) base_color: vec3<f32>,
    @location(6) zone_id: f32,
    @location(7) emissive_boost: f32,
    @location(8) curr_clip: vec4<f32>,
    @location(9) prev_clip: vec4<f32>,
}

struct MrtAll {
    beauty: vec4<f32>,
    depth: vec4<f32>,
    normal: vec4<f32>,
    wireframe: vec4<f32>,
    flat: vec4<f32>,
    motion: vec4<f32>,
}

struct MrtPassA {
    @location(0) beauty: vec4<f32>,
    @location(1) depth: vec4<f32>,
    @location(2) normal: vec4<f32>,
}

struct MrtPassB {
    @location(0) wireframe: vec4<f32>,
    @location(1) flat: vec4<f32>,
    @location(2) motion: vec4<f32>,
}

fn mat3_from_mat4(m: mat4x4<f32>) -> mat3x3<f32> {
    return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
}

fn zone_weight_u32(zone: u32) -> f32 {
    if zone == 0u {
        return u.stem_weights.x;
    } else if zone == 1u {
        return u.stem_weights.y;
    } else if zone == 2u {
        return u.stem_weights.z;
    }
    return u.stem_weights.w;
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

fn apply_morph(p: vec3<f32>, n: vec3<f32>, amp: f32, mt: f32) -> vec3<f32> {
    if amp <= 0.0001 {
        return p;
    }
    let w = sin(p.x * 3.7 + mt * 2.4) * cos(p.y * 4.1 - mt * 1.9) * sin(p.z * 3.3 + mt * 2.1);
    return p + normalize(n) * (amp * w);
}

@vertex
fn vs_mesh(in: VertexInput) -> VertexOutput {
    let mp = apply_morph(in.pos, in.normal, d.morph_params.x, d.morph_params.y);
    let prev_mp = apply_morph(in.pos, in.normal, d.morph_params.z, d.morph_params.w);
    let wp = d.model * vec4<f32>(mp, 1.0);
    let prev_wp = d.prev_model * vec4<f32>(prev_mp, 1.0);
    let vp = u.view * wp;
    let clip = u.proj * vp;

    var out: VertexOutput;
    out.clip_pos = clip;
    out.curr_clip = clip;
    out.prev_clip = u.prev_view_proj * prev_wp;
    out.world_pos = wp.xyz;
    out.view_pos = vp.xyz;
    out.view_normal = normalize(mat3_from_mat4(u.view) * (mat3_from_mat4(d.model) * in.normal));
    out.uv = in.uv;
    out.bary = in.bary;
    out.base_color = d.color_zone.rgb;
    out.zone_id = d.color_zone.w;
    out.emissive_boost = d.extra_params.x;
    return out;
}

fn shade_all(in: VertexOutput) -> MrtAll {
    let N = normalize(in.view_normal);
    let V = normalize(-in.view_pos);
    let ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

    let wire_thickness = u.time_params.w;
    let wire_glow = u.depth_params.z;
    let d_bary = fwidth(in.bary);
    let a3 = smoothstep(vec3<f32>(0.0), max(d_bary * wire_thickness, vec3<f32>(1e-5)), in.bary);
    let edge_factor = 1.0 - min(min(a3.x, a3.y), a3.z);
    let rim_edge = pow(1.0 - ndotv, 3.0);
    let wire_mask = clamp(max(edge_factor, rim_edge * 0.65), 0.0, 1.0);

    let view_dist = max(-in.view_pos.z, 0.0);
    let depth_near = u.depth_params.x;
    let depth_far = u.depth_params.y;
    let lin_depth = 1.0 - clamp((view_dist - depth_near) / max(depth_far - depth_near, 0.001), 0.0, 1.0);

    let zid = u32(max(floor(in.zone_id + 0.5), 0.0)) & 3u;
    let zone_w = zone_weight_u32(zid);

    let kick = u.musical1.x;
    let fill = u.musical2.y;
    let enter_p = u.musical3.z;
    let hit_e = u.answer.x;
    let hit_gather = u.answer.z * u.v2_gains.x;
    let sect_i = u.answer.w;
    let bright = u.tonal.x;
    let harm_ch = u.tonal.y;
    let tonal_g = u.v2_gains.z;
    let spotlight = 0.62 + 1.30 * zone_w + 0.30 * kick + 0.42 * enter_p + 0.35 * hit_e + 0.18 * sect_i;

    let L1 = normalize(vec3<f32>(0.45, 0.78, 0.42));
    let L2 = normalize(vec3<f32>(-0.65, 0.25, 0.72));
    let diff1 = max(dot(N, L1), 0.0);
    let diff2 = max(dot(N, L2), 0.0);
    let H1 = normalize(L1 + V);
    let spec1 = pow(max(dot(N, H1), 0.0), 32.0);

    let sampled_tex = textureSample(albedo_tex, albedo_sampler, in.uv);
    var albedo = in.base_color;
    if d.extra_params.y > 0.5 {
        albedo = albedo * sampled_tex.rgb;
    }

    let tonal_tint = mix(vec3<f32>(0.32, 0.56, 1.0), vec3<f32>(1.0, 0.84, 0.52), bright);
    albedo = mix(albedo, mix(albedo, tonal_tint, 0.38), clamp(harm_ch * 0.65 * tonal_g, 0.0, 0.65));

    let mat_style = u.grid_params.w;
    var beauty = albedo;

    if mat_style == 1u {
        let q_diff = floor(diff1 * 3.99) / 3.0;
        let q_spec = step(0.55, spec1);
        beauty = albedo * (0.26 + 0.82 * q_diff + 0.18 * diff2) * spotlight;
        beauty = beauty + vec3<f32>(1.0) * q_spec * 0.45 + albedo * rim_edge * (0.45 + 0.55 * fill + 0.35 * hit_e);
        beauty = mix(beauty, vec3<f32>(0.02, 0.02, 0.04), step(0.75, rim_edge) * 0.45);
        beauty = beauty + albedo * edge_factor * wire_glow * (0.4 + 0.9 * kick + 0.45 * hit_gather);
    } else if mat_style == 2u {
        beauty = albedo * (0.78 + 0.22 * diff1) * clamp(spotlight, 0.7, 1.45);
        beauty = beauty + albedo * edge_factor * wire_glow * (0.35 + 0.25 * hit_e);
    } else if mat_style == 3u {
        let core = albedo * (0.08 + 0.14 * diff1);
        let wire_col = mix(albedo, tonal_tint, 0.30 * tonal_g) * (1.15 + 0.85 * kick + 0.75 * fill + 0.65 * hit_e + 0.30 * hit_gather);
        beauty = core + wire_col * wire_mask * (0.85 + 0.5 * zone_w);
    } else {
        let ambient = albedo * (0.16 + 0.10 * (N.y * 0.5 + 0.5));
        let diffuse = albedo * (diff1 * 0.85 + diff2 * 0.35) * spotlight;
        let spec = mix(vec3<f32>(1.0), tonal_tint, 0.35 * tonal_g) * spec1 * (0.55 + 0.45 * spotlight);
        let emissive = albedo * (in.emissive_boost * (0.32 + 0.80 * zone_w + 0.55 * kick + 0.65 * fill + 0.65 * hit_e));
        let wire_trim = mix(albedo, vec3<f32>(1.0), 0.45) * edge_factor * wire_glow * (0.48 + 0.75 * fill + 0.45 * kick + 0.40 * hit_gather);
        let rim_glow = mix(albedo, tonal_tint, 0.45 * tonal_g) * rim_edge * (0.35 + 0.35 * harm_ch * tonal_g + 0.35 * hit_e);
        beauty = ambient + diffuse + spec + emissive + wire_trim + rim_glow;
    }

    let fog_factor = exp(-view_dist * 0.018);
    beauty = mix(vec3<f32>(0.02, 0.03, 0.06), beauty, clamp(fog_factor, 0.0, 1.0));
    beauty = vec3<f32>(1.0) - exp(-max(beauty, vec3<f32>(0.0)) * 1.15);
    beauty = clamp(beauty, vec3<f32>(0.0), vec3<f32>(1.0));

    let out_beauty = select(beauty, srgb_to_linear(beauty), u.react_params.z > 0.5);

    let curr_ndc = in.curr_clip.xy / max(abs(in.curr_clip.w), 1e-5);
    let prev_ndc = in.prev_clip.xy / max(abs(in.prev_clip.w), 1e-5);
    let flow = (curr_ndc - prev_ndc) * 12.0;

    var out: MrtAll;
    out.beauty = vec4<f32>(out_beauty, 1.0);
    out.depth = vec4<f32>(vec3<f32>(lin_depth), 1.0);
    out.normal = vec4<f32>(N * 0.5 + 0.5, 1.0);
    out.wireframe = vec4<f32>(vec3<f32>(wire_mask), 1.0);
    out.flat = vec4<f32>(clamp(albedo, vec3<f32>(0.0), vec3<f32>(1.0)), (in.zone_id + 0.5) * 0.25);
    out.motion = vec4<f32>(clamp(flow * 0.5 + 0.5, vec2<f32>(0.0), vec2<f32>(1.0)), clamp(length(flow), 0.0, 1.0), 1.0);
    return out;
}

@fragment
fn fs_beauty(in: VertexOutput) -> @location(0) vec4<f32> {
    return shade_all(in).beauty;
}

@fragment
fn fs_mrt_a(in: VertexOutput) -> MrtPassA {
    let res = shade_all(in);
    var out: MrtPassA;
    out.beauty = res.beauty;
    out.depth = res.depth;
    out.normal = res.normal;
    return out;
}

@fragment
fn fs_mrt_b(in: VertexOutput) -> MrtPassB {
    let res = shade_all(in);
    var out: MrtPassB;
    out.wireframe = res.wireframe;
    out.flat = res.flat;
    out.motion = res.motion;
    return out;
}
