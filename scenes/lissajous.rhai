//! roles: hit, onset, energy, bass, brightness

// LISSAJOUS
// Three pens, each swinging from side to side at one rate and up and down at
// another, so each draws a looping figure; and nothing wipes the page, so the
// figures stay where they were drawn and fade only slowly. The rates drift, and
// the figures open, fold and close like a wire being turned in the hand.
//
//   hit      the page jumps outwards, leaving an echo of the figure round it
//   onset    the pens press harder
//   bass     how wide the figures are
//   brightness   how far apart the pens' rates are: how knotted the figures get
//   energy   how fast the pens move

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.075 });
    let press = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.2 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.5);
    let knot = roles.brightness.smooth.exponential(0.5, 1.0);
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.45 * style.speed));
    let width = bass.scale(1.2).add(3.6);

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let pen = radial.ring(#{ radius: 0.07, thickness: 0.14, segments: 16 });
        // Side to side at three, up and down at two; the knot signal detunes them.
        let detune = knot.scale(0.4).add(i * 0.07);
        pen.position.x = clock.scale(3.0).add(clock.scale(detune)).add(i * 2.0944).sin().scale(width);
        pen.position.y = clock.scale(2.0).add(i * 0.7).sin().scale(2.9);
        pen.scale = press.scale(0.8).add(1.0);
        scene.add(glow(pen, colours[i], hit.scale(0.5).add(1.2)));
    }

    // The page keeps what is drawn on it. A hit pushes the page outwards a little.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.035).add(1.0008), 0.0)
        .warp.waves(level.scale(0.6).add(0.3), 0.8, clock)
        .color.hsv(0.0015, 0.0, 0.0)
        .color.decay(misted(0.99, style.mist, 0.955, 0.996))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.35), intensity: misted(0.9, style.mist, 0.6, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
