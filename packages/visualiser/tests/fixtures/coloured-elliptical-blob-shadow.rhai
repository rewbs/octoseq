// Fixture for tests/blob_shadows.rs.
//
// One cube above the origin casting an opaque red shadow that is wide in X (radius
// 2.0) and narrow in Z (radius 0.4), on the plane y = -2. The camera looks at the
// shadow's centre. There is no floor: the shadow shows on the grey clear colour.

let cube = mesh.cube();

fn init(ctx) {
    camera.position = #{ x: 0.0, y: 9.0, z: 9.0 };
    camera.target = #{ x: 0.0, y: -2.0, z: 0.0 };

    cube.scale = 0.4;
    cube.position = #{ x: 0.0, y: 1.5, z: 0.0 };
    cube.shadow.enabled = true;
    cube.shadow.plane_y = -2.0;
    cube.shadow.radius_x = 2.0;
    cube.shadow.radius_z = 0.4;
    cube.shadow.opacity = 1.0;
    cube.shadow.softness = 0.05;
    cube.shadow.color = #{ r: 1.0, g: 0.0, b: 0.0 };
    scene.add(cube);
}

fn update(dt, frame) {
}
