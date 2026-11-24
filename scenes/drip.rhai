//! roles: hit, kick, energy, bass

// DRIP
// Paint running down a wall. Six beads of colour slide to and fro along the top
// edge of the frame, and the loop carries everything they leave straight down,
// wavering, with its edges sharpened so the runs stay runs instead of spreading
// into mist. The colours cross and mix on the way down.
//
//   hit      the wall is shaken: the runs lurch sideways and fall faster
//   kick     the beads swell, so the runs thicken
//   bass     how far the beads hang below the edge
//   energy   how fast the paint runs

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.7 * style.speed));

    let colours = [style.a, style.b, style.c, style.a, style.c, style.b];
    for i in 0..6 {
        let bead = radial.ring(#{ radius: 0.16, thickness: 0.32, segments: 24 });
        bead.position.x = clock.scale(0.4 + i * 0.09).add(i * 1.9).sin().scale(5.6);
        bead.position.y = bass.scale(-0.7).add(3.5);
        bead.scale = kick.scale(1.0).add(0.9);
        scene.add(glow(bead, colours[i], hit.scale(0.35).add(0.75)));
    }

    // Down the wall. A negative shift carries the last frame down the screen.
    let fall = level.scale(0.01).add(hit.scale(0.02)).add(0.007).scale(-1.0 * style.speed);
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, hit.scale(0.012).scale(clock.scale(2.0).sin()), fall)
        .warp.waves(level.scale(1.2).add(0.8), 1.3, clock)
        .color.sharpen(0.3, 0.02, 1.0)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.985, style.mist, 0.93, 0.994))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.4, style.mist, 0.2, 0.7), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
