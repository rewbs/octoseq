//! roles: hit, kick, snare, beat_phase, energy

// CORRIDOR
// A 3D raymarched ribbed geometric tunnel bending through infinite space,
// with tumbling wire cubes flying down its axis. Every blow launches the
// camera forward along the ribs and twists the cube.
//
//   hit         leaps forward down the corridor and twists the tumbling cube
//   kick        punches the leading wire cube open
//   snare       flares the trailing diamond frame
//   beat_phase  pulses the corridor's rib frequency
//   energy      sets flight speed down the tunnel

let style = #{ a: [1.0, 0.22, 0.28], b: [0.18, 0.95, 0.42], c: [0.22, 0.42, 1.0], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

// Draw a solid as its glowing edges.
fn wire(entity, c, level) {
    entity.material = "wire_glow";
    entity.materialParams.core_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_intensity = level;
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
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let way = count.scale(3.14159265).cos();
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    let cube = mesh.cube();
    cube.rotation.x = clock.scale(0.8).add(count.scale(0.5));
    cube.rotation.y = clock.scale(1.1);
    cube.scale = kick.scale(0.85).add(0.9);
    scene.add(wire(cube, style.a, hit.scale(0.8).add(1.0)));

    let frame = radial.ring(#{ radius: 2.2, thickness: 0.08, segments: 8 });
    frame.rotation.z = clock.scale(-0.5).add(count.scale(0.3927));
    frame.scale = snare.scale(0.55).add(0.9);
    scene.add(glow(frame, style.c, hit.scale(0.6).add(0.85)));

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.05).add(1.015), way.scale(0.006 * style.speed))
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.96))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(8.0, style.mist, 4.0, 11.0) }));
    post.add(fx.ground(#{ kind: 15, zoom: roles.beat_phase.scale(-0.08).add(1.18), angle: clock.scale(0.06).add(way.scale(0.22)), phase: clock.scale(0.32).add(count.scale(0.95)), p1: way.scale(0.45), p2: 2.6, amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
