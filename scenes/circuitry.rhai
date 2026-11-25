//! roles: hit, kick, snare, hat, flux, energy

// CIRCUITRY
// Glowing cybernetic circuit-board traces firing neon pulses through folded
// pathways, overlaid with crisp blinking logic nodes. High-energy and razor
// sharp for dense rhythmic sections.
//
//   hit     steps the circuit fold geometry and fires a current surge
//   kick    pulses the corner processor nodes
//   snare   flashes the outer bus frame
//   hat     flickers the inner clock ticks
//   flux    accelerates signal pulse velocity along the traces
//   energy  sets overall clock rate

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.22 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let flux = roles.flux.smooth.exponential(0.03, 0.25);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.1 * style.speed));

    let bus = radial.ring(#{ radius: 2.1, thickness: 0.09, segments: 4 });
    bus.rotation.z = count.scale(0.7854);
    bus.scale = snare.scale(0.6).add(0.85);
    scene.add(glow(bus, style.b, hit.scale(0.7).add(0.9)));

    for i in 0..4 {
        let node = radial.ring(#{ radius: 0.2, thickness: 0.32, segments: 4 });
        let a = i * 1.5708 + 0.7854;
        node.position.x = 2.6 * if i == 0 || i == 3 { 1.0 } else { -1.0 };
        node.position.y = 1.5 * if i < 2 { 1.0 } else { -1.0 };
        node.scale = kick.scale(1.1).add(0.75);
        scene.add(glow(node, style.a, hit.scale(0.65).add(0.9)));
    }

    let tick = radial.ring(#{ radius: 0.9, thickness: 0.07, segments: 4 });
    tick.rotation.z = clock.scale(1.1);
    tick.scale = hat.scale(0.6).add(0.75);
    scene.add(glow(tick, style.c, hit.scale(0.6).add(0.85)));

    let fb = feedback.builder()
        .warp.blocks(hit.scale(1.5).add(0.3), 6.0, count)
        .warp.affine(0.988, 0.0)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.87, style.mist, 0.76, 0.96))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 0.98), radius: misted(7.0, style.mist, 4.0, 11.0) }));
    post.add(fx.ground(#{ kind: 17, zoom: 1.55, angle: count.scale(0.3927), phase: clock.scale(0.35).add(count.scale(0.65)), p1: flux.scale(0.18).add(hit.scale(0.18)).add(0.92), p2: 2.0, amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
