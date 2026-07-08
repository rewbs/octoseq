// AUDIO RIBBON DANCE
// Flowing ribbons trace multiple signals through 3D space
// Features: Line ribbons, line traces, signal composition, lighting, shadows

let bass_ribbon = ();
let mid_ribbon = ();
let high_ribbon = ();
let rms_trace = ();
let flux_trace = ();
let center_guide = mesh.sphere();

// Composed signals
let bass_smooth = ();
let mid_smooth = ();
let high_smooth = ();
let combined = ();

fn init(ctx) {
    // Setup lighting for ribbon depth
    lighting.enabled = true;
    lighting.direction = #{ x: 1.0, y: -0.5, z: 0.5 };
    lighting.intensity = 1.5;
    lighting.ambient = 0.3;
    lighting.rim_intensity = 0.8;
    lighting.rim_power = 2.5;

    // Prepare smoothed frequency band signals
    bass_smooth = inputs.mix.bands["Bass"].energy
        .smooth.exponential(0.05, 0.3)
        .normalise.robust();

    mid_smooth = inputs.mix.bands["Mids"].energy
        .smooth.exponential(0.04, 0.25)
        .normalise.robust();

    high_smooth = inputs.mix.bands["Highs"].energy
        .smooth.exponential(0.03, 0.2)
        .normalise.robust();

    // Combine signals with different weights
    combined = bass_smooth.scale(0.4)
        .add(mid_smooth.scale(0.3))
        .add(high_smooth.scale(0.3));

    // Create ribbons for each frequency band
    bass_ribbon = line.ribbon(bass_smooth, #{
        max_points: 256,
        mode: "tube",
        width: 0.15,
        twist: 0.5,
        tube_segments: 12
    });
    bass_ribbon.color = #{ r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
    scene.add(bass_ribbon);

    mid_ribbon = line.ribbon(mid_smooth, #{
        max_points: 256,
        mode: "tube",
        width: 0.12,
        twist: -0.3,
        tube_segments: 10
    });
    mid_ribbon.color = #{ r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
    scene.add(mid_ribbon);

    high_ribbon = line.ribbon(high_smooth, #{
        max_points: 256,
        mode: "tube",
        width: 0.09,
        twist: 0.8,
        tube_segments: 8
    });
    high_ribbon.color = #{ r: 0.2, g: 0.4, b: 1.0, a: 1.0 };
    scene.add(high_ribbon);

    // Line traces for 2D signal visualization
    rms_trace = line.trace(inputs.mix.amplitude.smooth.exponential(0.05, 0.2), #{
        max_points: 512,
        mode: "line",
        x_scale: 2.0,
        y_scale: 3.0,
        y_offset: -2.0
    });
    rms_trace.color = #{ r: 1.0, g: 0.8, b: 0.2, a: 0.8 };
    rms_trace.position = #{ x: -4.0, y: 0.0, z: 0.0 };
    scene.add(rms_trace);

    flux_trace = line.trace(inputs.mix.flux.smooth.exponential(0.03, 0.15), #{
        max_points: 512,
        mode: "line",
        x_scale: 2.0,
        y_scale: 3.0,
        y_offset: -2.0
    });
    flux_trace.color = #{ r: 0.5, g: 1.0, b: 0.8, a: 0.8 };
    flux_trace.position = #{ x: 4.0, y: 0.0, z: 0.0 };
    scene.add(flux_trace);

    // Central guide sphere
    center_guide.material = "emissive";
    center_guide.scale = 0.3;
    center_guide.shadow.enabled = true;
    center_guide.shadow.plane_y = -2.0;
    center_guide.shadow.opacity = 0.6;
    scene.add(center_guide);

    // Ground plane for shadows
    let floor = mesh.plane();
    floor.position.y = -2.0;
    floor.rotation.x = -1.5708;
    floor.scale = 8.0;
    floor.color = #{ r: 0.1, g: 0.1, b: 0.15, a: 1.0 };
    floor.lit = false;
    scene.add(floor);

    // Subtle bloom
    let bloom = fx.bloom(#{
        threshold: 0.6,
        intensity: 0.6,
        radius: 6.0
    });
    post.add(bloom);

    // Color grading for warmth
    let grade = fx.colorGrade(#{
        contrast: 1.1,
        saturation: 1.2,
        brightness: 1.05
    });
    post.add(grade);
}

fn update(dt, frame) {
    // Position ribbons in orbital formation
    let time = frame.time;
    let beat_pos = timing.beatPosition;

    // Bass ribbon - circular orbit
    let bass_angle = time * 0.3;
    bass_ribbon.position = #{
        x: 2.0 * bass_angle.cos(),
        y: bass_smooth.scale(1.5).sub(0.5),
        z: 2.0 * bass_angle.sin()
    };
    bass_ribbon.rotation.y = bass_angle;

    // Mid ribbon - figure-8 pattern
    let mid_angle = time * 0.5;
    mid_ribbon.position = #{
        x: 1.5 * (mid_angle * 2.0).sin(),
        y: mid_smooth.scale(1.2),
        z: 1.5 * mid_angle.cos()
    };
    mid_ribbon.rotation.x = mid_angle * 0.5;

    // High ribbon - vertical helix
    let high_angle = time * 0.7;
    high_ribbon.position = #{
        x: 1.0 * high_angle.cos(),
        y: high_smooth.scale(2.0).sub(1.0),
        z: 1.0 * high_angle.sin()
    };
    high_ribbon.rotation.z = high_angle;

    // Ribbon widths pulse with signal
    bass_ribbon.width = bass_smooth.scale(0.1).add(0.1);
    mid_ribbon.width = mid_smooth.scale(0.08).add(0.08);
    high_ribbon.width = high_smooth.scale(0.06).add(0.06);

    // Central guide follows combined signal
    center_guide.position.y = combined.scale(2.0).sub(0.5);
    center_guide.rotation.y = timing.beatPhase.scale(6.28318);
    center_guide.scale = combined.scale(0.3).add(0.2);

    center_guide.params.emission_intensity = combined.scale(2.0).add(0.5);
    center_guide.params.emission_color = #{
        r: bass_smooth.scale(0.8).add(0.2),
        g: mid_smooth.scale(0.8).add(0.2),
        b: high_smooth.scale(0.8).add(0.2),
        a: 1.0
    };

    // Shadow scales with height
    center_guide.shadow.radius = combined.scale(0.8).add(0.5);
    center_guide.shadow.opacity = combined.scale(-0.3).add(0.7);
}
