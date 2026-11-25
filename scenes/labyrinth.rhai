//! roles: hit, kick, snare, beat_phase, energy

// LABYRINTH
// An infinite two-layer Truchet arc maze that weaves luminous neon ribbons
// across the whole frame. Every blow re-deals the labyrinth's tile orientations
// and snaps the foreground beacons onto the next beat.
//
//   hit         flips the labyrinth into a new tile arrangement and holds it
//   kick        inner beacons expand
//   snare       outer diamond frame flashes
//   beat_phase  throbs the ribbon width in time with the beat
//   energy      scrolls the maze faster

let style = #{ a: [0.12, 0.88, 0.52], b: [0.95, 0.25, 0.35], c: [0.95, 0.82, 0.32], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let beat_pulse = roles.beat_phase.scale(-1.0).add(1.0);
    let clock = timing.time.scale(0.35 * style.speed).add(level.integrate(0.0).scale(0.85 * style.speed));

    let diamond = radial.ring(#{ radius: 2.0, thickness: 0.1, segments: 4 });
    diamond.rotation.z = count.scale(0.7854).add(0.7854);
    diamond.scale = snare.scale(0.55).add(0.85);
    scene.add(glow(diamond, style.b, hit.scale(0.65).add(0.85)));

    let colours = [style.a, style.c];
    for i in 0..4 {
        let beacon = radial.ring(#{ radius: 0.18, thickness: 0.3, segments: 4 });
        let a = clock.scale(0.4).add(i * 1.5708);
        beacon.position.x = a.cos().scale(2.8);
        beacon.position.y = a.sin().scale(1.6);
        beacon.scale = kick.scale(1.1).add(0.85);
        scene.add(glow(beacon, colours[i % 2], hit.scale(0.6).add(0.95)));
    }

    let fb = feedback.builder()
        .warp.affine(0.985, 0.005 * style.speed)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.965))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(8.0, style.mist, 4.0, 11.0) }));
    post.add(fx.ground(#{ kind: 9, zoom: 3.6, angle: clock.scale(0.08), phase: clock.scale(0.9), p1: beat_pulse.scale(0.07).add(0.06), p2: count, amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
