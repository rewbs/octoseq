//! roles: hit, bass, melody, lead, energy

// LAVALAMP
// Seven luminous liquid metaballs drifting and fusing across a warm dark bath.
// Bass swells the molten globes and lead guides the orbiting rings above them;
// each blow nudges the blobs' orbit and shifts their contour glow.
//
//   hit      nudges the molten field forward and flares the floating rings
//   bass     expands the metaballs' reach and core ring
//   melody   sharpens the glowing iso-contours
//   lead     drives the orbiting rings' breadth
//   energy   sets the lava's buoyancy speed

let style = #{ a: [1.0, 0.42, 0.35], b: [0.08, 0.68, 0.82], c: [0.98, 0.9, 0.55], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let bass = roles.bass.smooth.exponential(0.04, 0.35);
    let melody = roles.melody.smooth.exponential(0.06, 0.4);
    let lead = roles.lead.smooth.exponential(0.05, 0.35);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.28 * style.speed).add(level.integrate(0.0).scale(0.65 * style.speed));

    let colours = [style.a, style.b, style.c, style.a];
    for i in 0..4 {
        let orb = radial.ring(#{ radius: 0.35, thickness: 0.14, segments: 32 });
        let a = clock.scale(0.42 + i * 0.09).add(i * 1.5708);
        let r = lead.scale(1.1).add(1.5 + i * 0.35);
        orb.position.x = a.cos().scale(r);
        orb.position.y = a.sin().scale(r).scale(0.7);
        orb.scale = bass.scale(0.8).add(hit.scale(0.5)).add(0.75);
        scene.add(glow(orb, colours[i], hit.scale(0.5).add(0.8)));
    }

    let fb = feedback.builder()
        .warp.flow(melody.scale(1.2).add(0.5), 1.8, clock.scale(0.45))
        .warp.affine(0.99, 0.002 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.91, style.mist, 0.8, 0.975))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.45, style.mist, 0.62, 0.35), intensity: misted(0.78, style.mist, 0.4, 1.0), radius: misted(11.0, style.mist, 5.0, 15.0) }));
    post.add(fx.ground(#{ kind: 7, zoom: bass.scale(-0.35).add(1.8), angle: clock.scale(0.06), phase: clock.scale(0.85).add(count.scale(0.28)), p1: melody.scale(1.5).add(1.2), p2: bass.scale(0.5).add(0.85), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
