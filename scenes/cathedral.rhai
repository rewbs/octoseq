//! roles: hit, kick, energy, bass, section_progress

// CATHEDRAL
// A nave. Pointed arches stand one behind another down a long hall, and the eye
// walks through them: each arch grows from a speck in the distance, passes
// overhead and is gone, and another has taken its place at the far end. This is
// the one scene with real depth in it; the others are flat pictures that move.
//
//   hit      a stride: the eye lurches forward through an arch
//   kick     the arches thicken
//   bass     how far the hall sways from side to side
//   energy   how fast the eye walks
//   section_progress   the hall slowly rolls over the length of a section

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
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    // How far the eye has walked: steadily, faster when loud, and a stride a hit.
    let walked = timing.time.scale(0.05 * style.speed).add(level.integrate(0.0).scale(0.1 * style.speed)).add(hit.integrate(0.0).scale(0.05));
    let sway = timing.time.scale(0.4 * style.speed).sin().scale(bass.scale(0.5).add(0.15));
    let roll = roles.section_progress.scale(0.5).sub(0.25);

    // Ten arches, 3.6 apart, from 30 away to just behind the eye. An arch is two
    // arcs leaning together: a pointed arch, not a round one.
    let hall = scene.group();
    let colours = [style.a, style.b, style.a, style.c, style.b];
    for i in 0..10 {
        let arch = scene.group();
        for side in 0..2 {
            let half = radial.ring(#{ radius: 2.9, thickness: 0.2, start_angle: 0.0, end_angle: 1.19, segments: 32 });
            half.position.x = if side == 0 { -1.1 } else { 1.1 };
            half.rotation.y = if side == 0 { 0.0 } else { 3.14159 };
            arch.add(glow(half, colours[i % 5], hit.scale(0.4).add(0.8)));
        }
        arch.position.z = walked.add(i * 0.1).fract().scale(36.0).sub(30.0);
        arch.position.x = sway.scale((10 - i) * 0.1);
        arch.position.y = -1.6;
        arch.scale = kick.scale(0.07).add(1.0);
        hall.add(arch);
    }
    hall.rotation.z = roll;
    scene.add(hall);

    // A short wake that opens outwards, so a passing arch leaves light on the walls.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.02), 0.0)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.8, 0.98))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.45), intensity: misted(0.7, style.mist, 0.35, 0.9), radius: misted(8.0, style.mist, 5.0, 12.0) }));
}
