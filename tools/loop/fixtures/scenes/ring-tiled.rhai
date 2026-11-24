// The ring with the last frame drawn two by two in the loop: a smaller ring must
// show in the right half of the frame, where the plain ring has nothing.
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
        .warp.tile(2.0)
        .color.decay(0.5)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);
}
