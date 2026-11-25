//! roles: hit, lead, brightness, melody, energy

// PLASMAVEIL
// Smooth demoscene wave-interference plasma that drifts and bends with the
// timbre and melody of the track. Designed for flowing melodic passages where
// subtle pitch brightness and sustained lead phrases shape the liquid colour.
//
//   hit         steps the plasma's chromatic phase forward
//   lead        swells the ribbon wave and foreground halos
//   brightness  raises the plasma's harmonic frequency and shimmer
//   melody      stirs the polar twist of the interference field
//   energy      controls the drift pace

let style = #{ a: [0.95, 0.18, 0.82], b: [0.15, 0.95, 0.92], c: [1.0, 0.52, 0.1], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// Light a shape in one colour at a brightness that can be a signal.
fn glow(entity, c, level) {
    entity.material = "emissive";
    entity.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    entity.materialParams.emission_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.emission_intensity = level;
    entity
}

// Colour a line or point cloud directly from a palette colour and brightness signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let lead = roles.lead.smooth.exponential(0.06, 0.45);
    let bright = roles.brightness.smooth.exponential(0.08, 0.5);
    let melody = roles.melody.smooth.exponential(0.06, 0.45);
    let level = roles.energy.smooth.exponential(0.08, 0.5);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.22 * style.speed).add(level.integrate(0.0).scale(0.55 * style.speed));

    let wave = radial.wave(lead, #{ base_radius: 1.8, amplitude: 0.55, wave_frequency: 4, resolution: 160 });
    wave.rotation.z = clock.scale(0.3);
    wave.color = tint(style.a, hit.scale(0.4).add(lead.scale(0.5)).add(0.65));
    scene.add(wave);

    let wave2 = radial.wave(melody, #{ base_radius: 2.7, amplitude: 0.45, wave_frequency: 6, resolution: 160 });
    wave2.rotation.z = clock.scale(-0.22);
    wave2.color = tint(style.b, bright.scale(0.6).add(0.55));
    scene.add(wave2);

    let fb = feedback.builder()
        .warp.flow(melody.scale(1.4).add(0.6), 2.2, clock.scale(0.5))
        .warp.affine(0.992, 0.003 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.92, style.mist, 0.82, 0.978))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.62, 0.38), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    post.add(fx.ground(#{ kind: 6, zoom: 1.5, angle: clock.scale(0.08).add(bright.scale(0.4)), phase: clock.scale(0.9).add(count.scale(0.45)), p1: bright.scale(1.8).add(1.3), p2: melody.scale(1.2).add(0.7), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
