//! roles: hit, kick, snare, energy, bass

// MOSAIC
// A wall of square tiles, and the eye pulling back from it and pushing in again,
// so there are now a few big tiles and now hundreds of small ones. Each tile
// grows and shrinks on two waves that cross the wall at an angle to each other,
// so patterns of big and small tiles run over it like wind over a field; the
// drums send a third wave out from the middle.
//
//   hit      the eye is thrown back from the wall: suddenly there are far more tiles
//   kick     a wave of size runs outwards from the middle of the wall
//   snare    alternate tiles twitch
//   bass     how deep the waves in the wall are
//   energy   how fast the waves run and the eye moves

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let depth = roles.bass.smooth.exponential(0.03, 0.3).scale(0.3).add(0.15);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    // Eight tiles across and five down fill the frame exactly, so when the wall
    // is repeated the joins do not show. A tile is a ring with four sides and no
    // hole, turned square.
    let colours = [style.a, style.b, style.c];
    for col in 0..8 {
        for row in 0..5 {
            let tile = radial.ring(#{ radius: 0.36, thickness: 0.72, segments: 4 });
            tile.rotation.z = 0.7854;
            let x = (col - 3.5) * 1.632;
            let y = (row - 2.0) * 1.469;
            tile.position.x = x;
            tile.position.y = y;
            let out = (x * x + y * y).sqrt();
            let waves = clock.scale(2.0).add(col * 0.8 + row * 0.3).sin().scale(clock.scale(1.3).add(row * 1.1 - col * 0.2).sin()).scale(depth);
            let size = waves.add(kick.delay(out * 0.06).scale(0.35)).add(0.55);
            tile.scale = if (col + row) % 2 == 0 { size.add(snare.scale(0.2)) } else { size };
            scene.add(glow(tile, colours[(col + row * 2) % 3], hit.scale(0.35).add(0.8)));
        }
    }

    let count = roles.hit.to_signal(#{ envelope: "count" });
    let fb = feedback.builder()
        // (half of what first stood in for the waves: at the full amount the picture moved so
        // much between blows that the blows themselves stood out less)
        .warp.blocks(level.scale(1.0).add(0.6).scale(0.3), 6.0, count)
        .color.hsv(0.01, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.78, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // The wall, repeated: 1 is the wall itself, 3 is nine of it.
    let back = clock.scale(0.35).sin().scale(0.8).add(1.9).add(hit.scale(0.5));
    post.add(fx.zoomWrap(#{ amount: back, center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] }, wrap_mode: "repeat" }));
    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.4, style.mist, 0.2, 0.7), radius: misted(5.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
