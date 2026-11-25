//! roles: hit, kick, snare, lead, energy

// HELIX
// A 3D double-helix of glowing spheres spiraling diagonally across space,
// seen from a swaying camera. Lead opens the strand radius and every blow
// twists the helix a quarter-turn further.
//
//   hit     twists the helix forward and flares every bead
//   kick    swells strand A's beads
//   snare   swells strand B's beads
//   lead    widens the spiral radius
//   energy  sets the helix's tumbling speed

let style = #{ a: [0.12, 0.95, 0.65], b: [0.35, 0.28, 1.0], c: [1.0, 0.42, 0.72], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let lead = roles.lead.smooth.exponential(0.04, 0.3);
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.1 * style.speed));

    let cam_a = clock.scale(0.25);
    camera.position = #{ x: cam_a.sin().scale(6.8), y: timing.time.scale(0.2).sin().scale(1.5), z: cam_a.cos().scale(6.8) };
    camera.target = #{ x: style.at[0] * -4.0, y: style.at[1] * 3.0, z: 0.0 };

    let spine = scene.group();
    for i in 0..10 {
        let y = (i - 4.5) * 0.68;
        let ang = clock.scale(1.2).add(i * 0.62).add(count.scale(0.5));
        let rad = lead.scale(0.9).add(1.35);

        let a_bead = mesh.sphere();
        a_bead.position.x = ang.cos().scale(rad);
        a_bead.position.y = y;
        a_bead.position.z = ang.sin().scale(rad);
        a_bead.scale = kick.scale(0.45).add(0.42);
        spine.add(glow(a_bead, style.a, hit.scale(0.7).add(1.0)));

        let b_bead = mesh.sphere();
        b_bead.position.x = ang.cos().scale(rad).scale(-1.0);
        b_bead.position.y = y;
        b_bead.position.z = ang.sin().scale(rad).scale(-1.0);
        b_bead.scale = snare.scale(0.45).add(0.42);
        spine.add(glow(b_bead, style.b, hit.scale(0.7).add(1.0)));
    }
    spine.rotation.z = 0.55;
    scene.add(spine);

    let cage = mesh.cube();
    cage.rotation.x = clock.scale(0.4);
    cage.rotation.y = clock.scale(-0.6);
    cage.scale = lead.scale(1.2).add(2.4);
    scene.add(wire(cage, style.c, hit.scale(0.6).add(0.95)));

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.045).add(1.012), 0.008 * style.speed)
        .warp.flow(level.scale(1.2).add(0.5), 2.0, clock.scale(0.5))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.945, style.mist, 0.85, 0.986))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
