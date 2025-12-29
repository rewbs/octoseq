use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::analysis_runner::{run_analysis_with_bands, run_analysis_with_events_and_bands, AnalysisConfig};
use crate::event_stream::Event;
use crate::frequency_band::{FrequencyBandStructure, FrequencyBoundsAtTime};
use crate::gpu::renderer::Renderer;
use crate::input::InputSignal;
use crate::musical_time::MusicalTimeStructure;
use crate::script_api::script_api_metadata_json;
use crate::visualiser::{FrameBudget, FrameResult, VisualiserState};

/// Debug struct for entity positions, serialized to JSON for debugging.
#[derive(Serialize)]
struct EntityPositionDebug {
    id: u64,
    entity_type: String,
    position: [f32; 3],
}

#[wasm_bindgen]
pub struct WasmVisualiser {
    inner: Rc<RefCell<VisualiserContext>>,
}

struct VisualiserContext {
    renderer: Renderer,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    state: VisualiserState,
    rotation_signal: Option<InputSignal>,
    zoom_signal: Option<InputSignal>,
    /// Named signals for dynamic script inputs (e.g., "spectralCentroid", "onsetEnvelope")
    named_signals: HashMap<String, InputSignal>,
    /// Band-scoped signals: band_key -> feature -> InputSignal
    /// band_key can be either band ID or label for lookup flexibility
    band_signals: HashMap<String, HashMap<String, InputSignal>>,
    /// Band ID -> label (for script namespace generation + editor UX).
    band_id_to_label: HashMap<String, String>,
    /// Musical time structure for beat-aware signal processing
    musical_time: Option<MusicalTimeStructure>,
    /// Frequency band structure for band-aware processing
    frequency_bands: Option<FrequencyBandStructure>,
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Get the host-defined Script API metadata as a JSON string.
///
/// This is a stable, versioned description of the scripting API surface and is
/// intended to drive editor UX (autocomplete/hover/docs) and future language
/// bindings.
#[wasm_bindgen]
pub fn get_script_api_metadata_json() -> String {
    script_api_metadata_json()
}

#[wasm_bindgen]
impl WasmVisualiser {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        panic!("Use create_visualiser async constructor");
    }

    pub fn push_rotation_data(&self, samples: &[f32], sample_rate: f32) {
        log::info!("Rust received rotation data: {} samples, rate {}", samples.len(), sample_rate);
        let mut inner = self.inner.borrow_mut();
        inner.rotation_signal = Some(InputSignal::new(samples.to_vec(), sample_rate));
    }

    pub fn push_zoom_data(&self, samples: &[f32], sample_rate: f32) {
        log::info!("Rust received zoom data: {} samples, rate {}", samples.len(), sample_rate);
        let mut inner = self.inner.borrow_mut();
        inner.zoom_signal = Some(InputSignal::new(samples.to_vec(), sample_rate));
    }

    // Legacy support (optional, can remove if we update TS)
    pub fn push_data(&self, samples: &[f32], sample_rate: f32) {
         self.push_rotation_data(samples, sample_rate);
    }

    /// Push a named signal for use in scripts.
    /// The signal will be available as `inputs.<name>` in Rhai scripts.
    pub fn push_signal(&self, name: &str, samples: &[f32], sample_rate: f32) {
        log::info!("Rust received signal '{}': {} samples, rate {}", name, samples.len(), sample_rate);
        let mut inner = self.inner.borrow_mut();
        inner.named_signals.insert(name.to_string(), InputSignal::new(samples.to_vec(), sample_rate));
    }

    /// Clear all named signals.
    pub fn clear_signals(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.named_signals.clear();
    }

    /// Set the musical time structure for beat-aware signal processing.
    /// The JSON format matches the TypeScript MusicalTimeStructure type.
    /// Returns true if successful, false if parsing failed.
    pub fn set_musical_time(&self, json: &str) -> bool {
        match serde_json::from_str::<MusicalTimeStructure>(json) {
            Ok(structure) => {
                log::info!(
                    "Musical time set: {} segments",
                    structure.segments.len()
                );
                let mut inner = self.inner.borrow_mut();
                inner.musical_time = Some(structure);
                true
            }
            Err(e) => {
                log::error!("Failed to parse musical time structure: {}", e);
                false
            }
        }
    }

    /// Clear the musical time structure.
    /// Beat-aware operations will fall back to 120 BPM default.
    pub fn clear_musical_time(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.musical_time = None;
    }

