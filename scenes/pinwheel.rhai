//! roles: hit, kick, snare, energy, bass

// PINWHEEL
// A firework wheel. Three jets of colour are fixed to a hub and the hub spins;
// the loop throws what the jets leave outwards and turns it as it goes, so each
// jet lays down a curved arm, and the three arms wind out to the corners as
// broad bands of plain colour. The faster the wheel, the tighter the bands wind.
//
//   hit      the wheel kicks backwards and the arms buckle
//   kick     the jets thicken
//   snare    the jets jump outwards
//   bass     how long the jets are
//   energy   how fast the wheel spins

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    // The wheel's angle: it runs on loudness, and a hit knocks it back.
    let spun = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(2.2 * style.speed)).sub(hit.scale(0.6));

    // A jet is a thick slice of a ring: a wedge with its point cut off.
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let jet = radial.ring(#{ radius: 0.9, thickness: 0.9, start_angle: -0.42, end_angle: 0.42, segments: 16 });
        jet.rotation.z = spun.add(i * 2.0944);
        jet.scale = bass.scale(0.5).add(snare.scale(0.35)).add(kick.scale(0.15)).add(0.7);
        scene.add(glow(jet, colours[i], hit.scale(0.35).add(0.75)));
    }

    // Outwards, turning the other way to the wheel: that is what bends the arms.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.015).add(hit.scale(0.04)).add(1.022), level.scale(-0.02).sub(0.012).add(hit.scale(0.05)).scale(style.speed))
        .color.hsv(0.0015, 0.0, 0.0)
        .color.decay(misted(0.982, style.mist, 0.9, 0.993))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.65, style.mist, 0.8, 0.5), intensity: misted(0.35, style.mist, 0.15, 0.7), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
