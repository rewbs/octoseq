//! roles: hit, beat_phase, kick, snare, hat, energy

// CHRONOS
// Inspired by Milkdrop's Sparkle/Mass Circles family: precision concentric
// clockwork escapement rings and twelve radial hour-markers locked tight to
// the track's beat phase. Crisp, mechanical, and hyper-rhythmic.
//
//   hit         snaps the escapement wheel forward a cog and pulses the rings
//   beat_phase  sweeps the main clock hand and throbs the inner dial
//   kick        punches the central escapement gear
//   snare       expands the outer dial arcs
//   hat         ticks the twelve rim jewels
//   energy      rotates the secondary gear train

let style = #{ a: [1.0, 0.76, 0.12], b: [0.14, 0.72, 0.68], c: [0.95, 0.25, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.22 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let beat_p = roles.beat_phase;
    let clock = timing.time.scale(0.35 * style.speed).add(level.integrate(0.0).scale(0.9 * style.speed));

    let gear = radial.ring(#{ radius: 0.85, thickness: 0.14, segments: 12 });
    gear.rotation.z = count.scale(0.5236);
    gear.scale = kick.scale(0.85).add(beat_p.scale(-0.25)).add(0.9);
    scene.add(glow(gear, style.a, hit.scale(0.8).add(1.0)));

    for i in 0..4 {
        let a = i * 1.5708;
        let arc = radial.ring(#{ radius: 1.9, thickness: 0.12, start_angle: a, end_angle: a + 0.9, segments: 24 });
        arc.rotation.z = clock.scale(-0.55).sub(count.scale(0.3927));
        arc.scale = snare.scale(0.45).add(0.95);
        scene.add(glow(arc, style.b, hit.scale(0.65).add(0.9)));
    }

    for i in 0..12 {
        let a = i * 0.5236;
        let jewel = radial.ring(#{ radius: 0.14, thickness: 0.24, segments: 16 });
        let ang = clock.scale(0.25).add(a);
        jewel.position.x = ang.cos().scale(2.9);
        jewel.position.y = ang.sin().scale(2.9);
        jewel.scale = hat.scale(0.9).add(0.75);
        scene.add(glow(jewel, style.c, hit.scale(0.6).add(0.9)));
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.05).add(1.012), 0.008 * style.speed)
        .warp.whirls(hit.scale(0.035).add(0.012), 6.0, clock.scale(0.4))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.935, style.mist, 0.84, 0.984))
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
