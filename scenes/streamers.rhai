//! roles: hit, onset, energy, bass, brightness

// STREAMERS
// Lights rise through the frame on wavering paths, like sparks in hot air, and the
// loop carries their trails upwards and lets them linger, so the frame fills with
// a slow haze of the colours the lights have left. This is the mistiest of the
// scenes at its own setting: there is little black in it.
//
//   hit      a gust: the haze is thrown upwards and sideways
//   onset    the lights flicker in size
//   bass     the lights swell
//   brightness   how far the lights swing from side to side
//   energy   how fast they rise

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
    let tick = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let sway = roles.brightness.smooth.exponential(0.2, 0.6).scale(1.2).add(0.5);
    let clock = timing.time.scale(0.35 * style.speed).add(level.integrate(0.0).scale(0.9 * style.speed));

    let colours = [style.a, style.c, style.b, style.c, style.a, style.c, style.a, style.b, style.c, style.a];
    for i in 0..10 {
        let light = radial.ring(#{ radius: 0.11, thickness: 0.22, segments: 20 });
        // Up through the frame and in again at the bottom, each at its own pace.
        let rise = clock.scale(0.16 + i * 0.017).add(i * 0.31).fract();
        light.position.y = rise.scale(9.0).sub(4.5);
        light.position.x = clock.scale(0.7 + i * 0.11).add(i * 1.9).sin().scale(sway).add(i * 1.3 - 5.85);
        light.scale = bass.scale(1.6).add(tick.scale(0.5)).add(0.8);
        scene.add(glow(light, colours[i], hit.scale(0.4).add(0.75)));
    }

    // Upwards, leaning to one side and then the other, and slow to fade.
    let fb = feedback.builder()
        .warp.affine(1.004, 0.0, hit.scale(0.012).scale(clock.scale(0.9).sin()), hit.scale(0.02).add(0.005).scale(style.speed))
        .warp.shear(clock.scale(0.7).sin().scale(0.006).add(hit.scale(0.01)))
        .warp.waves(level.scale(0.8).add(0.5), 1.0, clock)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.984, style.mist, 0.93, 0.992))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.7, 0.45), intensity: misted(0.9, style.mist, 0.35, 0.9), radius: misted(12.0, style.mist, 5.0, 12.0) }));
}