    /// Set the frequency band structure for band-aware processing.
    /// The JSON format matches the TypeScript FrequencyBandStructure type.
    /// Returns true if successful, false if parsing failed.
    pub fn set_frequency_bands(&self, json: &str) -> bool {
        match serde_json::from_str::<FrequencyBandStructure>(json) {
            Ok(structure) => {
                log::info!(
                    "Frequency bands set: {} bands",
                    structure.bands.len()
                );
                let mut inner = self.inner.borrow_mut();
                inner.frequency_bands = Some(structure);
                true
            }
            Err(e) => {
                log::error!("Failed to parse frequency band structure: {}", e);
                false
            }
        }
    }

    /// Clear the frequency band structure.
    pub fn clear_frequency_bands(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.frequency_bands = None;
    }

    /// Get frequency bounds for all active bands at a given time.
    /// Returns a JSON array of { bandId, label, lowHz, highHz, enabled } objects.
    pub fn get_band_bounds_at(&self, time: f32) -> String {
        let inner = self.inner.borrow();

        if let Some(ref structure) = inner.frequency_bands {
            let bounds: Vec<FrequencyBoundsAtTime> = structure.all_bounds_at(time);
            serde_json::to_string(&bounds).unwrap_or_else(|_| "[]".to_string())
        } else {
            "[]".to_string()
        }
    }

    /// Check if frequency bands are currently set.
    pub fn has_frequency_bands(&self) -> bool {
        let inner = self.inner.borrow();
        inner.frequency_bands.is_some()
    }

    /// Get the number of frequency bands.
    pub fn get_frequency_band_count(&self) -> usize {
        let inner = self.inner.borrow();
        inner.frequency_bands
            .as_ref()
            .map(|s| s.bands.len())
            .unwrap_or(0)
    }

    /// Get the list of available signal names.
    /// Returns a JSON array of signal names.
    pub fn get_signal_names(&self) -> String {
        let inner = self.inner.borrow();
        let names: Vec<&str> = inner.named_signals.keys().map(|s| s.as_str()).collect();
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }

    /// Push a band-scoped signal for use in scripts.
    /// The signal will be available as `inputs.bands[band_id].{feature}` in Rhai scripts.
    /// Stores under both band_id and band_label for dual-access support.
    ///
    /// - `band_id`: The unique ID of the frequency band.
    /// - `band_label`: The user-visible label of the band.
    /// - `feature`: Signal type ("energy", "onset", "flux").
    /// - `samples`: Signal data.
    /// - `sample_rate`: Sample rate of the signal.
    pub fn push_band_signal(
        &self,
        band_id: &str,
        band_label: &str,
        feature: &str,
        samples: &[f32],
        sample_rate: f32,
    ) {
        log::info!(
            "Rust received band signal '{}' / '{}' / '{}': {} samples, rate {}",
            band_id,
            band_label,
            feature,
            samples.len(),
            sample_rate
        );
        let mut inner = self.inner.borrow_mut();
        let signal = InputSignal::new(samples.to_vec(), sample_rate);

        // Store under band ID
        inner
            .band_signals
            .entry(band_id.to_string())
            .or_default()
            .insert(feature.to_string(), signal.clone());
        inner
            .band_id_to_label
            .insert(band_id.to_string(), band_label.to_string());

        // Also store under label if different from ID
        if band_label != band_id {
            inner
                .band_signals
                .entry(band_label.to_string())
                .or_default()
                .insert(feature.to_string(), signal);
        }
    }

    /// Clear all band signals.
    pub fn clear_band_signals(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.band_signals.clear();
        inner.band_id_to_label.clear();
    }

    /// Get list of band keys (IDs and labels) that have signals.
    /// Returns a JSON array of strings.
    pub fn get_band_signal_keys(&self) -> String {
        let inner = self.inner.borrow();
        let keys: Vec<&str> = inner.band_signals.keys().map(|s| s.as_str()).collect();
        serde_json::to_string(&keys).unwrap_or_else(|_| "[]".to_string())
    }

    // === Band Event Methods ===
    // These methods handle pre-extracted events for frequency bands.
    // Events are extracted in TypeScript and pushed here for script access.

