// Ground: a picture made of nothing but arithmetic, laid under the scene wherever
// the scene is dark. Nineteen procedural shaders:
//   1  Julia set          6  Plasma             11 Aurora             16 Apollonian glass
//   2  Marble             7  Metaballs          12 Caustics           17 Circuit traces
//   3  Cells (Voronoi)    8  Hyperdrive stars   13 Hex pulse grid     18 Chladni nodal waves
//   4  Tunnel             9  Truchet labyrinth  14 Spiral galaxy      19 Synthwave horizon
//   5  Kaleidoscopic IFS  10 Gyroid slice       15 Raymarched corridor

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct GroundUniforms {
    kind: f32,   // 1..19 (see header)
    zoom: f32,   // how much of the ground the frame takes in: larger shows more of it, smaller
    angle: f32,  // how far the ground is turned, in radians
    phase: f32,  // what the ground changes with: its colours travel, its cells drift, its tunnel is flown down
    p1: f32,     // shader-specific parameter 1
    p2: f32,     // shader-specific parameter 2
    amount: f32, // how bright the ground is
    cx: f32,     // the ground's middle, in normalized coordinates
    cy: f32,
    ar: f32,     // three colours it is painted in, each red, green, blue
    ag: f32,
    ab: f32,
    br: f32,
    bg: f32,
    bb: f32,
    cr: f32,
    cg: f32,
    cb: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> params: GroundUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

fn eased(x: f32) -> f32 {
    return x * x * (3.0 - 2.0 * x);
}

// The three colours as a wheel: the first at 0, the second a third of the way
// round, the third at two thirds, and back to the first at 1.
fn paint(t: f32) -> vec3<f32> {
    let a = vec3<f32>(params.ar, params.ag, params.ab);
    let b = vec3<f32>(params.br, params.bg, params.bb);
    let c = vec3<f32>(params.cr, params.cg, params.cb);
    let x = fract(t) * 3.0;
    if (x < 1.0) {
        return mix(a, b, eased(x));
    } else if (x < 2.0) {
        return mix(b, c, eased(x - 1.0));
    }
    return mix(c, a, eased(x - 2.0));
}

fn rot2(p: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(hash21(p), hash21(p + vec2<f32>(17.31, 41.73)));
}

// Smooth noise: a random height at each whole-number point, eased between them.
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}

// Four layers of it, each twice as fine and half as strong as the last, and turned
// a little so that the layers' grids do not line up.
fn layered(p: vec2<f32>) -> f32 {
    var total = 0.0;
    var strength = 0.5;
    var q = p;
    for (var i = 0; i < 4; i++) {
        total += strength * noise(q);
        q = vec2<f32>(q.x * 1.6 - q.y * 1.2, q.x * 1.2 + q.y * 1.6) + vec2<f32>(3.1, 7.7);
        strength *= 0.5;
    }
    return total / 0.9375;
}

// ============================================================================
// 1..4: Original four grounds (preserved identically)
// ============================================================================

// 1. Julia set of z*z + c
fn julia(p: vec2<f32>) -> vec3<f32> {
    let c = vec2<f32>(params.p1, params.p2);
    var z = p;
    var steps = 0.0;
    var flown = false;
    for (var i = 0; i < 72; i++) {
        z = vec2<f32>(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 64.0) {
            flown = true;
            break;
        }
        steps += 1.0;
    }
    if (!flown) {
        return paint(params.phase) * 0.06;
    }
    let smooth_steps = steps + 1.0 - log2(max(log2(dot(z, z)) * 0.5, 0.0001));
    let near = clamp(smooth_steps / 24.0, 0.0, 1.0);
    return paint(smooth_steps * 0.045 + params.phase) * (0.25 + 0.75 * sqrt(near));
}

// 2. Marble: domain-warped FBM
fn marble(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let first = vec2<f32>(layered(p + vec2<f32>(0.0, t * 0.31)), layered(p + vec2<f32>(5.2, 1.3 - t * 0.23)));
    let second = vec2<f32>(layered(p + params.p1 * first + vec2<f32>(1.7, 9.2)), layered(p + params.p1 * first + vec2<f32>(8.3, 2.8)));
    let height = layered(p + params.p1 * second);
    return paint(height * params.p2 + length(first) * 0.4 + t * 0.03) * (0.2 + 1.1 * height * height);
}

