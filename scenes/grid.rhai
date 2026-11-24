//! roles: hit, kick, snare, hat, energy

// GRID
// A board of lights, nine across and five down. The kick starts at the left edge
// and runs across the board a column at a time; the snare starts at the top and
// runs down it a row at a time; where the two meet a light is at its biggest. The
// board is a picture of the drum pattern, drawn again every bar.
//
//   hit      the whole board jumps towards the eye
//   kick     a column of lights swells, and the swell runs to the right
//   snare    a row of lights swells, and the swell runs downwards
//   hat      every other light twitches
//   energy   how far the board tilts

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
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let board = scene.group();
    for col in 0..9 {
        // Each column hears the kick a sixteenth of a beat after the one before it.
        let column = kick.delay(col * 0.0625);
        for row in 0..5 {
            let light = radial.ring(#{ radius: 0.16, thickness: 0.32, segments: 20 });
            light.position.x = (col - 4.0) * 1.3;
            light.position.y = (2.0 - row) * 1.25;
            let size = column.scale(0.28).add(snare.delay(row * 0.0625).scale(0.28)).add(0.7);
            light.scale = if (row + col) % 2 == 0 { size.add(hat.scale(0.1)) } else { size };
            let c = if row == 2 { style.c } else if col % 2 == 0 { style.a } else { style.b };
            board.add(glow(light, c, hit.scale(0.25).add(0.8)));
        }
    }
    board.rotation.y = clock.scale(0.5).sin().scale(level.scale(0.5).add(0.15));
    board.rotation.x = clock.scale(0.37).sin().scale(level.scale(0.3).add(0.1));
    board.position.z = hit.scale(1.1);
    scene.add(board);

    // A short wake straight back from the board, so a swelling light leaves a ring.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.02).add(1.012), 0.0)
        .warp.waves(level.scale(1.0).add(0.6), 1.0, clock)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.5), intensity: misted(0.6, style.mist, 0.35, 0.8), radius: misted(7.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
