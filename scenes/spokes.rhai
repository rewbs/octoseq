//! roles: hit, kick, snare, energy, bass

// SPOKES
// A wheel of twelve spokes round a hub. The kick runs round the wheel a spoke at
// a time, each one lengthening as it passes, and the snare runs round the other
// way; the loop carries everything straight outwards, so the tips of the spokes
// leave rays that reach the corners of the frame. A star, drawn with a ruler.
//
//   hit      the wheel turns a twelfth and the rays are thrown out
//   kick     a swell runs clockwise round the spokes
//   snare    a swell runs the other way
//   bass     the hub's size
//   energy   how fast the rays travel

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
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);

    // The wheel turns a twelfth of a turn on each hit, and creeps between them.
    let wheel = scene.group();
    wheel.rotation.z = hit.integrate(0.0).scale(0.9).add(timing.time.scale(0.04 * style.speed));

    // A spoke is a short piece of a very large ring, near enough straight, held
    // in a group whose origin is the hub: the group's size is the spoke's length.
    let colours = [style.a, style.b, style.c];
    for i in 0..12 {
        let spoke = radial.ring(#{ radius: 20.0, thickness: 0.07, start_angle: 1.5208, end_angle: 1.6208, segments: 8 });
        spoke.position.x = 1.45;
        spoke.position.y = -20.0;
        spoke.rotation.z = 0.0;
        let holder = scene.group();
        holder.add(glow(spoke, colours[i % 3], hit.scale(0.4).add(0.85)));
        holder.rotation.z = i * 0.5236;
        holder.scale = kick.delay(i * 0.04).scale(0.7).add(snare.delay((11 - i) * 0.04).scale(0.5)).add(0.75);
        wheel.add(holder);
    }
    let hub = radial.ring(#{ radius: 0.3, thickness: 0.12, segments: 12 });
    hub.scale = bass.scale(0.8).add(0.7);
    wheel.add(glow(hub, style.c, hit.scale(0.4).add(0.8)));
    scene.add(wheel);

    // Outwards, with a slow waver, so the rays are not ruled lines.
    let fb = feedback.builder()
        .warp.affine(level.scale(0.02).add(hit.scale(0.05)).add(1.02).scale(1.0), 0.0005 * style.speed)
        .warp.waves(level.scale(1.0).add(0.5), 1.0, timing.time.scale(0.5 * style.speed))
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.945, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.45), intensity: misted(0.7, style.mist, 0.35, 0.9), radius: misted(8.0, style.mist, 5.0, 10.0) }));
}
