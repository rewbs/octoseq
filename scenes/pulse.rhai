//! roles: hit, kick, snare, hat, energy, bass

// PULSE
// Rings thrown outwards from the centre. Every hit punches a thick ring open and
// kicks the whole picture forward, so the trails fly at the viewer; between hits
// they hang, barely drifting, and fade to black.
//
//   hit      the core ring bursts open and the picture lurches forward
//   kick     the core jumps
//   snare    a thin shock ring cracks out across the frame
//   hat      ticks around the rim
//   bass     how fat the core is
//   energy   how far the wave reaches

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0 }; // @style

// Light a shape in one colour at a brightness that can be a signal.
fn glow(entity, c, level) {
    entity.material = "emissive";
    entity.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    entity.materialParams.emission_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.emission_intensity = level;
    entity
}

// The same for a line, whose colour is set directly.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    camera.position = #{ x: 0.0, y: 0.0, z: 6.5 };
    camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

    // Instant attacks: a shape is at full size on the frame the hit lands.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.5 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);

    let core = radial.ring(#{ radius: 0.4, thickness: 0.22, segments: 96 });
    core.scale = hit.scale(1.8).add(kick.scale(0.4)).add(bass.scale(0.3)).add(0.45);
    scene.add(glow(core, style.a, hit.scale(0.6).add(0.55)));

    let shock = radial.ring(#{ radius: 1.0, thickness: 0.05, segments: 128 });
    shock.scale = snare.scale(2.4).add(0.6);
    scene.add(glow(shock, style.c, hit.scale(0.5).add(0.5)));

    let wave = radial.wave(level, #{ base_radius: 1.5, amplitude: 0.5, wave_frequency: 7, resolution: 192 });
    wave.rotation.z = timing.time.scale(0.35 * style.speed);
    wave.color = tint(style.b, level.scale(0.6).add(0.4));
    scene.add(wave);

    // Twelve short arcs round the rim, lit by the hi-hats.
    for i in 0..12 {
        let a = i * 0.5236;
        let tick = radial.ring(#{ radius: 2.7, thickness: 0.14, start_angle: a, end_angle: a + 0.22, segments: 8 });
        tick.rotation.z = timing.time.scale(-0.2 * style.speed);
        tick.scale = hat.scale(0.12).add(1.0);
        scene.add(glow(tick, style.c, 0.7));
    }

    // The loop: the last frame comes back larger and dimmer, and lurches on a hit.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.1).add(1.006), 0.002 * style.speed)
        .color.decay(0.9)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: 0.55, intensity: 0.7, radius: 10.0 }));
}
