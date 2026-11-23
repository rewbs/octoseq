//! roles: energy, vocal_presence

// No bundle the loop builds provides `vocal_presence`, so the engine must refuse to
// load this scene and say which role is missing. The loop checks that it does.

let ball = mesh.sphere();

fn init(ctx) {
    ball.scale = roles.vocal_presence.add(roles.energy).add(0.5);
    scene.add(ball);
}
