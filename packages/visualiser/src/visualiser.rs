use crate::input::InputSignal;

pub struct VisualiserConfig {
    pub base_rotation_speed: f32, // Radians per second
    pub sensitivity: f32,         // Scale factor for input
    pub sigmoid_k: f32,           // Sigmoid strength (0.0 = off)
    pub zoom_sensitivity: f32,    // Scale factor for zoom
}

impl Default for VisualiserConfig {
    fn default() -> Self {
        Self {
            base_rotation_speed: 0.5,
            sensitivity: 2.0, // Reduced default since input might be pushed by sigmoid
            sigmoid_k: 0.0,
            zoom_sensitivity: 5.0,
        }
    }
}

pub struct VisualiserState {
    pub time: f32,
    pub rotation: f32,
    pub zoom: f32,
    pub last_rot_input: f32,
    pub config: VisualiserConfig,
}

impl VisualiserState {
    pub fn new() -> Self {
        Self {
            time: 0.0,
            rotation: 0.0,
            zoom: 0.0,
            last_rot_input: 0.0,
            config: VisualiserConfig::default(),
        }
    }

    pub fn reset(&mut self) {
        self.time = 0.0;
        self.rotation = 0.0;
        self.zoom = 0.0;
        self.last_rot_input = 0.0;
    }

    pub fn set_time(&mut self, time: f32) {
        self.time = time;
    }

    // Now accepts two optional signals
    pub fn update(&mut self, dt: f32, rotation_signal: Option<&InputSignal>, zoom_signal: Option<&InputSignal>) {
        self.time += dt;

        // Rotation Logic
        let rot_input = if let Some(sig) = rotation_signal {
            // Use windowed sampling to catch transients
            let raw = sig.sample_window(self.time, dt);
            // Apply sigmoid if enabled
            if self.config.sigmoid_k > 0.0 {
                sig.apply_sigmoid(raw, self.config.sigmoid_k)
            } else {
                raw
            }
        } else {
            0.0
        };

        self.last_rot_input = rot_input;
        // User requested to disable auto-rotation
        // let speed = self.config.base_rotation_speed + (rot_input.abs() * self.config.sensitivity);

        let speed = rot_input * self.config.sensitivity;

        // If we want absolute rotation driven by signal, that's different from integration.
        // Currently it integrates speed: self.rotation += speed * dt;
        // If signal IS the speed, then this is correct.
        // If signal IS the angle, we should do: self.rotation = rot_input * scale;

        // "Disable auto-incrementing rotation... only use the input signal"
        // This implies signal -> angle (direct mapping) OR signal -> speed (w/o base).
        // Given it's a "Visualiser" usually we map magnitude to some property.
        // If signal is RMS (magnitude), mapping it to ANGLE might be jittery but "direct".
        // Mapping it to SPEED means it spins faster when loud.

        // "Auto-incrementing" suggests there was a base speed.
        // Removing base speed means 0 signal = 0 speed (stop).
        // This seems to be what is requested.

        self.rotation += speed * dt;
        self.rotation %= std::f32::consts::TAU;

        // Zoom Logic
        if let Some(sig) = zoom_signal {
             // Use windowed sampling
             let raw = sig.sample_window(self.time, dt);
             // Apply same sigmoid? Or separate? For now same config.
             let val = if self.config.sigmoid_k > 0.0 {
                 sig.apply_sigmoid(raw, self.config.sigmoid_k)
             } else {
                 raw
             };
             // Zoom effect: oscillate or offset?
             // Use value directly as offset from base distance
             self.zoom = val * self.config.zoom_sensitivity;
        } else {
             self.zoom = 0.0;
        }
    }
}
