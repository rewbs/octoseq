//! roles: hit, kick, snare, hat, energy, bass

// COLUMNS
// A row of rings across the frame, each answering a different drum, with the
// picture sliding upwards so every ring draws a column of light above itself. A
// hit shoves the whole frame up at once.
//
//   hit      the frame is shoved upwards
//   kick     the centre ring slams open
//   snare    the two rings beside it crack open
//   hat      the outer rings flicker
//   bass     the row sinks and rises
//   energy   how fast the columns climb

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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
    // This scene is the crispest there is at its own settings: it goes mistier, never crisper.
    let mist = if style.mist < 0.5 { 0.5 } else { style.mist };
    // `style.at` is where in the frame the scene sits (0, 0 is the middle; x to the
    // right and y down, in frame widths and heights). The eye moves the other way.
    let ex = style.at[0] * -6.6;
    let ey = style.at[1] * 3.7;
    camera.position = #{ x: ex, y: ey, z: 6.5 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let sink = roles.bass.smooth.exponential(0.03, 0.3).scale(-0.9).add(-1.2);

    // Seven rings, left to right: hat, hat, snare, kick, snare, hat, hat.
    let drums = [hat, hat, snare, kick, snare, hat, hat];
    let colours = [style.c, style.b, style.b, style.a, style.b, style.b, style.c];
    let jumps = [0.6, 0.8, 1.4, 2.0, 1.4, 0.8, 0.6];
    for i in 0..7 {
        let ring = radial.ring(#{ radius: 0.24, thickness: 0.13, segments: 48 });
        ring.position.x = (i - 3) * 1.25;
        ring.position.y = sink.add(timing.time.scale(1.3 * style.speed).add(i * 0.9).sin().scale(0.18));
        ring.scale = drums[i].scale(jumps[i]).add(0.55);
        // Size follows each drum; brightness follows only the hits, which are
        // never close enough together to strobe.
        scene.add(glow(ring, colours[i], hit.scale(0.45).add(0.55)));
    }

    // The loop slides the last frame upwards, faster when the music is loud, and
    // throws it on a hit. Nothing turns: the trails are straight columns.
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, 0.0, hit.scale(0.055).add(level.scale(0.004)).add(0.003))
        .warp.waves(level.scale(1.2).add(0.8), 1.0, timing.time.scale(0.5 * style.speed))
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.93, mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, mist, 0.7, 0.55), intensity: misted(0.7, mist, 0.35, 0.7), radius: misted(10.0, mist, 5.0, 10.0) }));
}
