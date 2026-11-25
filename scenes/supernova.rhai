//! roles: hit, kick, snare, drums, energy

// SUPERNOVA
// Inspired by Milkdrop's Drawing/Explosions family: a radial ring of glowing
// shards and a blinding core erupting outward on every blow, throwing fiery
// trails straight to the edges of the frame.
//
//   hit     blasts the shockwave and shards outward at full speed
//   kick    swells the inner stellar core
//   snare   throws the twelve radial shards wide
//   drums   intensifies the radial blur streaks
//   energy  keeps the corona churning

let style = #{ a: [1.0, 0.48, 0.12], b: [1.0, 0.9, 0.25], c: [0.95, 0.18, 0.45], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

// Colour a line or point cloud directly from a palette colour and brightness signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.24 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let drums = roles.drums.smooth.exponential(0.02, 0.18);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.3 * style.speed));

    let core = radial.ring(#{ radius: 0.45, thickness: 0.5, segments: 48 });
    core.scale = kick.scale(1.4).add(hit.scale(0.8)).add(0.55);
    scene.add(glow(core, style.b, hit.scale(0.9).add(1.1)));

    let colours = [style.a, style.c, style.b];
    for i in 0..12 {
        let a = clock.scale(0.35).add(i * 0.5236).add(count.scale(0.2618));
        let shard = radial.ring(#{ radius: 0.18, thickness: 0.28, segments: 3 });
        let r = snare.scale(1.8).add(hit.scale(1.2)).add(1.3);
        shard.position.x = a.cos().scale(r);
        shard.position.y = a.sin().scale(r);
        shard.rotation.z = a;
        shard.scale = hit.scale(0.9).add(0.85);
        scene.add(glow(shard, colours[i % 3], hit.scale(0.8).add(1.0)));
    }

    let sparks = points.cloud(#{ count: 160, spread: 4.8, mode: "uniform", seed: 91, point_size: 2.5 });
    sparks.rotation.z = clock.scale(-0.4);
    sparks.point_size = hit.scale(3.0).add(2.0);
    sparks.color = tint(style.a, hit.scale(0.6).add(1.0));
    scene.add(sparks);

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.1).add(1.022), 0.005 * style.speed)
        .warp.petals(hit.scale(0.025).add(0.008), 6.0, clock.scale(0.6))
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.92, style.mist, 0.82, 0.98))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.radialBlur(#{ strength: drums.scale(0.22).add(hit.scale(0.25)).add(0.04), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] }, samples: 12 }));
    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.65, 0.35), intensity: misted(0.8, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
