//! roles: hit, kick, energy, bass, flux

// MERCURY
// Liquid metal. Three dim rings of light move under the surface; the loop stirs
// their trails in slow coils, sharpens them against a wide blur so every fold
// catches a highlight, and almost all the colour is taken out, leaving silver
// with a tint. It is heavy and slow where the other liquids are quick.
//
//   hit      the surface is struck: a shudder runs through it
//   kick     the lights swell
//   bass     how bright the highlights are cut
//   flux     how hard the surface is stirred
//   energy   how fast the coils turn

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let stir = roles.flux.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.2 * style.speed).add(level.integrate(0.0).scale(0.5 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let light = radial.ring(#{ radius: 0.8, thickness: 0.18, segments: 40 });
        light.position.x = clock.scale(0.5 + i * 0.17).add(i * 2.1).sin().scale(3.6);
        light.position.y = clock.scale(0.7 - i * 0.13).add(i * 1.4).sin().scale(2.0);
        light.scale = kick.scale(0.5).add(0.9);
        scene.add(glow(light, colours[i], hit.scale(0.25).add(0.5)));
    }

    let fb = feedback.builder()
        .warp.waves(stir.scale(2.5).add(hit.scale(5.0)).add(1.6), 0.7, clock)
        .warp.spiral(0.25 * style.speed, 0.004)
        .color.sharpen(bass.scale(0.3).add(0.35), 0.035, 1.0)
        .color.decay(misted(0.982, style.mist, 0.9, 0.993))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Nearly all the colour out, and the contrast up: metal.
    post.add(fx.colorGrade(#{ saturation: 0.3, contrast: 1.45, gamma: 0.9 }));
    post.add(fx.bloom(#{ threshold: misted(0.7, style.mist, 0.8, 0.6), intensity: misted(0.4, style.mist, 0.2, 0.6), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
