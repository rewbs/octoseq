//! roles: hit, lead, brightness, melody, energy

// APOLLONIAN
// Nested circle-inversion stained glass inspired by Apollonian gaskets and
// hyperbolic tilings. Pitch brightness and melody gently shift the inversion
// fold while blows step the glass into a fresh kaleidoscopic rosette.
//
//   hit         steps the glass fold into a new symmetry
//   lead        expands the counter-rotating brass arcs
//   brightness  adjusts the circle inversion radius
//   melody      drifts the stained glass fold shift
//   energy      drives the steady rotation

let style = #{ a: [1.0, 0.76, 0.12], b: [0.58, 0.14, 0.78], c: [0.12, 0.82, 0.55], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let lead = roles.lead.smooth.exponential(0.05, 0.38);
    let bright = roles.brightness.smooth.exponential(0.07, 0.45);
    let melody = roles.melody.smooth.exponential(0.06, 0.42);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.24 * style.speed).add(level.integrate(0.0).scale(0.6 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let arc = radial.ring(#{ radius: 1.1 + i * 0.75, thickness: 0.08, start_angle: 0.0, end_angle: 3.6, segments: 48 });
        arc.rotation.z = clock.scale(if i % 2 == 0 { 0.45 } else { -0.35 }).add(count.scale(0.5236 * (i + 1)));
        arc.scale = lead.scale(0.35).add(hit.scale(0.25)).add(0.85);
        scene.add(glow(arc, colours[i], hit.scale(0.5).add(0.85)));
    }

    let fb = feedback.builder()
        .warp.affine(0.99, 0.004 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.78, 0.97))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.64, 0.38), intensity: misted(0.75, style.mist, 0.4, 0.98), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    post.add(fx.ground(#{ kind: 16, zoom: 1.45, angle: clock.scale(0.1).add(count.scale(0.26)), phase: clock.scale(0.7).add(count.scale(0.35)), p1: bright.scale(0.6).add(1.1), p2: melody.scale(1.4).add(count.scale(0.4)), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
