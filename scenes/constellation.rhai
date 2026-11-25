//! roles: hit, onset, brightness, melody, lead, energy

// CONSTELLATION
// A deep celestial map of three drifting star clouds and glowing constellation
// nodes linked by rotating geometric rings. Built for quiet, spacious, and
// melodic moments where subtle onsets and pitch brightness twinkle across the sky.
//
//   hit         pulses the major constellation stars
//   onset       twinkles the fine starfield points
//   brightness  lifts the constellation's palette brilliance and tilt
//   melody      expands the celestial rings
//   lead        swells the anchor nodes
//   energy      sets the slow celestial drift

let style = #{ a: [0.55, 0.92, 1.0], b: [1.0, 0.86, 0.38], c: [0.68, 0.18, 0.92], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let onset = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let bright = roles.brightness.smooth.exponential(0.08, 0.5);
    let melody = roles.melody.smooth.exponential(0.06, 0.45);
    let lead = roles.lead.smooth.exponential(0.06, 0.42);
    let level = roles.energy.smooth.exponential(0.08, 0.5);
    let clock = timing.time.scale(0.18 * style.speed).add(level.integrate(0.0).scale(0.45 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let cloud = points.cloud(#{ count: 140, spread: 5.8, mode: "uniform", seed: 11 + i * 37, point_size: 2.3 });
        cloud.rotation.z = clock.scale(if i == 1 { -0.22 } else { 0.16 + i * 0.08 });
        cloud.rotation.y = bright.scale(0.5).add(i * 1.1);
        cloud.point_size = onset.scale(2.4).add(lead.scale(1.2)).add(1.8);
        cloud.color = tint(colours[i], hit.scale(0.5).add(0.95));
        scene.add(cloud);
    }

    for i in 0..5 {
        let star = radial.ring(#{ radius: 0.2, thickness: 0.34, segments: 24 });
        let a = clock.scale(0.28 + i * 0.06).add(i * 1.2566);
        let r = melody.scale(1.0).add(1.6 + (i % 3) * 0.7);
        star.position.x = a.cos().scale(r).scale(1.4);
        star.position.y = a.sin().scale(r).scale(0.8);
        star.scale = lead.scale(0.9).add(hit.scale(0.6)).add(0.65);
        scene.add(glow(star, colours[i % 3], hit.scale(0.7).add(1.0)));
    }

    let orbit = radial.ring(#{ radius: 2.5, thickness: 0.06, segments: 72 });
    orbit.scale = melody.scale(0.3).add(0.9);
    scene.add(glow(orbit, style.a, hit.scale(0.45).add(0.65)));

    let fb = feedback.builder()
        .warp.flow(melody.scale(1.1).add(0.4), 1.8, clock.scale(0.35))
        .warp.affine(0.993, 0.003 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.42, style.mist, 0.6, 0.32), intensity: misted(0.82, style.mist, 0.45, 1.05), radius: misted(11.0, style.mist, 5.0, 15.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
