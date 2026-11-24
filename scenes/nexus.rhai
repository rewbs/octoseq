//! roles: hit, kick, snare, energy, bass

// NEXUS
// A tunnel that is the same on the left as on the right. A core burns in the
// middle, struts and sparks circle it, and the loop throws everything outwards
// fast, so the walls rush past; an echo of the picture, flipped, is laid over it,
// which is what makes the two halves agree.
//
//   hit      the tunnel surges and its walls ripple
//   kick     the core swells
//   snare    the struts jump outwards
//   bass     the core's size
//   energy   how fast the tunnel runs

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.25);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // The core.
    let core = radial.ring(#{ radius: 0.2, thickness: 0.4, segments: 40 });
    core.scale = bass.scale(0.9).add(kick.scale(0.8)).add(0.5);
    scene.add(glow(core, style.c, hit.scale(1.2).add(0.9)));

    // Struts: short arcs that circle the core, all on one side. The echo makes
    // the other side.
    for i in 0..3 {
        let strut = radial.ring(#{ radius: 0.9 + i * 0.35, thickness: 0.1, start_angle: -0.5, end_angle: 0.5, segments: 24 });
        strut.rotation.z = clock.scale(0.6 + i * 0.25).add(i * 2.1).sin().scale(1.3);
        strut.scale = snare.scale(0.5).add(1.0);
        scene.add(glow(strut, if i == 1 { style.a } else { style.b }, hit.scale(0.4).add(0.65)));
    }
    // Sparks riding round.
    for i in 0..2 {
        let spark = radial.ring(#{ radius: 0.06, thickness: 0.12, segments: 16 });
        let angle = clock.scale(1.7 - i * 0.6).add(i * 3.0);
        spark.position.x = angle.sin().scale(1.9 - i * 0.7);
        spark.position.y = angle.add(1.5708).sin().scale(1.2 + i * 0.4);
        scene.add(glow(spark, style.a, hit.scale(0.5).add(0.8)));
    }

    // Outwards, fast: what was at the core a moment ago is the wall now.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.02).add(hit.scale(0.05)).add(1.03), clock.scale(0.5).sin().scale(0.006))
        .warp.ripple(hit.scale(0.04).add(0.012), 5.0, clock.scale(2.0))
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.echo(#{ alpha: 0.5, zoom: 1.0, flip: 1.0 }));
    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.5), intensity: misted(0.8, style.mist, 0.4, 0.8), radius: misted(10.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
