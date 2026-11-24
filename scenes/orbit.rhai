//! roles: hit, kick, snare, energy, beat_phase, section_progress

// ORBIT
// A wire cube tumbles in the middle with a light inside it, four smaller cubes
// circle it, and the camera flies round the lot. All of it is solid geometry seen
// from a moving eye; the loop then smears every frame of that into the next, so
// the trails are the cube's own corners swept through space.
//
// Three things here come from knowing the whole track rather than hearing it as
// it arrives: the cube draws itself in BEFORE each hit and bursts on it; the light
// inside beats with the beat's own phase, not with loudness; and the water in the
// loop rises steadily through each section and drops back when the next begins.
//
//   hit               the cube gathers before it and bursts on it
//   kick, snare       the circling cubes jump, two each
//   beat_phase        the light inside swells on every beat and sinks until the next
//   section_progress  how stirred the trails are: calm at a section's start
//   energy            how fast everything turns

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0 }; // @style

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

// Draw a solid as its glowing edges.
fn wire(entity, c, level) {
    entity.material = "wire_glow";
    // The line's core is white unless told otherwise, and white leaves white trails.
    entity.materialParams.core_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.glow_intensity = level;
    entity
}

fn init(ctx) {
    // Short and sharp: an answer that lingers runs into the next one, and then no blow stands out.
    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.1 });
    // A bell centred on each hit: it starts to rise a beat before the hit lands.
    let gather = roles.hit.to_signal(#{ envelope: "gaussian", width_beats: 2.0 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.45 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);

    // Runs on with time, and faster while the music is loud.
    let t = timing.time.scale(style.speed);
    let clock = t.scale(0.4).add(level.integrate(0.0).scale(1.3 * style.speed));

    // The eye circles the scene, rising and falling as it goes.
    let round = clock.scale(0.35);
    camera.position = #{ x: round.sin().scale(7.0), y: t.scale(0.23).sin().scale(2.2), z: round.add(1.5708).sin().scale(7.0) };
    // `style.at` places the scene in the frame; the eye looks past the cube by that much.
    camera.target = #{ x: 0.0, y: style.at[1] * 5.39, z: 0.0 };

    let body = mesh.cube();
    body.rotation.x = clock.scale(0.7);
    body.rotation.y = clock.scale(0.9);
    // Draws in as the hit approaches, then bursts when it lands.
    body.scale = gather.scale(-0.7).add(hit.scale(1.6)).add(1.9);
    scene.add(wire(body, style.a, hit.scale(1.2).add(1.4)));

    let heart = mesh.sphere();
    // Full size on the beat, sinking until the next one.
    heart.scale = roles.beat_phase.scale(-0.45).add(0.95);
    scene.add(glow(heart, style.b, hit.scale(0.4).add(0.6)));

    for i in 0..4 {
        let moon = mesh.cube();
        let angle = clock.scale(-0.8).add(i * 1.5708);
        moon.position.x = angle.sin().scale(3.4);
        moon.position.z = angle.add(1.5708).sin().scale(3.4);
        moon.position.y = clock.scale(0.5).add(i * 2.0).sin().scale(1.2);
        moon.rotation.x = clock.scale(1.3).add(i);
        moon.rotation.z = clock.scale(1.1);
        let drum = if i % 2 == 0 { kick } else { snare };
        moon.scale = drum.scale(0.5).add(0.45);
        // Its size follows its drum; its brightness follows only `hit`. A drum's level
        // can flicker faster than the strobe limit allows, and now that light brighter
        // than white is shown as brighter, not cut off, that flicker would show.
        scene.add(wire(moon, style.c, hit.scale(0.6).add(1.2)));
    }

    // The loop. Calm water at the start of a section, rising to a boil by its end.
    let stir = roles.section_progress.scale(2.5).add(0.6);
    let fb = feedback.builder()
        .warp.waves(hit.scale(5.0).add(stir), 1.0, clock)
        .warp.affine(hit.scale(0.05).add(1.012), t.scale(0.29).sin().scale(0.01))
        .color.hsv(0.005, 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.85, 0.988))
        .centre(0.0, style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.7, 0.5), intensity: misted(0.8, style.mist, 0.35, 0.8), radius: misted(10.0, style.mist, 5.0, 10.0) }));

    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, hit, style.at);
}
