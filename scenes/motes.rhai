//! roles: hit, kick, snare, energy

// MOTES
// Dust in a beam of light. Several hundred specks hang in a slab of space that
// turns slowly in front of the eye; the near ones cross the frame quickly and the
// far ones hardly move, so the eye reads depth without being shown any. The drums
// do not move the dust: they change how big each speck is, so the whole cloud
// blinks.
//
//   hit      the eye is pushed through the cloud
//   kick     the warm specks swell
//   snare    the cool specks swell
//   energy   how fast the cloud turns

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// A colour at a brightness that is a signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.5 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.15 * style.speed).add(level.integrate(0.0).scale(0.35 * style.speed));

    let dust = scene.group();
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let cloud = points.cloud(#{ count: 320, spread: 4.5, mode: "uniform", seed: 11 + i * 17, point_size: 3.0 });
        cloud.point_size = if i == 0 { kick.scale(7.0).add(2.5) } else if i == 1 { snare.scale(7.0).add(2.5) } else { level.scale(2.0).add(2.0) };
        cloud.color = tint(colours[i], hit.scale(0.4).add(1.1));
        dust.add(cloud);
    }
    dust.rotation.y = clock;
    dust.rotation.x = clock.scale(0.6).sin().scale(0.4);
    dust.position.z = hit.scale(1.6);
    scene.add(dust);

    // Hardly any trail: enough that a speck is a short stroke, not a dot.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.025).add(1.004), 0.0)
        .warp.waves(level.scale(1.0).add(0.6), 1.0, clock.scale(2.0))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.86, style.mist, 0.78, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.35, style.mist, 0.45, 0.3), intensity: misted(1.0, style.mist, 0.7, 1.1), radius: misted(6.0, style.mist, 4.0, 10.0) }));
}
