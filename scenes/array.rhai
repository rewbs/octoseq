//! roles: hit, kick, snare, energy, bass

// ARRAY
// Forty moons in a grid. Each is a disc of light with a disc of shadow lying
// across part of it, so it shows a phase, and all forty show the same one: the
// shadows swing round together as if one lamp were circling the whole array.
// A wave of size runs out through the grid from the middle. Nearly everything
// else in the pool is light on black; this reads as solid things in a light.
//
//   hit      the lamp jumps round: every moon changes phase at once
//   kick     a wave of size runs out from the middle columns
//   snare    a wave of size runs out from the middle row
//   bass     how deep the shadow lies: from thin crescents to nearly full
//   energy   how fast the lamp circles

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.5 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    // Which way the lamp is: it circles, and a hit sends it a third of the way round.
    let lamp = clock.scale(0.5).add(hit.integrate(0.0).scale(2.1));
    // How far the shadow lies across each moon, in moon radii: 1.6 is a thin
    // crescent of shadow, 0.5 leaves only a crescent of light.
    let depth = bass.scale(-0.8).add(1.3);
    let shade_x = lamp.sin().scale(depth).scale(0.42);
    let shade_y = lamp.add(1.5708).sin().scale(depth).scale(0.42);

    let colours = [style.a, style.b, style.c];
    for row in 0..5 {
        for col in 0..8 {
            let moon = scene.group();
            let face = radial.ring(#{ radius: 0.21, thickness: 0.42, segments: 32 });
            moon.add(glow(face, colours[(row + col) % 3], hit.scale(0.3).add(0.85)));
            // The shadow: a black disc a little nearer the eye, so it is drawn over the face.
            let shade = radial.ring(#{ radius: 0.22, thickness: 0.44, segments: 32 });
            shade.position.x = shade_x;
            shade.position.y = shade_y;
            shade.position.z = 0.02;
            moon.add(glow(shade, [0.0, 0.0, 0.0], 0.0));
            let x = (col - 3.5) * 1.55;
            let y = (row - 2.0) * 1.42;
            moon.position.x = x;
            moon.position.y = y;
            let across = if col < 4 { 3 - col } else { col - 4 };
            let down = if row < 2 { 2 - row } else { row - 2 };
            moon.scale = kick.delay(across * 0.12).scale(0.28).add(snare.delay(down * 0.15).scale(0.28)).add(1.25);
            scene.add(moon);
        }
    }

    // A short wake straight out from the middle; when the look is misty, a long one.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.02).add(1.006), 0.0)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.85, style.mist, 0.6, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.4, style.mist, 0.2, 0.7), radius: misted(6.0, style.mist, 3.0, 10.0) }));
}
