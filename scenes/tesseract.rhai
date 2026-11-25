//! roles: hit, kick, snare, beat_phase, lead, energy

// TESSERACT
// Four-dimensional hypercube illusion: nested 3D wireframes rotating on
// opposing axes inside an eight-fold mirrored feedback fold. Sharp, geometric,
// and kinetic for drops and intense beats.
//
//   hit         snaps the fold symmetry and blasts the hypercube open
//   kick        punches the inner cube
//   snare       punches the outer cube
//   beat_phase  steps the inner sphere's rhythmic glow
//   lead        expands the satellite vertices
//   energy      controls the 4D rotation rate

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.24 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let lead = roles.lead.smooth.exponential(0.03, 0.25);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let beat_p = roles.beat_phase.scale(-0.6).add(1.0);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.3 * style.speed));

    let inner = mesh.cube();
    inner.rotation.x = clock.scale(1.1).add(count.scale(0.7854));
    inner.rotation.y = clock.scale(0.9);
    inner.scale = kick.scale(0.95).add(1.2);
    scene.add(wire(inner, style.a, hit.scale(0.85).add(1.15)));

    let outer = mesh.cube();
    outer.rotation.x = clock.scale(-0.7);
    outer.rotation.z = clock.scale(0.85).sub(count.scale(0.3927));
    outer.scale = snare.scale(1.1).add(2.3);
    scene.add(wire(outer, style.b, hit.scale(0.75).add(1.05)));

    let node = mesh.sphere();
    node.position.x = clock.scale(1.1).cos().scale(2.4);
    node.position.y = clock.scale(1.1).sin().scale(1.6);
    node.scale = lead.scale(0.55).add(beat_p.scale(0.35)).add(0.35);
    scene.add(glow(node, style.c, hit.scale(0.7).add(1.0)));

    let fb = feedback.builder()
        .warp.fold(8.0, clock.scale(0.18).add(count.scale(0.2618)))
        .warp.affine(hit.scale(0.05).add(1.015), 0.008 * style.speed)
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.935, style.mist, 0.84, 0.982))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.78, style.mist, 0.4, 1.0), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
