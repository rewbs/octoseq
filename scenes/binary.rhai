//! roles: hit, kick, snare, energy, bass

// BINARY
// Two stars in orbit about each other, seen a little from above, with three small
// bodies circling the pair on tilted paths of their own. The orbits are real:
// each body passes in front of the stars and then behind them, growing and
// shrinking as it comes and goes. The loop keeps a fading record of where each
// has been, so every orbit is drawn as a closed curve of light.
//
//   hit      the two stars swing wide apart and fall back together
//   kick     the first star swells
//   snare    the second star swells
//   bass     how far apart the stars sit
//   energy   how fast everything orbits

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.7, easing: "quadratic_out" });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.6 * style.speed).add(level.integrate(0.0).scale(1.5 * style.speed));

    // Everything orbits in one tilted plane; the group is the plane.
    let plane = scene.group();
    plane.rotation.x = 1.1;
    plane.rotation.z = clock.scale(0.05).sin().scale(0.3);

    let apart = bass.scale(0.6).add(hit.scale(1.3)).add(1.0);
    for i in 0..2 {
        let star = mesh.sphere();
        let angle = clock.add(i * 3.14159);
        star.position.x = angle.sin().scale(apart);
        star.position.y = angle.add(1.5708).sin().scale(apart);
        star.scale = if i == 0 { kick.scale(0.25).add(0.6) } else { snare.scale(0.25).add(0.5) };
        plane.add(glow(star, if i == 0 { style.a } else { style.b }, hit.scale(0.8).add(1.6)));
    }
    for i in 0..3 {
        let body = mesh.sphere();
        // Further out is slower, as it is for real orbits.
        let reach = 2.8 + i * 1.1;
        let angle = clock.scale(0.75 - i * 0.2).add(i * 2.1);
        body.position.x = angle.sin().scale(reach);
        body.position.y = angle.add(1.5708).sin().scale(reach);
        body.position.z = angle.add(i * 1.0).sin().scale(0.5 + i * 0.3);
        body.scale = 0.22;
        plane.add(glow(body, style.c, hit.scale(0.5).add(1.3)));
    }
    scene.add(plane);

    // The page keeps what crosses it, and gives it up slowly.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.015).add(1.0015), 0.0)
        .warp.waves(level.scale(0.6).add(0.3), 0.8, clock.scale(0.3))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.98, style.mist, 0.962, 0.993))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.45, 0.35), intensity: misted(0.9, style.mist, 0.7, 1.0), radius: misted(9.0, style.mist, 6.0, 12.0) }));
}
