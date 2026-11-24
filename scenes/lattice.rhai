//! roles: hit, snare, energy, melody

// LATTICE
// Bent wires seen through a kaleidoscope of four wedges, with the whole picture
// drawn again inside a square in the middle, and again inside that: a lattice of
// lines that repeats down into its own centre. The wires bend with the melody.
//
//   hit      the inner picture turns a notch and the lattice opens out
//   snare    the wires jump
//   melody   how far the wires bend
//   energy   how fast the wires and the kaleidoscope turn

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let melody = roles.melody.smooth.exponential(0.03, 0.25);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let colours = [style.b, style.c, style.a];
    for i in 0..3 {
        let wire = radial.wave(melody, #{ base_radius: 1.3 + i * 0.9, amplitude: 0.7, wave_frequency: 4 + i * 3, resolution: 256 });
        wire.rotation.z = clock.scale(0.3 - i * 0.22);
        wire.scale = snare.scale(0.2).add(1.0);
        wire.color = tint(colours[i], hit.scale(0.6).add(1.4));
        scene.add(wire);
    }

    // The loop shrinks nothing and spreads nothing: it only draws the last frame
    // again, small, in a square that turns. All the depth comes from that.
    let notch = hit.integrate(0.0).scale(0.4).add(clock.scale(0.15));
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.006), 0.002 * style.speed)
        .color.inset(0.3, 1.25, notch, 0.85, 4.0)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.kaleidoscope(#{ segments: 4.0, angle: clock.scale(0.1), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.4), intensity: misted(0.9, style.mist, 0.6, 1.0), radius: misted(7.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
