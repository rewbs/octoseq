//! roles: hit, kick, energy, bass

// WHIRLPOOLS
// One whirlpool, shown four times. Two lights circle a drain, the loop winds
// their trails inwards in a spiral while the colour runs round the wheel, and the
// finished picture is tiled two by two, each tile the mirror of its neighbours, so
// four whirlpools turn against each other and their arms join at the seams.
//
//   hit      the whirlpools spin up and the tiling pulls back
//   kick     the lights swell
//   bass     how wide the lights circle
//   energy   how fast the water turns

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
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let light = radial.ring(#{ radius: 0.22, thickness: 0.44, segments: 28 });
        let angle = clock.scale(0.8 + i * 0.3).add(i * 2.0944);
        let reach = bass.scale(0.8).add(2.6 + i * 0.4);
        light.position.x = angle.sin().scale(reach).scale(1.5);
        light.position.y = angle.add(1.5708).sin().scale(reach);
        light.scale = kick.scale(0.9).add(0.8);
        scene.add(glow(light, colours[i], hit.scale(0.4).add(0.7)));
    }

    // Wound inwards, and the colour never still.
    let fb = feedback.builder()
        .warp.affine(hit.scale(-0.015).add(0.984), level.scale(0.04).add(hit.scale(0.06)).add(0.045).scale(style.speed))
        // (half of what first stood in for the waves: at the full amount the picture moved so
        // much between blows that the blows themselves stood out less)
        .warp.whirls(level.scale(1.5).add(1.0).scale(0.03), 5.0, clock.scale(0.3))
        .color.hsv(0.012, 0.0, 0.0)
        .color.decay(misted(0.985, style.mist, 0.9, 0.993))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Two by two, mirrored.
    post.add(fx.zoomWrap(#{ amount: hit.scale(0.25).add(2.0), center: #{ x: 0.5, y: 0.5 }, wrap_mode: "mirror" }));
    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.5), intensity: misted(0.6, style.mist, 0.35, 0.8), radius: misted(8.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
