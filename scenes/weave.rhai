//! roles: hit, kick, snare, energy, bass

// WEAVE
// Cloth on a loom. Six long threads run across the frame and nine run down it,
// each rising and falling a little out of step with its neighbours, so a wave
// passes through the warp and another through the weft; where a thread of one
// colour crosses a thread of the other the two add to a third. A border holds it.
//
//   hit      the cloth is shaken: every thread jumps and the border flashes
//   kick     the threads across thicken
//   snare    the threads down thicken
//   bass     how deep the waves in the cloth are
//   energy   how fast the waves run

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let depth = roles.bass.smooth.exponential(0.03, 0.3).scale(0.5).add(hit.scale(0.35)).add(0.12);
    let clock = timing.time.scale(0.6 * style.speed).add(level.integrate(0.0).scale(1.5 * style.speed));

    // A thread is a piece of a very large ring: near enough straight, and long
    // enough to cross the frame. Its group's size is its thickness.
    for i in 0..6 {
        let strand = radial.ring(#{ radius: 60.0, thickness: 0.1, start_angle: 1.4708, end_angle: 1.6708, segments: 16 });
        strand.position.y = -60.0;
        let holder = scene.group();
        holder.add(glow(strand, style.a, hit.scale(0.35).add(0.7)));
        holder.position.y = clock.scale(1.3).add(i * 1.1).sin().scale(depth).add((i - 2.5) * 1.15);
        holder.scale = kick.scale(0.5).add(1.0);
        scene.add(holder);
    }
    for i in 0..9 {
        let strand = radial.ring(#{ radius: 60.0, thickness: 0.1, start_angle: 1.4708, end_angle: 1.6708, segments: 16 });
        strand.position.y = -60.0;
        let holder = scene.group();
        holder.add(glow(strand, style.b, hit.scale(0.35).add(0.7)));
        holder.rotation.z = 1.5708;
        holder.position.x = clock.scale(1.1).add(i * 0.9).sin().scale(depth).add((i - 4.0) * 1.4);
        holder.scale = snare.scale(0.5).add(1.0);
        scene.add(holder);
    }
    // The border: a ring with four sides, turned square to the frame.
    let border = radial.ring(#{ radius: 5.0, thickness: 0.16, segments: 4 });
    border.rotation.z = 0.7854;
    scene.add(glow(border, style.c, hit.scale(0.6).add(0.6)));

    // The cloth leaves a soft print of itself that swells outwards and fades.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.008), 0.0)
        .warp.waves(level.scale(0.8).add(0.3), 1.0, clock.scale(0.5))
        .color.hsv(0.01, 0.0, 0.0)
        .color.decay(misted(0.93, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.5), intensity: misted(0.55, style.mist, 0.3, 0.8), radius: misted(7.0, style.mist, 4.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
