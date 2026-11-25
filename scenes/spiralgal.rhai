//! roles: hit, lead, brightness, bass, energy

// SPIRALGAL
// A luminous multi-arm spiral galaxy turning slowly around a blazing core,
// laced with stardust clouds. Built for soaring, atmospheric passages where
// lead and pitch brightness wind and tint the galactic arms.
//
//   hit         pulses the galactic core and nudges the spiral rotation
//   lead        expands the stardust disk
//   brightness  winds the logarithmic spiral arms tighter
//   bass        swells the glowing core
//   energy      controls the galaxy's rotation speed

let style = #{ a: [0.68, 0.18, 0.92], b: [1.0, 0.62, 0.2], c: [0.12, 0.82, 0.85], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

// Colour a line or point cloud directly from a palette colour and brightness signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let lead = roles.lead.smooth.exponential(0.06, 0.42);
    let bright = roles.brightness.smooth.exponential(0.08, 0.5);
    let bass = roles.bass.smooth.exponential(0.05, 0.4);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.22 * style.speed).add(level.integrate(0.0).scale(0.55 * style.speed));

    let dust = points.cloud(#{ count: 180, spread: 5.5, mode: "uniform", seed: 42, point_size: 2.2 });
    dust.rotation.z = clock.scale(0.32);
    dust.scale = lead.scale(0.35).add(0.9);
    dust.point_size = hit.scale(2.0).add(1.8);
    dust.color = tint(style.c, bright.scale(0.5).add(0.75));
    scene.add(dust);

    let core = radial.ring(#{ radius: 0.22, thickness: 0.38, segments: 32 });
    core.scale = bass.scale(0.9).add(hit.scale(0.5)).add(0.7);
    scene.add(glow(core, style.b, hit.scale(0.6).add(0.9)));

    let fb = feedback.builder()
        .warp.spiral(0.25 * style.speed, 0.006)
        .warp.affine(0.992, 0.005 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.92, style.mist, 0.8, 0.978))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.8, style.mist, 0.4, 1.05), radius: misted(11.0, style.mist, 5.0, 15.0) }));
    post.add(fx.ground(#{ kind: 14, zoom: 1.75, angle: clock.scale(0.18).add(count.scale(0.24)), phase: clock.scale(0.85).add(count.scale(0.3)), p1: 3.0, p2: bright.scale(2.4).add(2.0), amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
