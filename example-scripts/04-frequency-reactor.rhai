// FREQUENCY REACTOR
// Multi-layered frequency visualization with hierarchical groups
// Features: Groups, instancing, complex signal transformations, anticipation/delay, shadows

let reactor_core = ();
let bass_ring = [];
let mid_ring = [];
let high_ring = [];
let delay_followers = [];

// Signal processing
let bass = ();
let mids = ();
let highs = ();
let onset_env = ();
let beat_events = ();

fn init(ctx) {
    // Lighting setup
    lighting.enabled = true;
    lighting.direction = #{ x: 0.0, y: -1.0, z: 0.5 };
    lighting.intensity = inputs.mix.energy
        .smooth.exponential(0.1, 0.3)
        .normalise.robust()
        .scale(0.5)
        .add(0.8);
    lighting.ambient = 0.4;
    lighting.rim_intensity = 0.5;

    // Process frequency bands
    bass = inputs.mix.bands["Bass"].energy
        .smooth.exponential(0.05, 0.3)
        .normalise.robust();

    mids = inputs.mix.bands["Mids"].energy
        .smooth.exponential(0.04, 0.25)
        .normalise.robust();

    highs = inputs.mix.bands["Highs"].energy
        .smooth.exponential(0.03, 0.2)
        .normalise.robust();

    // Extract beat events
    beat_events = inputs.mix.onset
        .smooth.exponential(0.02, 0.15)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.4,
            target_density: 2.0
        });

    onset_env = beat_events.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.25,
        easing: "exponential_out"
    });

    // Create reactor core group
    reactor_core = scene.group();

    let core_sphere = mesh.sphere();
    core_sphere.material = "emissive";
    core_sphere.scale = 0.6;
    reactor_core.add(core_sphere);

    scene.add(reactor_core);

    // Create bass ring - 8 large cubes in outer orbit
    for i in 0..8 {
        let cube = mesh.cube();
        cube.material = "gradient";
        cube.scale = 0.4;
        cube.shadow.enabled = true;
        cube.shadow.plane_y = -3.0;
        cube.shadow.radius = 0.8;
        cube.shadow.opacity = 0.5;
        bass_ring.push(cube);
        scene.add(cube);
    }

    // Create mid ring - 12 medium spheres
    let base_sphere = mesh.sphere();
    base_sphere.scale = 0.25;
    base_sphere.color = #{ r: 0.2, g: 1.0, b: 0.4, a: 1.0 };

    for i in 0..12 {
        let instance = base_sphere.instance();
        mid_ring.push(instance);
        scene.add(instance);
    }

    // Create high ring - 16 small cubes
    for i in 0..16 {
        let cube = mesh.cube();
        cube.scale = 0.15;
        cube.material = "wire_glow";
        high_ring.push(cube);
        scene.add(cube);
    }

    // Create delay followers demonstrating time-shifting
    for i in 0..3 {
        let follower = mesh.sphere();
        follower.scale = 0.2;
        follower.material = "soft_additive";
        delay_followers.push(follower);
        scene.add(follower);
    }

    // Add floor plane
    let floor = mesh.plane();
    floor.position.y = -3.0;
    floor.rotation.x = -1.5708;
    floor.scale = 12.0;
    floor.color = #{ r: 0.05, g: 0.05, b: 0.1, a: 1.0 };
    floor.lit = false;
    scene.add(floor);

    // Post-processing
    let bloom = fx.bloom(#{
        threshold: 0.5,
        intensity: 0.7,
        radius: 10.0
    });
    post.add(bloom);

    let vignette = fx.vignette(#{
        intensity: 0.3,
        smoothness: 0.5
    });
    post.add(vignette);
}

