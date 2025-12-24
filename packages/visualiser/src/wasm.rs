use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::analysis_runner::{run_analysis, run_analysis_with_events, AnalysisConfig};
use crate::event_stream::Event;
use crate::gpu::renderer::Renderer;
use crate::input::InputSignal;
use crate::musical_time::MusicalTimeStructure;
use crate::visualiser::VisualiserState;

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
    /// Musical time structure for beat-aware signal processing
    musical_time: Option<MusicalTimeStructure>,
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
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

    /// Get the list of available signal names.
    /// Returns a JSON array of signal names.
    pub fn get_signal_names(&self) -> String {
        let inner = self.inner.borrow();
        let names: Vec<&str> = inner.named_signals.keys().map(|s| s.as_str()).collect();
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn set_sigmoid_k(&self, k: f32) {
        let mut inner = self.inner.borrow_mut();
        inner.state.config.sigmoid_k = k;
    }

    /// Load a Rhai script for controlling the visualiser.
    /// Returns true if the script was loaded successfully.
    pub fn load_script(&self, script: &str) -> bool {
        let mut inner = self.inner.borrow_mut();
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

    pub fn render(&self, dt: f32) {
        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        // Update state with named signals
        ctx.state.update(
            dt,
            ctx.rotation_signal.as_ref(),
            ctx.zoom_signal.as_ref(),
            &ctx.named_signals
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

    /// Run script in analysis mode to collect debug.emit() signals.
    ///
    /// This runs the script headlessly across the full track duration,
    /// collecting all debug.emit() calls without rendering.
    ///
    /// Returns a JSON-serialized AnalysisResultJson.
    pub fn run_analysis(&self, script: &str, duration: f32, time_step: f32) -> String {
        let inner = self.inner.borrow();

        let config = AnalysisConfig::new(duration, time_step);

        // Run analysis with the current named_signals
        match run_analysis(script, &inner.named_signals, config) {
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

        match run_analysis_with_events(
            script,
            &inner.named_signals,
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
            musical_time: None,
        })),
    })
}
