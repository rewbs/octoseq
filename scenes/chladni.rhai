//! roles: hit, brightness, melody, lead, energy

// CHLADNI
// Acoustic Chladni standing-wave nodal figures glowing like sand resonating
// on a vibrating brass plate. Directly maps pitch brightness and melody to the
// harmonic mode numbers (n, m), making subtle pitch shifts visibly morph the pattern.
//
//   hit         steps the plate into a new harmonic mode pair
//   brightness  drives the primary standing-wave harmonic number n
//   melody      drives the cross-harmonic number m and wave amplitude
//   lead        illuminates the resonant ring over the plate
//   energy      gently drifts the standing wave phase

let style = #{ a: [0.95, 0.48, 0.22], b: [0.14, 0.72, 0.68], c: [0.88, 0.84, 0.72], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let bright = roles.brightness.smooth.exponential(0.06, 0.4);
    let melody = roles.melody.smooth.exponential(0.06, 0.4);
    let lead = roles.lead.smooth.exponential(0.05, 0.35);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.24 * style.speed).add(level.integrate(0.0).scale(0.55 * style.speed));

    let ring = radial.wave(lead, #{ base_radius: 2.1, amplitude: 0.48, wave_frequency: 6, resolution: 180 });
    ring.rotation.z = clock.scale(0.22);
    ring.color = tint(style.c, hit.scale(0.5).add(lead.scale(0.45)).add(0.6));
    scene.add(ring);

    let rim = radial.ring(#{ radius: 2.6, thickness: 0.06, segments: 96 });
    rim.scale = melody.scale(0.25).add(0.92);
    scene.add(glow(rim, style.a, hit.scale(0.45).add(0.75)));

    let fb = feedback.builder()
        .warp.affine(0.99, 0.003 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.78, 0.97))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 0.98), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    let mode_shift = count.scale(1.1).sin().scale(1.6);
    post.add(fx.ground(#{ kind: 18, zoom: 1.5, angle: clock.scale(0.07), phase: clock.scale(0.75).add(count.scale(0.25)), p1: bright.scale(4.0).add(mode_shift).add(3.0).clamp(1.5, 8.5), p2: melody.scale(3.5).sub(mode_shift).add(4.2).clamp(2.0, 9.5), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
