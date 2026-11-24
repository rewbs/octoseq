//! roles: hit, kick, energy, bass, section_progress

// SPIROGRAPH
// A pen on a wheel rolling round inside a bigger wheel. Five pens trace looping
// curves that never quite close, the page keeps what they draw, and a
// kaleidoscope of eight wedges turns each stroke into a rosette: a flower that
// is added to petal by petal until the page is full, in colours at full strength.
// Over each section of the track the small wheel changes size, so the flower
// that fills the page at the end is not the one that started it.
//
//   hit      the page jumps outwards and the rosette turns a notch
//   kick     the pens press harder
//   bass     how far the pens reach
//   section_progress   the size of the small wheel: which flower is being drawn
//   energy   how fast the wheels roll

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.075 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.5);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));
    // How many times the small wheel turns for one trip round the big one.
    let gearing = roles.section_progress.scale(2.0).add(3.3);

    let colours = [style.a, style.b, style.c];
    for i in 0..5 {
        let pen = radial.ring(#{ radius: 0.1, thickness: 0.2, segments: 16 });
        let big = clock.scale(0.6).add(i * 1.2566);
        let small = clock.scale(0.6).scale(gearing).scale(-1.0).add(i * 0.9);
        let arm = bass.scale(0.7).add(1.0 + (i % 3) * 0.35);
        pen.position.x = big.sin().scale(2.1).add(small.sin().scale(arm));
        pen.position.y = big.add(1.5708).sin().scale(2.1).add(small.add(1.5708).sin().scale(arm));
        pen.scale = kick.scale(0.9).add(1.0);
        scene.add(glow(pen, colours[i % 3], hit.scale(0.5).add(1.3)));
    }

    // The page keeps what is drawn on it.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.0012), 0.0)
        .warp.whirls(level.scale(0.6).add(0.3).scale(0.08), 6.0, clock.scale(0.5).scale(0.5))
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.99, style.mist, 0.978, 0.996))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    let notch = hit.integrate(0.0).scale(0.2);
    post.add(fx.kaleidoscope(#{ segments: 8.0, angle: notch, center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.colorGrade(#{ saturation: 1.35, contrast: 1.1 }));
    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.45, 0.35), intensity: misted(0.9, style.mist, 0.7, 1.0), radius: misted(7.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
