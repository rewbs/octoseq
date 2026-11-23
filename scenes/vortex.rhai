//! roles: kick, snare, hat, energy, bass, section_progress, section_intensity

// VORTEX
// Everything drawn here is drawn into the feedback loop: the previous frame is the
// background, slowly turning and opening outwards, so each shape leaves a trail that
// the loop carries to the edge of the frame. Motion comes from time; the music
// pushes it around.
//
//   kick     the core ring jumps open
//   snare    a wide ring flashes
//   hat      the satellites flare
//   bass     the core swells
//   energy   how fast the loop opens and how far the wave reaches
//   section  the palette drifts through each section, brighter in the loud ones

let core = radial.ring(#{ radius: 0.5, thickness: 0.16, segments: 96 });
let flash = radial.ring(#{ radius: 1.6, thickness: 0.08, segments: 128 });
let wave = ();
let satellites = [];

fn init(ctx) {
    // Face the picture square on.
    camera.position = #{ x: 0.0, y: 0.0, z: 6.5 };
    camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

    // Bell-shaped envelopes centred on each hit: the whole track is known, so a shape
    // can start swelling before the hit lands and peak exactly on it.
    let kick = roles.kick.to_signal(#{ envelope: "gaussian", width_beats: 0.7, overlap_mode: "max" });
    let snare = roles.snare.to_signal(#{ envelope: "gaussian", width_beats: 0.5, overlap_mode: "max" });
    let hat = roles.hat.to_signal(#{ envelope: "gaussian", width_beats: 0.3, overlap_mode: "max" });
    let level = roles.energy.smooth.exponential(0.08, 0.5);
    let turn = timing.time;

    // Palette: one hue that drifts across a section, brighter in louder sections.
    let drift = roles.section_progress.scale(0.6).add(turn.scale(0.02));
    let warm = drift.scale(6.2832).sin().scale(0.5).add(0.5);
    let cool = drift.scale(6.2832).add(2.1).sin().scale(0.5).add(0.5);
    let lift = roles.section_intensity.scale(0.5).add(0.5);

    core.scale = kick.scale(0.9).add(roles.bass.smooth.exponential(0.05, 0.4).scale(0.5)).add(0.7);
    core.rotation.z = turn.scale(0.3);
    core.color = #{ r: warm.scale(0.7).add(0.3).mul(lift), g: 0.35, b: cool.scale(0.7).add(0.3).mul(lift), a: 1.0 };
    scene.add(core);

    flash.scale = snare.scale(0.5).add(0.8);
    flash.color = #{ r: 0.9, g: 0.95, b: 1.0, a: snare };
    scene.add(flash);

    wave = radial.wave(level, #{ base_radius: 1.1, amplitude: 0.5, wave_frequency: 5, resolution: 160 });
    wave.rotation.z = turn.scale(-0.2);
    wave.color = #{ r: cool.scale(0.6).add(0.2), g: warm.scale(0.5).add(0.3), b: 0.9, a: 0.9 };
    scene.add(wave);

    // Six small rings in orbit, each a sixth of a turn behind the last.
    for i in 0..6 {
        let dot = radial.ring(#{ radius: 0.1, thickness: 0.1, segments: 32 });
        let angle = turn.scale(0.7).add(i * 1.0472);
        let reach = turn.scale(0.9).add(i * 1.0).sin().scale(0.3).add(2.0);
        dot.position.x = angle.cos().mul(reach);
        dot.position.y = angle.sin().mul(reach);
        dot.scale = hat.scale(1.6).add(0.6);
        dot.color = #{ r: 1.0, g: warm.scale(0.5).add(0.4), b: cool.scale(0.6).add(0.2), a: 1.0 };
        satellites.push(dot);
        scene.add(dot);
    }

    // The loop: each frame the last one comes back a little larger, a little turned,
    // a little dimmer and a shade further round the colour wheel.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.010).add(1.010), level.scale(0.006).add(0.004))
        .color.decay(0.989)
        .color.hsv(0.004, 0.0, 0.0)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: 0.6, intensity: 0.5, radius: 8.0 }));
}
