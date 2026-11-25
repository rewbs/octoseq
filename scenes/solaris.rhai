//! roles: hit, bass, brightness, lead, energy

// SOLARIS
// Inspired by Milkdrop's Supernova/Gas family: a radiant solar corona of
// undulating radial waves and orbiting prominence rings spilling soft glowing
// plasma outward. Warm and fluid for atmospheric or bass-heavy passages.
//
//   hit         flares the solar corona outward
//   bass        swells the molten sun core
//   brightness  raises the prominence ripple energy
//   lead        expands the undulating corona waves
//   energy      sets the solar wind's speed

let style = #{ a: [1.0, 0.72, 0.08], b: [0.95, 0.18, 0.12], c: [0.18, 0.48, 1.0], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let bass = roles.bass.smooth.exponential(0.04, 0.38);
    let bright = roles.brightness.smooth.exponential(0.07, 0.48);
    let lead = roles.lead.smooth.exponential(0.05, 0.4);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let clock = timing.time.scale(0.28 * style.speed).add(level.integrate(0.0).scale(0.65 * style.speed));

    let core = radial.ring(#{ radius: 0.55, thickness: 0.55, segments: 64 });
    core.scale = bass.scale(1.1).add(hit.scale(0.5)).add(0.65);
    scene.add(glow(core, style.a, hit.scale(0.6).add(0.95)));

    let w1 = radial.wave(lead, #{ base_radius: 1.7, amplitude: 0.65, wave_frequency: 7, resolution: 180 });
    w1.rotation.z = clock.scale(0.35);
    w1.color = tint(style.b, hit.scale(0.5).add(0.85));
    scene.add(w1);

    let w2 = radial.wave(bright, #{ base_radius: 2.5, amplitude: 0.5, wave_frequency: 11, resolution: 180 });
    w2.rotation.z = clock.scale(-0.25);
    w2.color = tint(style.c, lead.scale(0.5).add(0.7));
    scene.add(w2);

    let sparks = points.cloud(#{ count: 120, spread: 5.5, mode: "uniform", seed: 55, point_size: 2.2 });
    sparks.rotation.z = clock.scale(0.18);
    sparks.point_size = bright.scale(2.2).add(1.8);
    sparks.color = tint(style.a, hit.scale(0.5).add(0.85));
    scene.add(sparks);

    let fb = feedback.builder()
        .warp.spiral(0.28 * style.speed, 0.008)
        .warp.affine(hit.scale(0.045).add(1.012), 0.004 * style.speed)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.42, style.mist, 0.6, 0.32), intensity: misted(0.85, style.mist, 0.45, 1.1), radius: misted(12.0, style.mist, 5.0, 16.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
