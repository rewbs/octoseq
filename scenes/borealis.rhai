//! roles: hit, melody, brightness, lead, energy

// BOREALIS
// Northern lights: five undulating curtains of polar silk shimmering across
// a star-strewn night sky. Built for atmospheric and less-rhythmic sections
// where melody, lead phrasing, and spectral brightness gently paint the sky.
//
//   hit         sends a soft pulse through the curtains and twinkles the stars
//   melody      lifts the vertical reach of the auroral curtains
//   brightness  increases the fine curtain wave frequency
//   lead        guides the drifting star-field glow
//   energy      sets the solar wind pace

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

// Colour a line or point cloud directly from a palette colour and brightness signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.14 });
    let melody = roles.melody.smooth.exponential(0.08, 0.55);
    let bright = roles.brightness.smooth.exponential(0.08, 0.55);
    let lead = roles.lead.smooth.exponential(0.06, 0.45);
    let level = roles.energy.smooth.exponential(0.08, 0.55);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.2 * style.speed).add(level.integrate(0.0).scale(0.45 * style.speed));

    let stars = points.cloud(#{ count: 160, spread: 6.2, mode: "uniform", seed: 73, point_size: 2.2 });
    stars.rotation.z = clock.scale(0.08);
    stars.point_size = hit.scale(2.2).add(lead.scale(1.4)).add(1.8);
    stars.color = tint(style.c, bright.scale(0.5).add(0.8));
    scene.add(stars);

    let arc = radial.wave(melody, #{ base_radius: 2.4, amplitude: 0.4, wave_frequency: 3, resolution: 140 });
    arc.rotation.z = clock.scale(0.14);
    arc.color = tint(style.a, hit.scale(0.45).add(lead.scale(0.45)).add(0.55));
    scene.add(arc);

    let fb = feedback.builder()
        .warp.flow(melody.scale(1.0).add(0.4), 2.0, clock.scale(0.35))
        .warp.affine(0.994, 0.0015 * style.speed)
        .color.hsv(0.0015, 0.0, 0.0)
        .color.decay(misted(0.92, style.mist, 0.82, 0.978))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.8, style.mist, 0.42, 1.05), radius: misted(12.0, style.mist, 6.0, 16.0) }));
    post.add(fx.ground(#{ kind: 11, zoom: 1.5, angle: clock.scale(0.04).sin().scale(0.18), phase: clock.scale(0.9).add(count.scale(0.32)), p1: bright.scale(1.6).add(1.0), p2: melody.scale(0.9).add(0.75), amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
