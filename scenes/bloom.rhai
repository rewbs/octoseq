//! roles: hit, kick, snare, hat, energy, bass

// BLOOM
// A flower that keeps opening. A wavy ring in the middle is the only thing drawn
// that matters; the loop pushes each frame outwards in six directions and pulls it
// in between them, so the ring's trail unfolds into petals that turn, swell with
// the music and change colour as they travel.
//
//   hit      the petals are thrown outwards
//   kick     the ring at the heart jumps
//   snare    a second ring cracks open inside it
//   hat      the seeds round the heart flicker
//   bass     how deep the ring's waves are
//   energy   how fast the flower turns

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

// `style.mist` says how misty the look is, from 0 (crisp: short trails and a tight
// glow, so bright shapes sit on black) to 1 (misty: trails that linger until colour
// fills the frame). At 0.5 a setting is the scene's own. Every scene reads it
// through this, so it means the same in all of them.
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

// The same for a line, whose colour is set directly.
fn tint(c, level) {
    #{ r: level.scale(c[0]), g: level.scale(c[1]), b: level.scale(c[2]), a: 1.0 }
}

fn init(ctx) {
    // `style.at` is where in the frame the scene sits (0, 0 is the middle; x to the
    // right and y down, in frame widths and heights). The eye moves the other way.
    let ex = style.at[0] * -9.57;
    let ey = style.at[1] * 5.39;
    camera.position = #{ x: ex, y: ey, z: 6.5 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.45 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let bass = roles.bass.smooth.exponential(0.03, 0.3);

    // Runs on with time, and faster while the music is loud.
    let t = timing.time.scale(style.speed);
    let clock = t.scale(0.4).add(level.integrate(0.0).scale(1.4 * style.speed));

    let heart = radial.wave(bass, #{ base_radius: 0.7, amplitude: 0.45, wave_frequency: 6, resolution: 192 });
    heart.rotation.z = clock.scale(0.5);
    heart.scale = kick.scale(0.5).add(hit.scale(0.4)).add(0.8);
    heart.color = tint(style.a, hit.scale(0.4).add(0.6));
    scene.add(heart);

    let inner = radial.ring(#{ radius: 0.32, thickness: 0.07, segments: 64 });
    inner.scale = snare.scale(1.6).add(0.6);
    scene.add(glow(inner, style.b, hit.scale(0.4).add(0.6)));

    // Six seeds on a circle that turns against the flower.
    for i in 0..6 {
        let seed = radial.ring(#{ radius: 0.07, thickness: 0.07, segments: 20 });
        seed.position.x = clock.scale(-0.8).add(i * 1.0472).sin().scale(1.25);
        seed.position.y = clock.scale(-0.8).add(i * 1.0472 + 1.5708).sin().scale(1.25);
        seed.scale = hat.scale(1.5).add(0.8);
        scene.add(glow(seed, style.c, 0.75));
    }

    // The loop: six petals of outward push that turn with the clock, a steady
    // growth so everything travels to the edge, a little of the water from
    // `liquid` so the petals' edges are not ruled lines, and creeping colour.
    let fb = feedback.builder()
        .warp.petals(hit.scale(0.08).add(level.scale(0.02)).add(0.026), 6.0, clock.scale(0.6))
        .warp.affine(hit.scale(0.08).add(t.scale(0.19).sin().scale(0.01)).add(1.028), t.scale(0.31).sin().scale(0.016))
        .warp.waves(level.scale(0.8).add(0.5), 1.4, clock)
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.962, style.mist, 0.85, 0.988))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.55, style.mist, 0.7, 0.55), intensity: misted(0.7, style.mist, 0.35, 0.7), radius: misted(10.0, style.mist, 5.0, 10.0) }));
}