// 3. Cells: Voronoi
fn cells(p: vec2<f32>) -> vec3<f32> {
    let square = floor(p);
    let within = fract(p);
    var nearest = 8.0;
    var second = 8.0;
    var owner = vec2<f32>(0.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let other = vec2<f32>(f32(i), f32(j));
            let seed = vec2<f32>(hash21(square + other), hash21(square + other + vec2<f32>(17.3, 41.7)));
            let point = other + vec2<f32>(0.5) + 0.5 * params.p2 * sin(params.phase * (0.6 + seed.y) + 6.2831853 * seed) - within;
            let d = dot(point, point);
            if (d < nearest) {
                second = nearest;
                nearest = d;
                owner = square + other;
            } else if (d < second) {
                second = d;
            }
        }
    }
    let to_border = sqrt(second) - sqrt(nearest);
    let body = smoothstep(0.0, max(params.p1, 0.005), to_border);
    return paint(hash21(owner) + params.phase * 0.02) * body * (0.4 + 0.6 * (1.0 - clamp(sqrt(nearest), 0.0, 1.0)));
}

// 4. Tunnel: cylindrical panel pipe
fn tunnel(p: vec2<f32>) -> vec3<f32> {
    let r = length(p) + 0.0001;
    let depth = 0.6 / r + params.phase;
    let around = atan2(p.y, p.x) / 6.2831853 * max(params.p1, 1.0) + params.p2 * depth * 0.15;
    let ring = floor(depth);
    let panel = floor(around);
    let lit = abs(fract(ring * 0.5) * 2.0 - fract(panel * 0.5) * 2.0);
    let edge = smoothstep(0.0, 0.08, fract(depth)) * smoothstep(0.0, 0.08, 1.0 - fract(depth)) * smoothstep(0.0, 0.06, fract(around)) * smoothstep(0.0, 0.06, 1.0 - fract(around));
    return paint(ring * 0.13 + panel * 0.21) * mix(0.3, 1.0, lit) * edge * smoothstep(0.02, 0.5, r);
}

// ============================================================================
// 5..19: Fifteen new procedural shaders
// ============================================================================

