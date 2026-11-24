//! roles: hit, kick, energy, bass, melody

// AMOEBA
// One creature on a black slide. Its outline is a single closed line that bulges
// and pinches with the music, and the loop draws that outline again and again
// inside itself, each copy a little smaller and a little later, so the creature
// is filled with the rings of where its skin has been, like the grain in wood.
// Everything outside it stays black.
//
//   hit      the creature flinches: it jumps in size and its rings are squeezed inwards
//   kick     its skin thickens
//   bass     how big it is
//   melody   how far its skin bulges and pinches
//   energy   how fast it turns and wanders

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
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

    // Short and sharp, for the scene's own movement. The whole frame's answer, at the end, has shapes of its own.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let bulge = roles.melody.smooth.exponential(0.03, 0.25);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    // The skin: three lines nearly on top of each other, with three, five and
    // two lobes, so the outline is never a regular flower. The kick pushes the
    // outer two apart, which reads as the skin thickening.
    let colours = [style.a, style.c, style.b];
    let lobes = [3, 5, 2];
    for i in 0..3 {
        let skin = radial.wave(bulge, #{ base_radius: 2.3, amplitude: 0.9 - i * 0.2, wave_frequency: lobes[i], resolution: 256 });
        skin.rotation.z = clock.scale(0.4 - i * 0.33).add(i * 1.1);
        skin.scale = bass.scale(0.35).add(hit.scale(0.14)).add(kick.scale(0.04 * i)).add(0.75);
        skin.color = tint(colours[i], hit.scale(0.3).add(1.5));
        scene.add(skin);
    }

    // Inwards: each time round the loop the last frame comes back a little
    // smaller, so the old outlines sink towards the middle.
    let fb = feedback.builder()
        .warp.affine(hit.scale(-0.04).add(0.972), level.scale(0.006).scale(style.speed))
        .warp.petals(0.01, 3.0, clock)
        .color.hsv(0.012, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.35), intensity: misted(0.8, style.mist, 0.5, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
