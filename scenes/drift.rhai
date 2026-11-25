//! roles: hit, brightness, flux, lead, energy

// DRIFT
// Minimalist atmospheric strata: seven soft luminous horizontal ribbons
// gliding lazily past one another in a slicing current. Designed for calm,
// ambient, and textural passages where pitch brightness and spectral flux
// gently lift and shear the horizon bands.
//
//   hit         shifts the strata bands and sends a luminous wave across them
//   brightness  lifts the ribbons higher and tilts the slice angle
//   flux        broadens the gentle slicing shear
//   lead        swells the glowing horizon beads
//   energy      sets the current's drift speed

let style = #{ a: [0.55, 0.92, 1.0], b: [0.12, 0.82, 0.85], c: [1.0, 0.62, 0.42], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let bright = roles.brightness.smooth.exponential(0.08, 0.52);
    let flux = roles.flux.smooth.exponential(0.06, 0.45);
    let lead = roles.lead.smooth.exponential(0.06, 0.42);
    let level = roles.energy.smooth.exponential(0.08, 0.52);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.24 * style.speed).add(level.integrate(0.0).scale(0.55 * style.speed));

    let colours = [style.a, style.b, style.c];
    for i in 0..7 {
        let dir = if i % 2 == 0 { 1.0 } else { -1.0 };
        let bar = radial.ring(#{ radius: 28.0, thickness: 0.16, start_angle: 1.5008, end_angle: 1.6408, segments: 12 });
        bar.position.y = -28.0;
        let holder = scene.group();
        holder.add(glow(bar, colours[i % 3], hit.scale(0.55).add(lead.scale(0.45)).add(0.8)));
        let slide = clock.scale(0.12 + i * 0.015).add(i * 0.29).fract().scale(13.0).sub(6.5);
        holder.position.x = slide.scale(dir);
        holder.position.y = bright.scale(0.8).add((i - 3.0) * 0.92);
        holder.scale = lead.scale(0.45).add(0.85);
        scene.add(holder);
    }

    let fb = feedback.builder()
        .warp.slices(flux.scale(1.2).add(hit.scale(1.6)).add(0.45), 7.0, bright.scale(0.35).add(count.scale(0.15)))
        .warp.affine(0.996, 0.0)
        .color.hsv(0.0025, 0.0, 0.0)
        .color.decay(misted(0.955, style.mist, 0.87, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.75, style.mist, 0.4, 1.0), radius: misted(10.0, style.mist, 5.0, 14.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
