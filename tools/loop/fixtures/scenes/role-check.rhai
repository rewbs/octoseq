//! roles: kick, snare, hat, beat, energy, bass, beat_phase, section_progress, section_intensity

// A scene that reads nothing but roles. It is not meant to look good: it exists so
// the loop can check that a bundle's roles reach a scene, on a perfect bundle and on
// an analysed one alike. Each drum has a cube that jumps when it hits; the rest of
// the roles move a fourth.

let kick_cube = mesh.cube();
let snare_cube = mesh.cube();
let hat_cube = mesh.cube();
let body = mesh.sphere();

fn init(ctx) {
    let kick = roles.kick.to_signal(#{ envelope: "attack_decay", decay_beats: 0.5 });
    let snare = roles.snare.to_signal(#{ envelope: "attack_decay", decay_beats: 0.5 });
    let hat = roles.hat.to_signal(#{ envelope: "attack_decay", decay_beats: 0.25 });
    let beat = roles.beat.to_signal(#{ envelope: "attack_decay", decay_beats: 0.5 });

    kick_cube.position.x = -2.0;
    kick_cube.scale = kick.scale(0.8).add(0.4);
    kick_cube.color = #{ r: 1.0, g: 0.3, b: 0.2, a: 1.0 };

    snare_cube.position.x = 0.0;
    snare_cube.position.y = 1.6;
    snare_cube.scale = snare.scale(0.8).add(0.4);
    snare_cube.color = #{ r: 0.2, g: 0.8, b: 1.0, a: 1.0 };

    hat_cube.position.x = 2.0;
    hat_cube.scale = hat.scale(0.6).add(0.3);
    hat_cube.color = #{ r: 1.0, g: 0.9, b: 0.3, a: 1.0 };

    body.position.y = -1.2;
    body.scale = roles.energy.smooth.exponential(0.05, 0.3).scale(0.8).add(roles.bass.scale(0.4)).add(beat.scale(0.2)).add(0.3);
    body.rotation.y = roles.section_progress.scale(6.28);
    body.rotation.x = roles.beat_phase.scale(0.5).add(roles.section_intensity);

    scene.add(kick_cube);
    scene.add(snare_cube);
    scene.add(hat_cube);
    scene.add(body);
}
