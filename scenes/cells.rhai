//! roles: hit, kick, energy, bass

// CELLS
// One cell in the middle, and the whole picture drawn again at half size in each
// quarter of the frame, every time round the loop: so the cell has four smaller
// copies of itself about it, each of those has four, and so on down until they are
// too small to see. When the cell moves, the move runs outwards through its
// descendants a generation at a time.
//
//   hit      the cell divides: it jumps in size and every generation's colour turns
//   kick     the cell swells
//   bass     how far the cell wanders from the middle
//   energy   how fast it wanders and turns

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
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // The cell: a wall, a body that is not quite a full disc, and a nucleus that
    // wanders inside it, each a different colour.
    let cell = scene.group();
    let wall = radial.ring(#{ radius: 1.5, thickness: 0.16, segments: 64 });
    cell.add(glow(wall, style.b, hit.scale(0.4).add(0.75)));
    let body = radial.ring(#{ radius: 0.62, thickness: 1.24, start_angle: 0.0, end_angle: 4.6, segments: 48 });
    body.rotation.z = clock.scale(0.9);
    cell.add(glow(body, style.a, hit.scale(0.3).add(0.5)));
    let nucleus = radial.ring(#{ radius: 0.2, thickness: 0.4, segments: 24 });
    nucleus.position.x = clock.scale(1.3).sin().scale(0.6);
    nucleus.position.y = clock.scale(1.7).sin().scale(0.6);
    cell.add(glow(nucleus, style.c, hit.scale(0.5).add(1.0)));
    cell.position.x = clock.scale(0.6).sin().scale(bass.scale(1.4).add(0.3));
    cell.position.y = clock.scale(0.8).sin().scale(bass.scale(0.8).add(0.15));
    cell.scale = kick.scale(0.2).add(hit.scale(0.25)).add(0.85);
    scene.add(cell);

    // Two by two: each time round the loop the last frame comes back four times
    // over, half the size, so every copy gains four of its own. The fade and the
    // turn of colour are per generation, and the grid turns a little with each.
    let fb = feedback.builder()
        .warp.tile(2.0)
        .warp.affine(1.0, clock.scale(0.5).sin().scale(0.02 * style.speed))
        .color.hsv(hit.scale(0.05).add(0.04), 0.0, 0.0)
        .color.decay(misted(0.86, style.mist, 0.7, 0.95))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.45), intensity: misted(0.5, style.mist, 0.3, 0.8), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
