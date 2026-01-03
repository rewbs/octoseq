export const DEFAULT_SCRIPT = `let cube = mesh.cube();

cube.rotation.x = timing.time;

fn init(ctx) {
    scene.add(cube);
}

fn update(dt, frame) {
}`;


export const BASIC_AUDIO_SCRIPT = `let cube = mesh.cube();

let smoothAmp = inputs.mix.energy.smooth.moving_average(0.5).scale(20);
let smoothOnsets = inputs.mix.onset.smooth.exponential(0.1, 0.5).scale(10);

cube.rotation.x = smoothAmp;
cube.scale = smoothOnsets;
cube.rotation.y = sin(timing.time);
camera.lookAt(#{x:gen.perlin(4, 40), y:gen.perlin(2, 41), z:gen.perlin(8, 42)});


let bloom = fx.bloom(#{
  intensity: smoothOnsets.sigmoid(10).scale(10).add(1.0) ,
  threshold: 0.7});

let fb = feedback.builder()
    .warp.spiral(sin(timing.beatPosition), 1, 0.1)
    .opacity(0.4)
    .blend.difference()
    .build();

fn init(ctx) {
    scene.add(cube);
    post.add(bloom);
    feedback.enable(fb);
}

fn update(dt, frame) {
}`;
