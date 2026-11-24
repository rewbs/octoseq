//! roles: hit, kick, snare, energy, bass

// MANDALA
// An arc, a spoke and a wandering light, none of them symmetrical, seen through a
// kaleidoscope of six wedges: every move is made twelve times over and the frame
// is a neon star that never repeats. A hit turns the kaleidoscope a notch.
//
//   hit      the kaleidoscope snaps round and the star is thrown outwards
//   kick     the wandering light swells
//   snare    the arc flares
//   bass     everything breathes
//   energy   how fast the pieces move

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

// `style.mist` says how misty the look is, from 0 (crisp: short trails and a tight
// glow, so bright shapes sit on black) to 1 (misty: trails that linger until colour
// fills the frame). At 0.5 a setting is the scene's own. Every scene reads it
// through this, so it means the same in all of them.
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
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let breathe = roles.bass.smooth.exponential(0.03, 0.3).scale(0.3).add(0.9);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    // The kaleidoscope shows one wedge of this, wherever it is pointing, so there
    // is something in every direction: three of each, none moving in step.
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let third = i * 2.0944;

        // An arc sweeping to and fro.
        let arc = radial.ring(#{ radius: 1.5 + i * 0.5, thickness: 0.16, start_angle: 0.0, end_angle: 1.5, segments: 48 });
        arc.rotation.z = clock.scale(0.5 + i * 0.13).sin().scale(1.1).add(third);
        arc.scale = breathe.add(snare.scale(0.35));
        scene.add(glow(arc, colours[(i + 1) % 3], hit.scale(0.45).add(0.6)));

        // A spoke: a long thin bar swinging on an arm that reaches out of the frame.
        let spoke = radial.ring(#{ radius: 7.0, thickness: 0.07, start_angle: -0.3, end_angle: 0.3, segments: 24 });
        let swing = clock.scale(0.23 + i * 0.07).add(third);
        spoke.position.x = swing.sin().scale(-6.4);
        spoke.position.y = swing.add(1.5708).sin().scale(-6.4);
        spoke.rotation.z = swing.scale(-1.0).add(1.5708);
        scene.add(glow(spoke, colours[(i + 2) % 3], hit.scale(0.4).add(0.55)));

        // A wandering light.
        let light = radial.ring(#{ radius: 0.12, thickness: 0.24, segments: 24 });
        let wander = clock.scale(0.6 + i * 0.17).add(third);
        light.position.x = wander.sin().scale(clock.scale(0.37).add(third).sin().scale(0.9).add(1.9));
        light.position.y = wander.add(1.5708).sin().scale(clock.scale(0.29).add(third).sin().scale(0.7).add(1.5));
        light.scale = kick.scale(1.6).add(breathe);
        scene.add(glow(light, colours[i], hit.scale(0.5).add(0.7)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.05).add(1.014), level.scale(0.008).add(0.004).scale(style.speed))
        .warp.waves(level.scale(1.5).add(0.6), 1.0, clock)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.94, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Six wedges; the first one's direction drifts, and each hit turns it a notch.
    let turn = timing.time.scale(0.05 * style.speed).add(hit.integrate(0.0).scale(0.35));
    post.add(fx.kaleidoscope(#{ segments: 6.0, angle: turn, center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.7, style.mist, 0.35, 0.7), radius: misted(10.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
