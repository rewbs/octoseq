// SPECTRAL FLOWER
// A blooming flower visualization driven by frequency bands
// Features: Radial waves, frequency bands, event-driven petals, materials, lighting

let center_sphere = mesh.sphere();
let petals = [];
let energy_ring = ();

// Audio signals
let bass_energy = ();
let mid_energy = ();
let high_energy = ();
let bass_hits = ();

fn init(ctx) {
    // Enable lighting for depth
    lighting.enabled = true;
    lighting.direction = #{ x: 0.5, y: -1.0, z: 0.3 };
    lighting.intensity = 1.2;
    lighting.ambient = 0.4;
    lighting.rim_intensity = 0.6;
    lighting.rim_power = 3.0;

    // Central sphere with emissive pulsing
    center_sphere.material = "emissive";
    center_sphere.scale = 0.5;
    scene.add(center_sphere);

    // Extract bass hit events for petal spawning
    bass_hits = inputs.mix.bands["Bass"].onset
        .smooth.exponential(0.02, 0.2)
        .normalise.robust()
        .pick.events(#{
            hysteresis_beats: 0.5,
            target_density: 1.5,
            min_threshold: 0.3
        });

    // Create 8 petals with gradient material
    for i in 0..8 {
        let petal = mesh.sphere();
        petal.material = "gradient";
        petal.scale = 0.3;
        petals.push(petal);
        scene.add(petal);
    }

    // Audio-reactive frequency bands
    bass_energy = inputs.mix.bands["Bass"].energy
        .smooth.exponential(0.05, 0.3)
        .normalise.robust();

    mid_energy = inputs.mix.bands["Mids"].energy
        .smooth.exponential(0.05, 0.25)
        .normalise.robust();

    high_energy = inputs.mix.bands["Highs"].energy
        .smooth.exponential(0.03, 0.2)
        .normalise.robust();

    // Create radial wave visualization for bass
    energy_ring = radial.wave(bass_energy, #{
        base_radius: 2.0,
        amplitude: 0.8,
        wave_frequency: 6,
        resolution: 256
    });
    energy_ring.color = #{ r: 0.2, g: 0.6, b: 1.0, a: 0.8 };
    scene.add(energy_ring);

    // Add bloom for glow
    let bloom = fx.bloom(#{
        threshold: 0.5,
        intensity: 0.8,
        radius: 8.0
    });
    post.add(bloom);

    // Subtle vignette
    let vignette = fx.vignette(#{
        intensity: 0.25,
        smoothness: 0.6
    });
    post.add(vignette);
}

fn update(dt, frame) {
    // Center sphere pulses with overall energy
    let overall_energy = inputs.mix.rms
        .smooth.exponential(0.05, 0.2)
        .normalise.robust();

    center_sphere.scale = overall_energy.scale(0.4).add(0.3);
    center_sphere.rotation.y += dt * 0.3;

    // Emission intensity driven by bass hits
    let hit_envelope = bass_hits.to_signal(#{
        envelope: "attack_decay",
        attack_beats: 0.01,
        decay_beats: 0.3,
        easing: "exponential_out"
    });

    center_sphere.params.emission_intensity = hit_envelope.scale(3.0).add(0.5);
    center_sphere.params.emission_color = #{
        r: bass_energy.scale(0.6).add(0.4),
        g: mid_energy.scale(0.4).add(0.3),
        b: high_energy.scale(0.8).add(0.2),
        a: 1.0
    };

    // Animate petals in a flower pattern
    let beat_phase = timing.beatPhase;

    for i in 0..8 {
        let petal = petals[i];
        let angle = (i / 8.0) * 6.28318 + frame.time * 0.2;

        // Radial distance oscillates with frequency bands
        let band_index = i % 3;
        let radius_signal = if band_index == 0 {
            bass_energy
        } else if band_index == 1 {
            mid_energy
        } else {
            high_energy
        };

        // Position petals in flower formation
        petal.position = #{
            x: (2.0 + radius_signal.scale(1.0)) * angle.cos(),
            y: beat_phase.scale(0.5).sin().scale(0.3),
            z: (2.0 + radius_signal.scale(1.0)) * angle.sin()
        };

        // Scale with hits
        petal.scale = hit_envelope.scale(0.3).add(0.25);

        // Rotation follows music
        petal.rotation.y = frame.time * 0.5 + i * 0.5;
        petal.rotation.x = beat_phase.scale(6.28318);

        // Gradient colors cycling through spectrum
        let hue_offset = i / 8.0;
        petal.params.color_top = #{
            r: ((frame.time * 0.2 + hue_offset * 6.28).sin() * 0.5 + 0.5) * radius_signal,
            g: ((frame.time * 0.2 + hue_offset * 6.28 + 2.09).sin() * 0.5 + 0.5) * radius_signal,
            b: ((frame.time * 0.2 + hue_offset * 6.28 + 4.19).sin() * 0.5 + 0.5) * radius_signal,
            a: 1.0
        };
        petal.params.color_bottom = #{
            r: 0.1,
            g: 0.1,
            b: 0.2,
            a: 1.0
        };
    }

    // Ring color shifts with highs
    energy_ring.color = #{
        r: high_energy.scale(0.6).add(0.2),
        g: mid_energy.scale(0.5).add(0.3),
        b: bass_energy.scale(0.7).add(0.3),
        a: 0.9
    };
}
