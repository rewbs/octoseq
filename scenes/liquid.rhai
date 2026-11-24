//! roles: hit, kick, snare, hat, energy, bass

// LIQUID
// Three lights wander the frame and a ring breathes in the middle. What makes the
// picture is the loop: every frame the last one comes back bent by slow waves, so
// the lights' trails run like ink in water, changing colour as they age. Loud music
// stirs the water faster; a hit throws it.
//
//   hit      the water is thrown: the waves jump and the picture lurches forward
//   kick     the first light swells
//   snare    the second light swells
//   hat      the third light swells
//   bass     the ring opens
//   energy   how fast the water moves

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

// `style.mist` says how misty the look is, from 0 (crisp: short trails and a tight
// glow, so bright shapes sit on black) to 1 (misty: trails that linger until colour
// fills the frame). At 0.5 a setting is the scene's own. Every scene reads it
// through this, so it means the same in all of them.
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
    // `style.at` is where in the frame the scene sits (0, 0 is the middle; x to the
    // right and y down, in frame widths and heights). The eye moves the other way.
    let ex = style.at[0] * -9.57;
    let ey = style.at[1] * 5.39;
    camera.position = #{ x: ex, y: ey, z: 6.5 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);

    // A clock that never stops but runs faster while the music is loud: everything
    // that drifts here drifts on it, so quiet passages slow the whole scene down.
    let t = timing.time.scale(style.speed);
    let clock = t.scale(0.45).add(level.integrate(0.0).scale(1.5 * style.speed));

    let drums = [kick, snare, hat];
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let light = radial.ring(#{ radius: 0.2, thickness: 0.2, segments: 40 });
        // Each on its own pair of speeds, so the three never repeat a formation.
        light.position.x = clock.scale(0.9 + i * 0.23).add(i * 2.1).sin().scale(2.7);
        light.position.y = clock.scale(0.7 + i * 0.31).add(i * 1.3 + 1.57).sin().scale(1.35);
        light.scale = drums[i].scale(1.3).add(0.75);
        scene.add(glow(light, colours[i], hit.scale(0.4).add(0.6)));
    }

    let iris = radial.ring(#{ radius: 0.9, thickness: 0.05, segments: 96 });
    iris.scale = bass.scale(0.8).add(hit.scale(0.7)).add(0.5);
    scene.add(glow(iris, style.c, 0.8));

    // The loop. Waves bend the last frame, more when loud and far more on a hit; it
    // grows a little each frame, so trails travel outwards; it turns one way and
    // then the other on two slow speeds that never line up; and its colour creeps
    // round the wheel, so a trail is a rainbow of its own age.
    let turn = t.scale(0.37).sin().scale(0.01).add(t.scale(0.58).sin().scale(0.007));
    // The tide: the picture streams outwards for a while, then slackens and draws
    // back in, on a period of half a minute, so the same scene has several looks.
    let tide = t.scale(0.21).sin().scale(0.022).add(1.018);
    let fb = feedback.builder()
        .warp.waves(hit.scale(9.0).add(level.scale(2.5)).add(2.6), 1.0, clock)
        .warp.affine(hit.scale(0.07).add(tide), turn)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.965, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.7, style.mist, 0.35, 0.7), radius: misted(10.0, style.mist, 5.0, 10.0) }));
}
