//! roles: hit, kick, energy, bass, flux

// RORSCHACH
// Blots. Three lights drift on one side of the frame; the loop stirs their trails
// like ink in water and sharpens them against a blurred copy of themselves, so
// the ink gathers into hard-edged pools, and the picture is folded down the
// middle so both halves match. What it looks like is up to whoever is looking.
//
//   hit      the ink is shaken and the blots spread
//   kick     the lights swell
//   bass     how hard the edges are cut
//   flux     how much the ink is stirred
//   energy   how fast the lights drift

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp, for the scene's own movement. The whole frame's answer, at the end, has shapes of its own.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let stir = roles.flux.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let light = radial.ring(#{ radius: 0.2, thickness: 0.4, segments: 28 });
        light.position.x = clock.scale(0.41 + i * 0.13).add(i * 2.3).sin().scale(1.6).sub(2.1);
        light.position.y = clock.scale(0.53 - i * 0.11).add(i * 1.1).sin().scale(1.9);
        light.scale = kick.scale(0.9).add(0.8);
        scene.add(glow(light, colours[i], hit.scale(0.4).add(0.7)));
    }

    let fb = feedback.builder()
        .warp.waves(stir.scale(3.0).add(hit.scale(4.0)).add(1.5), 1.6, clock)
        .warp.affine(hit.scale(0.035).add(1.006), clock.scale(0.4).sin().scale(0.006))
        .color.sharpen(bass.scale(0.2).add(0.3), 0.02, 0.7)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.975, style.mist, 0.88, 0.99))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Folded down the middle.
    post.add(fx.echo(#{ alpha: 0.5, zoom: 1.0, flip: 1.0 }));
    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.55), intensity: misted(0.4, style.mist, 0.25, 0.6), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
