// Fixture for tests/blob_shadows.rs.
//
// Two shadowed cubes at x = -3 and x = +3, with an unshadowed cube declared between
// them so a shadow's uniform slot differs from its mesh's index. There is no floor:
// the shadows show as dark ellipses on the grey clear colour, on the plane y = -2.
// The camera looks at the midpoint between the two shadow centres.

let left = mesh.cube();
let middle = mesh.cube();
let right = mesh.cube();

fn init(ctx) {
    camera.position = #{ x: 0.0, y: 9.0, z: 9.0 };
    camera.target = #{ x: 0.0, y: -2.0, z: 0.0 };

    // Small, opaque, hard-edged shadow.
    left.scale = 0.4;
    left.position = #{ x: -3.0, y: 1.5, z: 0.0 };
    left.shadow.enabled = true;
    left.shadow.plane_y = -2.0;
    left.shadow.radius = 0.6;
    left.shadow.opacity = 1.0;
    left.shadow.softness = 0.05;
    scene.add(left);

    middle.scale = 0.4;
    middle.position = #{ x: 0.0, y: 1.5, z: 0.0 };
    scene.add(middle);

    // Large, translucent, soft shadow.
    right.scale = 0.4;
    right.position = #{ x: 3.0, y: 1.5, z: 0.0 };
    right.shadow.enabled = true;
    right.shadow.plane_y = -2.0;
    right.shadow.radius = 1.6;
    right.shadow.opacity = 0.6;
    right.shadow.softness = 0.8;
    scene.add(right);
}

fn update(dt, frame) {
}