    /// Push pre-extracted events for a band.
    ///
    /// Events are extracted by the TypeScript layer using the existing peak picker,
    /// then pushed here for script access via `inputs.bands[id].events`.
    ///
    /// The JSON format should be an array of event objects with:
    /// - time: f32
    /// - weight: f32
    /// - beat_position: Option<f32>
    /// - beat_phase: Option<f32>
    /// - cluster_id: Option<u32>
    ///
    /// Returns true if successful, false if parsing failed.
    pub fn push_band_events(&self, band_id: &str, events_json: &str) -> bool {
        use crate::event_rhai::store_band_event_stream;
        use crate::event_stream::{EventStream, PickEventsOptions};

        #[derive(serde::Deserialize)]
        struct EventInput {
            time: f32,
            weight: f32,
            beat_position: Option<f32>,
            beat_phase: Option<f32>,
            cluster_id: Option<u32>,
        }

        match serde_json::from_str::<Vec<EventInput>>(events_json) {
            Ok(inputs) => {
                let events: Vec<Event> = inputs
                    .into_iter()
                    .map(|e| Event {
                        time: e.time,
                        weight: e.weight,
                        beat_position: e.beat_position,
                        beat_phase: e.beat_phase,
                        cluster_id: e.cluster_id,
                        source: Some(format!("band:{}", band_id)),
                    })
                    .collect();

                let event_count = events.len();
                let stream = EventStream::new(
                    events,
                    format!("band_events:{}", band_id),
                    PickEventsOptions::default(),
                );

                store_band_event_stream(band_id.to_string(), stream);
                log::info!(
                    "Pushed {} events for band '{}'",
                    event_count,
                    band_id
                );
                true
            }
            Err(e) => {
                log::error!("Failed to parse band events for '{}': {}", band_id, e);
                false
            }
        }
    }

    /// Clear all band event streams.
    pub fn clear_band_events(&self) {
        use crate::event_rhai::clear_band_event_streams;
        clear_band_event_streams();
        log::info!("Cleared all band event streams");
    }

    /// Get the number of events for a specific band.
    /// Returns 0 if no events are stored for this band.
    pub fn get_band_event_count(&self, band_id: &str) -> usize {
        use crate::event_rhai::get_band_event_stream;
        get_band_event_stream(band_id)
            .map(|s| s.len())
            .unwrap_or(0)
    }

    pub fn set_sigmoid_k(&self, k: f32) {
        let mut inner = self.inner.borrow_mut();
        inner.state.config.sigmoid_k = k;
    }

    /// Load a Rhai script for controlling the visualiser.
    /// Returns true if the script was loaded successfully.
    pub fn load_script(&self, script: &str) -> bool {
        let mut inner = self.inner.borrow_mut();

        // Configure the script environment before compiling:
        // - The global `inputs` signal namespace needs to know which names exist.
        // - The global `inputs.bands[...]` namespace needs the (id,label) list.
        let mut signal_names: Vec<String> = inner.named_signals.keys().cloned().collect();
        signal_names.extend(["time", "dt", "amplitude", "flux"].into_iter().map(|s| s.to_string()));
        signal_names.sort();
        signal_names.dedup();
        inner.state.set_available_signals(signal_names);

        let mut bands: Vec<(String, String)> = inner
            .band_id_to_label
            .iter()
            .map(|(id, label)| (id.clone(), label.clone()))
            .collect();
        bands.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        inner.state.set_available_bands(bands);

        let result = inner.state.load_script(script);
        if !result {
            log::error!("Failed to load script: {:?}", inner.state.get_script_error());
        }
        result
    }

    /// Check if a script is currently loaded.
    pub fn has_script(&self) -> bool {
        let inner = self.inner.borrow();
        inner.state.has_script()
    }

    /// Get the last script error message, if any.
    pub fn get_script_error(&self) -> Option<String> {
        let inner = self.inner.borrow();
        inner.state.get_script_error().map(|s| s.to_string())
    }

