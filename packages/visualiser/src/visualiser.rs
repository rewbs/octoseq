//! Visualiser state management.
//!
//! This module manages the high-level visualiser state including:
//! - Script engine and scene graph
//! - Input signal processing
//! - Frame updates

use std::collections::{HashMap, HashSet};
use crate::debug_markers::DebugMarkerLayer;
use crate::feedback::FeedbackConfig;
use crate::input::InputSignal;
use crate::mesh_asset::MeshAssetRegistry;
use crate::musical_time::MusicalTimeStructure;
use crate::script_diagnostics::ScriptDiagnostic;
use crate::scripting::{ScriptEngine, get_script_debug_options, reset_script_debug_options};
use crate::scene_graph::{EntityId, SceneGraph};
use crate::signal_explorer::{ScriptSignalInfo, SignalChainAnalysis};

/// Frame budget for limiting processing time in web preview.
///
/// Used to prevent expensive scripts from freezing the browser tab.
/// When the budget is exceeded, the frame is dropped with a warning.
#[derive(Debug, Clone, Copy)]
pub struct FrameBudget {
    /// Maximum time in milliseconds for frame processing.
    pub max_ms: f64,
    /// Start time (from performance.now() or similar).
    pub start_time: f64,
}

impl FrameBudget {
    /// Create a new frame budget with the given maximum time in milliseconds.
    pub fn new(max_ms: f64, start_time: f64) -> Self {
        Self { max_ms, start_time }
    }

    /// Check if the budget has been exceeded given the current time.
    pub fn is_exceeded(&self, current_time: f64) -> bool {
        (current_time - self.start_time) > self.max_ms
    }

    /// Get elapsed time in milliseconds.
    pub fn elapsed(&self, current_time: f64) -> f64 {
        current_time - self.start_time
    }
}

/// Result of a frame update with budget tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameResult {
    /// Frame completed successfully within budget.
    Completed,
    /// Frame was dropped due to budget exceeded.
    DroppedBudgetExceeded,
}

/// Debug visualization options.
#[derive(Debug, Clone, Default)]
pub struct DebugOptions {
    /// Enable wireframe rendering (not supported in WebGL2, falls back to normal).
    pub wireframe: bool,
    /// Show bounding boxes around entities.
    pub bounding_boxes: bool,
    /// Only render this entity (if Some).
    pub isolated_entity: Option<EntityId>,
    /// Per-entity debug bounding box toggles (via dbg.showBounds()).
    pub debug_bounds_entities: HashSet<u64>,
}

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
    /// Debug visualization options
    pub debug_options: DebugOptions,
    /// Mesh asset registry for loaded OBJ meshes
    pub asset_registry: MeshAssetRegistry,
    /// Debug marker layer for event visualization
    debug_marker_layer: DebugMarkerLayer,
    /// Current BPM for beat-based calculations
    current_bpm: f32,
    /// Global seed for deterministic particle systems.
    /// This is used as a base seed when particle systems don't specify their own seed.
    global_seed: u64,
    /// Stem-scoped input signals (stem_id -> feature -> InputSignal)
    stem_signals: HashMap<String, HashMap<String, InputSignal>>,
}

impl VisualiserState {
    pub fn new() -> Self {
        Self {
            time: 0.0,
            config: VisualiserConfig::default(),
            script_engine: ScriptEngine::new(),
            debug_options: DebugOptions::default(),
            asset_registry: MeshAssetRegistry::new(),
            debug_marker_layer: DebugMarkerLayer::new(),
            current_bpm: 120.0,
            global_seed: 0,
            stem_signals: HashMap::new(),
        }
    }

    /// Set the global random seed for particle systems.
    /// This should be called before loading scripts for deterministic rendering.
    /// The seed is passed to the script engine and used as a base for particle system seeds.
    pub fn set_global_seed(&mut self, seed: u64) {
        self.global_seed = seed;
        self.script_engine.set_global_seed(seed);
    }

