//! roles: hit, kick, snare, energy

// HEXAGON
// A hexagon, with the whole picture drawn again inside it, turned a little: so
// there is a hexagon inside the hexagon, and one inside that, winding down to the
// middle. The colour is cut into flat steps, so each one is a plain field with a
// hard edge. Sparks fly out from the middle on the drums and are caught in it.
//
//   hit      the nest of hexagons twists and the colours jump round the wheel
//   kick     the outer hexagon thickens
//   snare    the sparks are thrown outwards
//   energy   how fast the nest winds

let style = #{ a: [1.0, 0.3, 0.12], b: [0.1, 0.75, 1.0], c: [1.0, 0.88, 0.35], speed: 1.0, at: [0.0, 0.0], mist: 0.5 }; // @style

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

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.3 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.4 });
    let level = roles.energy.smooth.exponential(0.05, 0.4);
    let clock = timing.time.scale(0.4 * style.speed).add(level.integrate(0.0).scale(1.0 * style.speed));

    // The outer hexagon: a ring with six sides, and a second just inside it.
    let outer = radial.ring(#{ radius: 3.3, thickness: 0.3, segments: 6 });
    outer.scale = kick.scale(0.08).add(1.0);
    scene.add(glow(outer, style.a, hit.scale(0.4).add(0.75)));
    let inner = radial.ring(#{ radius: 2.75, thickness: 0.12, segments: 6 });
    inner.rotation.z = clock.scale(0.2);
    scene.add(glow(inner, style.b, hit.scale(0.4).add(0.7)));

    // Sparks: six lights thrown from the middle to the corners by the snare.
    for i in 0..6 {
        let spark = radial.ring(#{ radius: 0.1, thickness: 0.2, segments: 6 });
        let angle = clock.scale(0.3).add(i * 1.0472);
        let reach = snare.scale(1.6).add(1.1);
        spark.position.x = angle.sin().scale(reach);
        spark.position.y = angle.add(1.5708).sin().scale(reach);
        scene.add(glow(spark, style.c, hit.scale(0.5).add(0.9)));
    }

    // The last frame again, inside a hexagon, a little smaller and turned. Outside
    // the hexagon the loop only spreads outwards, so its edge sheds light.
    let twist = clock.scale(0.5).sin().scale(0.12).add(hit.scale(0.25));
    let fb = feedback.builder()
        .warp.affine(hit.scale(0.04).add(1.025), 0.004 * style.speed)
        .color.inset(0.43, 1.12, twist, 1.0, 6.0)
        .color.posterize(6.0)
        .color.hsv(hit.scale(0.03).add(0.012), 0.0, 0.0)
        .color.decay(misted(0.95, style.mist, 0.85, 0.985))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.6, style.mist, 0.75, 0.5), intensity: misted(0.45, style.mist, 0.25, 0.7), radius: misted(6.0, style.mist, 4.0, 10.0) }));
}
