//! roles: hit, lead, bass, melody, energy

// RIPPLES
// Inspired by Milkdrop's Reaction/Liquid Ripples family: concentric liquid
// rings expanding across a dark pool, bent into standing interference ripples
// by the feedback loop. Smooth and luminous for melodic and bass-led passages.
//
//   hit     drops a fresh bright stone into the pool
//   lead    drives the inner ripples' breadth
//   bass    swells the deep pool ring
//   melody  stirs the radial ripple warp
//   energy  sets the speed of the expanding rings

let style = #{ a: [0.08, 0.68, 0.82], b: [1.0, 0.42, 0.35], c: [0.98, 0.9, 0.55], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let lead = roles.lead.smooth.exponential(0.05, 0.38);
    let bass = roles.bass.smooth.exponential(0.04, 0.35);
    let melody = roles.melody.smooth.exponential(0.06, 0.42);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let clock = timing.time.scale(0.32 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..6 {
        let r = radial.ring(#{ radius: 0.7, thickness: 0.09, segments: 72 });
        let life = clock.scale(0.35).add(i * 0.1667).fract();
        r.scale = life.scale(4.6).add(0.4).add(bass.scale(0.35));
        scene.add(glow(r, colours[i % 3], hit.scale(0.6).add(lead.scale(0.4)).add(0.7)));
    }

    let surface = radial.wave(melody, #{ base_radius: 2.0, amplitude: 0.55, wave_frequency: 5, resolution: 180 });
    surface.rotation.z = clock.scale(-0.3);
    surface.color = tint(style.c, hit.scale(0.45).add(0.7));
    scene.add(surface);

    let fb = feedback.builder()
        .warp.ripple(melody.scale(0.025).add(hit.scale(0.03)).add(0.01), 4.0, clock.scale(1.6))
        .warp.affine(hit.scale(0.035).add(1.008), 0.003 * style.speed)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
