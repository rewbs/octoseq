//! roles: hit, kick, snare, hat, lead, energy

// HYPERDRIVE
// Four parallax layers of warp-speed starlight streaking past the viewer,
// framed by cockpit reticle arcs. Every blow snaps the swirl direction and
// surges the hyperdrive forward.
//
//   hit      reverses the warp swirl and surges forward through space
//   kick     the inner reticle expands sharply
//   snare    the outer targeting arcs flare
//   hat      the compass ticks shimmer
//   lead     stretches the star streaks longer
//   energy   drives flight speed

let style = #{ a: [0.55, 0.92, 1.0], b: [0.22, 0.32, 0.92], c: [1.0, 0.62, 0.42], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let lead = roles.lead.smooth.exponential(0.03, 0.25);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let way = count.scale(3.14159265).cos();
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.4 * style.speed));

    let ring = radial.ring(#{ radius: 1.3, thickness: 0.08, segments: 64 });
    ring.scale = kick.scale(0.75).add(0.85);
    scene.add(glow(ring, style.a, hit.scale(0.7).add(0.9)));

    for i in 0..4 {
        let a = i * 1.5708;
        let arc = radial.ring(#{ radius: 2.5, thickness: 0.1, start_angle: a, end_angle: a + 0.65, segments: 24 });
        arc.rotation.z = clock.scale(0.55).add(count.scale(0.3927));
        arc.scale = snare.scale(0.45).add(1.0);
        scene.add(glow(arc, style.b, hit.scale(0.6).add(0.85)));
    }

    for i in 0..8 {
        let a = i * 0.7854;
        let tick = radial.ring(#{ radius: 3.3, thickness: 0.12, start_angle: a, end_angle: a + 0.14, segments: 8 });
        tick.rotation.z = clock.scale(-0.3);
        tick.scale = hat.scale(0.25).add(1.0);
        scene.add(glow(tick, style.c, hit.scale(0.5).add(0.8)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.06).add(1.018), way.scale(0.008 * style.speed))
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.965))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(8.0, style.mist, 4.0, 11.0) }));
    post.add(fx.ground(#{ kind: 8, zoom: 1.2, angle: clock.scale(0.1), phase: clock.scale(0.35).add(count.scale(0.55)), p1: lead.scale(1.6).add(0.5), p2: way.scale(1.4), amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
