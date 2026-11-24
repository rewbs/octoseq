// Ground: a picture made of nothing but arithmetic, laid under the scene wherever
// the scene is dark. Four kinds: a Julia set, marble, cells, a tunnel.

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

struct GroundUniforms {
    kind: f32,   // 1 Julia set, 2 marble, 3 cells, 4 tunnel
    zoom: f32,   // how much of the ground the frame takes in: larger shows more of it, smaller
    angle: f32,  // how far the ground is turned, in radians
    phase: f32,  // what the ground changes with: its colours travel, its cells drift, its tunnel is flown down
    p1: f32,     // Julia: the real part of its number. Marble: how far it is stirred. Cells: how wide the gaps are. Tunnel: panels round it
    p2: f32,     // Julia: the imaginary part. Marble: how many bands of colour. Cells: how far they wander. Tunnel: its twist
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

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

// The Julia set of z*z + c: each point is squared and added to, over and over,
// and coloured by how long it takes to fly off. Points that never do are left dark.
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
    // A fraction of a step taken off by how far past the edge it had got, so the
    // bands of colour run into one another and do not step.
    let smooth_steps = steps + 1.0 - log2(max(log2(dot(z, z)) * 0.5, 0.0001));
    let near = clamp(smooth_steps / 24.0, 0.0, 1.0);
    return paint(smooth_steps * 0.045 + params.phase) * (0.25 + 0.75 * sqrt(near));
}

// Marble: noise looked up at a place pushed about by noise, itself pushed about
// by noise. The veins are where that double push changes fastest.
fn marble(p: vec2<f32>) -> vec3<f32> {
    let t = params.phase;
    let first = vec2<f32>(layered(p + vec2<f32>(0.0, t * 0.31)), layered(p + vec2<f32>(5.2, 1.3 - t * 0.23)));
    let second = vec2<f32>(layered(p + params.p1 * first + vec2<f32>(1.7, 9.2)), layered(p + params.p1 * first + vec2<f32>(8.3, 2.8)));
    let height = layered(p + params.p1 * second);
    return paint(height * params.p2 + length(first) * 0.4 + t * 0.03) * (0.2 + 1.1 * height * height);
}

// Cells: one wandering point in every square of a grid; each place takes the
// colour of the point nearest it, darkening towards the border with the next.
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

// Tunnel: the frame read as the inside of a pipe seen end on. Distance from the
// middle is depth, the direction is the way round, and the wall is in panels.
fn tunnel(p: vec2<f32>) -> vec3<f32> {
    let r = length(p) + 0.0001;
    let depth = 0.6 / r + params.phase;
    let around = atan2(p.y, p.x) / 6.2831853 * max(params.p1, 1.0) + params.p2 * depth * 0.15;
    let ring = floor(depth);
    let panel = floor(around);
    let lit = abs(fract(ring * 0.5) * 2.0 - fract(panel * 0.5) * 2.0);
    // Each panel has a soft edge, and the far end of the pipe is dark.
    let edge = smoothstep(0.0, 0.08, fract(depth)) * smoothstep(0.0, 0.08, 1.0 - fract(depth)) * smoothstep(0.0, 0.06, fract(around)) * smoothstep(0.0, 0.06, 1.0 - fract(around));
    return paint(ring * 0.13 + panel * 0.21) * mix(0.3, 1.0, lit) * edge * smoothstep(0.02, 0.5, r);
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
    var ground: vec3<f32>;
    if (params.kind < 1.5) {
        ground = julia(p);
    } else if (params.kind < 2.5) {
        ground = marble(p);
    } else if (params.kind < 3.5) {
        ground = cells(p);
    } else {
        ground = tunnel(p);
    }
    // Under the scene: the ground shows where the scene is dark and gives way where it is bright.
    let covered = clamp(max(scene.r, max(scene.g, scene.b)) * 1.5, 0.0, 1.0);
    let colour = scene.rgb + clamp(ground, vec3<f32>(0.0), vec3<f32>(1.0)) * params.amount * (1.0 - covered);
    return vec4<f32>(colour, scene.a);
}
