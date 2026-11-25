// Procedural GPU-instanced 3D vertex generators + shared stylized shading (beauty-only & 6-target MRT).
// Ported 1:1 from Lactoseq Scene3DPass (scene_rig.v1 + scene_rig.v2).

struct Scene3DUniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    prev_view_proj: mat4x4<f32>,
    // x = time, y = prev_time, z = spacing/ring_spacing, w = wire_thickness (height-scaled)
    time_params: vec4<f32>,
    // x = depth_near, y = depth_far, z = wire_glow, w = kick_punch
    depth_params: vec4<f32>,
    // x = fill_turb, y = bar_wave_amp, z = convert_srgb_to_linear, w = has_albedo_tex
    react_params: vec4<f32>,
    // x = seed, y = param_a (grid_side / sides / rings / shells), z = param_b (rings / per_ring / per_shell), w = material_style
    grid_params: vec4<u32>,
    col_drums: vec4<f32>,
    col_bass: vec4<f32>,
    col_vocals: vec4<f32>,
    col_other: vec4<f32>,
    musical0: vec4<f32>,     // beatPos, beatPhase, barPhase, sectionProg
    musical1: vec4<f32>,     // kick, snare, hat, downbeatAccent
    musical2: vec4<f32>,     // drumDensity, drumFill, drumSyncopation, leadStemId
    musical3: vec4<f32>,     // leadEnergy, leadOnset, stemEnter, stemExit
    stem_weights: vec4<f32>, // wDrums, wBass, wVocals, wOther
    answer: vec4<f32>,       // hitEnv, hitCount, hitGather, sectionIntensity
    tonal: vec4<f32>,        // brightness, harmonicChange, 0, 0
    v2_gains: vec4<f32>,     // hitGatherGain, stayingStepGain, tonalShiftGain, 0
}

@group(0) @binding(0) var<uniform> u: Scene3DUniforms;
@group(0) @binding(1) var albedo_tex: texture_2d<f32>;
@group(0) @binding(2) var albedo_sampler: sampler;

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