    /// Get the current global seed.
    pub fn global_seed(&self) -> u64 {
        self.global_seed
    }

    /// Register a mesh asset from OBJ content.
    /// Returns Ok(()) if successful, Err(message) if parsing failed.
    pub fn register_mesh_asset(&mut self, asset_id: &str, obj_content: &str) -> Result<(), String> {
        self.asset_registry.register_from_obj(asset_id, obj_content)
    }

    /// Unregister a mesh asset.
    pub fn unregister_mesh_asset(&mut self, asset_id: &str) -> bool {
        self.asset_registry.unregister(asset_id)
    }

    /// Get all registered mesh asset IDs.
    pub fn mesh_asset_ids(&self) -> Vec<&str> {
        self.asset_registry.asset_ids()
    }

    /// Load a Rhai script. Returns true if successful.
    pub fn load_script(&mut self, script: &str) -> bool {
        reset_script_debug_options();
        self.debug_options = DebugOptions::default();
        self.script_engine.load_script(script)
    }

    /// Configure which input signal names should be available in the global `inputs` Signal namespace.
    /// This must be called before `load_script()` for the `inputs.<name>` accessors to exist.
    pub fn set_available_signals(&mut self, names: Vec<String>) {
        self.script_engine.set_available_signals(names);
    }

    /// Configure which frequency bands should be available in the global `inputs.bands` namespace.
    /// This must be called before `load_script()` for the `inputs.bands["..."]` accessors to exist.
    pub fn set_available_bands(&mut self, bands: Vec<(String, String)>) {
        self.script_engine.set_available_bands(bands);
    }

    /// Configure which stems should be available in the global `inputs.stems` namespace.
    /// This must be called before `load_script()` for the `inputs.stems["..."]` accessors to exist.
    pub fn set_available_stems(&mut self, stems: Vec<(String, String)>) {
        self.script_engine.set_available_stems(stems);
    }

    /// Configure which custom signals should be available in the global `inputs.customSignals` namespace.
    /// This must be called before `load_script()` for the `inputs.customSignals["..."]` accessors to exist.
    pub fn set_available_custom_signals(&mut self, signals: Vec<(String, String)>) {
        self.script_engine.set_available_custom_signals(signals);
    }

    /// Push a stem-scoped signal.
    /// Stores under both stem_id and label for dual-access support.
    pub fn push_stem_signal(
        &mut self,
        stem_id: &str,
        stem_label: &str,
        feature: &str,
        signal: InputSignal,
    ) {
        // Store under stem ID
        self.stem_signals
            .entry(stem_id.to_string())
            .or_default()
            .insert(feature.to_string(), signal.clone());

        // Also store under label if different from ID
        if stem_label != stem_id {
            self.stem_signals
                .entry(stem_label.to_string())
                .or_default()
                .insert(feature.to_string(), signal);
        }
    }

    /// Clear all stem signals.
    pub fn clear_stem_signals(&mut self) {
        self.stem_signals.clear();
    }

    /// Check if a script is loaded.
    pub fn has_script(&self) -> bool {
        self.script_engine.has_script()
    }

    /// Get the last script error, if any.
    pub fn get_script_error(&self) -> Option<&str> {
        self.script_engine.last_error.as_deref()
    }

    /// Drain and return any structured script diagnostics since the last call.
    pub fn take_script_diagnostics(&mut self) -> Vec<ScriptDiagnostic> {
        self.script_engine.take_diagnostics()
    }

    /// Get a reference to the scene graph for rendering.
    pub fn scene_graph(&self) -> &SceneGraph {
        &self.script_engine.scene_graph
    }

    /// Get a reference to the debug marker layer for rendering.
    pub fn debug_marker_layer(&self) -> &DebugMarkerLayer {
        &self.debug_marker_layer
    }

