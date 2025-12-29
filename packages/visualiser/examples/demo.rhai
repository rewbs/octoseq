// Demo script: Cube reacts to audio features
//
// The cube object has:
//   - rotation_x, rotation_y, rotation_z (radians)
//   - scale (uniform scale factor, 1.0 = normal)
//
// The `frame` parameter has per-frame numeric values:
//   - time (seconds since start)
//   - dt (delta time since last frame)
//   - amplitude (current audio amplitude, 0.0-1.0)
//   - flux (spectral flux, 0.0-1.0)
//
// The global `inputs` object has Signal-returning accessors:
//   - inputs.bands["Bass"].energy, inputs.bands["Bass"].onset, etc.

// Persistent state - survives across frames
let phase = 0.0;

fn update(dt, frame) {
    // Accumulate phase based on flux (faster spin when more spectral change)
    phase += dt * (0.5 + frame.flux * 2.0);

    // Y rotation follows accumulated phase
    cube.rotation_y = phase;

    // X rotation adds subtle wobble based on time
    cube.rotation_x = 0.1 * (frame.time * 2.0).sin();

    // Scale pulses with amplitude
    cube.scale = 1.0 + frame.amplitude * 0.5;
}
