//! roles: hit, kick, snare, energy, bass

// BEAM
// A lighthouse. Two narrow wedges of light, opposite each other, sweep round a
// lamp in the middle of the frame, and a second pair, dimmer, sweeps the other
// way. Most of the frame is dark most of the time; what the eye follows is the
// beams coming round, and the moment they cross.
//
//   hit      the lamp flashes and the beams widen for a moment
//   kick     the bright pair of beams lengthens
//   snare    the dim pair lengthens
//   bass     the lamp's size
//   energy   how fast the beams sweep

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.3 * style.speed));

    // A wedge is a ring so thick it has no hole, cut down to a narrow slice. Four
    // of them: a bright pair turning one way, a dim pair the other.
    let colours = [style.a, style.a, style.b, style.b];
    for i in 0..4 {
        let bright = i < 2;
        let wedge = radial.ring(#{ radius: 3.6, thickness: 7.2, start_angle: -0.07, end_angle: 0.07, segments: 6 });
        wedge.rotation.z = clock.scale(if bright { 0.8 } else { -0.5 }).add(i * 3.14159);
        wedge.scale = if bright { kick.scale(0.25).add(0.85) } else { snare.scale(0.25).add(0.7) };
        scene.add(glow(wedge, colours[i], hit.scale(0.3).add(if bright { 0.75 } else { 0.4 })));
    }
    let lamp = radial.ring(#{ radius: 0.18, thickness: 0.36, segments: 32 });
    lamp.scale = bass.scale(0.9).add(0.8);
    scene.add(glow(lamp, style.c, hit.scale(1.5).add(1.5)));

    // The beams leave a wake that turns with them and widens outwards.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.02).add(1.004), level.scale(0.012).add(0.006).scale(style.speed))
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.8, style.mist, 0.45, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
