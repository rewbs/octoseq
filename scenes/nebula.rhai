//! roles: hit, onset, energy, bass, melody

// NEBULA
// Gas between the stars. Four dim lights turn slowly round each other, and the
// loop winds what they leave into long curls that take most of a minute to
// fade, so the frame fills with glowing cloud in their colours; a scatter of
// hard white points sits in front of it. It is the slowest scene in the pool,
// and the one with the least black.
//
//   hit      a shock passes through the cloud
//   onset    the stars twinkle
//   bass     how big the lights behind the cloud are
//   melody   how hard the cloud is stirred
//   energy   how fast the lights turn

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.2 });
    let twinkle = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let swell = roles.bass.smooth.exponential(0.05, 0.5).scale(0.7).add(0.8);
    let stir = roles.melody.smooth.exponential(0.1, 0.5);
    let clock = timing.time.scale(0.12 * style.speed).add(level.integrate(0.0).scale(0.3 * style.speed));

    // The lights are rings, not discs: nothing solid should show through the cloud.
    let colours = [style.a, style.b, style.c, style.a];
    for i in 0..4 {
        let light = radial.ring(#{ radius: 0.5, thickness: 0.22, segments: 32 });
        let angle = clock.scale(0.7).add(i * 1.5708);
        let reach = clock.scale(0.5).add(i * 2.0).sin().scale(1.2).add(2.4);
        light.position.x = angle.sin().scale(reach).scale(1.6);
        light.position.y = angle.add(1.5708).sin().scale(reach).scale(0.8);
        light.scale = swell;
        scene.add(glow(light, colours[i], hit.scale(0.2).add(0.45)));
    }

    let stars = points.cloud(#{ count: 140, spread: 6.5, mode: "uniform", seed: 21, point_size: 2.0 });
    stars.rotation.z = clock.scale(0.15);
    stars.point_size = twinkle.scale(2.5).add(1.8);
    stars.color = #{ r: 1.0, g: 0.98, b: 0.94, a: 1.0 };
    scene.add(stars);

    // Wound into curls, very slow to fade, and softened every time round: a
    // sharpening turned backwards is a blur, and a blur in the loop is what
    // spreads a trail into gas.
    let fb = feedback.builder()
        .warp.flow(stir.scale(2.5).add(hit.scale(4.0)).add(1.2).scale(0.3), 2.5, clock.scale(0.6))
        .warp.spiral(0.3 * style.speed, 0.006)
        .warp.affine(hit.scale(0.02).add(1.003), 0.0)
        .color.sharpen(-0.7, 0.02)
        .color.hsv(0.0015, 0.0, 0.0)
        .color.decay(misted(0.99, style.mist, 0.94, 0.996))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.35, style.mist, 0.6, 0.3), intensity: misted(1.0, style.mist, 0.45, 1.1), radius: misted(16.0, style.mist, 7.0, 20.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
