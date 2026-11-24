//! roles: hit, kick, energy, bass

// DUNES
// Three slow lights cross the frame, and the loop does to their trails what wind
// does to sand: it pushes the picture one way and sharpens its brightness against
// a blurred copy of itself each time round, so soft colour breaks into ridges and
// furrows that creep sideways. It looks like relief seen from above.
//
//   hit      the wind gusts and the ridges jump
//   kick     the lights swell
//   bass     how sharply the ridges are cut
//   energy   how fast the wind blows

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.7 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        // Thin rings, not discs: the wind should have an edge to work on, and
        // nothing solid should sit on top of the sand.
        let light = radial.ring(#{ radius: 0.7, thickness: 0.1, segments: 40 });
        light.position.x = clock.scale(0.31 + i * 0.09).add(i * 2.1).sin().scale(4.6);
        light.position.y = clock.scale(0.47 - i * 0.07).add(i * 1.3).sin().scale(2.6);
        light.scale = kick.scale(0.7).add(0.9);
        scene.add(glow(light, colours[i], hit.scale(0.3).add(0.55)));
    }

    // Pushed sideways and cut into ridges.
    let fb = feedback.builder()
        .warp.affine(1.003, 0.0, level.scale(0.004).add(hit.scale(0.012)).add(0.002).scale(style.speed), 0.0008)
        .warp.shear(clock.scale(0.5).sin().scale(0.004))
        .warp.waves(level.scale(0.8).add(0.5), 1.4, clock)
        .color.sharpen(bass.scale(0.3).add(hit.scale(0.2)).add(0.35), 0.03, 1.0)
        .color.hsv(0.0008, 0.0, 0.0)
        .color.decay(misted(0.972, style.mist, 0.88, 0.99))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.55), intensity: misted(0.4, style.mist, 0.25, 0.6), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
