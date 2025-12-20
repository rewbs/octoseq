//! Visualiser state management.
//!
//! This module manages the high-level visualiser state including:
//! - Script engine and scene graph
//! - Input signal processing
//! - Frame updates

use std::collections::HashMap;
use crate::input::InputSignal;
use crate::scripting::ScriptEngine;
use crate::scene_graph::SceneGraph;

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
            sensitivity: 2.0,
            sigmoid_k: 0.0,
            zoom_sensitivity: 5.0,
        }
    }
}

pub struct VisualiserState {
    pub time: f32,
    pub config: VisualiserConfig,
    /// Script engine manages scripts and the scene graph
    script_engine: ScriptEngine,
}

impl VisualiserState {
    pub fn new() -> Self {
        Self {
            time: 0.0,
            config: VisualiserConfig::default(),
            script_engine: ScriptEngine::new(),
        }
    }

    /// Load a Rhai script. Returns true if successful.
    pub fn load_script(&mut self, script: &str) -> bool {
        self.script_engine.load_script(script)
    }

    /// Check if a script is loaded.
    pub fn has_script(&self) -> bool {
        self.script_engine.has_script()
    }

    /// Get the last script error, if any.
    pub fn get_script_error(&self) -> Option<&str> {
        self.script_engine.last_error.as_deref()
    }

    /// Get a reference to the scene graph for rendering.
    pub fn scene_graph(&self) -> &SceneGraph {
        &self.script_engine.scene_graph
    }

    pub fn reset(&mut self) {
        self.time = 0.0;
        self.script_engine = ScriptEngine::new();
    }

    pub fn set_time(&mut self, time: f32) {
        self.time = time;
    }

    /// Update the visualiser state for one frame.
    pub fn update(
        &mut self,
        dt: f32,
        rotation_signal: Option<&InputSignal>,
        zoom_signal: Option<&InputSignal>,
        named_signals: &HashMap<String, InputSignal>,
    ) {
        self.time += dt;

        // Sample input signals
        let amplitude = if let Some(sig) = rotation_signal {
            let raw = sig.sample_window(self.time, dt);
            if self.config.sigmoid_k > 0.0 {
                sig.apply_sigmoid(raw, self.config.sigmoid_k)
            } else {
                raw
            }
        } else {
            0.0
        };

        let flux = if let Some(sig) = zoom_signal {
            let raw = sig.sample_window(self.time, dt);
            if self.config.sigmoid_k > 0.0 {
                sig.apply_sigmoid(raw, self.config.sigmoid_k)
            } else {
                raw
            }
        } else {
            0.0
        };

        // Build signals map for script
        let mut sampled_signals: HashMap<String, f32> = HashMap::new();

        // Sample all named signals
        for (name, signal) in named_signals {
            let raw = signal.sample_window(self.time, dt);
            let val = if self.config.sigmoid_k > 0.0 {
                signal.apply_sigmoid(raw, self.config.sigmoid_k)
            } else {
                raw
            };
            sampled_signals.insert(name.clone(), val);
        }

        // Add core signals
        sampled_signals.insert("time".to_string(), self.time);
        sampled_signals.insert("dt".to_string(), dt);
        sampled_signals.insert("amplitude".to_string(), amplitude);
        sampled_signals.insert("flux".to_string(), flux);

        // Update script engine (this also syncs the scene graph)
        self.script_engine.update(dt, &sampled_signals);
    }
}

impl Default for VisualiserState {
    fn default() -> Self {
        Self::new()
    }
}
