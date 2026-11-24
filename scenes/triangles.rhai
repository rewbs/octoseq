//! roles: hit, kick, snare, hat, energy

// TRIANGLES
// Five triangles, one inside another, each turning at its own pace and the
// smallest fastest, so their corners pass each other like the hands of a clock
// with five hands. The loop spins their trails outwards into a pinwheel of
// straight edges. Every colour is at full strength.
//
//   hit      all five snap to the same angle, then drift apart again
//   kick     the big triangles jump in size
//   snare    the small triangles jump in size
//   hat      the trails shiver
//   energy   how fast they turn

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));
    // 1 while a hit rings, 0 otherwise: it pulls every triangle's angle to nothing.
    let free = hit.scale(-1.0).add(1.0).clamp(0.0, 1.0);

    let colours = [style.a, style.c, style.b, style.a, style.c];
    for i in 0..5 {
        let size = 3.4 - i * 0.62;
        let triangle = radial.ring(#{ radius: size, thickness: 0.2 - i * 0.02, segments: 3 });
        let pace = if i % 2 == 0 { 0.25 + i * 0.22 } else { -0.3 - i * 0.2 };
        triangle.rotation.z = clock.scale(pace).sin().scale(2.6).scale(free).add(1.5708);
        triangle.scale = if i < 2 { kick.scale(0.16).add(1.0) } else { snare.scale(0.22).add(1.0) };
        scene.add(glow(triangle, colours[i], hit.scale(0.45).add(0.85)));
    }

    // Spun outwards.
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.04).add(1.016), level.scale(0.02).add(0.012).scale(style.speed))
        .warp.shear(hat.scale(0.008))
        .warp.slices(level.scale(1.2).add(0.8).scale(0.6), 6.0, count.scale(1.0472))
        .color.hsv(0.008, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.colorGrade(#{ saturation: 1.3, contrast: 1.1 }));
    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.5), intensity: misted(0.6, style.mist, 0.35, 0.8), radius: misted(8.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