    /// Drain and return any pending structured script diagnostics as JSON.
    ///
    /// Intended for UI consumption. Calling this clears the pending diagnostics
    /// queue so repeated polling does not duplicate messages.
    pub fn take_script_diagnostics_json(&self) -> String {
        let mut inner = self.inner.borrow_mut();
        let diags = inner.state.take_script_diagnostics();
        serde_json::to_string(&diags).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn resize(&self, width: u32, height: u32) {
        if width == 0 || height == 0 { return; }

        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        ctx.renderer.resize(width, height, &ctx.state);
        ctx.config.width = width;
        ctx.config.height = height;

        ctx.surface.configure(ctx.renderer.device(), &ctx.config);
    }

    pub fn set_time(&self, time: f32) {
        let mut inner = self.inner.borrow_mut();
        inner.state.set_time(time);
    }

    /// Set debug visualization options.
    pub fn set_debug_options(&self, wireframe: bool, bounding_boxes: bool) {
        let mut inner = self.inner.borrow_mut();
        inner.state.set_debug_options(wireframe, bounding_boxes);
    }

    /// Isolate a single entity for rendering (useful for debugging).
    /// Only this entity will be rendered.
    pub fn isolate_entity(&self, entity_id: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.state.isolate_entity(entity_id);
    }

    /// Clear entity isolation, resume normal rendering.
    pub fn clear_isolation(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.state.clear_isolation();
    }

    // === Mesh Asset Methods ===

    /// Register a mesh asset from OBJ content.
    /// The asset will be available as `mesh.load(asset_id)` in scripts.
    /// Returns true if successful, false if parsing failed.
    pub fn register_mesh_asset(&self, asset_id: &str, obj_content: &str) -> bool {
        let mut inner = self.inner.borrow_mut();
        match inner.state.register_mesh_asset(asset_id, obj_content) {
            Ok(()) => {
                log::info!("Registered mesh asset '{}'", asset_id);
                true
            }
            Err(e) => {
                log::error!("Failed to register mesh asset '{}': {}", asset_id, e);
                false
            }
        }
    }

    /// Unregister a mesh asset.
    /// Returns true if the asset was unregistered, false if it didn't exist.
    pub fn unregister_mesh_asset(&self, asset_id: &str) -> bool {
        let mut inner = self.inner.borrow_mut();
        let result = inner.state.unregister_mesh_asset(asset_id);
        if result {
            log::info!("Unregistered mesh asset '{}'", asset_id);
        }
        result
    }

    /// Get a list of all registered mesh asset IDs.
    /// Returns a JSON array of asset IDs.
    pub fn list_mesh_assets(&self) -> String {
        let inner = self.inner.borrow();
        let ids: Vec<&str> = inner.state.mesh_asset_ids();
        serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get current state values for debugging.
    /// Returns [time, scene_entity_count, mesh_count, line_count]
    pub fn get_current_vals(&self) -> Vec<f32> {
        let inner = self.inner.borrow();
        let scene_graph = inner.state.scene_graph();
        vec![
            inner.state.time,
            scene_graph.scene_entities().count() as f32,
            scene_graph.meshes().count() as f32,
            scene_graph.lines().count() as f32,
        ]
    }

    /// Get entity positions as JSON for debugging.
    /// Returns a JSON array of objects with id, type, and position fields.
    pub fn get_entity_positions_json(&self) -> String {
        let inner = self.inner.borrow();
        let scene_graph = inner.state.scene_graph();

        let positions: Vec<EntityPositionDebug> = scene_graph.scene_entities()
            .map(|(id, entity)| {
                let transform = entity.transform();
                EntityPositionDebug {
                    id: id.0,
                    entity_type: format!("{:?}", entity),
                    position: [transform.position.x, transform.position.y, transform.position.z],
                }
            })
            .collect();

        serde_json::to_string(&positions).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn render(&self, dt: f32) {
        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        // Update state with named signals
        ctx.state.update(
            dt,
            ctx.rotation_signal.as_ref(),
            ctx.zoom_signal.as_ref(),
            &ctx.named_signals,
            &ctx.band_signals,
            ctx.musical_time.as_ref(),
        );

        // Render
        match ctx.surface.get_current_texture() {
            Ok(output) => {
                let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
                ctx.renderer.render(&view, &ctx.state);
                output.present();
            },
            Err(wgpu::SurfaceError::Lost) => {
                ctx.renderer.resize(ctx.config.width, ctx.config.height, &ctx.state);
                ctx.surface.configure(ctx.renderer.device(), &ctx.config);
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                log::error!("Surface out of memory");
            }
            Err(e) => {
                log::warn!("Surface error: {:?}", e);
            }
        }
    }

    /// Render with a frame budget timeout.
    ///
    /// If the frame takes longer than `budget_ms` to process, it will be dropped
    /// and a warning logged. This prevents expensive scripts from freezing the browser.
    ///
    /// Returns true if the frame completed, false if it was dropped due to budget.
    pub fn render_with_budget(&self, dt: f32, budget_ms: f64) -> bool {
        // Get performance.now() for timing
        let get_time = || -> f64 {
            web_sys::window()
                .and_then(|w| w.performance())
                .map(|p| p.now())
                .unwrap_or(0.0)
        };

        let start_time = get_time();
        let budget = FrameBudget::new(budget_ms, start_time);

        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        // Update state with budget tracking
        let result = ctx.state.update_with_budget(
            dt,
            ctx.rotation_signal.as_ref(),
            ctx.zoom_signal.as_ref(),
            &ctx.named_signals,
            &ctx.band_signals,
            ctx.musical_time.as_ref(),
            &budget,
            get_time,
        );

        // If budget was exceeded, skip rendering this frame
        if result == FrameResult::DroppedBudgetExceeded {
            return false;
        }

        // Render
        match ctx.surface.get_current_texture() {
            Ok(output) => {
                let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
                ctx.renderer.render(&view, &ctx.state);
                output.present();
            },
            Err(wgpu::SurfaceError::Lost) => {
                ctx.renderer.resize(ctx.config.width, ctx.config.height, &ctx.state);
                ctx.surface.configure(ctx.renderer.device(), &ctx.config);
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                log::error!("Surface out of memory");
            }
            Err(e) => {
                log::warn!("Surface error: {:?}", e);
            }
        }

        true
    }

    /// Run script in analysis mode to collect debug.emit() signals.
    ///
    /// This runs the script headlessly across the full track duration,
    /// collecting all debug.emit() calls without rendering.
    ///
    /// Returns a JSON-serialized AnalysisResultJson.
    pub fn run_analysis(&self, script: &str, duration: f32, time_step: f32) -> String {
        let inner = self.inner.borrow();

        let config = AnalysisConfig::new(duration, time_step);

        // Get band information for namespace generation
        let bands: Vec<(String, String)> = inner
            .band_id_to_label
            .iter()
            .map(|(id, label)| (id.clone(), label.clone()))
            .collect();

        // Run analysis with the current named_signals, bands, and band_signals
        match run_analysis_with_bands(script, &inner.named_signals, &bands, &inner.band_signals, config) {
            Ok(result) => {
                let wasm_signals: Vec<WasmDebugSignal> = result
                    .debug_signals
                    .into_iter()
                    .map(|(name, sig)| {
                        let (times, values) = sig.to_arrays();
                        WasmDebugSignal { name, times, values }
                    })
                    .collect();

                let wasm_result = WasmAnalysisResult {
                    success: true,
                    error: None,
                    signals: wasm_signals,
                    step_count: result.step_count,
                    duration: result.duration,
                };

                serde_json::to_string(&wasm_result).unwrap_or_else(|e| {
                    format!(
                        r#"{{"success":false,"error":"Serialization error: {}","signals":[],"step_count":0,"duration":0}}"#,
                        e
                    )
                })
            }
            Err(e) => {
                let wasm_result = WasmAnalysisResult {
                    success: false,
                    error: Some(e),
                    signals: vec![],
                    step_count: 0,
                    duration: 0.0,
                };
                serde_json::to_string(&wasm_result).unwrap_or_else(|_| {
                    r#"{"success":false,"error":"Unknown error","signals":[],"step_count":0,"duration":0}"#.to_string()
                })
            }
        }
    }

    /// Run script in analysis mode with event extraction support.
    ///
    /// This runs the script headlessly across the full track duration,
    /// collecting all debug.emit() calls AND extracting events from
    /// any signal.pick.events() calls.
    ///
    /// Returns a JSON-serialized ExtendedAnalysisResultJson.
    pub fn run_analysis_with_events(&self, script: &str, duration: f32, time_step: f32) -> String {
        let inner = self.inner.borrow();

        let config = AnalysisConfig::new(duration, time_step);

        // Get band information for namespace generation
        let bands: Vec<(String, String)> = inner
            .band_id_to_label
            .iter()
            .map(|(id, label)| (id.clone(), label.clone()))
            .collect();

        match run_analysis_with_events_and_bands(
            script,
            &inner.named_signals,
            &bands,
            &inner.band_signals,
            inner.musical_time.as_ref(),
            config,
            false, // Don't collect event debug data (reduces payload size)
        ) {
            Ok(result) => {
                let wasm_signals: Vec<WasmDebugSignal> = result
                    .debug_signals
                    .into_iter()
                    .map(|(name, sig)| {
                        let (times, values) = sig.to_arrays();
                        WasmDebugSignal { name, times, values }
                    })
                    .collect();

                let wasm_event_streams: Vec<WasmEventStream> = result
                    .event_streams
                    .into_iter()
                    .map(|(name, stream)| WasmEventStream {
                        name,
                        events: stream.iter().map(WasmEvent::from).collect(),
                    })
                    .collect();

                let wasm_result = WasmExtendedAnalysisResult {
                    success: true,
                    error: None,
                    signals: wasm_signals,
                    event_streams: wasm_event_streams,
                    step_count: result.step_count,
                    duration: result.duration,
                };

                serde_json::to_string(&wasm_result).unwrap_or_else(|e| {
                    format!(
                        r#"{{"success":false,"error":"Serialization error: {}","signals":[],"event_streams":[],"step_count":0,"duration":0}}"#,
                        e
                    )
                })
            }
            Err(e) => {
                let wasm_result = WasmExtendedAnalysisResult {
                    success: false,
                    error: Some(e),
                    signals: vec![],
                    event_streams: vec![],
                    step_count: 0,
                    duration: 0.0,
                };
                serde_json::to_string(&wasm_result).unwrap_or_else(|_| {
                    r#"{"success":false,"error":"Unknown error","signals":[],"event_streams":[],"step_count":0,"duration":0}"#.to_string()
                })
            }
        }
    }
}

/// A debug signal serialized for JavaScript.
#[derive(Serialize)]
struct WasmDebugSignal {
    name: String,
    times: Vec<f32>,
    values: Vec<f32>,
}

/// Analysis result serialized for JavaScript.
#[derive(Serialize)]
struct WasmAnalysisResult {
    success: bool,
    error: Option<String>,
    signals: Vec<WasmDebugSignal>,
    step_count: usize,
    duration: f32,
}

/// An event serialized for JavaScript.
#[derive(Serialize)]
struct WasmEvent {
    time: f32,
    weight: f32,
    beat_position: Option<f32>,
    beat_phase: Option<f32>,
    cluster_id: Option<u32>,
}

impl From<&Event> for WasmEvent {
    fn from(e: &Event) -> Self {
        Self {
            time: e.time,
            weight: e.weight,
            beat_position: e.beat_position,
            beat_phase: e.beat_phase,
            cluster_id: e.cluster_id,
        }
    }
}

/// An event stream serialized for JavaScript.
#[derive(Serialize)]
struct WasmEventStream {
    name: String,
    events: Vec<WasmEvent>,
}

/// Extended analysis result including event streams.
#[derive(Serialize)]
struct WasmExtendedAnalysisResult {
    success: bool,
    error: Option<String>,
    signals: Vec<WasmDebugSignal>,
    event_streams: Vec<WasmEventStream>,
    step_count: usize,
    duration: f32,
}

#[wasm_bindgen]
pub async fn create_visualiser(canvas: HtmlCanvasElement) -> Result<WasmVisualiser, JsValue> {
    init_panic_hook();

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        dx12_shader_compiler: Default::default(),
        flags: wgpu::InstanceFlags::default(),
        gles_minor_version: wgpu::Gles3MinorVersion::Automatic,
    });

    let target = wgpu::SurfaceTarget::Canvas(canvas.clone());
    let surface = instance.create_surface(target)
        .map_err(|e| JsValue::from_str(&format!("Failed to create surface: {}", e)))?;

    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::None,
        compatible_surface: Some(&surface),
        force_fallback_adapter: false,
    }).await.ok_or_else(|| JsValue::from_str("Failed to find an appropriate adapter"))?;

    let (device, queue) = adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: None,
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
            memory_hints: Default::default(),
        },
        None,
    ).await.map_err(|e| JsValue::from_str(&format!("Failed to create device: {}", e)))?;

    let surface_caps = surface.get_capabilities(&adapter);
    let surface_format = surface_caps.formats.iter()
        .copied()
        .find(|f: &wgpu::TextureFormat| f.is_srgb())
        .unwrap_or(surface_caps.formats[0]);

    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: surface_format,
        width: canvas.width(),
        height: canvas.height(),
        present_mode: surface_caps.present_modes[0],
        alpha_mode: surface_caps.alpha_modes[0],
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    surface.configure(&device, &config);

    let renderer = Renderer::new(
        device,
        queue,
        config.format,
        config.width,
        config.height
    );

    let state = VisualiserState::new();

    Ok(WasmVisualiser {
        inner: Rc::new(RefCell::new(VisualiserContext {
            renderer,
            surface,
            config,
            state,
            rotation_signal: None,
            zoom_signal: None,
            named_signals: HashMap::new(),
            band_signals: HashMap::new(),
            band_id_to_label: HashMap::new(),
            musical_time: None,
            frequency_bands: None,
        })),
    })
}
