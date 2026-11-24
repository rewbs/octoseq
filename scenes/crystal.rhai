//! roles: hit, kick, snare, energy, brightness

// CRYSTAL
// Ice. A few straight shards and a scatter of points, nearly white, seen through
// a kaleidoscope of eight wedges, with a smaller copy of the whole picture laid
// over its own middle: a crystal with a crystal inside it. Hard edges, no haze,
// and only as much colour as light picks up going through glass.
//
//   hit      the crystal cracks: the wedges turn and the inner copy jumps in size
//   kick     the shards lengthen
//   snare    the points flare
//   brightness   how far the colour is let down with white
//   energy   how fast the shards slide

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

// A colour let down with white: half its own, half white.
fn pale(c) {
    [c[0] * 0.5 + 0.5, c[1] * 0.5 + 0.5, c[2] * 0.5 + 0.5]
}

fn init(ctx) {
    // The eye stands where the frame is 13.2 across and 7.4 high. `style.at` is where in
    // the frame the scene sits, in frame widths and heights; the eye moves the other way.
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let white = roles.brightness.smooth.exponential(0.3, 0.6);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.8 * style.speed));

    // Shards: straight bars sliding along their own length, at odd angles, in
    // every direction so that whichever wedge the kaleidoscope keeps has some.
    let colours = [pale(style.a), pale(style.b), pale(style.c)];
    for i in 0..7 {
        let shard = radial.ring(#{ radius: 25.0, thickness: 0.05, start_angle: 1.5108, end_angle: 1.6308, segments: 10 });
        shard.position.y = -25.0;
        shard.position.x = clock.scale(0.5 + i * 0.09).add(i * 1.7).sin().scale(1.8);
        let holder = scene.group();
        holder.add(glow(shard, colours[i % 3], hit.scale(0.5).add(1.0)));
        holder.rotation.z = i * 0.8976 + 0.3;
        holder.position.x = (i * 0.8976).cos() * 1.2;
        holder.position.y = (i * 0.8976).sin() * 1.2;
        holder.scale = kick.scale(0.4).add(1.0);
        scene.add(holder);
    }
    let frost = points.cloud(#{ count: 220, spread: 3.6, mode: "uniform", seed: 5, point_size: 2.0 });
    frost.rotation.z = clock.scale(0.2);
    frost.point_size = snare.scale(5.0).add(2.0);
    frost.color = #{ r: 0.9, g: 0.97, b: 1.0, a: 1.0 };
    scene.add(frost);

    // A short, straight wake.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.012), 0.0)
        .color.decay(misted(0.84, style.mist, 0.76, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    let crack = hit.integrate(0.0).scale(0.3).add(clock.scale(0.08));
    post.add(fx.kaleidoscope(#{ segments: 8.0, angle: crack, center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] } }));
    post.add(fx.echo(#{ alpha: 0.45, zoom: hit.scale(0.25).add(0.42), angle: 0.3927 }));
    post.add(fx.colorGrade(#{ saturation: white.scale(-0.5).add(1.0), contrast: 1.15 }));
    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.6, 0.4), intensity: misted(0.7, style.mist, 0.45, 0.9), radius: misted(5.0, style.mist, 3.0, 9.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
