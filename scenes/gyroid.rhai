//! roles: hit, lead, brightness, flux, energy

// GYROID
// A glowing slice through a 3D triply periodic minimal surface — an organic
// skeletal coral lattice — paired with a tumbling wire sphere in front of it.
// Brightness and spectral flux glide the slice through depth.
//
//   hit         leaps the slice deeper into the 3D lattice
//   lead        expands the central wire sphere and zooms the coral
//   brightness  twists the layered gyroid planes
//   flux        accelerates the internal coral ripple
//   energy      drives the steady drift through depth

let style = #{ a: [0.38, 0.82, 0.24], b: [0.88, 0.42, 0.18], c: [0.28, 0.55, 0.95], speed: 1.0, at: [0.0, 0.0], mist: 0.5, answer: 1, kick: 1.0, finish: 0 }; // @style

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
    let ex = style.at[0] * -13.17;
    let ey = style.at[1] * 7.41;
    camera.position = #{ x: ex, y: ey, z: 8.94 };
    camera.target = #{ x: ex, y: ey, z: 0.0 };

    let hit = roles.hit.to_signal(#{ envelope: "attack_decay", attack_beats: 0.01, decay_beats: 0.12 });
    let lead = roles.lead.smooth.exponential(0.05, 0.35);
    let bright = roles.brightness.smooth.exponential(0.06, 0.45);
    let flux = roles.flux.smooth.exponential(0.04, 0.3);
    let level = roles.energy.smooth.exponential(0.06, 0.45);
    let count = roles.hit.to_signal(#{ envelope: "count" });
    let clock = timing.time.scale(0.28 * style.speed).add(level.integrate(0.0).scale(0.65 * style.speed));

    let orb = mesh.sphere();
    orb.rotation.x = clock.scale(0.6);
    orb.rotation.y = clock.scale(0.8).add(count.scale(0.4));
    orb.scale = lead.scale(0.95).add(hit.scale(0.45)).add(1.0);
    scene.add(wire(orb, style.a, hit.scale(0.7).add(1.0)));

    let halo = radial.ring(#{ radius: 2.3, thickness: 0.07, segments: 64 });
    halo.rotation.z = clock.scale(-0.4);
    halo.scale = flux.scale(0.4).add(0.95);
    scene.add(glow(halo, style.c, hit.scale(0.5).add(0.8)));

    let fb = feedback.builder()
        .warp.affine(0.988, 0.004 * style.speed)
        .color.hsv(0.002, 0.0, 0.0)
        .color.decay(misted(0.9, style.mist, 0.78, 0.97))
        .centre(style.at[0], style.at[1])
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);

    post.add(fx.bloom(#{ threshold: misted(0.5, style.mist, 0.65, 0.4), intensity: misted(0.7, style.mist, 0.4, 0.95), radius: misted(9.0, style.mist, 5.0, 13.0) }));
    post.add(fx.ground(#{ kind: 10, zoom: lead.scale(-0.25).add(1.5), angle: clock.scale(0.09), phase: clock.scale(0.85).add(flux.integrate(0.0).scale(0.5)), p1: count.scale(0.55), p2: bright.scale(2.2).add(0.5), amount: 0.88, a: style.a, b: style.b, c: style.c, at: style.at }));
    // The whole frame answers every blow as well, in the way the show asks for
    // (`style.answer`: see post.answer in scripting.md), so the link is never in doubt.
    post.answer(style.answer, style.kick, roles.hit, style.at);
    // And the show may lay a finish over it all (`style.finish`: grain, dither, characters and so on).
    post.finish(style.finish, timing.time);
}
