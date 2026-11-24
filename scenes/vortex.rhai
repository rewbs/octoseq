//! roles: hit, kick, snare, energy, beat

// VORTEX
// A ring grows from the middle to the edge of the frame on every beat, and two
// arms sweep round it. The loop turns the whole picture about the middle, faster
// near the centre than at the rim, so the rings are wrung into a spiral and the
// arms into hooks. Two colours do nearly all of it; the third only marks the beat.
//
//   hit      the vortex is wrung hard the other way for a moment
//   kick     the arms thicken
//   snare    the arms jump outwards
//   beat     a ring leaves the middle
//   energy   how fast the vortex turns

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    // The beat's ring: from nothing to past the corners in one beat.
    let through = roles.beat.beat_phase_between();
    let ring = radial.ring(#{ radius: 1.0, thickness: 0.035, segments: 96 });
    ring.scale = through.scale(7.5).add(0.05);
    scene.add(glow(ring, style.c, hit.scale(0.25).add(0.45)));

    // Two arms, opposite each other.
    for i in 0..2 {
        let arm = radial.ring(#{ radius: 1.7, thickness: 0.5, start_angle: 0.0, end_angle: 0.9, segments: 32 });
        arm.rotation.z = clock.scale(0.7).add(i * 3.14159);
        arm.scale = snare.scale(0.5).add(kick.scale(0.2)).add(1.0);
        scene.add(glow(arm, if i == 0 { style.a } else { style.b }, hit.scale(0.4).add(0.7)));
    }

    // Turned about the middle, and wrung: the spiral warp turns the centre more.
    let wring = level.scale(0.5).add(0.5).sub(hit.scale(1.6)).scale(style.speed);
    let fb = feedback.builder()
        .warp.spiral(wring, 0.02)
        .warp.affine(hit.scale(0.03).add(1.004), 0.0)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.5), intensity: misted(0.6, style.mist, 0.35, 0.8), radius: misted(8.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
