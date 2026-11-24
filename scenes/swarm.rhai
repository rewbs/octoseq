//! roles: hit, onset, energy, bass

// SWARM
// Two shells of sparks, one inside the other, spinning hard in opposite senses
// about different axes, like a swarm round a hive. The loop spins what they
// leave behind as well, so each spark draws a short hooked tail. It is the
// fastest thing in the pool: nothing in it holds still.
//
//   hit      the swarm bursts outwards and falls back
//   onset    the sparks flare in size
//   bass     how big the swarm is
//   energy   how fast it spins

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// A colour at a brightness that is a signal.
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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let flare = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.05, decay_beats: 0.4 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    let colours = [style.a, style.c, style.b];
    let counts = [260, 180, 90];
    for i in 0..3 {
        let shell = points.cloud(#{ count: counts[i], spread: 2.6 - i * 0.8, mode: "sphere", seed: 7 + i, point_size: 4.0 });
        shell.rotation.y = clock.scale(if i == 1 { -1.3 } else { 1.0 + i * 0.3 });
        shell.rotation.x = clock.scale(0.7 - i * 0.5).add(i * 1.1);
        shell.scale = bass.scale(0.35).add(hit.scale(0.8)).add(0.8);
        shell.point_size = flare.scale(1.5).add(3.5);
        shell.color = tint(colours[i], hit.scale(0.5).add(1.2));
        scene.add(shell);
    }

    // The trails are spun too, and thrown outwards.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.05).add(1.02), level.scale(0.04).add(0.03).scale(style.speed))
        .warp.waves(level.scale(1.5).add(1.0), 1.0, clock.scale(0.3))
        .color.hsv(0.008, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.8, 0.98))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.35), intensity: misted(0.9, style.mist, 0.6, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
