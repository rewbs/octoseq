//! roles: hit, kick, snare, hat, energy

// MARBLE
// Veined stone, slowly being stirred: bands of three colours folded into one
// another the way cream folds into coffee. Loud music stirs it harder, and every
// blow moves the whole slab on at once to where it would have been seconds later.
// Three small lights circle in front of it.
//
//   hit      the stone leaps on to a later state and stays there; it is stirred harder for a moment
//   kick     the first light swells
//   snare    the second light swells
//   hat      the third light swells
//   energy   how hard the stone is stirred and how fast it moves

let style = #{ a: [0.95, 0.75, 0.4], b: [0.2, 0.75, 0.7], c: [0.6, 0.25, 0.75], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

    // Short and sharp, for the scene's own movement. The whole frame's answer, at the end, has shapes of its own.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));
    // How many blows there have been: what the ground steps on, so each blow leaves it changed.
    let count = roles.hit.to_signal(#{ envelope: "count" });

    // Three small lights circle the middle, one for each drum, leaving trails that
    // the loop draws outwards and fades.
    let drums = [kick, snare, hat];
    let colours = [style.a, style.b, style.c];
    for i in 0..3 {
        let moon = radial.ring(#{ radius: 0.16, thickness: 0.32, segments: 24 });
        let angle = clock.scale(-0.4).add(i * 2.0944);
        moon.position.x = angle.cos().scale(2.2);
        moon.position.y = angle.sin().scale(2.2);
        moon.scale = drums[i].scale(1.6).add(1.0);
        scene.add(glow(moon, colours[i], hit.scale(0.8).add(1.2)));
    }

    let fb = feedback.builder()
        .warp.affine(1.012, -0.004)
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.8, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(7.0, style.mist, 4.0, 11.0) }));
    // The ground. A blow adds a whole step to its phase, so the stone is suddenly
    // somewhere else, and stirs it further for a moment.
    post.add(fx.ground(#{ kind: 2, zoom: 2.6, angle: clock.scale(0.05), phase: clock.scale(0.5).add(count.scale(0.9)), p1: level.scale(1.2).add(hit.scale(1.0)).add(2.6), p2: 2.2, amount: 0.9, a: style.a, b: style.b, c: style.c, at: style.at }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
