//! roles: hit, kick, snare, energy, bass

// BOKEH
// City lights out of focus. Eighteen discs of plain colour hang at different
// depths, the near ones large and dim and the far ones small and bright, and
// drift; every hit throws them all outwards from the middle, the near ones
// furthest, and they float back. They overlap like cut paper. No trails to speak
// of: the picture is the discs.
//
//   hit      the lights burst outwards and float back
//   kick     the near lights swell
//   snare    the far lights swell
//   bass     how widely the lights are spread
//   energy   how fast they drift

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.225, easing: "quadratic_out" });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.6 * style.speed));

    // Far lights are made first, so that near ones are drawn over them.
    let colours = [style.a, style.b, style.c];
    for i in 0..18 {
        let layer = i / 6;
        let near = layer == 2;
        let light = radial.ring(#{ radius: 0.2 + layer * 0.22, thickness: 0.4 + layer * 0.44, segments: 40 });
        // Each has a home, a turn of the golden angle on from the last, and wanders about it.
        let home = i * 2.39996;
        let far = 1.0 + (i % 6) * 0.75;
        let spread = bass.scale(0.3).add(hit.scale(0.35 + layer * 0.35)).add(0.85);
        light.position.x = clock.scale(0.5 + (i % 4) * 0.13).add(i * 1.3).sin().scale(0.6).add(home.cos() * far * 1.5).scale(spread);
        light.position.y = clock.scale(0.6 - (i % 3) * 0.11).add(i * 2.1).sin().scale(0.45).add(home.sin() * far * 0.8).scale(spread);
        light.position.z = layer * 1.2 - 2.4;
        light.scale = if near { kick.scale(0.18).add(1.0) } else { snare.scale(0.18).add(1.0) };
        scene.add(glow(light, colours[i % 3], hit.scale(0.2).add(0.85 - layer * 0.2)));
    }

    // A breath of trail, drifting outwards: each disc has a soft shadow of itself.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.02).add(1.008), 0.0)
        .color.hsv(0.004 * style.speed, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.75, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.35), intensity: misted(0.6, style.mist, 0.3, 0.9), radius: misted(10.0, style.mist, 5.0, 16.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
