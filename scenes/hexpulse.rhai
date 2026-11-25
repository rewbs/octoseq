//! roles: hit, kick, snare, drums, energy

// HEXPULSE
// A glowing sci-fi hexagonal honeycomb lattice swept by concentric shockwaves.
// Drums thicken the neon hex borders and fire concentric hexagonal frames on
// every kick and snare.
//
//   hit     steps the lattice rotation and fires a traveling pulse wave
//   kick    expands the central hexagon
//   snare   flares the outer hex brackets
//   drums   widens the glowing hex borders
//   energy  speeds the traveling waves across the grid

let style = #{ a: [1.0, 0.72, 0.08], b: [0.95, 0.18, 0.12], c: [0.18, 0.48, 1.0], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let drums = roles.drums.smooth.exponential(0.02, 0.18);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.1 * style.speed));

    let hex1 = radial.ring(#{ radius: 1.2, thickness: 0.12, segments: 6 });
    hex1.rotation.z = count.scale(0.5236);
    hex1.scale = kick.scale(0.9).add(0.75);
    scene.add(glow(hex1, style.a, hit.scale(0.75).add(0.95)));

    let hex2 = radial.ring(#{ radius: 2.5, thickness: 0.08, segments: 6 });
    hex2.rotation.z = clock.scale(-0.3).sub(count.scale(0.5236));
    hex2.scale = snare.scale(0.7).add(0.9);
    scene.add(glow(hex2, style.c, hit.scale(0.65).add(0.85)));

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.05).add(1.012), 0.004 * style.speed)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.965))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.75, style.mist, 0.4, 0.98), radius: misted(8.0, style.mist, 4.0, 12.0) }));
    post.add(fx.ground(#{ kind: 13, zoom: 4.5, angle: clock.scale(0.06).add(count.scale(0.2618)), phase: clock.scale(1.2).add(count.scale(0.6)), p1: drums.scale(0.07).add(0.05), p2: 1.8, amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
