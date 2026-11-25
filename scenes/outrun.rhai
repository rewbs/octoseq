//! roles: hit, kick, snare, bass, energy

// OUTRUN
// Retro-futuristic synthwave horizon: an infinite perspective grid racing
// underneath jagged neon mountains and a striped sunset disk. Kicks thump
// the sun's corona and blows surge the highway forward.
//
//   hit     surges down the highway and flashes the horizon ring
//   kick    pulses the sun's size and central beacon
//   snare   flares the twin wing chevrons
//   bass    raises the mountain ridge height
//   energy  sets highway cruising speed

let style = #{ a: [1.0, 0.45, 0.85], b: [0.3, 0.95, 0.95], c: [1.0, 0.85, 0.2], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    let sun_ring = radial.ring(#{ radius: 1.5, thickness: 0.07, segments: 64 });
    sun_ring.position.y = 1.4;
    sun_ring.scale = kick.scale(0.45).add(0.92);
    scene.add(glow(sun_ring, style.c, hit.scale(0.65).add(0.85)));

    for side in 0..2 {
        let dir = if side == 0 { -1.0 } else { 1.0 };
        let wing = radial.ring(#{ radius: 0.7, thickness: 0.08, segments: 3 });
        wing.position.x = dir * 3.4;
        wing.position.y = -1.2;
        wing.rotation.z = clock.scale(0.6 * dir);
        wing.scale = snare.scale(0.75).add(0.7);
        scene.add(glow(wing, style.b, hit.scale(0.6).add(0.85)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.008), 0.0)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.86, style.mist, 0.75, 0.955))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(9.0, style.mist, 4.0, 13.0) }));
    post.add(fx.ground(#{ kind: 19, zoom: 1.05, angle: 0.0, phase: clock.scale(1.2).add(count.scale(0.45)), p1: kick.scale(0.1).add(0.24), p2: bass.scale(0.14).add(0.14), amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
