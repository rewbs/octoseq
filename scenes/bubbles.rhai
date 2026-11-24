//! roles: hit, kick, onset, energy, bass

// BUBBLES
// Under water. Rings of light rise through the frame like bubbles, swaying as
// they go and growing as they near the top, and the loop ripples what they leave
// in rings that spread from the middle, so the water between them is marbled with
// their colours. The loop never lets the picture drift: the bubbles move, the
// water stays.
//
//   hit      a swell passes through the water
//   kick     the big bubbles pulse
//   onset    the small bubbles pulse
//   bass     how far the bubbles sway
//   energy   how fast they rise

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let pop = roles.onset.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let sway = roles.bass.smooth.exponential(0.05, 0.4).scale(0.9).add(0.3);
    let clock = timing.time.scale(0.3 * style.speed).add(level.integrate(0.0).scale(0.7 * style.speed));

    let colours = [style.b, style.c, style.a];
    for i in 0..11 {
        let big = i % 3 == 0;
        let bubble = radial.ring(#{ radius: if big { 0.5 } else { 0.24 }, thickness: if big { 0.07 } else { 0.05 }, segments: 48 });
        // From below the frame to above it, and round again; bigger near the top.
        let risen = clock.scale(0.13 + (i % 4) * 0.03).add(i * 0.283).fract();
        bubble.position.y = risen.scale(9.0).sub(4.5);
        bubble.position.x = clock.scale(0.9 + i * 0.07).add(i * 1.7).sin().scale(sway).add(i * 1.15 - 5.75);
        let pulse = if big { kick.scale(0.35) } else { pop.scale(0.3) };
        bubble.scale = risen.scale(0.7).add(pulse).add(0.6);
        scene.add(glow(bubble, colours[i % 3], hit.scale(0.4).add(0.85)));
    }

    // The water bends but does not flow.
    let fb = feedback.builder()
        .warp.ripple(level.scale(0.008).add(hit.scale(0.03)).add(0.008), 3.0, clock.scale(2.0))
        .warp.noise(0.004, 3.0)
        .color.hsv(0.003, 0.0, 0.0)
        .color.decay(misted(0.975, style.mist, 0.88, 0.991))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(9.0, style.mist, 5.0, 13.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
