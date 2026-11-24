//! roles: hit, kick, snare, hat, energy

// HATCH
// Straight bars at two slants, one set leaning each way, sliding across the frame
// while the picture behind them is dragged sideways and sheared, so every bar
// leaves a streak and the streaks cross into a hatching like lit streets seen from
// above. Nothing in it is round.
//
//   hit      the whole hatching lurches sideways
//   kick     the bars leaning one way thicken
//   snare    the bars leaning the other way thicken
//   hat      the streaks shiver
//   energy   how fast the bars slide

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.5 * style.speed));

    // A bar is a short piece of a very large ring: near enough straight. Each sits
    // in a group at its place, so the group can lean it and slide it.
    let colours = [style.a, style.b, style.c];
    for i in 0..10 {
        let lean_left = i % 2 == 0;
        let bar = radial.ring(#{ radius: 30.0, thickness: 0.09, start_angle: 1.5108, end_angle: 1.6308, segments: 12 });
        bar.position.y = -30.0;
        let holder = scene.group();
        holder.add(glow(bar, colours[i % 3], hit.scale(0.4).add(0.65)));
        holder.rotation.z = if lean_left { 0.62 } else { -0.95 };
        // Across the frame and round again, each at its own pace.
        let across = clock.scale(0.11 + i * 0.013).add(i * 0.37).fract().scale(14.0).sub(7.0);
        holder.position.x = if lean_left { across } else { across.scale(-1.0) };
        holder.position.y = (i * 0.83 - 3.7) * 0.8;
        holder.scale = if lean_left { kick.scale(1.2).add(1.0) } else { snare.scale(1.2).add(1.0) };
        scene.add(holder);
    }

    // The loop drags the picture sideways and shears it; a hit shoves it.
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, hit.scale(0.02).add(0.004).scale(style.speed), 0.0015)
        .warp.shear(clock.scale(0.6).sin().scale(0.012).add(hat.scale(0.006)))
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.6, style.mist, 0.35, 0.7), radius: misted(8.0, style.mist, 5.0, 10.0) }));
}
