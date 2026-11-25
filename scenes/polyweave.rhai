//! roles: hit, melody, bass, brightness, lead, energy

// POLYWEAVE
// Inspired by Milkdrop's Waveform/Wire Flower family: three interlocking
// radial wave blossoms spinning in opposite directions through a petal warp,
// opening with the lead voice and shifting symmetry with pitch brightness.
//
//   hit         snaps the flower's petal phase and blooms it wide
//   melody      drives the outer blossom's petals
//   bass        swells the inner calyx
//   brightness  spins the petal warp faster
//   lead        controls the middle blossom's amplitude
//   energy      sets the overall rotation pace

let style = #{ a: [1.0, 0.55, 0.72], b: [0.18, 0.78, 0.72], c: [1.0, 0.86, 0.38], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let melody = roles.melody.smooth.exponential(0.05, 0.35);
    let bass = roles.bass.smooth.exponential(0.04, 0.32);
    let bright = roles.brightness.smooth.exponential(0.06, 0.42);
    let lead = roles.lead.smooth.exponential(0.04, 0.35);
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.35 * style.speed).add(level.integrate(0.0).scale(0.85 * style.speed));

    let calyx = radial.wave(bass, #{ base_radius: 1.0, amplitude: 0.48, wave_frequency: 4, resolution: 160 });
    calyx.rotation.z = clock.scale(0.6).add(count.scale(0.5236));
    calyx.color = tint(style.a, hit.scale(0.6).add(0.95));
    scene.add(calyx);

    let mid = radial.wave(lead, #{ base_radius: 1.9, amplitude: 0.65, wave_frequency: 6, resolution: 192 });
    mid.rotation.z = clock.scale(-0.45);
    mid.color = tint(style.b, hit.scale(0.55).add(0.9));
    scene.add(mid);

    let outer = radial.wave(melody, #{ base_radius: 2.8, amplitude: 0.55, wave_frequency: 9, resolution: 192 });
    outer.rotation.z = clock.scale(0.3);
    outer.color = tint(style.c, bright.scale(0.5).add(0.8));
    scene.add(outer);

    let core = radial.ring(#{ radius: 0.25, thickness: 0.3, segments: 32 });
    core.scale = bass.scale(0.9).add(hit.scale(0.5)).add(0.6);
    scene.add(glow(core, style.c, hit.scale(0.6).add(0.95)));

    let fb = feedback.builder()
        .warp.petals(lead.scale(0.018).add(hit.scale(0.025)).add(0.008), 6.0, clock.scale(0.5).add(bright.scale(1.5)))
        .warp.affine(hit.scale(0.04).add(1.008), 0.005 * style.speed)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.945, style.mist, 0.85, 0.986))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.78, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
