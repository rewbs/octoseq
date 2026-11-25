//! roles: hit, kick, snare, bass, beat_phase, energy

// PRISM3D
// Inspired by Milkdrop's Geometric/Cube family: three nested 3D wire cubes
// and glowing core spheres tumbling inside a mirrored kaleidoscope echo.
// Snaps crisply on every blow while the beat phase locks its breathing.
//
//   hit         snaps the nested cubes to a new angle and punches outward
//   kick        expands the inner core cube
//   snare       expands the outer wire shell
//   bass        swells the glowing core sphere
//   beat_phase  pulses the middle frame on every beat
//   energy      drives the camera's banking orbit

let style = #{ a: [0.95, 0.18, 0.82], b: [0.15, 0.95, 0.92], c: [1.0, 0.52, 0.1], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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

// Draw a solid as its glowing edges.
fn wire(entity, c, level) {
    entity.material = "wire_glow";
    entity.materialParams.core_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_intensity = level;
    entity
}

fn init(ctx) {
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.09 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.25 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.28 });
    let bass = roles.bass.smooth.exponential(0.03, 0.3);
    let level = roles.energy.smooth.exponential(0.04, 0.35);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let beat_p = roles.beat_phase.scale(-0.5).add(1.0);
    let clock = timing.time.scale(0.45 * style.speed).add(level.integrate(0.0).scale(1.2 * style.speed));

    let cam = clock.scale(0.32);
    camera.position = #{ x: cam.sin().scale(7.2), y: cam.scale(0.7).cos().scale(2.4), z: cam.cos().scale(7.2) };
    camera.target = #{ x: style.at[0] * -3.5, y: style.at[1] * 3.5, z: 0.0 };

    let c1 = mesh.cube();
    c1.rotation.x = clock.scale(0.9).add(count.scale(0.7854));
    c1.rotation.y = clock.scale(1.1);
    c1.scale = kick.scale(1.1).add(1.1);
    scene.add(wire(c1, style.a, hit.scale(0.9).add(1.2)));

    let c2 = mesh.cube();
    c2.rotation.x = clock.scale(-0.7);
    c2.rotation.z = clock.scale(0.8).sub(count.scale(0.5236));
    c2.scale = beat_p.scale(0.9).add(1.9);
    scene.add(wire(c2, style.b, hit.scale(0.7).add(1.05)));

    let c3 = mesh.cube();
    c3.rotation.y = clock.scale(-0.55).add(count.scale(0.3927));
    c3.rotation.z = clock.scale(0.45);
    c3.scale = snare.scale(1.0).add(2.8);
    scene.add(wire(c3, style.c, hit.scale(0.7).add(0.95)));

    let heart = mesh.sphere();
    heart.scale = bass.scale(0.8).add(0.55);
    scene.add(glow(heart, style.c, hit.scale(0.7).add(0.9)));

    let fb = feedback.builder()
        .warp.affine(hit.scale(0.06).add(1.015), 0.01 * style.speed)
        .warp.slices(hit.scale(1.2).add(0.25), 5.0, clock.scale(0.4))
        .color.hsv(0.004, 0.0, 0.0)
        .color.decay(misted(0.94, style.mist, 0.84, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.48, style.mist, 0.65, 0.38), intensity: misted(0.8, style.mist, 0.4, 1.05), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