// 5. Kaleidoscopic IFS (Kali / Shadertoy fractal fold)
// p1: fold angle offset; p2: fractal scale / shift
fn kifs(p: vec2<f32>) -> vec3<f32> {
    var z = p;
    var acc = vec3<f32>(0.0);
    let fold_a = 0.785 + params.p1;
    let shift = 0.55 + clamp(params.p2, -0.35, 0.55);
    var scale = 1.0;
    for (var i = 0; i < 7; i++) {
        z = abs(z) - vec2<f32>(shift, shift * 0.82);
        z = rot2(z, fold_a + f32(i) * 0.17);
        let d = abs(min(z.x, z.y));
        let glow = exp(-d * 7.5);
        let ring = exp(-abs(length(z) - 0.35) * 6.0);
        acc += paint(f32(i) * 0.145 + params.phase * 0.18 + length(z) * 0.25) * (glow * 0.45 + ring * 0.35) / scale;
        z *= 1.38;
        scale *= 1.18;
    }
    return clamp(acc * 0.65, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 6. Plasma: layered demoscene wave interference with polar twist
// p1: harmonic scale (1..5); p2: swirl / modulation depth
fn plasma(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let freq = max(params.p1, 0.5);
    let r = length(p);
    let a = atan2(p.y, p.x);
    let q = p * freq + vec2<f32>(sin(p.y * 1.7 + t), cos(p.x * 1.5 - t * 0.8)) * params.p2;
    let v1 = sin(q.x * 1.8 + t * 1.1);
    let v2 = sin(q.y * 2.1 - t * 0.9);
    let v3 = sin((q.x + q.y) * 1.4 + t * 0.7);
    let v4 = sin(r * 3.8 * freq - t * 1.6 + sin(a * 3.0 + t * 0.5) * params.p2);
    let v = (v1 + v2 + v3 + v4) * 0.25;
    let ridge = 0.45 + 0.55 * sin(v * 3.14159265 + 0.8);
    let ribbon = smoothstep(0.15, 0.95, abs(sin(v * 6.2831853)));
    return paint(v * 0.65 + r * 0.15 + t * 0.06) * (0.28 + 0.62 * ridge * ribbon);
}

// 7. Metaballs: glowing organic lava-lamp field with crisp iso-contours
// p1: field contour sharpness; p2: orbit radius multiplier
fn metaballs(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let spread = max(params.p2, 0.2);
    var field = 0.0;
    var weighted_hue = 0.0;
    for (var i = 0; i < 7; i++) {
        let fi = f32(i);
        let speed = 0.55 + fi * 0.17;
        let center = vec2<f32>(
            sin(t * speed + fi * 1.9) * 0.65 + cos(t * 0.37 - fi * 2.3) * 0.25,
            cos(t * (speed * 0.83) + fi * 2.7) * 0.55 + sin(t * 0.41 + fi * 1.4) * 0.2
        ) * spread;
        let d2 = dot(p - center, p - center) + 0.025;
        let contrib = (0.09 + 0.025 * sin(t + fi)) / d2;
        field += contrib;
        weighted_hue += contrib * (fi / 7.0);
    }
    let hue = weighted_hue / max(field, 0.001) + t * 0.05;
    let sharp = max(params.p1, 1.0);
    let body = smoothstep(0.75, 1.45, field);
    let rim = exp(-abs(field - 1.15) * 2.8 * sharp);
    let rings = 0.5 + 0.5 * sin(field * 5.0 - t * 2.0);
    let col = paint(hue + field * 0.08) * (0.18 + 0.65 * body + 0.45 * rim) + paint(hue + 0.33) * (rim * 0.4 + body * rings * 0.22);
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 8. Hyperdrive stars: 4-layer 3D parallax starfield with warp streaks
// p1: streak/warp intensity; p2: tunnel swirl
fn warp_stars(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    var col = vec3<f32>(0.0);
    let r = length(p);
    // Faint nebula backdrop so frame is never dead black
    let neb = layered(p * 1.8 + vec2<f32>(t * 0.12, -t * 0.09));
    col += paint(neb * 0.9 + t * 0.04) * (0.14 + 0.22 * neb);
    let warp_len = clamp(params.p1, 0.2, 2.5);
    for (var layer = 0; layer < 4; layer++) {
        let fl = f32(layer);
        let depth = fract(t * 0.35 + fl * 0.25);
        let scale = mix(10.0, 0.7, depth);
        let fade = smoothstep(0.0, 0.2, depth) * smoothstep(1.0, 0.75, depth);
        let q = rot2(p, fl * 1.2 + params.p2 * depth) * scale;
        let cell = floor(q);
        let f = fract(q) - vec2<f32>(0.5);
        let rnd = hash22(cell + vec2<f32>(fl * 31.7, fl * 19.3));
        let star_pos = (rnd - vec2<f32>(0.5)) * 0.65;
        let delta = f - star_pos;
        // Stretch star radially from center for warp-speed streaks
        let dir = normalize(p + vec2<f32>(0.0001));
        let along = dot(delta, dir);
        let across = length(delta - dir * along);
        let streak = length(vec2<f32>(across, along / (1.0 + warp_len * r * 3.0)));
        let spark = exp(-streak * 14.0) * (0.6 + 0.4 * sin(t * 4.0 + rnd.x * 18.0));
        let flare = exp(-abs(delta.x) * 28.0) * exp(-abs(delta.y) * 8.0) * 0.35;
        col += paint(rnd.x + fl * 0.25 + t * 0.05) * (spark + flare) * fade * 1.3;
    }
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 9. Truchet labyrinth: multi-scale weaving neon arcs
// p1: ribbon thickness; p2: pattern seed (step on hits to flip tiles!)
fn truchet(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let seed = floor(params.p2 + 0.5) * 13.37;
    let thick = clamp(params.p1, 0.03, 0.22);
    var col = vec3<f32>(0.0);
    for (var layer = 0; layer < 2; layer++) {
        let sc = select(1.0, 2.0, layer == 1);
        let q = p * sc + vec2<f32>(t * 0.25 * sc, t * 0.14);
        let id = floor(q);
        var f = fract(q) - vec2<f32>(0.5);
        let h = hash21(id + vec2<f32>(seed, f32(layer) * 47.0));
        if (h < 0.5) {
            f.x = -f.x;
        }
        let s = select(-1.0, 1.0, f.x + f.y > 0.0);
        let corner = f - vec2<f32>(0.5) * s;
        let d = abs(length(corner) - 0.5);
        let ang = atan2(corner.y, corner.x);
        let pulse = 0.55 + 0.45 * sin(ang * 4.0 - t * 3.0 + h * 6.2831853);
        let line = smoothstep(thick, thick * 0.25, d);
        let halo = exp(-d * 9.0) * 0.55;
        let w = select(0.75, 0.45, layer == 1);
        col += paint(h * 0.8 + f32(layer) * 0.33 + ang * 0.15 + t * 0.08) * (line * pulse + halo) * w;
    }
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 10. Gyroid: 3D triply periodic minimal surface slice with layered depth
// p1: slice depth / scale; p2: twist speed
fn gyroid_val(q: vec3<f32>) -> f32 {
    return dot(sin(q), cos(q.yzx));
}

fn gyroid(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    var acc = vec3<f32>(0.0);
    let twist = params.p2;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let z = t * 0.45 + fi * 0.72 + params.p1;
        let q2 = rot2(p * (2.6 + fi * 0.55), fi * 0.4 + twist * 0.25);
        let g1 = gyroid_val(vec3<f32>(q2, z));
        let g2 = gyroid_val(vec3<f32>(q2 * 1.9 + vec2<f32>(1.3, -0.7), z * 1.3));
        let g = g1 + 0.35 * g2;
        let contour = exp(-abs(g) * 5.0);
        let fill = smoothstep(-0.6, 0.7, g) * 0.28;
        let depth_w = 1.0 - fi * 0.18;
        acc += paint(g * 0.35 + fi * 0.22 + t * 0.05) * (contour * 0.65 + fill) * depth_w;
    }
    return clamp(acc * 0.68, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 11. Aurora: northern lights silk curtains undulating across the sky
// p1: curtain wave frequency; p2: shimmer / vertical reach
fn aurora(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let freq = max(params.p1, 0.5);
    let reach = clamp(params.p2, 0.3, 2.0);
    var col = vec3<f32>(0.0);
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let x = p.x * (1.2 + fi * 0.28) * freq;
        let wave = sin(x + t * (0.45 + fi * 0.11) + sin(x * 0.6 - t * 0.3 + fi) * 1.4) * 0.35;
        let band_y = p.y - wave - (fi - 2.0) * 0.16;
        // Sharp bottom edge, softly fading upward like real auroral curtains
        let curtain = exp(-max(band_y, 0.0) * (3.2 / reach)) * smoothstep(-0.18, 0.04, band_y);
        let rays = 0.55 + 0.45 * sin(x * 4.5 + noise(vec2<f32>(x * 2.0, t * 0.4 + fi)) * 5.0);
        let glow = curtain * rays;
        col += paint(fi * 0.2 + p.x * 0.18 + t * 0.04) * glow * 0.55;
    }
    // Subtle dark sky tint + stars
    let sky = paint(p.y * 0.3 + t * 0.02) * 0.12;
    return clamp(col + sky, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 12. Caustics: dual-layer refracted underwater light web (Voronoi caustic ridges)
// p1: focus / sharpness; p2: wave turbulence
fn caustic_layer(q: vec2<f32>, t: f32) -> f32 {
    let cell = floor(q);
    let f = fract(q);
    var d1 = 8.0;
    var d2 = 8.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let g = vec2<f32>(f32(i), f32(j));
            let rnd = hash22(cell + g);
            let pt = g + vec2<f32>(0.5) + 0.42 * sin(t + 6.2831853 * rnd) - f;
            let d = dot(pt, pt);
            if (d < d1) {
                d2 = d1;
                d1 = d;
            } else if (d < d2) {
                d2 = d;
            }
        }
    }
    let ridge = sqrt(d2) - sqrt(d1);
    return exp(-ridge * 5.2);
}

fn caustics(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let turb = clamp(params.p2, 0.3, 2.2);
    let warp = vec2<f32>(sin(p.y * 1.4 + t * 0.6), cos(p.x * 1.4 - t * 0.5)) * (0.28 * turb);
    let c1 = caustic_layer((p + warp) * 1.45, t * 0.9);
    let c2 = caustic_layer(rot2(p - warp * 0.7, 0.55) * 2.15 + vec2<f32>(t * 0.12, -t * 0.09), -t * 0.75);
    let web = clamp(c1 * 0.72 + c2 * 0.62 + c1 * c2 * 0.9, 0.0, 1.0);
    let sharp = pow(max(web, 0.0001), clamp(params.p1 * 0.55, 1.0, 3.2));
    let base = paint(length(p) * 0.14 + c1 * 0.35 + t * 0.04);
    let hi = paint(c2 * 0.5 + 0.36 + t * 0.05);
    return clamp(base * (0.14 + 0.45 * web) + hi * sharp * 0.95, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 13. Hex pulse grid: glowing sci-fi hexagonal lattice with traveling waves
// p1: border width; p2: pulse wave frequency
fn hexgrid(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let s = vec2<f32>(1.0, 1.7320508);
    let h = s * 0.5;
    let a = p - s * floor(p / s) - h;
    let b = (p - h) - s * floor((p - h) / s) - h;
    let gv = select(b, a, dot(a, a) < dot(b, b));
    let id = p - gv;
    let q = abs(gv);
    let hex_dist = max(dot(q, normalize(s)), q.x);
    let edge = 0.5 - hex_dist;
    let bw = clamp(params.p1, 0.02, 0.16);
    let border = smoothstep(bw, bw * 0.15, edge);
    let rnd = hash21(floor(id * 2.0 + vec2<f32>(0.5)));
    let wave = 0.5 + 0.5 * sin(length(id) * max(params.p2, 0.5) - t * 2.5 + rnd * 3.14159);
    let fill = smoothstep(0.02, 0.18, edge) * (0.2 + 0.55 * wave * (0.4 + 0.6 * rnd));
    let col = paint(rnd * 0.7 + length(id) * 0.09 + t * 0.05) * fill + paint(rnd * 0.7 + 0.35 + t * 0.05) * border * (0.55 + 0.45 * wave);
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 14. Spiral galaxy: multi-arm logarithmic vortex with glowing core & dust lanes
// p1: number of arms (2..6); p2: spiral winding tightness
fn galaxy(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let r = length(p) + 0.0001;
    let ang = atan2(p.y, p.x);
    let arms = max(floor(params.p1 + 0.5), 2.0);
    let wind = params.p2;
    let spiral = ang * arms + log(r + 0.08) * wind * arms - t * 1.4;
    let arm_wave = 0.5 + 0.5 * cos(spiral);
    let arm_shape = arm_wave * arm_wave;
    let dust = layered(rot2(p * 2.4, -t * 0.2 + r * 0.9) + vec2<f32>(t * 0.15, 0.0));
    let core = exp(-r * 2.8);
    let radial_fade = exp(-r * 0.55);
    let body = (arm_shape * (0.45 + 0.85 * dust) + core * 0.9) * radial_fade;
    let hue = r * 0.25 + dust * 0.45 + ang / 6.2831853 + t * 0.04;
    return clamp(paint(hue) * (0.14 + body * 0.95) + paint(hue + 0.4) * core * 0.45, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 15. Raymarched corridor: true 3D infinite ribbed geometric tunnel
// p1: corridor curvature; p2: rib frequency
fn raytunnel(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let curv = params.p1;
    let rib_f = max(params.p2, 1.0);
    let ro = vec3<f32>(0.0, 0.0, t * 2.2);
    let rd = normalize(vec3<f32>(p, 1.15));
    var dist = 0.0;
    var hit_pos = ro;
    var min_rib = 10.0;
    for (var i = 0; i < 24; i++) {
        let pos = ro + rd * dist;
        let path = vec2<f32>(sin(pos.z * 0.35) * curv, cos(pos.z * 0.27) * curv * 0.7);
        let q = pos.xy - path;
        // Octagonal-rounded tunnel cross-section
        let aq = abs(q);
        let wall_r = max(max(aq.x, aq.y), (aq.x + aq.y) * 0.7071);
        let rib = 0.09 * sin(pos.z * rib_f);
        let d = (1.15 + rib) - wall_r;
        min_rib = min(min_rib, abs(sin(pos.z * rib_f * 0.5)));
        if (d < 0.015 || dist > 18.0) {
            hit_pos = pos;
            break;
        }
        dist += max(d * 0.7, 0.05);
        hit_pos = pos;
    }
    let fog = exp(-dist * 0.14);
    let path_h = vec2<f32>(sin(hit_pos.z * 0.35) * curv, cos(hit_pos.z * 0.27) * curv * 0.7);
    let qh = hit_pos.xy - path_h;
    let ang = atan2(qh.y, qh.x);
    let bands = smoothstep(0.15, 0.9, abs(sin(hit_pos.z * rib_f)));
    let stripes = smoothstep(0.15, 0.9, abs(sin(ang * 4.0 + hit_pos.z * 0.4)));
    let lit = (0.3 + 0.7 * bands * stripes) * fog + exp(-min_rib * 5.0) * 0.25 * fog;
    let far_glow = (1.0 - fog) * 0.35;
    return clamp(paint(hit_pos.z * 0.09 + ang * 0.16 + t * 0.05) * lit + paint(t * 0.1 + 0.5) * far_glow, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 16. Apollonian glass: iterated circle-inversion fractal stained glass
// p1: inversion radius scale; p2: fold shift
fn stained(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    var z = p;
    var orbit = 10.0;
    var sum_d = 0.0;
    let inv_k = clamp(params.p1, 0.8, 2.2);
    let sh = params.p2;
    for (var i = 0; i < 6; i++) {
        z = abs(z) - vec2<f32>(0.55 + 0.15 * sin(t * 0.4 + sh), 0.55 + 0.15 * cos(t * 0.33 - sh));
        let r2 = max(dot(z, z), 0.08);
        z = z * (inv_k / r2);
        z = rot2(z, 0.42 + t * 0.07);
        let d = abs(length(z) - 0.85);
        orbit = min(orbit, d);
        sum_d += exp(-d * 3.5);
    }
    let lead = smoothstep(0.02, 0.14, orbit);
    let glass = clamp(sum_d * 0.28, 0.0, 1.0);
    let edge = exp(-orbit * 10.0);
    return clamp(paint(glass * 0.85 + atan2(z.y, z.x) * 0.16 + t * 0.05) * (0.25 + 0.65 * lead * glass) + paint(glass + 0.45) * edge * 0.55, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 17. Circuitry: cybernetic PCB glowing traces with travelling pulses
// p1: fold / trace density; p2: pulse speed
fn circuit(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    var z = p;
    var trace = 0.0;
    var node = 0.0;
    let fold_s = clamp(params.p1, 0.65, 1.65);
    for (var i = 0; i < 5; i++) {
        z = abs(z) / max(dot(z, z), 0.18) - vec2<f32>(fold_s, fold_s * 0.88);
        let line_x = exp(-abs(z.x) * 14.0);
        let line_y = exp(-abs(z.y) * 14.0);
        let pulse = 0.45 + 0.55 * sin((z.x + z.y) * 4.0 - t * max(params.p2, 1.0) + f32(i) * 1.3);
        trace += (line_x + line_y) * pulse * (0.38 - f32(i) * 0.04);
        node += exp(-length(z) * 7.0) * 0.45;
    }
    let col = paint(trace * 0.5 + t * 0.06) * clamp(trace * 0.8, 0.0, 1.0) + paint(node * 0.7 + 0.4 + t * 0.06) * clamp(node, 0.0, 1.0);
    return clamp(col + paint(length(p) * 0.25 + t * 0.02) * 0.12, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 18. Chladni interference: acoustic standing-wave nodal plates
// p1: harmonic mode n (1.5..8); p2: harmonic mode m (2..9)
fn interference(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let n = max(params.p1, 1.0);
    let m = max(params.p2, 1.5);
    let q = p * 2.4;
    let pi = 3.14159265;
    let c1 = cos(n * pi * q.x * 0.35 + t * 0.3) * cos(m * pi * q.y * 0.35 - t * 0.22);
    let c2 = cos(m * pi * q.x * 0.35 - t * 0.25) * cos(n * pi * q.y * 0.35 + t * 0.28);
    let wave = c1 - c2;
    let nodal = exp(-abs(wave) * 6.5);
    let contour = 0.5 + 0.5 * cos(wave * 9.0 - t * 1.5);
    let radial = exp(-dot(p, p) * 0.28);
    let col = paint(wave * 0.42 + t * 0.06) * (0.2 + 0.45 * contour * radial) + paint(wave * 0.42 + 0.38 + t * 0.06) * nodal * 0.9;
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

// 19. Synthwave horizon: outrun perspective grid, striped sun, mountain silhouettes
// p1: sun size / pulse; p2: mountain amplitude
fn synthgrid(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    // Flip y so positive is up in sky
    let y = -p.y;
    let horizon = -0.06;
    if (y < horizon) {
        // Perspective ground grid
        let depth = 0.42 / max(horizon - y, 0.012);
        let gx = p.x * depth;
        let gz = depth + t * 2.4;
        let fx = abs(fract(gx) - 0.5);
        let fz = abs(fract(gz) - 0.5);
        let line_x = smoothstep(0.06, 0.01, fx);
        let line_z = smoothstep(0.08, 0.01, fz);
        let grid = max(line_x, line_z);
        let fade = exp(-depth * 0.08);
        let floor_col = paint(0.05 + depth * 0.02 + t * 0.02) * 0.18 + paint(0.35 + depth * 0.03 + t * 0.03) * grid * fade * 0.95;
        return clamp(floor_col, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    // Sky gradient + striped sun + mountain silhouette
    let sky_t = clamp((y - horizon) * 1.4, 0.0, 1.0);
    var sky = paint(0.68 - sky_t * 0.28 + t * 0.02) * (0.22 + 0.35 * (1.0 - sky_t));
    // Sun
    let sun_c = vec2<f32>(0.0, 0.24);
    let sun_r = clamp(params.p1, 0.16, 0.42);
    let d_sun = length(vec2<f32>(p.x, y) - sun_c);
    let sun_mask = smoothstep(sun_r + 0.015, sun_r - 0.015, d_sun);
    let stripes = smoothstep(-0.1, 0.35, sin((y - horizon) * 44.0 - t * 2.0) + (y - sun_c.y) * 3.5);
    let sun_glow = exp(-d_sun * 3.2) * 0.45;
    sky += paint(0.02 + (y - horizon) * 0.5 + t * 0.02) * (sun_mask * stripes * 0.95 + sun_glow);
    // Mountain ridge along the horizon
    let m_amp = clamp(params.p2, 0.05, 0.35);
    let ridge = (noise(vec2<f32>(p.x * 2.8 + t * 0.08, 1.7)) * 0.65 + noise(vec2<f32>(p.x * 6.5 - t * 0.05, 4.3)) * 0.35) * m_amp;
    let m_top = horizon + ridge;
    if (y < m_top) {
        let edge = smoothstep(0.022, 0.0, m_top - y);
        sky = paint(0.66 + t * 0.02) * 0.12 + paint(0.34 + t * 0.03) * edge * 0.9;
    }
    return clamp(sky, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSampleLevel(input_texture, input_sampler, in.uv, 0.0);
    if (params.amount <= 0.0 || params.kind < 0.5) {
        return scene;
    }
    let dims = vec2<f32>(textureDimensions(input_texture));
    let from_middle = (in.uv - vec2<f32>(params.cx, params.cy)) * vec2<f32>(dims.x / dims.y, 1.0);
    let c = cos(params.angle);
    let s = sin(params.angle);
    let p = vec2<f32>(from_middle.x * c - from_middle.y * s, from_middle.x * s + from_middle.y * c) * params.zoom;
    let k = i32(round(params.kind));
    var ground: vec3<f32>;
    switch k {
        case 1: { ground = julia(p); }
        case 2: { ground = marble(p); }
        case 3: { ground = cells(p); }
        case 4: { ground = tunnel(p); }
        case 5: { ground = kifs(p); }
        case 6: { ground = plasma(p); }
        case 7: { ground = metaballs(p); }
        case 8: { ground = warp_stars(p); }
        case 9: { ground = truchet(p); }
        case 10: { ground = gyroid(p); }
        case 11: { ground = aurora(p); }
        case 12: { ground = caustics(p); }
        case 13: { ground = hexgrid(p); }
        case 14: { ground = galaxy(p); }
        case 15: { ground = raytunnel(p); }
        case 16: { ground = stained(p); }
        case 17: { ground = circuit(p); }
        case 18: { ground = interference(p); }
        case 19: { ground = synthgrid(p); }
        default: { ground = tunnel(p); }
    }
    // Under the scene: the ground shows where the scene is dark and gives way where it is bright.
    let covered = clamp(max(scene.r, max(scene.g, scene.b)) * 1.5, 0.0, 1.0);
    let colour = scene.rgb + clamp(ground, vec3<f32>(0.0), vec3<f32>(1.0)) * params.amount * (1.0 - covered);
    return vec4<f32>(colour, scene.a);
}
