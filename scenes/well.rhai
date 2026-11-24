//! roles: hit, kick, snare, hat, energy, bass

// WELL
// Looking down a well. Lights race round the rim of the frame and the loop pulls
// every frame towards the centre, in rings that squeeze and stretch as they fall,
// so the rim's light pours inwards in bands and vanishes into the middle.
//
//   hit      the well gulps: everything drops towards the centre at once
//   kick     the rim's main light flares
//   snare    its opposite number flares
//   hat      the small lights between them flicker
//   bass     how wide the rim is
//   energy   how fast the lights race and the rings fall

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
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.45 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);

    // Runs on with time, and faster while the music is loud.
    let t = timing.time.scale(style.speed);
    let clock = t.scale(0.5).add(level.integrate(0.0).scale(1.8 * style.speed));

    // Eight lights on the rim: two large ones opposite each other, six small.
    let radius = bass.scale(0.5).add(2.4);
    for i in 0..8 {
        let big = i % 4 == 0;
        let light = radial.ring(#{ radius: if big { 0.3 } else { 0.11 }, thickness: if big { 0.3 } else { 0.11 }, segments: 32 });
        let angle = clock.scale(0.9).add(i * 0.7854);
        light.position.x = angle.sin().scale(1.0).mul(radius);
        light.position.y = angle.add(1.5708).sin().scale(0.62).mul(radius);
        let drum = if i == 0 { kick } else if i == 4 { snare } else { hat };
        let colour = if i == 0 { style.a } else if i == 4 { style.b } else { style.c };
        light.scale = drum.scale(1.2).add(0.8);
        scene.add(glow(light, colour, hit.scale(0.4).add(0.6)));
    }

    // The loop: a steady pull to the centre (each frame comes back larger, so what
    // was at the rim is nearer the middle), rings of squeeze and stretch that fall
    // with the clock, a slow turn, and creeping colour. A hit doubles the pull.
    let fb = feedback.builder()
        .warp.ripple(hit.scale(0.08).add(0.04), t.scale(0.17).sin().scale(1.2).add(2.2), clock.scale(2.0))
        // The pull towards the middle. Misty, it slackens: trails then linger on their
        // way in and colour reaches the edges, where at its own strength they are gone
        // before a long fade can show.
        .warp.affine(hit.scale(-0.08).add(misted(0.962, style.mist, 0.962, 0.99)), t.scale(0.23).sin().scale(0.022))
        .warp.waves(level.scale(0.6).add(0.3), 0.8, clock)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.97, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.7, style.mist, 0.35, 0.7), radius: misted(10.0, style.mist, 5.0, 10.0) }));
}
