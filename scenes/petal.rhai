//! roles: hit, kick, snare, energy, bass

// PETAL
// A flower opening for ever. A small ring in the middle is the only thing drawn;
// the loop carries it outwards faster in some directions than in others, so the
// ring is pulled into petals as it grows, and the next ring follows it out. The
// colours are let down with white: this one is pale where the others are neon.
//
//   hit      the flower bursts open and gains or loses a petal
//   kick     the ring thickens
//   snare    the ring jumps outwards
//   bass     the ring's size
//   energy   how fast the flower opens

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

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
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // Three thin rings, one inside the other, taking turns to be the bright one.
    let colours = [style.a, style.c, style.b];
    for i in 0..3 {
        let ring = radial.ring(#{ radius: 0.35 + i * 0.16, thickness: 0.07, segments: 64 });
        ring.scale = bass.scale(0.8).add(snare.scale(0.5)).add(kick.scale(0.25)).add(0.7);
        let turn = clock.scale(0.5).add(i * 2.0944).sin().scale(0.35).add(0.55);
        scene.add(glow(ring, colours[i], turn.add(hit.scale(0.35))));
    }

    // Outwards, by petals. How many changes with every hit: five, six or seven.
    let petals = hit.integrate(0.0).scale(0.9).sin().scale(1.0).add(6.0).round();
    let fb = feedback.builder()
        .warp.petals(level.scale(0.03).add(hit.scale(0.07)).add(0.03), petals, clock.scale(0.6))
        .warp.affine(level.scale(0.012).add(hit.scale(0.04)).add(1.012), 0.004 * style.speed)
        .color.hsv(0.005, -0.004, 0.0)
        .color.decay(misted(0.972, style.mist, 0.87, 0.99))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Pale: colour pulled towards white, and a wide soft glow.
    post.add(fx.colorGrade(#{ saturation: 0.6 }));
    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.7, 0.4), intensity: misted(0.8, style.mist, 0.35, 0.9), radius: misted(12.0, style.mist, 5.0, 14.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
