//! roles: hit, energy, bass, melody, flux

// WIRE
// Four loops of bright wire, each bent into waves by a different part of the
// music and each tumbling slowly in depth, drawn on black. This is the crispest
// of the scenes at its own setting: thin lines, short trails, the dark left dark.
//
//   hit      the wires jump apart
//   bass     bends the widest wire
//   melody   bends the two middle wires
//   flux     bends the smallest wire
//   energy   how fast they tumble

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.0875 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.02, 0.2);
    let melody = roles.melody.smooth.exponential(0.03, 0.25);
    let flux = roles.flux.smooth.exponential(0.02, 0.2);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let bends = [bass, melody, melody, flux];
    let colours = [style.a, style.b, style.c, [1.0, 1.0, 1.0]];
    let waves = [3, 5, 8, 13];
    for i in 0..4 {
        let wire = radial.wave(bends[i], #{ base_radius: 2.6 - i * 0.55, amplitude: 0.9 - i * 0.12, wave_frequency: waves[i], resolution: 256 });
        wire.rotation.x = clock.scale(0.5 + i * 0.17).add(i * 1.3).sin().scale(1.1);
        wire.rotation.y = clock.scale(0.37 + i * 0.11).add(i * 0.7);
        wire.rotation.z = clock.scale(0.2 - i * 0.13);
        wire.scale = hit.scale(0.25 + i * 0.1).add(1.0);
        wire.color = tint(colours[i], hit.scale(0.5).add(1.3));
        scene.add(wire);
    }

    // A short trail that opens outwards: each wire has a wake, not a history.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.01), 0.003 * style.speed)
        .color.hsv(0.01, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.82, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.4), intensity: misted(0.9, style.mist, 0.6, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