    /// Get the current frame feedback configuration.
    pub fn feedback_config(&self) -> &FeedbackConfig {
        &self.script_engine.feedback_config
    }

    /// Get the evaluated feedback uniforms (signals resolved to f32 for GPU upload).
    pub fn feedback_uniforms(&self) -> &crate::feedback::FeedbackUniforms {
        &self.script_engine.feedback_uniforms
    }

    /// Get the current camera configuration.
    pub fn camera_config(&self) -> &crate::camera::CameraConfig {
        &self.script_engine.camera_config
    }

    /// Get the evaluated camera uniforms (signals resolved to f32 for renderer).
    pub fn camera_uniforms(&self) -> &crate::camera::CameraUniforms {
        &self.script_engine.camera_uniforms
    }

    /// Get the current post-processing chain.
    pub fn post_chain(&self) -> &crate::post_processing::PostProcessingChain {
        &self.script_engine.post_chain
    }

    /// Get a reference to the particle systems for rendering.
    pub fn particle_systems(&self) -> &std::collections::HashMap<u64, crate::particle::ParticleSystem> {
        &self.script_engine.particle_systems
    }

    /// Set the current BPM for beat-based calculations.
    pub fn set_bpm(&mut self, bpm: f32) {
        self.current_bpm = bpm;
    }

    /// Get the current BPM.
    pub fn bpm(&self) -> f32 {
        self.current_bpm
    }

    pub fn reset(&mut self) {
        self.time = 0.0;
        self.script_engine = ScriptEngine::new();
        self.debug_options = DebugOptions::default();
        self.asset_registry.clear();
        self.debug_marker_layer.clear();
        reset_script_debug_options();
        // Preserve global_seed across reset - if user set it, they want it to persist
        self.script_engine.set_global_seed(self.global_seed);
    }

    pub fn set_time(&mut self, time: f32) {
        self.time = time;
    }

    /// Set debug visualization options.
    pub fn set_debug_options(&mut self, wireframe: bool, bounding_boxes: bool) {
        self.debug_options.wireframe = wireframe;
        self.debug_options.bounding_boxes = bounding_boxes;
    }

    /// Isolate a single entity for rendering (useful for debugging).
    pub fn isolate_entity(&mut self, entity_id: u64) {
        self.debug_options.isolated_entity = Some(EntityId(entity_id));
    }

    /// Clear entity isolation, resume normal rendering.
    pub fn clear_isolation(&mut self) {
        self.debug_options.isolated_entity = None;
    }

    /// Update the visualiser state for one frame.
    pub fn update(
        &mut self,
        dt: f32,
        rotation_signal: Option<&InputSignal>,
        zoom_signal: Option<&InputSignal>,
        named_signals: &HashMap<String, InputSignal>,
        band_signals: &HashMap<String, HashMap<String, InputSignal>>,
        custom_signals: &HashMap<String, InputSignal>,
        musical_time: Option<&MusicalTimeStructure>,
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

        // Add core signals (don't overwrite if already present from named_signals)
        sampled_signals.insert("time".to_string(), self.time);
        sampled_signals.insert("dt".to_string(), dt);
        // Only use legacy rotation_signal for amplitude if not already in named_signals
        if !sampled_signals.contains_key("amplitude") {
            sampled_signals.insert("amplitude".to_string(), amplitude);
        }
        // Only use legacy zoom_signal for flux if not already in named_signals
        if !sampled_signals.contains_key("flux") {
            sampled_signals.insert("flux".to_string(), flux);
        }

        // Update script engine (this also syncs the scene graph)
        self.script_engine.update(
            self.time,
            dt,
            &sampled_signals,
            named_signals,
            band_signals,
            &self.stem_signals,
            custom_signals,
            musical_time,
        );

        // Apply script debug options (these are set via dbg.wireframe(), dbg.isolate(), etc.)
        let script_debug = get_script_debug_options();
        self.debug_options.wireframe = script_debug.wireframe;
        self.debug_options.bounding_boxes = script_debug.bounding_boxes;
        self.debug_options.isolated_entity = script_debug.isolated_entity.map(EntityId);
        self.debug_options.debug_bounds_entities = script_debug.debug_bounds_entities;

        // Update debug marker layer (processes pending marker requests from scripts)
        let current_beat = self.time * self.current_bpm / 60.0;
        self.debug_marker_layer.update(current_beat, self.current_bpm);
    }

