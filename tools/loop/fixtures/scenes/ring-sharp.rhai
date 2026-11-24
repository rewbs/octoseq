// ring-soft.rhai with the loop sharpening the last frame against a blurred copy
// of itself: the picture must have more fine detail than the soft one.
fn init(ctx) {
    camera.position = #{ x: 0.0, y: 0.0, z: 6.5 };
    camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

    let ring = radial.ring(#{ radius: 0.8, thickness: 0.5, segments: 48 });
    ring.position.x = -2.5;
    ring.material = "emissive";
    ring.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    ring.materialParams.emission_color = #{ r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
    ring.materialParams.emission_intensity = 1.0;
    scene.add(ring);

    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, 0.0, 0.0)
        .warp.waves(3.0, 1.0, timing.time)
        .color.sharpen(0.6, 0.012)
        .color.decay(0.94)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);
}
