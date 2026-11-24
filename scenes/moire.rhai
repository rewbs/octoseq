//! roles: hit, kick, snare, energy, bass

// MOIRE
// Two sets of thin rings, like the ripples from two stones dropped in a pond,
// drifting across each other. Where the sets cross, the eye makes a third pattern
// out of the crossings: broad curved bands that swing about far faster than either
// set of rings is moving. Nothing here is blurred; it is all fine line.
//
//   hit      the two sets jump apart and swing back
//   kick     the left set swells
//   snare    the right set swells
//   bass     how far apart the two centres sit
//   energy   how fast the sets drift round each other

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    // Short and sharp, for the scene's own movement. The whole frame's answer, at the end, has shapes of its own.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.125 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.7 * style.speed));

    let apart = bass.scale(0.8).add(hit.scale(0.9)).add(0.7);
    let sets = [scene.group(), scene.group()];
    let colours = [style.a, style.b];
    for s in 0..2 {
        for i in 0..14 {
            let ring = radial.ring(#{ radius: 0.3 + i * 0.36, thickness: 0.07, segments: 96 });
            sets[s].add(glow(ring, if i % 5 == 4 { style.c } else { colours[s] }, hit.scale(0.35).add(0.8)));
        }
        let side = if s == 0 { -1.0 } else { 1.0 };
        sets[s].position.x = clock.scale(0.7).sin().scale(0.6).add(apart).scale(side);
        sets[s].position.y = clock.scale(0.9).add(s * 1.5708).sin().scale(0.7 * side);
        sets[s].scale = if s == 0 { kick.scale(0.07).add(1.0) } else { snare.scale(0.07).add(1.0) };
        scene.add(sets[s]);
    }

    // Almost no trail: the pattern is in the lines, and a trail would fill it in.
    let fb = feedback.builder()
        .warp.affine(1.004, 0.0)
        .color.hsv(0.01, 0.0, 0.0)
        .color.decay(misted(0.78, style.mist, 0.7, 0.96))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.7, 0.5), intensity: misted(0.35, style.mist, 0.25, 0.7), radius: misted(4.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