fn glsl_mod(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

fn hash12(id: u32, s: u32) -> f32 {
    var x = (id * 747796405u + 2891336453u) ^ s;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return f32(x & 0x00FFFFFFu) / 16777216.0;
}

fn zone_color(zone: u32) -> vec3<f32> {
    if zone == 0u {
        return u.col_drums.rgb;
    } else if zone == 1u {
        return u.col_bass.rgb;
    } else if zone == 2u {
        return u.col_vocals.rgb;
    }
    return u.col_other.rgb;
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

// ============================================================================
// 1. scene_rig.v2 Rig 07: Sacred Polyhedra Cathedral (stateless, O(1) seekable)
// ============================================================================
struct EvalResult {
    world_pos: vec3<f32>,
    world_norm: vec3<f32>,
    zone: u32,
    emissive: f32,
}

fn eval_cathedral_world(id: u32, ts: f32, a_pos: vec3<f32>, a_normal: vec3<f32>) -> EvalResult {
    let rings = max(u.grid_params.y, 1u);
    let per_ring = max(u.grid_params.z, 1u);
    let ring_idx = id / per_ring;
    let slot_idx = id % per_ring;
    let ring_f = f32(ring_idx) / max(f32(rings) - 1.0, 1.0);
    let slot_f = f32(slot_idx) / f32(per_ring);

    let hit_e = u.answer.x;
    let hit_count = u.answer.y;
    let hit_gather = u.answer.z * u.v2_gains.x;
    let stay_g = u.v2_gains.y;
    let sect_i = u.answer.w;
    let fill = u.musical2.y * u.react_params.x;
    let kick_punch = u.depth_params.w;

    let ring_dir = select(-1.0, 1.0, (ring_idx & 1u) == 0u);
    let stay_angle = hit_count * 0.57595865 * stay_g * ring_dir; // +-33 deg (5.5 ribs) staying ratchet per blow
    let base_ang = slot_f * 6.2831853 + stay_angle + ts * 0.015 * ring_dir + fill * 0.10 * ring_dir;

    let z_base = -3.0 - f32(ring_idx) * 3.1;
    let radius_base = 5.4 + 2.4 * sin(ring_f * 3.14159265) + 0.65 * cos(slot_f * 12.56637);
    let radius = radius_base * (1.0 - 0.045 * hit_gather + 0.055 * hit_e * kick_punch) + 0.25 * sect_i;

    let polarity = cos(hit_count * 3.14159265) * stay_g;
    let pillar_w = 0.42 + 0.16 * (1.0 - ring_f);
    let pillar_h = (1.65 + 1.35 * sin(slot_f * 6.2831853 + polarity * 0.95)) * (0.94 - 0.04 * hit_gather + 0.14 * hit_e);
    let pillar_d = 0.52 + 0.08 * hit_e;

    let lp = vec3<f32>(a_pos.x * pillar_w, a_pos.y * pillar_h, a_pos.z * pillar_d);
    let tilt = base_ang + 0.45 * polarity * ring_dir;
    let ca = cos(tilt);
    let sa = sin(tilt);
    let rp = vec3<f32>(lp.x * ca - lp.y * sa, lp.x * sa + lp.y * ca, lp.z);
    let rn = normalize(vec3<f32>(a_normal.x * ca - a_normal.y * sa, a_normal.x * sa + a_normal.y * ca, a_normal.z));

    let center = vec3<f32>(cos(base_ang) * radius, sin(base_ang) * radius * 0.88 + 0.45, z_base);
    let zone = (ring_idx + slot_idx) & 3u;
    let emis = clamp(0.22 + 0.20 * sect_i + 0.12 * hit_gather + 0.38 * hit_e + 0.25 * u.tonal.y, 0.0, 1.15);

    var res: EvalResult;
    res.world_pos = rp + center;
    res.world_norm = rn;
    res.zone = zone;
    res.emissive = emis;
    return res;
}

@vertex
fn vs_cathedral(in: VertexInput, @builtin(instance_index) inst_id: u32) -> VertexOutput {
    let curr = eval_cathedral_world(inst_id, u.time_params.x, in.pos, in.normal);
    let prev = eval_cathedral_world(inst_id, u.time_params.y, in.pos, in.normal);

    let vp = u.view * vec4<f32>(curr.world_pos, 1.0);
    let clip = u.proj * vp;

    var out: VertexOutput;
    out.clip_pos = clip;
    out.curr_clip = clip;
    out.prev_clip = u.prev_view_proj * vec4<f32>(prev.world_pos, 1.0);
    out.world_pos = curr.world_pos;
    out.view_pos = vp.xyz;
    out.view_normal = normalize(mat3_from_mat4(u.view) * curr.world_norm);
    out.uv = in.uv;
    out.bary = in.bary;
    out.zone_id = f32(curr.zone);
    out.emissive_boost = curr.emissive;

    let c = zone_color(curr.zone);
    let bright_tint = mix(vec3<f32>(0.35, 0.45, 1.0), vec3<f32>(1.0, 0.90, 0.62), u.tonal.x);
    out.base_color = mix(c, bright_tint, 0.22 * u.v2_gains.z);
    return out;
}

// ============================================================================
// 2. scene_rig.v2 Rig 08: Orbital Prism Array (stateless, O(1) seekable)
// ============================================================================
fn eval_orbital_world(id: u32, ts: f32, a_pos: vec3<f32>, a_normal: vec3<f32>) -> EvalResult {
    let shells = max(u.grid_params.y, 1u);
    let per_shell = max(u.grid_params.z, 1u);
    let shell_idx = id / per_shell;
    let idx = id % per_shell;
    let n_per = f32(per_shell);
    let shell_f = f32(shell_idx) / max(f32(shells) - 1.0, 1.0);

    let hit_e = u.answer.x;
    let hit_count = u.answer.y;
    let hit_gather = u.answer.z * u.v2_gains.x;
    let stay_g = u.v2_gains.y;
    let sect_i = u.answer.w;
    let kick_punch = u.depth_params.w;

    let y_fib = 1.0 - (2.0 * (f32(idx) + 0.5)) / n_per;
    let r_xz = sqrt(max(0.0, 1.0 - y_fib * y_fib));
    let shell_dir = select(-1.0, 1.0, (shell_idx & 1u) == 0u);

    let stay_az = hit_count * 0.39269908 * stay_g * shell_dir; // +-PI/8 azimuth step
    let theta = f32(idx) * 2.3999632 + stay_az + ts * (0.012 + 0.006 * shell_f) * shell_dir;
    var dir = vec3<f32>(cos(theta) * r_xz, y_fib, sin(theta) * r_xz);

    let tilt_ang = 0.28 * sin(hit_count * 1.15 * stay_g + f32(shell_idx) * 0.9);
    let ct = cos(tilt_ang);
    let st = sin(tilt_ang);
    dir = vec3<f32>(dir.x, dir.y * ct - dir.z * st, dir.y * st + dir.z * ct);

    let shell_r = (2.8 + f32(shell_idx) * 1.15) * (1.0 - 0.045 * hit_gather + 0.055 * hit_e * kick_punch) + 0.20 * sect_i;
    let center = dir * shell_r;

    let spin = hit_count * 0.78539816 * stay_g * shell_dir + ts * 0.02;
    let cs = cos(spin);
    let ss = sin(spin);
    let p_thick = 0.22 + 0.08 * (1.0 - shell_f);
    let p_len = (0.72 + 0.35 * shell_f) * (1.0 + 0.07 * hit_gather + 0.14 * hit_e);
    let lp = vec3<f32>(a_pos.x * p_thick, a_pos.y * p_len, a_pos.z * p_thick);
    let sp = vec3<f32>(lp.x * cs - lp.z * ss, lp.y, lp.x * ss + lp.z * cs);
    let sn = vec3<f32>(a_normal.x * cs - a_normal.z * ss, a_normal.y, a_normal.x * ss + a_normal.z * cs);

    let up = normalize(dir);
    let ref_v = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(up.y) < 0.95);
    let right = normalize(cross(ref_v, up));
    let fwd = cross(up, right);

    var res: EvalResult;
    res.world_pos = right * sp.x + up * sp.y + fwd * sp.z + center;
    res.world_norm = normalize(right * sn.x + up * sn.y + fwd * sn.z);
    res.zone = (shell_idx + (idx & 3u)) & 3u;
    res.emissive = clamp(0.24 + 0.18 * sect_i + 0.12 * hit_gather + 0.38 * hit_e + 0.28 * u.tonal.y, 0.0, 1.15);
    return res;
}

@vertex
fn vs_orbital(in: VertexInput, @builtin(instance_index) inst_id: u32) -> VertexOutput {
    let curr = eval_orbital_world(inst_id, u.time_params.x, in.pos, in.normal);
    let prev = eval_orbital_world(inst_id, u.time_params.y, in.pos, in.normal);

    let vp = u.view * vec4<f32>(curr.world_pos, 1.0);
    let clip = u.proj * vp;

    var out: VertexOutput;
    out.clip_pos = clip;
    out.curr_clip = clip;
    out.prev_clip = u.prev_view_proj * vec4<f32>(prev.world_pos, 1.0);
    out.world_pos = curr.world_pos;
    out.view_pos = vp.xyz;
    out.view_normal = normalize(mat3_from_mat4(u.view) * curr.world_norm);
    out.uv = in.uv;
    out.bary = in.bary;
    out.zone_id = f32(curr.zone);
    out.emissive_boost = curr.emissive;

    let c = zone_color(curr.zone);
    let warm_cool = mix(vec3<f32>(0.28, 0.58, 1.0), vec3<f32>(1.0, 0.88, 0.56), u.tonal.x);
    out.base_color = mix(c, warm_cool, 0.25 * u.v2_gains.z);
    return out;
}

// ============================================================================
// 3. scene_rig.v1 Rig 01: Instanced Megastructure (stateless, O(1) seekable)
// ============================================================================
@vertex
fn vs_megastructure(in: VertexInput, @builtin(instance_index) inst_id: u32) -> VertexOutput {
    let grid_side = max(u.grid_params.y, 1u);
    let spacing = u.time_params.z;
    let seed = u.grid_params.x;

    let gx = i32(inst_id % grid_side);
    let gz = i32(inst_id / grid_side);
    let half_g = 0.5 * f32(grid_side - 1u);
    let cx = (f32(gx) - half_g) * spacing;
    let cz = (f32(gz) - half_g) * spacing;

    let dist_center = length(vec2<f32>(cx, cz));
    let canyon_clear = smoothstep(3.2, 6.5, abs(cx));

    let h_rand = hash12(inst_id, seed ^ 0x51a7u);
    let p_rand = hash12(inst_id, seed ^ 0x9b31u);
    let zone = u32((abs(gx * 3 + gz * 5) + i32(h_rand * 4.0)) & 3);

    let beat_pos = u.musical0.x;
    let bar_phase = u.musical0.z;
    let kick = u.musical1.x;
    let snare = u.musical1.y;
    let fill = u.musical2.y;
    let lead_e = u.musical3.x;
    let kick_punch = u.depth_params.w;
    let fill_turb = u.react_params.x;
    let bar_wave_amp = u.react_params.y;
    let ts = u.time_params.x;

    let wave = sin(dist_center * 0.28 - beat_pos * 1.5707963 + p_rand * 2.0) * 0.5 + 0.5;
    let bar_pulse = sin(cz * 0.15 - bar_phase * 6.2831853) * 0.5 + 0.5;

    let zone_e = zone_weight_u32(zone);
    let base_h = (1.1 + 5.8 * h_rand) * (0.28 + 0.72 * canyon_clear);
    let hit_gather = u.answer.z * u.v2_gains.x;
    let stay_step = u.answer.y * u.v2_gains.y;
    let dyn_h = base_h * (0.72 - 0.10 * hit_gather + (0.65 * wave + 0.45 * bar_pulse) * bar_wave_amp + 0.55 * kick * kick_punch * zone_e + 0.45 * lead_e + 0.35 * u.answer.x);

    let zone_sign = select(-1.0, 1.0, (zone & 1u) == 0u);
    let twist = (fill * 0.65 * fill_turb) * (p_rand - 0.5) * 2.0 + 0.15 * snare * sin(ts + f32(inst_id)) + stay_step * 0.08 * zone_sign;
    let ct = cos(twist);
    let st = sin(twist);

    let sx = 0.46 + 0.24 * h_rand;
    let sz = 0.46 + 0.24 * p_rand;
    let local_p = vec3<f32>(in.pos.x * sx, (in.pos.y + 0.5) * dyn_h, in.pos.z * sz);
    let rot_p = vec3<f32>(local_p.x * ct - local_p.z * st, local_p.y, local_p.x * st + local_p.z * ct);
    let rot_n = normalize(vec3<f32>(in.normal.x * ct - in.normal.z * st, in.normal.y, in.normal.x * st + in.normal.z * ct));

    let floor_y = -3.8 + 0.85 * sin(dist_center * 0.12 - ts * 0.6) * bar_wave_amp;
    let world_p = rot_p + vec3<f32>(cx, floor_y, cz);

    let view_p = u.view * vec4<f32>(world_p, 1.0);
    let clip = u.proj * view_p;

    var out: VertexOutput;
    out.clip_pos = clip;
    out.curr_clip = clip;
    out.prev_clip = u.prev_view_proj * vec4<f32>(world_p, 1.0);
    out.world_pos = world_p;
    out.view_pos = view_p.xyz;
    out.view_normal = mat3_from_mat4(u.view) * rot_n;
    out.uv = in.uv;
    out.bary = in.bary;
    out.zone_id = f32(zone);
    out.emissive_boost = clamp(wave * 0.55 + zone_e * 0.6 + (in.pos.y + 0.5) * 0.45, 0.0, 1.5);
    out.base_color = zone_color(zone);
    return out;
}

// ============================================================================
// 4. scene_rig.v1 Rig 06: Cyber Wireframe Tunnel (stateless, O(1) seekable)
// ============================================================================
fn eval_tunnel_world(id: u32, ts: f32, a_pos: vec3<f32>, a_normal: vec3<f32>) -> EvalResult {
    let sides = max(u.grid_params.y, 1u);
    let rings = max(u.grid_params.z, 1u);
    let ring_spacing = u.time_params.z;

    let side_idx = id % sides;
    let ring_idx = id / sides;
    let total_len = f32(rings) * ring_spacing;

    let kick_punch = u.depth_params.w;
    let fill_turb = u.react_params.x;
    let bar_wave_amp = u.react_params.y;

    let kick = u.musical1.x * kick_punch;
    let snare = u.musical1.y;
    let fill = u.musical2.y * fill_turb;
    let bar_p = u.musical0.z;
    let beat_pos = u.musical0.x;
    let lead_e = u.musical3.x;
    let hit_e = u.answer.x;
    let hit_count = u.answer.y * u.v2_gains.y;
    let hit_gather = u.answer.z * u.v2_gains.x;

    let smooth_step_beat = beat_pos - 0.14 * sin(beat_pos * 6.2831853);
    let travel = ts * 0.40 + smooth_step_beat * 0.20 + kick * 0.62 + hit_e * 0.45;
    let z_mod = glsl_mod(f32(ring_idx) * ring_spacing - travel, total_len);
    let z = 6.0 - z_mod;

    let twist = z * (0.036 + 0.035 * fill) + sin(bar_p * 6.2831853) * 0.14 + snare * 0.18 + hit_count * 0.14;
    let ang = (f32(side_idx) / f32(sides)) * 6.2831853 + twist;
    let pulse = 0.5 + 0.5 * sin(z * 0.28 + beat_pos * 1.5707963);
    let radius = 4.6 - 0.26 * hit_gather + (0.22 * pulse * bar_wave_amp) + 0.95 * kick + 0.55 * hit_e + 0.20 * lead_e + 0.05 * sin(z * 0.14 + ts * 0.18);

    let sway_x = sin(z * 0.055 + ts * 0.09) * 0.28;
    let sway_y = cos(z * 0.048 - ts * 0.08) * 0.20;

    let seg_w = (2.0 * 3.14159265 * radius / f32(sides)) * 0.88;
    let seg_h = 0.26 + 0.20 * pulse + 0.34 * kick + 0.24 * hit_e;
    let seg_l = ring_spacing * 0.72;
    let lp = vec3<f32>(a_pos.x * seg_w, a_pos.y * seg_h, a_pos.z * seg_l);

    let ca = cos(ang);
    let sa = sin(ang);
    let rp = vec3<f32>(lp.x * ca - lp.y * sa, lp.x * sa + lp.y * ca, lp.z);
    let rn = normalize(vec3<f32>(a_normal.x * ca - a_normal.y * sa, a_normal.x * sa + a_normal.y * ca, a_normal.z));

    let ring_pos = vec3<f32>(cos(ang + 1.5707963) * radius + sway_x, sin(ang + 1.5707963) * radius + sway_y, z);

    var res: EvalResult;
    res.world_pos = rp + ring_pos;
    res.world_norm = rn;
    res.zone = (side_idx + ring_idx) & 3u;
    res.emissive = clamp(0.26 + 0.28 * pulse + 0.75 * kick + 0.55 * hit_e + 0.35 * snare, 0.0, 1.8);
    return res;
}

@vertex
fn vs_tunnel(in: VertexInput, @builtin(instance_index) inst_id: u32) -> VertexOutput {
    let curr = eval_tunnel_world(inst_id, u.time_params.x, in.pos, in.normal);
    let prev = eval_tunnel_world(inst_id, u.time_params.y, in.pos, in.normal);

    let vp = u.view * vec4<f32>(curr.world_pos, 1.0);
    let clip = u.proj * vp;

    var out: VertexOutput;
    out.clip_pos = clip;
    out.curr_clip = clip;
    out.prev_clip = u.prev_view_proj * vec4<f32>(prev.world_pos, 1.0);
    out.world_pos = curr.world_pos;
    out.view_pos = vp.xyz;
    out.view_normal = normalize(mat3_from_mat4(u.view) * curr.world_norm);
    out.uv = in.uv;
    out.bary = in.bary;
    out.zone_id = f32(curr.zone);
    out.emissive_boost = curr.emissive;
    out.base_color = zone_color(curr.zone);
    return out;
}

// ============================================================================
// Shared Stylized PBR / Toon / Flat / Wireframe-Neon + 6-Target MRT Shading
// ============================================================================
fn shade_all(in: VertexOutput, use_albedo_tex: bool) -> MrtAll {
    let N = normalize(in.view_normal);
    let V = normalize(-in.view_pos);
    let ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

    // Single-pass anti-aliased barycentric wireframe using screen-space derivatives
    let wire_thickness = u.time_params.w;
    let wire_glow = u.depth_params.z;
    let d_bary = fwidth(in.bary);
    let a3 = smoothstep(vec3<f32>(0.0), max(d_bary * wire_thickness, vec3<f32>(1e-5)), in.bary);
    let edge_factor = 1.0 - min(min(a3.x, a3.y), a3.z);
    let rim_edge = pow(1.0 - ndotv, 3.0);
    let wire_mask = clamp(max(edge_factor, rim_edge * 0.65), 0.0, 1.0);

    // Inverted linear depth: 1.0 near camera, 0.0 at depth_far
    let view_dist = max(-in.view_pos.z, 0.0);
    let depth_near = u.depth_params.x;
    let depth_far = u.depth_params.y;
    let lin_depth = 1.0 - clamp((view_dist - depth_near) / max(depth_far - depth_near, 0.001), 0.0, 1.0);

    // Dominant-stem spotlight modulation
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
    let spotlight = 0.58 + 0.95 * zone_w + 0.18 * kick + 0.30 * enter_p + 0.18 * hit_e + 0.14 * sect_i;

    // Key + fill + rim stylized lights in view space
    let L1 = normalize(vec3<f32>(0.45, 0.78, 0.42));
    let L2 = normalize(vec3<f32>(-0.65, 0.25, 0.72));
    let diff1 = max(dot(N, L1), 0.0);
    let diff2 = max(dot(N, L2), 0.0);
    let H1 = normalize(L1 + V);
    let spec1 = pow(max(dot(N, H1), 0.0), 32.0);

    // Always sample albedo_tex uniformly for WGSL uniform-control-flow compliance
    let sampled_tex = textureSample(albedo_tex, albedo_sampler, in.uv);
    var albedo = in.base_color;
    if use_albedo_tex {
        albedo = albedo * sampled_tex.rgb;
    }

    let tonal_tint = mix(vec3<f32>(0.32, 0.56, 1.0), vec3<f32>(1.0, 0.84, 0.52), bright);
    albedo = mix(albedo, mix(albedo, tonal_tint, 0.38), clamp(harm_ch * 0.65 * tonal_g, 0.0, 0.65));

    let mat_style = u.grid_params.w;
    var beauty = albedo;

    if mat_style == 1u {
        // toon_cel
        let q_diff = floor(diff1 * 3.99) / 3.0;
        let q_spec = step(0.55, spec1);
        beauty = albedo * (0.26 + 0.82 * q_diff + 0.18 * diff2) * spotlight;
        beauty = beauty + vec3<f32>(1.0) * q_spec * 0.45 + albedo * rim_edge * (0.45 + 0.55 * fill + 0.35 * hit_e);
        beauty = mix(beauty, vec3<f32>(0.02, 0.02, 0.04), step(0.75, rim_edge) * 0.45);
        beauty = beauty + albedo * edge_factor * wire_glow * (0.4 + 0.9 * kick + 0.45 * hit_gather);
    } else if mat_style == 2u {
        // flat_unlit
        beauty = albedo * (0.78 + 0.22 * diff1) * clamp(spotlight, 0.7, 1.45);
        beauty = beauty + albedo * edge_factor * wire_glow * (0.35 + 0.25 * hit_e);
    } else if mat_style == 3u {
        // wireframe_neon
        let core = albedo * (0.08 + 0.14 * diff1);
        let wire_col = mix(albedo, tonal_tint, 0.30 * tonal_g) * (1.15 + 0.85 * kick + 0.75 * fill + 0.65 * hit_e + 0.30 * hit_gather);
        beauty = core + wire_col * wire_mask * (0.85 + 0.5 * zone_w);
    } else {
        // stylized_pbr (default)
        let ambient = albedo * (0.16 + 0.10 * (N.y * 0.5 + 0.5));
        let diffuse = albedo * (diff1 * 0.85 + diff2 * 0.35) * spotlight;
        let spec = mix(vec3<f32>(1.0), tonal_tint, 0.35 * tonal_g) * spec1 * (0.55 + 0.45 * spotlight);
        let emissive = albedo * (in.emissive_boost * (0.28 + 0.48 * zone_w + 0.26 * kick + 0.35 * fill + 0.28 * hit_e));
        let wire_trim = mix(albedo, vec3<f32>(1.0), 0.45) * edge_factor * wire_glow * (0.45 + 0.55 * fill + 0.30 * kick + 0.22 * hit_gather);
        let rim_glow = mix(albedo, tonal_tint, 0.45 * tonal_g) * rim_edge * (0.30 + 0.30 * harm_ch * tonal_g + 0.22 * hit_e);
        beauty = ambient + diffuse + spec + emissive + wire_trim + rim_glow;
    }

    // Distance atmospheric fog + soft filmic curve (matching Lactoseq)
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
    let res = shade_all(in, false);
    return res.beauty;
}

@fragment
fn fs_mrt_a(in: VertexOutput) -> MrtPassA {
    let res = shade_all(in, false);
    var out: MrtPassA;
    out.beauty = res.beauty;
    out.depth = res.depth;
    out.normal = res.normal;
    return out;
}

@fragment
fn fs_mrt_b(in: VertexOutput) -> MrtPassB {
    let res = shade_all(in, false);
    var out: MrtPassB;
    out.wireframe = res.wireframe;
    out.flat = res.flat;
    out.motion = res.motion;
    return out;
}
