// A feedback loop that brightens every frame: an additive blend at full opacity,
// almost no decay, and bloom sampled back into the loop. Left alone it climbs to
// white within seconds. The engine bounds feedback by default, so this scene must
// stay below white; the loop renders it on every run to check that it does.
let cube = mesh.cube();

fn init(ctx) {
    cube.scale = inputs.mix.energy.smooth.exponential(0.05, 0.3).scale(0.8).add(0.8);
    scene.add(cube);

    let fb = feedback.builder()
        .warp.spiral(0.4, 0.02)
        .color.decay(0.99)
        .blend.add()
        .opacity(1.0)
        .sample_after_effects()
        .build();
    feedback.enable(fb);
    post.add(fx.bloom(#{ threshold: 0.5, intensity: 0.8, radius: 8.0 }));
}

fn update(dt, frame) {
    cube.rotation.y += dt * 0.8;
    cube.rotation.x += dt * 0.5;
}
