// The same loop as feedback-runaway.rhai with the bound switched off. It must blow
// out to white: if it did not, the check on the bounded scene would prove nothing.
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
        .unbounded()
        .build();
    feedback.enable(fb);
    post.add(fx.bloom(#{ threshold: 0.5, intensity: 0.8, radius: 8.0 }));
}

fn update(dt, frame) {
    cube.rotation.y += dt * 0.8;
    cube.rotation.x += dt * 0.5;
}
