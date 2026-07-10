export const DEFAULT_SCRIPT = `// Neon Reactor
// Energy drives scale and camera movement, onsets punch the core and ring,
// while spectral flux adds motion and colour variation.

let energy = inputs.mix.energy
    .smooth.moving_average(0.22)
    .scale(12.0)
    .clamp(0.0, 1.0);

let onset = inputs.mix.onset
    .smooth.exponential(0.08, 0.45)
    .scale(8.0)
    .clamp(0.0, 1.0);

let flux = inputs.mix.flux
    .smooth.exponential(0.12, 0.35)
    .scale(5.0)
    .clamp(0.0, 1.0);

let core = mesh.cube();
core.material = "wire_glow";
core.scale = energy.scale(1.5).add(0.7);
core.rotation.x = timing.time.scale(0.35);
core.rotation.y = timing.time.scale(-0.55);
core.position.z = sin(timing.time.scale(0.7)).scale(0.25);
core.color.r = onset.scale(0.7).add(0.2);
core.color.g = energy.scale(0.65).add(0.15);
core.color.b = flux.scale(0.45).add(0.55);
core.emissive = onset.scale(2.0).add(0.4);

let ring = radial.ring(#{
    radius: onset.scale(0.75).add(2.0),
    thickness: energy.scale(0.22).add(0.05),
    segments: 128
});
ring.material = "emissive";
ring.rotation.z = timing.time.scale(-0.18);
ring.color.r = flux.scale(0.5).add(0.3);
ring.color.g = onset.scale(0.55).add(0.25);
ring.color.b = energy.scale(0.35).add(0.65);
ring.emissive = onset.scale(1.5).add(0.35);

let wave = radial.wave(energy, #{
    base_radius: 2.75,
    amplitude: energy.scale(1.1).add(0.15),
    wave_frequency: 10.0,
    resolution: 192
});
wave.rotation.z = timing.time.scale(0.12);
wave.color.r = energy.scale(0.45).add(0.2);
wave.color.g = flux.scale(0.6).add(0.25);
wave.color.b = onset.scale(0.35).add(0.65);
wave.color.a = energy.scale(0.5).add(0.35);

let stars = points.cloud(#{
    count: 420,
    spread: 9.0,
    mode: "sphere",
    seed: 23,
    point_size: 2.0
});
stars.rotation.x = timing.time.scale(0.025);
stars.rotation.y = timing.time.scale(-0.04);
stars.scale = energy.scale(0.08).add(1.0);
stars.color.r = flux.scale(0.45).add(0.35);
stars.color.g = energy.scale(0.35).add(0.45);
stars.color.b = onset.scale(0.25).add(0.75);
stars.color.a = energy.scale(0.45).add(0.2);

camera.orbit(
    #{ x: 0.0, y: onset.scale(0.3), z: 0.0 },
    energy.scale(-0.8).add(6.0),
    timing.time.scale(0.08)
);

let bloom = fx.bloom(#{
    threshold: 0.35,
    intensity: onset.scale(0.6).add(0.25),
    radius: 7.0
});

let trails = feedback.builder()
    .warp.spiral(flux.scale(0.12), onset.scale(0.01), 1.002)
    .color.decay(0.94)
    .color.hsv(flux.scale(0.015), 0.0, -0.01)
    .blend.add()
    .opacity(energy.scale(0.2).add(0.24))
    .build();

fn init(ctx) {
    scene.add(stars);
    scene.add(wave);
    scene.add(ring);
    scene.add(core);
    post.add(bloom);
    feedback.enable(trails);
}

fn update(dt, frame) {
}`;

export const BASIC_AUDIO_SCRIPT = `let cube = mesh.cube();

let smoothAmp = inputs.mix.energy.smooth.moving_average(0.5).scale(20);
let smoothOnsets = inputs.mix.onset.smooth.exponential(0.1, 0.5).scale(10);

cube.rotation.x = smoothAmp;
cube.scale = smoothOnsets;
cube.rotation.y = sin(timing.time);
camera.lookAt(#{x:gen.perlin(4, 40), y:gen.perlin(2, 41), z:gen.perlin(8, 42)});


let bloom = fx.bloom(#{
  intensity: smoothOnsets.sigmoid(10).scale(10).add(1.0) ,
  threshold: 0.7});

let fb = feedback.builder()
    .warp.spiral(sin(timing.beatPosition), 1, 0.1)
    .opacity(0.4)
    .blend.difference()
    .build();

fn init(ctx) {
    scene.add(cube);
    post.add(bloom);
    feedback.enable(fb);
}

fn update(dt, frame) {
}`;

const NEON_REACTOR_MARKER = "// Neon Reactor\n";
const LEGACY_NEON_REACTOR_WAVE =
  "let wave = radial.wave(inputs.mix.rms.smooth.moving_average(0.1), #{";
const NEON_REACTOR_WAVE = "let wave = radial.wave(energy, #{";

/** Upgrade only the short-lived starter that referenced an unavailable RMS signal. */
export function migrateDefaultScript(content: string): string {
  if (!content.startsWith(NEON_REACTOR_MARKER)) return content;
  return content.replace(LEGACY_NEON_REACTOR_WAVE, NEON_REACTOR_WAVE);
}
