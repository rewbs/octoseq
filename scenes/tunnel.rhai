//! roles: hit, kick, energy, melody, beat

// TUNNEL
// Falling down a well whose wall is made of the music. One wavering ring in the
// middle is all that is drawn, bent by the melody; the loop throws it outwards
// hard, so each ring becomes the wall a moment later and the next one follows
// it. A loud note bulges the wall, and the bulge travels up the tunnel past the
// eye. The ring changes colour on the beat, so the wall is banded.
//
//   hit      the fall speeds up: the wall rushes past and twists
//   kick     the ring swells
//   melody   how far the ring is bent out of round
//   beat     the ring takes the next colour
//   energy   how fast the fall is

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// A line's colour at a brightness that is a signal.
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

    // Short and sharp, for the scene's own movement. The whole frame's answer, at the end, has shapes of its own.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bend = roles.melody.smooth.exponential(0.02, 0.2);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // Three rings share the middle and take the beats in turn: each is there for
    // one beat in three and gone for the other two.
    let beats = roles.beat.count_prev_beats(100000.0);
    let colours = [style.a, style.b, style.c];
    let lobes = [5, 7, 4];
    for i in 0..3 {
        let ring = radial.wave(bend, #{ base_radius: 0.75, amplitude: 0.55, wave_frequency: lobes[i], resolution: 192 });
        let mine = beats.add(i * 1.0).modulo(3.0).scale(-1.0).add(0.5).gate.threshold(0.0);
        ring.rotation.z = clock.scale(0.5 - i * 0.4);
        ring.scale = mine.scale(kick.scale(0.4).add(1.0));
        ring.color = tint(colours[i], hit.scale(0.6).add(1.6));
        scene.add(ring);
    }

    // Outwards, hard. The petals warp makes the fall faster in some directions,
    // so the wall is fluted, not smooth.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.03).add(hit.scale(0.07)).add(1.04), clock.scale(0.4).sin().scale(0.01).add(hit.scale(0.03)).scale(style.speed))
        .warp.petals(level.scale(0.015).add(0.01), 6.0, clock.scale(0.5))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.975, style.mist, 0.9, 0.992))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.6, 0.4), intensity: misted(0.8, style.mist, 0.45, 1.0), radius: misted(8.0, style.mist, 4.0, 12.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
