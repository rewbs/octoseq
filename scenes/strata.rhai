//! roles: hit, kick, snare, energy

// STRATA
// Layers of rock, tilted. Five long straight bars lie across the frame on a
// slant and climb it slowly, one after another, while the loop slides what they
// leave back down the slope: so each bar lays down a broad band of its colour
// behind it, and the frame fills with slanted stripes that creep. Two colours
// alternate; the third is a thin seam between them.
//
//   hit      a fault: the whole pile slips along the slant
//   kick     the thick bars swell
//   snare    the seams flare
//   energy   how fast the layers are laid down

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.45 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.2 * style.speed).add(level.integrate(0.0).scale(0.45 * style.speed));

    // The slant, and the direction straight up the slope from it.
    let slant = 0.45;
    let up_x = -0.435;
    let up_y = 0.9;

    // A bar is a piece of a very large ring: near enough straight, and longer than
    // the frame is wide. Every other one is a thin seam.
    let colours = [style.a, style.c, style.b, style.c, style.a, style.c, style.b, style.c];
    for i in 0..8 {
        let seam = i % 2 == 1;
        let bar = radial.ring(#{ radius: 60.0, thickness: if seam { 0.05 } else { 0.22 }, start_angle: 1.4208, end_angle: 1.7208, segments: 24 });
        bar.position.y = -60.0;
        let holder = scene.group();
        holder.add(glow(bar, colours[i], hit.scale(0.35).add(if seam { 0.95 } else { 0.7 })));
        holder.rotation.z = slant;
        // Up the slope and round again.
        let climbed = clock.scale(0.12).add(i * 0.125).fract().scale(10.0).sub(5.0);
        holder.position.x = climbed.scale(up_x);
        holder.position.y = climbed.scale(up_y);
        holder.scale = if seam { snare.scale(0.6).add(1.0) } else { kick.scale(0.5).add(1.0) };
        scene.add(holder);
    }

    // Back down the slope, and along it when a hit lands.
    let slide = level.scale(0.002).add(0.0025).scale(style.speed);
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, slide.scale(up_x).add(hit.scale(-0.02)), slide.scale(up_y).add(hit.scale(-0.0095)))
        .warp.waves(level.scale(1.2).add(0.9), 1.0, clock.scale(2.0))
        .color.sharpen(0.25, 0.02, 1.0)
        .color.hsv(0.0015, 0.0, 0.0)
        .color.decay(misted(0.985, style.mist, 0.92, 0.994))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.65, style.mist, 0.8, 0.55), intensity: misted(0.35, style.mist, 0.15, 0.6), radius: misted(5.0, style.mist, 3.0, 9.0) }));
}
