//! roles: hit, lead, melody, bass, energy

// CAUSTICS
// Shimmering underwater light webs refracting across a sunlit seabed, with
// rising luminous bubbles drifting upward. Responsive to bass warmth and
// melodic ripple without frantic strobing.
//
//   hit      sends a bright refraction jump across the caustic web
//   lead     broadens the rising bubble rings
//   melody   stirs the water's turbulence
//   bass     deepens the caustic focus
//   energy   sets the current's flow speed

let style = #{ a: [0.08, 0.38, 0.95], b: [0.1, 0.92, 0.62], c: [0.92, 0.28, 0.55], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let lead = roles.lead.smooth.exponential(0.05, 0.38);
    let melody = roles.melody.smooth.exponential(0.06, 0.42);
    let bass = roles.bass.smooth.exponential(0.05, 0.38);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.25 * style.speed).add(level.integrate(0.0).scale(0.6 * style.speed));

    let colours = [style.b, style.a, style.c];
    for i in 0..6 {
        let bubble = radial.ring(#{ radius: 0.2 + (i % 3) * 0.1, thickness: 0.06, segments: 28 });
        let rise = clock.scale(0.14 + i * 0.025).add(i * 0.17).fract().scale(8.5).sub(4.25);
        bubble.position.x = clock.scale(0.5 + i * 0.11).add(i * 1.4).sin().scale(3.8);
        bubble.position.y = rise;
        bubble.scale = lead.scale(0.8).add(hit.scale(0.45)).add(0.7);
        scene.add(glow(bubble, colours[i % 3], hit.scale(0.5).add(0.85)));
    }

    let fb = feedback.builder()
        .warp.ripple(melody.scale(0.015).add(0.005), 3.0, clock.scale(1.2))
        .warp.affine(0.992, 0.002 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.78, 0.97))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.75, style.mist, 0.4, 0.98), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    post.add(fx.ground(#{ kind: 12, zoom: 2.2, angle: clock.scale(0.07), phase: clock.scale(0.9).add(count.scale(0.35)), p1: bass.scale(2.0).add(2.2), p2: melody.scale(0.9).add(0.9), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
