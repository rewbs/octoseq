//! roles: hit, kick, snare, energy, melody

// FRAMES
// A square frame at the edge of the picture, and the picture drawn again inside
// it, and again inside that: a corridor of frames running away to a point. The
// colour turns a step with every frame, so the corridor is banded like a rainbow,
// and whatever happens to the outer frame runs down the corridor after it. A
// small scribble sits where the corridor ends.
//
//   hit      the corridor swings to one side and its colours jump
//   kick     the outer frame thickens
//   snare    a second frame flashes inside the first
//   melody   the scribble at the far end
//   energy   how fast the colours run

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

// A line's colour at a brightness that is a signal.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let melody = roles.melody.smooth.exponential(0.03, 0.25);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // A ring with four sides is a square standing on its corner; turned an eighth
    // of a turn it is a frame.
    let frame = radial.ring(#{ radius: 4.75, thickness: 0.34, segments: 4 });
    frame.rotation.z = 0.7854;
    frame.scale = kick.scale(0.05).add(1.0);
    scene.add(glow(frame, style.a, hit.scale(0.4).add(0.75)));
    let second = radial.ring(#{ radius: 4.0, thickness: 0.14, segments: 4 });
    second.rotation.z = 0.7854;
    second.scale = snare.scale(0.1).add(0.95);
    scene.add(glow(second, style.b, hit.scale(0.4).add(0.7)));

    // The scribble.
    let scribble = radial.wave(melody, #{ base_radius: 0.5, amplitude: 0.45, wave_frequency: 7, resolution: 160 });
    scribble.rotation.z = clock.scale(0.8);
    scribble.color = tint(style.c, hit.scale(0.6).add(1.4));
    scene.add(scribble);

    // The last frame again inside a square; each one a step round the colour wheel.
    let lean = clock.scale(0.6).sin().scale(0.05).add(hit.scale(0.12));
    let fb = feedback.builder()
        .color.inset(0.44, 1.14, lean, 1.0, 4.0)
        .color.hsv(level.scale(0.03).add(hit.scale(0.04)).add(0.02).scale(style.speed), 0.0, 0.0)
        .color.decay(misted(0.94, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.75, 0.5), intensity: misted(0.5, style.mist, 0.25, 0.7), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
