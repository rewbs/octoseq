//! roles: hit, kick, energy, bass, flux

// CONTOURS
// A map of a country that does not exist, redrawn all the time. Three rings of
// light drift about; the loop sharpens their trails so hard, each time round,
// that the colour cannot stay smooth: it separates into bands with hard edges,
// like the height lines on a map, in every colour at once. The bands crawl.
//
//   hit      the map is redrawn: the bands jump and the colours turn
//   kick     the rings swell
//   bass     how hard the bands are cut
//   flux     how much the map is stirred
//   energy   how fast the rings drift

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

fn init(ctx) {
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.113 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let stir = roles.flux.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.7 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let ring = radial.ring(#{ radius: 0.6, thickness: 0.3, segments: 40 });
        ring.position.x = clock.scale(0.37 + i * 0.11).add(i * 2.1).sin().scale(4.4);
        ring.position.y = clock.scale(0.53 - i * 0.09).add(i * 1.3).sin().scale(2.4);
        ring.scale = kick.scale(0.8).add(0.9);
        scene.add(glow(ring, colours[i], hit.scale(0.35).add(0.6)));
    }

    let fb = feedback.builder()
        .warp.waves(stir.scale(2.0).add(hit.scale(3.0)).add(1.0), 1.3, clock)
        .warp.affine(hit.scale(0.02).add(1.004), clock.scale(0.3).sin().scale(0.004))
        .color.sharpen(bass.scale(0.3).add(hit.scale(0.25)).add(0.4), 0.014)
        .color.hsv(hit.scale(0.01).add(0.002), 0.0, 0.0)
        .color.decay(misted(0.975, style.mist, 0.88, 0.99))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.7, style.mist, 0.8, 0.6), intensity: misted(0.3, style.mist, 0.15, 0.5), radius: misted(5.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
