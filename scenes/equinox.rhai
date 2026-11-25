//! roles: hit, lead, melody, bass, energy

// EQUINOX
// Inspired by Milkdrop's Fractal/Nested Circle family: luminous planetary
// rings reflected recursively inside a circular inset mirror at the centre of
// the frame, creating an infinite tunnel of golden-ratio halos.
//
//   hit     steps the recursive mirror's angle and brightens the halos
//   lead    expands the inset mirror's aperture
//   melody  drives the counter-orbiting twin moons
//   bass    swells the outer planetary ring
//   energy  sets the orbital pace

let style = #{ a: [0.92, 0.64, 0.18], b: [0.22, 0.48, 0.78], c: [0.85, 0.22, 0.32], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let lead = roles.lead.smooth.exponential(0.05, 0.35);
    let melody = roles.melody.smooth.exponential(0.06, 0.4);
    let bass = roles.bass.smooth.exponential(0.04, 0.35);
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.32 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let halo = radial.ring(#{ radius: 2.6, thickness: 0.14, segments: 96 });
    halo.scale = bass.scale(0.45).add(0.88);
    scene.add(glow(halo, style.a, hit.scale(0.6).add(0.95)));

    let colours = [style.b, style.c, style.a];
    for i in 0..3 {
        let moon = radial.ring(#{ radius: 0.28, thickness: 0.36, segments: 32 });
        let a = clock.scale(0.75 + i * 0.15).add(i * 2.0944);
        let r = melody.scale(0.9).add(2.1);
        moon.position.x = a.cos().scale(r);
        moon.position.y = a.sin().scale(r);
        moon.scale = lead.scale(0.85).add(hit.scale(0.55)).add(0.7);
        scene.add(glow(moon, colours[i], hit.scale(0.65).add(1.0)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.04).add(1.012), 0.008 * style.speed)
        .color.inset(lead.scale(0.08).add(0.28), 0.82, clock.scale(0.2).add(count.scale(0.35)), 0.72)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.94, style.mist, 0.85, 0.985))
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
