//! roles: hit, kick, energy, bass, section_intensity

// FLARE
// Looking into the sun. One light in the middle, many times brighter than white,
// with a ring of smaller lights round it; the picture is smeared outwards from
// the middle until the lights are rays, and the colours are pulled apart at the
// edges the way a cheap lens pulls them. A loud section is a bigger sun.
//
//   hit      the sun flares: the rays shoot out and the colours split wide
//   kick     the small lights jump outwards
//   bass     the sun's size
//   section_intensity   how big the sun is for this section of the track
//   energy   how fast the small lights circle

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

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

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.125 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.4);
    let grand = roles.section_intensity.smooth.exponential(1.0, 1.0);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    // The sun. Its size may only breathe: a light this bright fills the frame, and
    // if the drums moved it the whole picture would flash with them.
    let sun = radial.ring(#{ radius: 0.2, thickness: 0.4, segments: 40 });
    sun.scale = bass.scale(0.5).add(grand.scale(0.9)).add(0.6);
    scene.add(glow(sun, style.c, hit.scale(1.5).add(4.0)));

    // Seven smaller lights, unevenly round it, on two rings that turn against
    // each other: these make the separate rays.
    let colours = [style.a, style.b, style.c, style.a, style.b, style.a, style.b];
    for i in 0..7 {
        let light = radial.ring(#{ radius: 0.05, thickness: 0.1, segments: 12 });
        let angle = clock.scale(if i % 2 == 0 { 0.35 } else { -0.25 }).add(i * 0.8976 + (i % 3) * 0.3);
        let reach = kick.scale(0.5).add(1.1 + (i % 3) * 0.55);
        light.position.x = angle.sin().scale(reach);
        light.position.y = angle.add(1.5708).sin().scale(reach);
        scene.add(glow(light, colours[i], hit.scale(1.0).add(2.5)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.015), 0.003 * style.speed)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.92, style.mist, 0.82, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.radialBlur(#{ strength: hit.scale(0.3).add(grand.scale(0.2)).add(0.45), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] }, samples: 32 }));
    post.add(fx.chromaticAberration(#{ amount: hit.scale(0.015).add(0.006), angle: clock.scale(0.5) }));
    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
