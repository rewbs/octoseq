//! roles: hit, lead, brightness, melody, energy

// COMET
// Inspired by Milkdrop's Dancer/Comet family: a blazing comet head sweeping a
// wide tilted orbit, shedding a long silk tail carried off by slow eddies.
// Built for melodic and less-rhythmic sections where lead and pitch brightness
// guide the orbit and tail colour.
//
//   hit         flares the comet's coma and nudges the tail's drift
//   lead        grows the comet head and widens its orbit
//   brightness  tilts the orbital inclination and shifts tail hue
//   melody      stirs the curling dust eddies behind the comet
//   energy      controls orbital speed

let style = #{ a: [1.0, 0.72, 0.08], b: [0.18, 0.48, 1.0], c: [1.0, 0.42, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let lead = roles.lead.smooth.exponential(0.05, 0.4);
    let bright = roles.brightness.smooth.exponential(0.07, 0.48);
    let melody = roles.melody.smooth.exponential(0.06, 0.45);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let clock = timing.time.scale(0.32 * style.speed).add(level.integrate(0.0).scale(0.75 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let head = radial.ring(#{ radius: 0.32 - i * 0.06, thickness: 0.45, segments: 32 });
        let a = clock.scale(0.75 + i * 0.17).add(i * 2.0944);
        let rx = lead.scale(1.5).add(2.8);
        let ry = bright.scale(1.1).add(1.3);
        head.position.x = a.cos().scale(rx);
        head.position.y = a.sin().scale(ry);
        head.scale = lead.scale(0.85).add(hit.scale(0.55)).add(0.8);
        scene.add(glow(head, colours[i], hit.scale(0.6).add(1.1)));
    }

    let ring = radial.ring(#{ radius: 2.2, thickness: 0.07, segments: 64 });
    ring.scale = melody.scale(0.35).add(0.95);
    scene.add(glow(ring, style.b, hit.scale(0.45).add(0.65)));

    let fb = feedback.builder()
        .warp.flow(melody.scale(2.0).add(0.7), 2.2, clock.scale(0.45))
        .warp.affine(hit.scale(0.035).add(1.008), 0.008 * style.speed)
        .color.hsv(bright.scale(0.006).add(0.002), 0.0, 0.0)
        .color.decay(misted(0.96, style.mist, 0.87, 0.99))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.42, style.mist, 0.6, 0.32), intensity: misted(0.85, style.mist, 0.45, 1.1), radius: misted(12.0, style.mist, 5.0, 16.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
