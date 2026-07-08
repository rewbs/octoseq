// PARTICLE STORM
// Dynamic particle bursts with warping feedback trails
// Features: Particle systems, events, feedback warps, point clouds, chromatic aberration

let particle_bursts = ();
let ambient_cloud = ();
let core = mesh.sphere();

// Audio signals
let onset_events = ();
let energy = ();
let flux = ();

fn init(ctx) {
    // Extract strong onset events for particle bursts
    onset_events = inputs.mix.onset
        .smooth.exponential(0.02, 0.1)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.3,
            target_density: 2.5,
            min_threshold: 0.4,
            phase_bias: 0.3
        });

    // Create particle system from events
    particle_bursts = particles.from_events(onset_events, #{
        count: 32,
        lifetime_beats: 0.8,
        envelope: "attack_decay",
        attack_beats: 0.02,
        decay_beats: 0.5,
        easing: "cubic_out",
        spread: #{ x: 2.0, y: 1.5, z: 2.0 },
        scale: 0.06,
        scale_variation: 0.7,
        color: #{ r: 1.0, g: 0.8, b: 0.3, a: 1.0 },
        color_variation: 0.3
    });
    scene.add(particle_bursts);

    // Ambient point cloud for atmosphere
    ambient_cloud = points.cloud(#{
        count: 2000,
        spread: 4.0,
        mode: "sphere",
        seed: 42,
        point_size: 2.0
    });
    ambient_cloud.color = #{ r: 0.3, g: 0.5, b: 0.8, a: 0.6 };
    scene.add(ambient_cloud);

    // Central core with soft additive material
    core.material = "soft_additive";
    core.scale = 0.4;
    scene.add(core);

    // Audio signals
    energy = inputs.mix.rms
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    flux = inputs.mix.flux
        .smooth.exponential(0.03, 0.15)
        .normalise.robust();

    // Create feedback with dynamic warping
    let fb = feedback.builder()
        .warp.radial(0.4, 1.02)
        .warp.noise(0.15, 2.0)
        .color.decay(0.93)
        .color.hsv(0.02, 0.0, -0.05)
        .blend.add()
        .opacity(0.85)
        .build();
    feedback.enable(fb);

    // Post-processing stack
    let bloom = fx.bloom(#{
        threshold: 0.4,
        intensity: 1.0,
        radius: 12.0,
        downsample: 2.0
    });
    post.add(bloom);

    let chroma = fx.chromaticAberration(#{
        amount: 0.003,
        angle: 0.0
    });
    post.add(chroma);

    let radial_blur = fx.radialBlur(#{
        strength: 0.02,
        center: #{ x: 0.5, y: 0.5 },
        samples: 8
    });
    post.add(radial_blur);
}

fn update(dt, frame) {
    // Rotate core with flux
    core.rotation.y += dt * (0.5 + flux.scale(2.0));
    core.rotation.x = timing.beatPhase.scale(6.28318).sin().scale(0.3);

    // Core scale pulses with energy
    core.scale = energy.scale(0.5).add(0.3);
    core.params.softness = flux.scale(0.5).add(0.3);

    // Point cloud reacts to audio
    ambient_cloud.point_size = energy.scale(3.0).add(1.5);
    ambient_cloud.color = #{
        r: flux.scale(0.5).add(0.3),
        g: energy.scale(0.4).add(0.4),
        b: 0.8,
        a: 0.7
    };

    // Slow rotation of point cloud
    ambient_cloud.rotation.y = timing.time.scale(0.1);
    ambient_cloud.rotation.x = timing.beatPhase.scale(6.28318).sin().scale(0.2);

    // Update feedback warping based on flux
    let warp_amount = frame.flux * 0.6;
    let rotation_rate = frame.energy * 0.03;

    let fb = feedback.builder()
        .warp.spiral(warp_amount, rotation_rate)
        .warp.noise(frame.onset * 0.2, 2.5)
        .color.decay(0.93)
        .color.hsv(frame.flux * 0.03, 0.0, -0.05)
        .blend.add()
        .opacity(0.85)
        .build();
    feedback.enable(fb);
}
