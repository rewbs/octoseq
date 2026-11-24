//! roles: hit, kick, snare, energy, beat_phase

// JEWEL
// A cut stone turning under a lamp. Three wire cages, one inside another, tumble
// about different axes, so their edges cross and re-cross like the facets of a
// gem; the picture is smeared outwards from the stone's middle, which turns
// every bright edge into a ray. The light inside it beats with the beat.
//
//   hit      the stone flashes: its rays reach the edge of the frame
//   kick     the outer cage jumps in size
//   snare    the inner cages jump in size
//   beat_phase   the light at the heart swells on each beat and sinks until the next
//   energy   how fast the cages tumble

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

// `style.mist` runs from 0 (crisp) to 1 (misty); at 0.5 a setting is the scene's own.
fn misted(own, mist, crisp, misty) {
    if mist < 0.5 { crisp + (own - crisp) * mist * 2.0 } else { own + (misty - own) * (mist * 2.0 - 1.0) }
}

// Draw a solid as glowing wire in one colour.
fn wire(entity, c, level) {
    entity.material = "wire_glow";
    entity.materialParams.glow_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_intensity = level;
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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.125 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    let colours = [style.b, style.c, style.a];
    for i in 0..3 {
        let cage = mesh.cube();
        cage.rotation.x = clock.scale(0.5 + i * 0.23).add(i * 0.8);
        cage.rotation.y = clock.scale(if i == 1 { -0.7 } else { 0.4 + i * 0.2 });
        cage.rotation.z = clock.scale(0.3 - i * 0.25).add(0.6);
        cage.scale = if i == 0 { kick.scale(0.35).add(2.6) } else { snare.scale(0.3).add(1.9 - i * 0.55) };
        scene.add(wire(cage, colours[i], hit.scale(1.0).add(1.4)));
    }

    // The light at the heart: brightest on the beat, sinking until the next.
    let heart = mesh.sphere();
    heart.material = "emissive";
    heart.materialParams.emission_color = #{ r: 1.0, g: 0.96, b: 0.9, a: 1.0 };
    heart.materialParams.emission_intensity = hit.scale(1.5).add(1.5);
    heart.scale = roles.beat_phase.scale(-0.2).add(0.42);
    scene.add(heart);

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.03).add(1.012), 0.002 * style.speed)
        .color.hsv(0.006, 0.0, 0.0)
        .color.decay(misted(0.88, style.mist, 0.78, 0.98))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Smeared outwards from the stone: edges become rays.
    post.add(fx.radialBlur(#{ strength: hit.scale(0.35).add(level.scale(0.1)).add(0.15), center: #{ x: 0.5 + style.at[0], y: 0.5 + style.at[1] }, samples: 24 }));
    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.6, 0.4), intensity: misted(0.8, style.mist, 0.45, 1.0), radius: misted(7.0, style.mist, 4.0, 11.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
