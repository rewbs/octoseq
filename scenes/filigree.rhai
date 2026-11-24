//! roles: hit, snare, energy, melody, flux

// FILIGREE
// Lace. Three rings of fine line, each crimped into dozens of small waves, turn
// against each other, and a kaleidoscope of ten wedges repeats them round the
// middle. The loop sharpens what they leave, so the trails thin out into more
// line instead of blurring into glow. Dark, with fine bright work on it.
//
//   hit      the lace opens outwards and the kaleidoscope turns
//   snare    the outer ring jumps
//   melody   how deep the crimping is
//   flux     how sharply the trails are cut into line
//   energy   how fast the rings turn

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let crimp = roles.melody.smooth.exponential(0.03, 0.25);
    let cut = roles.flux.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.6 * style.speed));

    let colours = [style.b, style.c, style.a];
    let waves = [18, 30, 44];
    for i in 0..3 {
        let lace = radial.wave(crimp, #{ base_radius: 1.1 + i * 1.0, amplitude: 0.5, wave_frequency: waves[i], resolution: 512 });
        lace.rotation.z = clock.scale(if i == 1 { -0.5 } else { 0.3 + i * 0.1 });
        lace.position.x = clock.scale(0.4 + i * 0.1).sin().scale(0.5);
        lace.scale = if i == 2 { snare.scale(0.15).add(1.0) } else { hit.scale(0.1).add(1.0) };
        lace.color = tint(colours[i], hit.scale(0.6).add(1.3));
        scene.add(lace);
    }

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.008), 0.003 * style.speed)
        .warp.petals(0.012, 5.0, clock)
        .color.sharpen(cut.scale(0.2).add(0.3), 0.006)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    let turn = hit.integrate(0.0).scale(0.2).add(clock.scale(0.05));
    post.add(fx.kaleidoscope(#{ segments: 10.0, angle: turn, center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.55, 0.4), intensity: misted(0.7, style.mist, 0.45, 0.9), radius: misted(4.0, style.mist, 3.0, 9.0) }));
}
