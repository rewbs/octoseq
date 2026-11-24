//! roles: hit, onset, energy, flux

// AUTOMATA
// Something growing in a dish. A scatter of points seeds the frame, and the loop
// sharpens what they leave against a very fine blur, hard: so every speck either
// dies or thickens into a spot, spots join into worms, worms into a maze, and the
// maze is eaten away again as it fades. Mostly dark, in one or two colours, and
// alive at the scale of a few pixels.
//
//   hit      a fresh sowing: the seeds flare and the growth is shaken
//   onset    the seeds pulse in size
//   flux     how hard the growth is driven
//   energy   how fast the seeds turn

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.125 });
    let pulse = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.2 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let drive = roles.flux.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.08 * style.speed).add(level.integrate(0.0).scale(0.2 * style.speed));

    let colours = [style.a, style.b, style.c];
    let counts = [90, 60, 30];
    for i in 0..3 {
        let seeds = points.cloud(#{ count: counts[i], spread: 4.2, mode: "uniform", seed: 13 + i * 7, point_size: 2.0 });
        seeds.rotation.z = clock.scale(if i == 1 { -1.0 } else { 0.6 + i * 0.3 });
        seeds.rotation.y = clock.scale(0.5).add(i * 1.0);
        seeds.point_size = pulse.scale(2.5).add(hit.scale(2.0)).add(1.8);
        seeds.color = tint(colours[i], hit.scale(0.4).add(0.9));
        scene.add(seeds);
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.01).add(1.002), 0.001 * style.speed)
        .warp.waves(hit.scale(4.0).add(0.15), 1.2, clock.scale(3.0))
        .color.sharpen(drive.scale(0.5).add(hit.scale(0.3)).add(0.75), 0.006, 0.85)
        .color.decay(misted(0.955, style.mist, 0.87, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.7, 0.45), intensity: misted(0.45, style.mist, 0.25, 0.8), radius: misted(4.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
