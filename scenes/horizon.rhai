//! roles: hit, energy, bass, melody, flux

// HORIZON
// The sound itself, drawn as line. Three lines run from one side of the frame to
// the other, one above another, and each shakes with a different part of the
// music: the low line with the bass, the middle with the melody, the top with
// whatever is changing fastest. The loop parts what they leave upwards and
// downwards from the middle, so each line stands on a fading stack of its own
// earlier shapes, like the lines on a seismograph.
//
//   hit      all three lines leap apart and the stacks are thrown outwards
//   bass     shakes the low line
//   melody   shakes the middle line
//   flux     shakes the top line
//   energy   how fast the shapes travel along the lines

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

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

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.02, 0.15);
    let melody = roles.melody.smooth.exponential(0.02, 0.15);
    let flux = roles.flux.smooth.exponential(0.02, 0.15);
    let clock = timing.time.scale(0.02 * style.speed).add(level.integrate(0.0).scale(0.05 * style.speed));

    // A line is the top of a wavy circle far too big for the frame: only a short
    // piece of it is ever in view, bowed a little, like the edge of a planet.
    let shakes = [bass, melody, flux];
    let colours = [style.a, style.b, style.c];
    let ripples = [195, 340, 560];
    for i in 0..3 {
        let trace = radial.wave(shakes[i], #{ base_radius: 30.0, amplitude: 1.3 - i * 0.3, wave_frequency: ripples[i], resolution: 3072 });
        trace.position.y = hit.scale(0.5).add(1.0).scale((i - 1) * 2.1).sub(30.0);
        // Turning the circle slides the wave along the line.
        trace.rotation.z = clock.scale(if i == 1 { -1.0 } else { 0.6 + i * 0.3 });
        trace.color = tint(colours[i], hit.scale(0.6).add(1.5));
        scene.add(trace);
    }

    // Parted from the middle: what is above goes up, what is below goes down.
    let fb = feedback.builder()
        .warp.ripple(level.scale(0.01).add(hit.scale(0.05)).add(0.012), 0.5, 0.0)
        .warp.affine(1.006, 0.0)
        .color.hsv(0.008, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.35), intensity: misted(0.9, style.mist, 0.55, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
