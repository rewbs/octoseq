//! roles: hit, kick, snare, hat, energy, bass

// SWIRL
// Three arcs sweeping round the centre at different speeds, with the picture
// turning and opening outwards behind them, so the trails wind out in a spiral. A
// hit snaps the arcs round and throws the spiral wide.
//
//   hit      the arcs snap forward and the spiral is thrown wide
//   kick     the inner arc thickens
//   snare    the middle arc flares
//   hat      the outer arc flickers
//   bass     the arcs breathe
//   energy   how fast everything turns

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0 }; // @style

// Light a shape in one colour at a brightness that can be a signal.
fn glow(entity, c, level) {
    entity.material = "emissive";
    entity.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    entity.materialParams.emission_color = #{ r: c[0], g: c[1], b: c[2], a: 1.0 };
    entity.materialParams.emission_intensity = level;
    entity
}

fn init(ctx) {
    camera.position = #{ x: 0.0, y: 0.0, z: 6.5 };
    camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.35 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.15 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let breathe = roles.bass.smooth.exponential(0.03, 0.3).scale(0.25).add(0.9);
    let turn = timing.time.scale(style.speed);

    let inner = radial.ring(#{ radius: 1.0, thickness: 0.26, start_angle: 0.0, end_angle: 4.6, segments: 64 });
    inner.rotation.z = turn.scale(0.5).add(hit.scale(0.5));
    inner.scale = breathe.add(kick.scale(0.45));
    scene.add(glow(inner, style.a, hit.scale(0.5).add(0.55)));

    let middle = radial.ring(#{ radius: 1.9, thickness: 0.2, start_angle: 2.0, end_angle: 6.8, segments: 96 });
    middle.rotation.z = turn.scale(-0.35).add(hit.scale(-0.4));
    middle.scale = breathe.add(snare.scale(0.35));
    scene.add(glow(middle, style.b, hit.scale(0.4).add(0.6)));

    let outer = radial.ring(#{ radius: 2.8, thickness: 0.16, start_angle: 4.0, end_angle: 9.0, segments: 96 });
    outer.rotation.z = turn.scale(0.25).add(hit.scale(0.3));
    outer.scale = breathe.add(hat.scale(0.08));
    scene.add(glow(outer, style.c, 0.75));

    // The loop turns the last frame and opens it outwards, so trails wind away
    // from the centre; a hit throws them out hard.
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.07).add(1.012), level.scale(0.012).add(0.012).scale(style.speed))
        .color.decay(0.93)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: 0.55, intensity: 0.7, radius: 10.0 }));
}
