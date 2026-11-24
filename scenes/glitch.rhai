//! roles: hit, onset, kick, energy

// GLITCH
// A picture going wrong. Eight blocks of light sit on a coarse grid and jump
// from square to square as the music makes its sounds, one at each sound, never
// easing between; the loop splits the colours of what they leave apart sideways and
// cuts the fade into steps, so trails break off instead of dying away. A scan
// line crawls down the frame throughout. Nothing else in this scene moves
// smoothly, on purpose.
//
//   hit      the whole frame tears sideways
//   onset    one of the blocks jumps to another square
//   kick     the blocks swell
//   energy   how far apart the colours are split

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.0625 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.2 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    // How many sounds there have been: the blocks' places are worked out from it,
    // so they change on a sound and at no other time.
    let sounds = roles.onset.count_prev_beats(100000.0).add(timing.time.scale(0.2 * style.speed).floor());

    // A ring with four sides and no hole, turned square: a block.
    let colours = [style.a, style.b, style.c, [1.0, 1.0, 1.0]];
    for i in 0..8 {
        let block = radial.ring(#{ radius: 0.3, thickness: 0.6, segments: 4 });
        block.rotation.z = 0.7854;
        // Eleven squares across and six down; each block strides through them by
        // its own odd step. Each waits eight sounds between moves, and they take
        // turns: one moves on any one sound.
        let moves = sounds.add(i * 1.0).scale(0.125).floor();
        block.position.x = moves.scale(3.0 + i * 2.0).add(i * 5.0).modulo(11.0).sub(5.0).scale(1.2);
        block.position.y = moves.scale(1.0 + i * 1.0).add(i * 3.0).modulo(6.0).sub(2.5).scale(1.2);
        block.scale = kick.scale(0.12).add(0.8 + (i % 3) * 0.5);
        scene.add(glow(block, colours[i % 4], 0.9));
    }

    // A scan line, as on a failing screen: a thin bar the width of the frame that
    // travels down it and starts again, whatever the music is doing. It is the one
    // thing here that moves between sounds, so a quiet bar does not freeze the frame.
    let scan = radial.ring(#{ radius: 60.0, thickness: 0.05, start_angle: 1.4508, end_angle: 1.6908, segments: 16 });
    scan.position.y = -60.0;
    let line_at = scene.group();
    line_at.add(glow(scan, [1.0, 1.0, 1.0], 0.5));
    line_at.position.y = timing.time.scale(0.3 * style.speed).fract().scale(-8.0).add(4.0);
    scene.add(line_at);

    // Colours pulled apart sideways; the fade cut into steps; a hit tears it.
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, hit.scale(0.05), 0.0)
        .warp.shear(hit.scale(0.03))
        .color.channel_offset(level.scale(0.006).add(hit.scale(0.012)).add(0.002), 0.0)
        .color.posterize(misted(7.0, style.mist, 4.0, 24.0))
        .color.decay(misted(0.93, style.mist, 0.85, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.4, style.mist, 0.2, 0.7), radius: misted(5.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