    /// Update the visualiser state with a frame budget.
    ///
    /// If the budget is exceeded after script engine update, returns `DroppedBudgetExceeded`.
    /// The `get_time` closure should return the current time in milliseconds (e.g., from performance.now()).
    pub fn update_with_budget<F>(
        &mut self,
        dt: f32,
        rotation_signal: Option<&InputSignal>,
        zoom_signal: Option<&InputSignal>,
        named_signals: &HashMap<String, InputSignal>,
        band_signals: &HashMap<String, HashMap<String, InputSignal>>,
        custom_signals: &HashMap<String, InputSignal>,
        musical_time: Option<&MusicalTimeStructure>,
        budget: &FrameBudget,
        get_time: F,
    ) -> FrameResult
    where
        F: Fn() -> f64,
    {
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
        if !sampled_signals.contains_key("amplitude") {
            sampled_signals.insert("amplitude".to_string(), amplitude);
        }
        if !sampled_signals.contains_key("flux") {
            sampled_signals.insert("flux".to_string(), flux);
        }

        // Update script engine (this is the expensive part)
        self.script_engine.update(
            self.time,
            dt,
            &sampled_signals,
            named_signals,
            band_signals,
            &self.stem_signals,
            custom_signals,
            musical_time,
        );

        // Check budget after script engine update
        let current_time = get_time();
        if budget.is_exceeded(current_time) {
            let elapsed = budget.elapsed(current_time);
            log::warn!(
                "Frame budget exceeded: {:.1}ms > {:.1}ms limit. Consider simplifying your script.",
                elapsed,
                budget.max_ms
            );
            return FrameResult::DroppedBudgetExceeded;
        }

        // Apply script debug options
        let script_debug = get_script_debug_options();
        self.debug_options.wireframe = script_debug.wireframe;
        self.debug_options.bounding_boxes = script_debug.bounding_boxes;
        self.debug_options.isolated_entity = script_debug.isolated_entity.map(EntityId);
        self.debug_options.debug_bounds_entities = script_debug.debug_bounds_entities;

        // Update debug marker layer
        let current_beat = self.time * self.current_bpm / 60.0;
        self.debug_marker_layer.update(current_beat, self.current_bpm);

        FrameResult::Completed
    }

    // === Signal Explorer API ===

    /// Get all Signal variables from the current script scope.
    pub fn get_signal_variables(&self) -> Vec<ScriptSignalInfo> {
        self.script_engine.get_signal_variables()
    }

    /// Check if a Signal variable exists in the current script scope.
    pub fn has_signal(&mut self, name: &str) -> bool {
        self.script_engine.has_signal(name)
    }

    /// Analyze a signal chain with localized sampling.
    pub fn analyze_signal_chain(
        &mut self,
        signal_name: &str,
        center_time: f32,
        window_beats: f32,
        sample_count: usize,
        input_signals: &HashMap<String, InputSignal>,
        band_signals: &HashMap<String, HashMap<String, InputSignal>>,
        musical_time: Option<&MusicalTimeStructure>,
    ) -> Result<SignalChainAnalysis, String> {
        self.script_engine.analyze_signal_chain(
            signal_name,
            center_time,
            window_beats,
            sample_count,
            input_signals,
            band_signals,
            &self.stem_signals,
            musical_time,
        )
    }
}

impl Default for VisualiserState {
    fn default() -> Self {
        Self::new()
    }
}
