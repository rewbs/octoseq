//! roles: hit, kick, energy, bass

// STARFIELD
// Flying through stars. A field of points turns slowly about the line of flight
// and the loop throws every frame outwards from the middle, so each star draws a
// streak that lengthens towards the edge of the frame. Loudness is speed: in a
// quiet passage the stars hang nearly still, and a hit is a jump to speed.
//
//   hit      a jump: the streaks shoot out to the corners
//   kick     the stars swell
//   bass     how bright the glow at the middle is
//   energy   how fast the flight is

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// A colour let down with white, at a brightness that is a signal: stars are pale.
fn star(c, level) {
    #{ r: level.scale(c[0] * 0.4 + 0.6), g: level.scale(c[1] * 0.4 + 0.6), b: level.scale(c[2] * 0.4 + 0.6), a: 1.0 }
}

fn init(ctx) {
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.5 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.1 * style.speed).add(level.integrate(0.0).scale(0.25 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let stars = points.cloud(#{ count: 150, spread: 5.5, mode: "uniform", seed: 3 + i * 29, point_size: 2.5 });
        stars.rotation.z = clock.scale(if i == 1 { -0.7 } else { 0.5 + i * 0.2 });
        stars.rotation.x = clock.scale(0.3).add(i * 2.0);
        stars.point_size = kick.scale(3.5).add(2.2);
        stars.color = star(colours[i], hit.scale(0.5).add(1.2));
        scene.add(stars);
    }

    // The glow dead ahead.
    let ahead = radial.ring(#{ radius: 0.12, thickness: 0.24, segments: 24 });
    ahead.scale = bass.scale(1.5).add(0.5);
    ahead.material = "emissive";
    ahead.materialParams.emission_color = #{ r: style.c[0], g: style.c[1], b: style.c[2], a: 1.0 };
    ahead.materialParams.emission_intensity = hit.scale(0.5).add(0.5);
    scene.add(ahead);

    // Outwards from the middle: slowly when quiet, hard when loud.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.05).add(hit.scale(0.09)).add(1.012).scale(1.0), 0.001 * style.speed)
        .warp.waves(level.scale(0.8).add(0.4), 1.0, timing.time.scale(0.4 * style.speed))
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.radialBlur(#{ strength: hit.scale(0.2).add(level.scale(0.1)).add(0.05), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] }, samples: 16 }));
    post.add(fx.bloom(#{ threshold: misted(0.4, style.mist, 0.5, 0.35), intensity: misted(0.9, style.mist, 0.6, 1.0), radius: misted(6.0, style.mist, 4.0, 10.0) }));
}
