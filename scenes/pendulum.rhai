//! roles: hit, melody, brightness, lead, energy

// PENDULUM
// Fifteen harmonic pendulum lights swinging in a phase-graded row, weaving
// hypnotic traveling sine waves and braided interference arcs. Made for
// melodic, rhythmic-light passages where pitch brightness tunes the wave.
//
//   hit         pulses every pendulum bob and shifts the wave's colour
//   melody      widens the pendulum swing amplitude
//   brightness  increases the phase spread between neighbouring bobs
//   lead        swells the glowing bobs
//   energy      controls the pendulums' natural frequency

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

fn init(ctx) {
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let melody = roles.melody.smooth.exponential(0.06, 0.42);
    let bright = roles.brightness.smooth.exponential(0.08, 0.5);
    let lead = roles.lead.smooth.exponential(0.05, 0.38);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..15 {
        let bob = radial.ring(#{ radius: 0.2, thickness: 0.32, segments: 24 });
        let frac = (i - 7.0) / 7.0;
        let phase = clock.scale(1.0 + i * 0.085).add(bright.scale(i * 0.22));
        bob.position.x = frac * 4.9;
        bob.position.y = phase.sin().scale(melody.scale(1.5).add(1.35));
        bob.scale = lead.scale(0.9).add(hit.scale(0.5)).add(0.65);
        scene.add(glow(bob, colours[i % 3], hit.scale(0.6).add(1.0)));
    }

    let fb = feedback.builder()
        .warp.flow(melody.scale(1.3).add(0.5), 2.4, clock.scale(0.4))
        .warp.affine(0.992, 0.004 * style.speed)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.87, 0.988))
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
