// PSYCHEDELIC FEEDBACK TUNNEL
// Warped feedback with multiple post-processing layers
// Features: Advanced feedback warping, effect chains, material params, noise generators

let tunnel_mesh = ();
let orbiters = [];
let sparklines = [];

// Audio signals
let energy = ();
let flux = ();
let centroid = ();
let onset_events = ();
let beat_density = ();

// Generated signals
let perlin_wobble = ();
let beat_osc = ();

fn init(ctx) {
    // Audio signal processing
    energy = inputs.mix.amplitude
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    flux = inputs.mix.flux
        .smooth.exponential(0.03, 0.15)
        .normalise.robust();

    centroid = inputs.mix.centroid
        .smooth.exponential(0.1, 0.3)
        .normalise.robust();

    onset_events = inputs.mix.onset
        .smooth.exponential(0.02, 0.1)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.25,
            target_density: 3.0,
            min_threshold: 0.3
        });

    // Beat density signal - count recent events
    beat_density = onset_events.density_prev_beats(4.0);

    // Generated signals
    perlin_wobble = gen.perlin(2.0, 123);
    beat_osc = gen.sin(2.0, 0.0);

    // Create tunnel from sphere
    tunnel_mesh = mesh.sphere();
    tunnel_mesh.material = "emissive";
    tunnel_mesh.scale = 5.0;
    scene.add(tunnel_mesh);

    // Create orbiting emissive cubes
    for i in 0..6 {
        let cube = mesh.cube();
        cube.material = "emissive";
        cube.scale = 0.3;
        orbiters.push(cube);
        scene.add(cube);
    }

    // Create signal trace sparklines
    for i in 0..3 {
        let trace = line.trace(
            if i == 0 { energy } else if i == 1 { flux } else { centroid },
            #{
                max_points: 128,
                mode: "line",
                x_scale: 1.5,
                y_scale: 2.0,
                y_offset: i - 1.0
            }
        );
        sparklines.push(trace);
        scene.add(trace);
    }

    // Complex feedback with multiple warps
    let fb = feedback.builder()
        .warp.spiral(0.5, 0.025)
        .warp.noise(0.2, 1.5)
        .warp.shear(0.1)
        .color.decay(0.91)
        .color.hsv(0.03, 0.05, -0.03)
        .color.posterize(6.0)
        .blend.screen()
        .opacity(0.88)
        .sample_after_effects()
        .build();
    feedback.enable(fb);

    // Extensive post-processing chain
    let bloom = fx.bloom(#{
        threshold: 0.4,
        intensity: 1.2,
        radius: 16.0,
        downsample: 2.0
    });
    post.add(bloom);

    let chroma = fx.chromaticAberration(#{
        amount: 0.005,
        angle: 0.785
    });
    post.add(chroma);

    let zoom_wrap = fx.zoomWrap(#{
        amount: 0.98,
        center: #{ x: 0.5, y: 0.5 },
        wrap_mode: "mirror"
    });
    post.add(zoom_wrap);

    let grain = fx.grain(#{
        amount: 0.08,
        scale: 1.5,
        seed: 42
    });
    post.add(grain);

    let grade = fx.colorGrade(#{
        contrast: 1.15,
        saturation: 1.4,
        brightness: 1.05,
        gamma: 1.1
    });
    post.add(grade);

    let directional_blur = fx.directionalBlur(#{
        amount: 2.0,
        angle: 0.0,
        samples: 8
    });
    post.add(directional_blur);
}

fn update(dt, frame) {
    let time = frame.time;
    let beat_phase = timing.beatPhase;

    // Dynamic blur angle follows spectral centroid
    let dir_blur_angle = centroid.scale(6.28318);

    // Update tunnel emission based on beat density
    tunnel_mesh.rotation.y = timing.time.scale(0.1);
    tunnel_mesh.rotation.x = perlin_wobble.scale(0.3);

    tunnel_mesh.params.emission_intensity = beat_density.scale(1.5).add(0.3);
    tunnel_mesh.params.emission_color = #{
        r: energy.scale(0.7).add(0.3),
        g: flux.scale(0.6).add(0.2),
        b: centroid.scale(0.8).add(0.2),
        a: 1.0
    };

    // Orbiters create patterns
    for i in 0..6 {
        let cube = orbiters[i];
        let angle = (i / 6.0) * 6.28318 + time * 0.5;
        let radius = 2.0 + beat_osc.scale(0.5);
        let height_offset = i * 0.3 - 0.9;

        cube.position = #{
            x: radius * angle.cos(),
            y: height_offset + perlin_wobble.scale(0.4),
            z: radius * angle.sin()
        };

        cube.rotation.y = time * 2.0 + i;
        cube.rotation.x = beat_phase.scale(6.28318);
        cube.rotation.z = perlin_wobble.scale(3.14159);

        cube.scale = energy.scale(0.2).add(0.25);

        // Color cycling through HSV space
        let hue = (time * 0.3 + i * 1.047) % 6.28318;
        cube.params.emission_intensity = flux.scale(2.0).add(1.0);
        cube.params.emission_color = #{
            r: (hue.sin() * 0.5 + 0.5),
            g: ((hue + 2.094).sin() * 0.5 + 0.5),
            b: ((hue + 4.189).sin() * 0.5 + 0.5),
            a: 1.0
        };
    }

    // Position sparklines
    sparklines[0].position = #{ x: -3.0, y: 0.0, z: 2.0 };
    sparklines[0].color = #{
        r: energy.scale(0.8).add(0.2),
        g: 0.3,
        b: 0.3,
        a: 0.9
    };

    sparklines[1].position = #{ x: 0.0, y: 0.0, z: 2.0 };
    sparklines[1].color = #{
        r: 0.3,
        g: flux.scale(0.8).add(0.2),
        b: 0.3,
        a: 0.9
    };

    sparklines[2].position = #{ x: 3.0, y: 0.0, z: 2.0 };
    sparklines[2].color = #{
        r: 0.3,
        g: 0.3,
        b: centroid.scale(0.8).add(0.2),
        a: 0.9
    };

    // Update feedback dynamically based on audio
    let warp_strength = frame.flux * 0.7;
    let rotation_speed = frame.energy * 0.04;
    let noise_intensity = frame.onset * 0.3;

    let fb = feedback.builder()
        .warp.spiral(warp_strength, rotation_speed)
        .warp.noise(noise_intensity, 2.0)
        .warp.radial(frame.energy * 0.2, 1.015)
        .color.decay(0.91)
        .color.hsv(frame.centroid * 0.05, 0.05, -0.03)
        .color.posterize(6.0)
        .blend.screen()
        .opacity(0.88)
        .sample_after_effects()
        .build();
    feedback.enable(fb);
}
