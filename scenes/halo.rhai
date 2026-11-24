//! roles: hit, kick, snare, hat, energy

// HALO
// Nine broken rings round a glowing middle, like the grooves of a record seen
// under a lamp. Each ring is an arc with a gap in it, each turns at its own pace,
// and alternate rings turn opposite ways, so the gaps line up into spokes for a
// moment and then scatter. The loop ripples what they leave in and out.
//
//   hit      the rings jump outwards and the ripple deepens
//   kick     the inner rings swell
//   snare    the outer rings swell
//   hat      the middle flickers in size
//   energy   how fast the rings turn

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
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    let colours = [style.a, style.b, style.a, style.c, style.b, style.a, style.b, style.c, style.a];
    for i in 0..9 {
        let ring = radial.ring(#{ radius: 0.7 + i * 0.42, thickness: 0.08, start_angle: 0.0, end_angle: 5.2 - (i % 3) * 0.7, segments: 96 });
        let pace = (0.5 - i * 0.04) * (if i % 2 == 0 { 1.0 } else { -1.0 });
        ring.rotation.z = clock.scale(pace).add(i * 0.9);
        ring.scale = if i < 4 { kick.scale(0.12).add(hit.scale(0.1)).add(1.0) } else { snare.scale(0.1).add(hit.scale(0.1)).add(1.0) };
        scene.add(glow(ring, colours[i], hit.scale(0.4).add(0.8)));
    }
    let middle = radial.ring(#{ radius: 0.15, thickness: 0.3, segments: 32 });
    middle.scale = hat.scale(0.4).add(1.0);
    scene.add(glow(middle, style.c, hit.scale(1.0).add(1.5)));

    let fb = feedback.builder()
        .warp.ripple(hit.scale(0.04).add(0.012), 6.0, clock.scale(2.0))
        .warp.affine(1.003, 0.0)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.8, 0.983))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(7.0, style.mist, 4.0, 11.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
