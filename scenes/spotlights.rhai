//! roles: hit, kick, snare, energy, bass

// SPOTLIGHTS
// A rig of five lamps swings over a dark stage. Each lamp is a ball of light far
// brighter than white, and the picture is smeared away from a point above the
// frame, so each one throws a beam down through the dark. The beams sweep and
// cross as the lamps swing.
//
//   hit      the beams lengthen and the rig lurches
//   kick     the outer lamps swell
//   snare    the inner lamps swell
//   bass     how bright the haze under the lamps is
//   energy   how fast the rig swings

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
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let clock = timing.time.scale(0.5 * style.speed).add(level.integrate(0.0).scale(1.1 * style.speed));

    let colours = [style.a, style.b, style.c, style.b, style.a];
    for i in 0..5 {
        let lamp = mesh.sphere();
        let swing = clock.scale(0.5 + i * 0.07).add(i * 1.2).sin();
        lamp.position.x = swing.scale(1.5).add(i * 2.2 - 4.4).add(hit.scale(0.3));
        lamp.position.y = swing.scale(swing).scale(-0.5).add(1.9);
        let outer = i == 0 || i == 4;
        // A lamp this bright lights a good part of the frame, so its size may
        // only move a little, or the drums would flash the whole picture.
        lamp.scale = if outer { kick.scale(0.05).add(0.26) } else { snare.scale(0.05).add(0.26) };
        // Four times brighter than white: the beam is made of what the smear spreads.
        scene.add(glow(lamp, colours[i], hit.scale(1.0).add(4.0)));
    }

    // A little of the last frame, sinking: the haze the beams light up.
    let fb = feedback.builder()
        .warp.affine(1.006, 0.0, 0.0, -0.004 * style.speed)
        .warp.waves(level.scale(1.5).add(0.5), 1.0, clock)
        .color.decay(misted(0.95, style.mist, 0.86, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    // Smeared away from a point above the rig: lamps become beams.
    post.add(fx.radialBlur(#{ strength: hit.scale(0.2).add(bass.scale(0.15)).add(0.55), center: #{ x: 0.5 + style.at[0], y: -0.25 + style.at[1] }, samples: 32 }));
    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.45), intensity: misted(0.8, style.mist, 0.4, 0.9), radius: misted(9.0, style.mist, 5.0, 12.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
