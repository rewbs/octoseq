//! roles: hit, kick, snare, lead, energy

// KALEIDOFOLD
// A kaleidoscopic iterated-fold fractal shader behind nested spinning rings.
// Every blow snaps the fractal's fold angle to a new crystalline symmetry and
// pulses the foreground arcs; the dominant part of the band drives its breathing.
//
//   hit      snaps the fractal fold angle and shifts its palette phase
//   kick     the inner crystal ring punches outward
//   snare    the outer crystal ring flares
//   lead     drives the fractal's expansion and foreground motion
//   energy   how fast the crystal folds turn

let style = #{ a: [0.0, 0.92, 1.0], b: [1.0, 0.12, 0.58], c: [0.98, 0.92, 0.15], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let lead = roles.lead.smooth.exponential(0.03, 0.25);
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.35 * style.speed).add(level.integrate(0.0).scale(0.9 * style.speed));

    let inner = radial.ring(#{ radius: 1.1, thickness: 0.12, segments: 6 });
    inner.rotation.z = clock.scale(0.7).add(count.scale(0.5236));
    inner.scale = kick.scale(0.8).add(lead.scale(0.35)).add(0.7);
    scene.add(glow(inner, style.a, hit.scale(0.7).add(0.9)));

    let outer = radial.ring(#{ radius: 2.3, thickness: 0.09, segments: 6 });
    outer.rotation.z = clock.scale(-0.5).sub(count.scale(0.5236));
    outer.scale = snare.scale(0.7).add(lead.scale(0.3)).add(0.85);
    scene.add(glow(outer, style.b, hit.scale(0.6).add(0.85)));

    for i in 0..6 {
        let node = radial.ring(#{ radius: 0.14, thickness: 0.24, segments: 18 });
        let a = clock.scale(0.45).add(i * 1.0472);
        let r = lead.scale(0.9).add(2.0);
        node.position.x = a.cos().scale(r);
        node.position.y = a.sin().scale(r);
        node.scale = hit.scale(0.9).add(0.8);
        scene.add(glow(node, style.c, hit.scale(0.6).add(0.95)));
    }

    let fb = feedback.builder()
        .warp.fold(6.0, clock.scale(0.15))
        .warp.affine(hit.scale(0.04).add(0.988), 0.004 * style.speed)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.965))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(8.0, style.mist, 4.0, 11.0) }));
    post.add(fx.ground(#{ kind: 5, zoom: lead.scale(-0.35).add(1.65), angle: clock.scale(0.12).add(count.scale(0.26)), phase: clock.scale(0.4).add(count.scale(0.22)), p1: count.scale(0.31).add(clock.scale(0.15)), p2: lead.scale(0.35).sub(0.1), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
