//! roles: hit, kick, snare, hat, drums, energy

// SHATTER
// Inspired by Milkdrop's Particles/Spaz family: sharp polygonal shards and
// snappy arcs fractured through a block-shuffling feedback warp that deals a
// fresh tile permutation on every blow. Punchy and glitchy for aggressive drops.
//
//   hit     deals a brand new block-fracture pattern and flashes the shards
//   kick    throws the inner triangle shards outward
//   snare   widens the outer fractured brackets
//   hat     ticks the corner diamonds
//   drums   controls how hard the blocks slide apart
//   energy  sets rotation speed

let style = #{ a: [1.0, 0.22, 0.28], b: [0.98, 0.92, 0.15], c: [0.0, 0.92, 1.0], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.22 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let drums = roles.drums.smooth.exponential(0.02, 0.16);
    let level = roles.energy.smooth.exponential(0.04, 0.32);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.3 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..8 {
        let shard = radial.ring(#{ radius: 0.45, thickness: 0.18, segments: 3 });
        let a = clock.scale(if i % 2 == 0 { 0.8 } else { -0.65 }).add(i * 0.7854);
        let r = if i % 2 == 0 { kick.scale(1.5).add(1.3) } else { snare.scale(1.6).add(2.2) };
        shard.position.x = a.cos().scale(r);
        shard.position.y = a.sin().scale(r).scale(0.75);
        shard.rotation.z = a.add(count.scale(1.0472));
        shard.scale = hit.scale(0.8).add(0.8);
        scene.add(glow(shard, colours[i % 3], hit.scale(0.8).add(1.05)));
    }

    let rim = radial.ring(#{ radius: 2.9, thickness: 0.1, segments: 5 });
    rim.rotation.z = clock.scale(-0.4).sub(count.scale(0.6283));
    rim.scale = hat.scale(0.3).add(0.95);
    scene.add(glow(rim, style.c, hit.scale(0.7).add(0.9)));

    let fb = feedback.builder()
        .warp.blocks(hit.scale(2.8).add(drums.scale(0.9)).add(0.25), 5.0, count)
        .warp.affine(hit.scale(0.05).add(1.01), 0.004 * style.speed)
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.83, 0.98))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.78, style.mist, 0.4, 1.0), radius: misted(8.0, style.mist, 4.0, 12.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
