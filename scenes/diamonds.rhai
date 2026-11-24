//! roles: hit, kick, energy, bass, beat

// DIAMONDS
// A diamond in the middle changes colour on every beat, and the loop throws each
// one outwards after the last, so the frame is a nest of striped diamonds growing
// from the centre like the rings of a tree, one stripe a beat. Stare at the middle
// and the whole frame seems to be falling towards you.
//
//   hit      the stripes are flung outwards and the nest twists
//   kick     the diamond in the middle swells
//   bass     how thick the stripes are drawn
//   beat     which of the three diamonds is showing: one a beat, in turn
//   energy   how fast the stripes travel

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
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // A ring with four sides is a diamond. Three of them share the middle and take
    // the beats in turn: each is full size for one beat in three and nothing for
    // the other two, growing through its beat so the stripe has a soft inner edge.
    let beats = roles.beat.count_prev_beats(100000.0);
    let through = roles.beat.beat_phase_between();
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let diamond = radial.ring(#{ radius: 0.55, thickness: 0.34, segments: 4 });
        let mine = beats.add(i * 1.0).modulo(3.0).scale(-1.0).add(0.5).gate.threshold(0.0);
        diamond.scale = mine.scale(through.scale(0.5).add(bass.scale(0.5)).add(kick.scale(0.4)).add(0.6));
        scene.add(glow(diamond, colours[i], hit.scale(0.4).add(0.85)));
    }

    // Outwards, fast, without bending: the stripes must stay straight.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.02).add(hit.scale(0.06)).add(1.035).scale(1.0), clock.scale(0.5).sin().scale(0.008).add(hit.scale(0.02)).scale(style.speed))
        .color.sharpen(0.35, 0.004, 1.0)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.975, style.mist, 0.9, 0.992))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.4, style.mist, 0.25, 0.7), radius: misted(5.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
