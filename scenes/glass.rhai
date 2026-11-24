//! roles: hit, kick, energy, bass, melody

// GLASS
// Five great lamps drift across each other behind frosted glass. Each is a plain
// disc of colour; the picture is then blurred both ways until no disc has an
// edge, bent as if through a lens, and fringed with colour at its rim. What is
// left is slow gradients sliding over each other, and nothing with an outline.
//
//   hit      the lens flexes and the colour fringes spread
//   kick     the lamps swell
//   bass     how bright the lamps are
//   melody   how far the lamps wander
//   energy   how fast they drift

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.6 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bright = roles.bass.smooth.exponential(0.1, 0.6).scale(0.35).add(0.55);
    let wander = roles.melody.smooth.exponential(0.1, 0.5).scale(1.2).add(1.3);
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.6 * style.speed));

    let colours = [style.a, style.b, style.c, style.b, style.a];
    for i in 0..5 {
        let lamp = radial.ring(#{ radius: 0.9, thickness: 1.8, segments: 40 });
        lamp.position.x = clock.scale(0.6 + i * 0.13).add(i * 1.3).sin().scale(wander).scale(1.5).add(i * 2.3 - 4.6);
        lamp.position.y = clock.scale(0.8 - i * 0.09).add(i * 2.1).sin().scale(wander);
        // Nearer lamps are larger and pass in front.
        lamp.position.z = (i % 3) * 0.8 - 1.0;
        lamp.scale = kick.scale(0.2).add(1.0);
        scene.add(glow(lamp, colours[i], bright));
    }

    // A breath of trail, so a lamp leaves a little of itself on the glass.
    let fb = feedback.builder()
        .warp.waves(level.scale(1.0).add(0.6), 0.8, clock)
        .warp.affine(1.004, 0.0)
        .color.decay(misted(0.94, style.mist, 0.8, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Frosted: blurred across and then down. Then the lens, and its fringe.
    let frost = misted(46.0, style.mist, 22.0, 70.0);
    post.add(fx.directionalBlur(#{ amount: frost, angle: 0.0, samples: 32 }));
    post.add(fx.directionalBlur(#{ amount: frost, angle: 1.5708, samples: 32 }));
    post.add(fx.distortion(#{ amount: hit.scale(-0.15).sub(0.12), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.chromaticAberration(#{ amount: hit.scale(0.012).add(0.006), angle: clock }));
}