fn update(dt, frame) {
    let time = frame.time;
    let beat_phase = timing.beatPhase;

    // Reactor core pulses and rotates
    reactor_core.scale = onset_env.scale(0.5).add(1.0);
    reactor_core.rotation.y = timing.time.scale(0.3);
    reactor_core.rotation.x = beat_phase.scale(6.28318).sin().scale(0.2);

    // Core emission
    let core_sphere = reactor_core;
    // Since we can't directly access group children, we'll update via signals

    // Bass ring - outer orbit
    for i in 0..8 {
        let cube = bass_ring[i];
        let angle = (i / 8.0) * 6.28318 + time * 0.2;
        let radius = 3.5 + bass.scale(1.0);

        cube.position = #{
            x: radius * angle.cos(),
            y: bass.scale(1.5).sub(0.5),
            z: radius * angle.sin()
        };

        cube.rotation.y = time + i * 0.5;
        cube.rotation.x = beat_phase.scale(6.28318);
        cube.scale = bass.scale(0.3).add(0.3);

        // Gradient colors
        cube.params.color_top = #{
            r: bass.scale(0.8).add(0.2),
            g: 0.3,
            b: onset_env.scale(0.6).add(0.2),
            a: 1.0
        };
        cube.params.color_bottom = #{
            r: 0.1,
            g: 0.1,
            b: 0.2,
            a: 1.0
        };

        // Shadow intensity
        cube.shadow.opacity = bass.scale(0.4).add(0.3);
    }

    // Mid ring - middle orbit
    for i in 0..12 {
        let sphere = mid_ring[i];
        let angle = (i / 12.0) * 6.28318 - time * 0.4;
        let radius = 2.2 + mids.scale(0.6);

        sphere.position = #{
            x: radius * angle.cos(),
            y: mids.scale(1.2) + beat_phase.scale(0.3).sin(),
            z: radius * angle.sin()
        };

        sphere.scale = mids.scale(0.15).add(0.2);
        sphere.rotation.y = -time * 2.0;

        sphere.color = #{
            r: 0.2,
            g: mids.scale(0.8).add(0.2),
            b: onset_env.scale(0.5).add(0.3),
            a: 1.0
        };
    }

    // High ring - inner orbit, fast rotation
    for i in 0..16 {
        let cube = high_ring[i];
        let angle = (i / 16.0) * 6.28318 + time * 0.8;
        let radius = 1.2 + highs.scale(0.4);

        cube.position = #{
            x: radius * angle.cos(),
            y: highs.scale(0.8),
            z: radius * angle.sin()
        };

        cube.rotation.y = time * 3.0 + i;
        cube.rotation.z = beat_phase.scale(6.28318);
        cube.scale = highs.scale(0.1).add(0.12);

        cube.params.glow_color = #{
            r: highs.scale(0.5).add(0.3),
            g: 0.4,
            b: 1.0,
            a: 1.0
        };
        cube.params.glow_intensity = highs.scale(2.0).add(0.5);
    }

    // Delay followers - demonstrate time-shifting
    // Leader uses current onset
    let leader_signal = onset_env;

    // Follower 1: 0.25 beats behind
    let follower1_signal = onset_env.delay(0.25);

    // Follower 2: 0.5 beats behind
    let follower2_signal = onset_env.delay(0.5);

    let followers_y = 2.0;

    delay_followers[0].position = #{
        x: -1.5,
        y: leader_signal.scale(1.5).add(followers_y),
        z: 0.0
    };
    delay_followers[0].scale = leader_signal.scale(0.2).add(0.15);
    delay_followers[0].color = #{ r: 1.0, g: 0.3, b: 0.3, a: 0.8 };

    delay_followers[1].position = #{
        x: 0.0,
        y: follower1_signal.scale(1.5).add(followers_y),
        z: 0.0
    };
    delay_followers[1].scale = follower1_signal.scale(0.2).add(0.15);
    delay_followers[1].color = #{ r: 0.3, g: 1.0, b: 0.3, a: 0.8 };

    delay_followers[2].position = #{
        x: 1.5,
        y: follower2_signal.scale(1.5).add(followers_y),
        z: 0.0
    };
    delay_followers[2].scale = follower2_signal.scale(0.2).add(0.15);
    delay_followers[2].color = #{ r: 0.3, g: 0.3, b: 1.0, a: 0.8 };
}
