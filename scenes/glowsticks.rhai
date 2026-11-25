//! roles: hit, kick, snare, hat, drums, energy

// GLOWSTICKS
// Inspired by Milkdrop's Dancer/Glowsticks family: twin sweeping neon batons
// whipping in counter-phase Lissajous figure-eights, trailing luminous ribbons
// through a whirlpool feedback field. Built for high-energy rhythmic sections.
//
//   hit     flips the batons' spin direction and kicks the trails outward
//   kick    swells the lead baton's glowing tips
//   snare   swells the partner baton's tips
//   hat     flashes the orbiting spark satellites
//   drums   widens the figure-eight sweep
//   energy  controls how fast the batons whip

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
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let drums = roles.drums.smooth.exponential(0.02, 0.2);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let way = count.scale(3.14159265).cos();
    let clock = timing.time.scale(0.55 * style.speed).add(level.integrate(0.0).scale(1.5 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..6 {
        let pair = i / 2;
        let end_sign = if i % 2 == 0 { 1.0 } else { -1.0 };
        let tip = radial.ring(#{ radius: 0.22, thickness: 0.35, segments: 24 });
        let phase = clock.scale(1.1 + pair * 0.25).add(pair * 2.0944);
        let reach = drums.scale(1.4).add(2.2);
        tip.position.x = phase.sin().scale(reach).scale(end_sign);
        tip.position.y = phase.scale(2.0).cos().scale(reach).scale(0.55 * end_sign);
        let drum = if pair == 0 { kick } else if pair == 1 { snare } else { hat };
        tip.scale = drum.scale(1.3).add(0.85);
        scene.add(glow(tip, colours[pair], hit.scale(0.8).add(1.15)));
    }

    let baton = radial.ring(#{ radius: 1.8, thickness: 0.12, start_angle: 0.0, end_angle: 2.2, segments: 36 });
    baton.rotation.z = clock.scale(1.4).add(count.scale(0.7854));
    baton.scale = hit.scale(0.55).add(0.95);
    scene.add(glow(baton, style.c, hit.scale(0.7).add(0.95)));

    let fb = feedback.builder()
        .warp.whirls(hit.scale(0.05).add(0.018), 4.0, clock.scale(0.5))
        .warp.affine(hit.scale(0.05).add(1.012), way.scale(0.012 * style.speed))
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.94, style.mist, 0.85, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.65, 0.35), intensity: misted(0.8, style.mist, 0.4, 1.05), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
