//! roles: hit, drums, bass, melody, energy

// QUARTET
// Each part of the band has its own place in the frame and moves only when that
// part plays. The drums are the ring of studs round the outside; the bass is the
// great ring that swells in the middle; the melody (everything that is neither) is
// the wavering line between them and the two lights that ride it. A passage with
// no drums leaves the studs dark; a bass drop opens the ring on its own.
//
// Each part's level moves its shapes' size. Brightness follows only the hits, which
// are never close enough together to strobe; a drum stem's level flickers faster
// than the eye should be asked to take over a whole frame.
//
// This is the scene that needs the track taken apart: the three levels come from
// the separated stems, not from frequency bands of the mix.
//
//   drums    the studs round the rim flare and the rim turns
//   bass     the middle ring swells
//   melody   the line wavers and its lights brighten
//   hit      the picture lurches forward
//   energy   how fast the water in the loop moves

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

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

// The same for a line, whose colour is set directly.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    // `style.at` is where in the frame the scene sits (0, 0 is the middle; x to the
    // right and y down, in frame widths and heights). The eye moves the other way.
    let ex = style.at[0] * -9.57;
    let ey = style.at[1] * 5.39;
    camera.position = #{ x: ex, y: ey, z: 6.5 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    // Fast up, slower down: each part's level as the eye should follow it.
    let drums = roles.drums.smooth.exponential(0.01, 0.12);
    let bass = roles.bass.smooth.exponential(0.03, 0.25);
    let melody = roles.melody.smooth.exponential(0.04, 0.3);
    let level = roles.energy.smooth.exponential(0.05, 0.4);

    let t = timing.time.scale(style.speed);
    let clock = t.scale(0.4).add(level.integrate(0.0).scale(1.4 * style.speed));
    // The rim turns only while the drums play.
    let rim = drums.integrate(0.0).scale(2.5 * style.speed);

    // Drums: sixteen studs round the rim.
    for i in 0..16 {
        let stud = radial.ring(#{ radius: 0.1, thickness: 0.1, segments: 20 });
        let angle = rim.add(i * 0.3927);
        stud.position.x = angle.sin().scale(3.3);
        stud.position.y = angle.add(1.5708).sin().scale(1.75);
        stud.scale = drums.scale(2.4).add(0.12);
        scene.add(glow(stud, style.c, hit.scale(0.35).add(0.6)));
    }

    // Bass: the ring in the middle.
    let ring = radial.ring(#{ radius: 0.6, thickness: 0.2, segments: 96 });
    ring.scale = bass.scale(1.7).add(0.2);
    scene.add(glow(ring, style.a, hit.scale(0.3).add(0.65)));

    // Melody: a wavering line, and two lights riding round it.
    let line = radial.wave(melody, #{ base_radius: 1.5, amplitude: 0.55, wave_frequency: 5, resolution: 192 });
    line.rotation.z = clock.scale(0.3);
    line.color = tint(style.b, hit.scale(0.3).add(0.65));
    scene.add(line);
    for i in 0..2 {
        let rider = radial.ring(#{ radius: 0.13, thickness: 0.13, segments: 24 });
        let angle = clock.scale(0.9).add(i * 3.1416);
        rider.position.x = angle.sin().scale(1.5);
        rider.position.y = angle.add(1.5708).sin().scale(1.5);
        rider.scale = melody.scale(1.9).add(0.12);
        scene.add(glow(rider, style.b, hit.scale(0.3).add(0.65)));
    }

    // The loop: the same water as the other scenes, stirred by the melody rather
    // than by loudness, so a held chord keeps the trails moving after the drums stop.
    let fb = feedback.builder()
        .warp.waves(hit.scale(5.0).add(melody.scale(2.5)).add(0.8), 1.0, clock)
        .warp.affine(hit.scale(0.045).add(bass.scale(0.012)).add(1.008), t.scale(0.33).sin().scale(0.009))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.7, style.mist, 0.35, 0.7), radius: misted(10.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
