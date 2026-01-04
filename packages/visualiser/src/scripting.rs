//! Rhai scripting integration for the visualiser.
//!
//! Scripts can define:
//! - `fn init(ctx)` - Called once after script load to create scene objects
//! - `fn update(dt, frame)` - Called each frame with delta time and per-frame signal values
//!
//! Note: The `frame` parameter contains per-frame numeric values (time, dt, amplitude, flux).
//! For Signal-returning accessors like `inputs.bands["Bass"].energy`, use the global `inputs`
//! variable which is always available.
//!
//! Available API:
//! - `mesh.cube()`, `mesh.plane()` - Create mesh instances
//! - `line.strip(options)` - Create procedural line strips
//! - `scene.add(entity)`, `scene.remove(entity)` - Manage scene content
//!
//! Entity properties:
//! - `entity.position.x/y/z` - Position in 3D space
//! - `entity.rotation.x/y/z` - Rotation (Euler angles)
//! - `entity.scale` - Uniform scale
//! - `entity.visible` - Visibility flag
//!
//! Line-specific methods:
//! - `entity.push(x, y)` - Add a point to the line strip
//! - `entity.clear()` - Clear all points
//!
//! Logging:
//! - `log.info(value)` - Log info message to console/stdout
//! - `log.warn(value)` - Log warning message to console/stderr
//! - `log.error(value)` - Log error message to console/stderr
//! - Values can be strings, numbers, booleans, or arrays
//!
//! Debug signals:
//! - `dbg.emit(name, value)` - Emit a debug signal for analysis
//! - Collected during analysis mode; no-op during playback
//! - Use for inspecting script-derived values (gates, envelopes, etc.)

use std::collections::HashMap;
use rhai::{Engine, Scope, AST, Dynamic, EvalAltResult};

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicI64, Ordering};
use std::sync::{Mutex, LazyLock};
use std::collections::HashSet as StdHashSet;

// Thread-local storage for post-processing effects (avoids Rhai closure capture issues)
thread_local! {
    static PENDING_POST_EFFECTS: std::cell::RefCell<std::collections::HashMap<rhai::INT, rhai::Map>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
    static PENDING_POST_CHAIN: std::cell::RefCell<Vec<rhai::INT>> =
        std::cell::RefCell::new(Vec::new());
}

// Atomic counter for effect IDs
static EFFECT_ID_COUNTER: AtomicI64 = AtomicI64::new(0);

use crate::debug_collector::debug_emit;
use crate::debug_markers::{add_marker_request, DebugMarkerRequest, ShowEventsOptions, MarkerSpreadMode};
use crate::event_rhai::{get_named_event_stream_names, get_authored_event_stream_names};
use crate::event_stream::EventStream;
use crate::input::{BandSignalMap, SignalMap};
use crate::musical_time::MusicalTimeStructure;
use crate::scene_graph::{SceneGraph, EntityId, MeshType, RenderMode, LineMode, SceneEntity, LineStrip as SceneLineStrip, PointCloudMode, RadialWave, Ribbon, RibbonMode};
use crate::deformation::{Deformation, DeformAxis};
use crate::script_log::{ScriptLogger, reset_frame_log_count};
use crate::script_diagnostics::{from_eval_error, from_parse_error, lint_script, ScriptDiagnostic, ScriptPhase};
use crate::script_introspection::register_introspection_api;
use crate::signal_rhai::{
    clear_current_input_signals, generate_custom_events_namespace, generate_custom_signals_namespace,
    generate_bands_namespace, generate_event_streams_namespace, generate_inputs_namespace,
    generate_stems_namespace, register_signal_api, set_current_custom_signals,
    set_current_input_signals, SIGNAL_API_RHAI,
};
use crate::signal::Signal;
use crate::signal_eval::EvalContext;
use crate::signal_state::SignalState;
use crate::signal_stats::StatisticsCache;
use crate::particle_rhai::{register_particle_api, generate_particles_namespace, set_global_particle_seed};
use crate::post_processing::{PostProcessingChain, PostEffectInstance, EffectParamValue};
use crate::camera::{CameraConfig, CameraUniforms};
use crate::camera_rhai::{generate_camera_namespace, sync_camera_from_scope};
use crate::lighting::{LightingConfig, LightingUniforms};
use crate::lighting_rhai::{generate_lighting_namespace, sync_lighting_from_scope};
use crate::signal_explorer::{sample_signal_chain, ScriptSignalInfo, SignalChainAnalysis};
use crate::perf_profiling::{time_start, time_end, should_log_collections};
use std::sync::Arc;

/// Global debug options set by scripts.
/// These are read by the visualiser after each update.
static DEBUG_WIREFRAME: AtomicBool = AtomicBool::new(false);
static DEBUG_BOUNDING_BOXES: AtomicBool = AtomicBool::new(false);
/// 0 means no isolation, any other value is the entity ID to isolate.
static DEBUG_ISOLATED_ENTITY: AtomicU64 = AtomicU64::new(0);
/// Per-entity debug bounding box toggles.
static DEBUG_BOUNDS_ENTITIES: LazyLock<Mutex<StdHashSet<u64>>> = LazyLock::new(|| Mutex::new(StdHashSet::new()));

// Pending feedback configuration from script.
// Uses the FeedbackConfig type directly now that we have the fluent builder API.
// Using thread_local since rhai types are not Send (contains Rc types) and
// the script engine runs on a single thread.
thread_local! {
    static PENDING_FEEDBACK_CONFIG: std::cell::RefCell<Option<crate::feedback::FeedbackConfig>> = const { std::cell::RefCell::new(None) };
}

/// Debug options requested by the script.
#[derive(Debug, Clone, Default)]
pub struct ScriptDebugOptions {
    pub wireframe: bool,
    pub bounding_boxes: bool,
    /// None means render all entities, Some(id) means only render that entity.
    pub isolated_entity: Option<u64>,
    /// Per-entity debug bounding box toggles (via dbg.showBounds()).
    pub debug_bounds_entities: StdHashSet<u64>,
}

/// Get the current debug options set by scripts.
pub fn get_script_debug_options() -> ScriptDebugOptions {
    let isolated = DEBUG_ISOLATED_ENTITY.load(Ordering::Relaxed);
    let bounds_entities = DEBUG_BOUNDS_ENTITIES.lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    ScriptDebugOptions {
        wireframe: DEBUG_WIREFRAME.load(Ordering::Relaxed),
        bounding_boxes: DEBUG_BOUNDING_BOXES.load(Ordering::Relaxed),
        isolated_entity: if isolated == 0 { None } else { Some(isolated) },
        debug_bounds_entities: bounds_entities,
    }
}

/// Reset script debug options to defaults.
pub fn reset_script_debug_options() {
    DEBUG_WIREFRAME.store(false, Ordering::Relaxed);
    DEBUG_BOUNDING_BOXES.store(false, Ordering::Relaxed);
    DEBUG_ISOLATED_ENTITY.store(0, Ordering::Relaxed);
    if let Ok(mut guard) = DEBUG_BOUNDS_ENTITIES.lock() {
        guard.clear();
    }
}

/// Scripting engine that manages Rhai VM lifecycle and scene graph.
pub struct ScriptEngine {
    engine: Engine,
    ast: Option<AST>,
    scope: Scope<'static>,
    /// Scene graph managed by scripts
    pub scene_graph: SceneGraph,
    /// Mapping from entity Map references to their IDs (for syncing)
    entity_maps: HashMap<u64, rhai::Map>,
    /// Last error message (for display/debugging)
    pub last_error: Option<String>,
    /// Structured diagnostics for UI consumption.
    diagnostics: Vec<ScriptDiagnostic>,
    /// Number of prelude lines before the user script.
    user_line_offset: usize,
    /// Whether init() has been called
    init_called: bool,
    /// Available signal names for the inputs namespace
    available_signal_names: Vec<String>,
    /// Available frequency bands: (id, label) pairs
    available_bands: Vec<(String, String)>,
    /// Available stems: (id, label) pairs
    available_stems: Vec<(String, String)>,
    /// Available custom signals: (id, name) pairs
    available_custom_signals: Vec<(String, String)>,
    /// Runtime state for stateful Signal operations (smooth, gates, delay, etc.)
    signal_state: SignalState,
    /// Precomputed signal statistics for normalization (optional/empty until populated).
    signal_statistics: StatisticsCache,
    /// Post-processing effect chain
    pub post_chain: PostProcessingChain,
    /// Global seed for deterministic particle systems.
    /// Used as base seed when particle configs don't specify their own.
    global_seed: u64,
    /// Frame counter for time.frames signal.
    frame_count: u64,
    /// Frame feedback configuration (V7)
    pub feedback_config: crate::feedback::FeedbackConfig,
    /// Evaluated feedback uniforms (signals resolved to f32 values for GPU upload).
    pub feedback_uniforms: crate::feedback::FeedbackUniforms,
    /// Camera configuration with signal support.
    pub camera_config: CameraConfig,
    /// Evaluated camera uniforms (signals resolved to f32 values for renderer).
    pub camera_uniforms: CameraUniforms,
    /// Lighting configuration with signal support.
    pub lighting_config: LightingConfig,
    /// Evaluated lighting uniforms (signals resolved to f32 values for renderer).
    pub lighting_uniforms: LightingUniforms,
    /// Particle systems extracted from script scope.
    /// Keyed by entity ID assigned when added to scene.
    pub particle_systems: HashMap<u64, crate::particle::ParticleSystem>,
    /// Script source code for parsing signal declarations.
    script_source: String,
    /// Parsed signal variable declarations: variable name -> RHS expression string.
    /// Used to find signal variables declared in init() that aren't in global scope.
    parsed_signal_decls: HashMap<String, String>,
    /// Signals that have been evaluated during init().
    /// Populated by re-evaluating parsed_signal_decls expressions.
    evaluated_signals: HashMap<String, Signal>,
}

impl ScriptEngine {
    /// Create a new script engine with sandboxed settings.
    pub fn new() -> Self {
        let mut engine = Engine::new();

        // Sandbox settings
        engine.set_max_expr_depths(64, 64);
        engine.set_max_call_levels(64);
        engine.set_max_operations(100_000); // Prevent infinite loops
        engine.set_max_string_size(10_000);
        engine.set_max_array_size(100_000);  // Allow larger arrays for mesh assets
        engine.set_max_map_size(500);

        // Register standalone logging functions (these can be called from anywhere)
        engine
            .register_fn("__log_info", |value: Dynamic| {
                ScriptLogger::new().info(value);
            })
            .register_fn("__log_warn", |value: Dynamic| {
                ScriptLogger::new().warn(value);
            })
            .register_fn("__log_error", |value: Dynamic| {
                ScriptLogger::new().error(value);
            });

        // Register debug.emit native function
        // This records signals during analysis mode (when a collector is installed)
        // In playback mode, it's a no-op (no collector installed)
        engine.register_fn(
            "__debug_emit",
            |name: rhai::ImmutableString, value: Dynamic| {
                // Convert value to f32
                let f_value = if let Ok(f) = value.as_float() {
                    f as f32
                } else if let Ok(i) = value.as_int() {
                    i as f32
                } else {
                    // Ignore non-numeric values
                    return;
                };
                debug_emit(&name, f_value);
            },
        );

        // Register debug visualization control functions
        engine.register_fn("__debug_wireframe", |enabled: bool| {
            DEBUG_WIREFRAME.store(enabled, Ordering::Relaxed);
        });

        engine.register_fn("__debug_bounding_boxes", |enabled: bool| {
            DEBUG_BOUNDING_BOXES.store(enabled, Ordering::Relaxed);
        });

        engine.register_fn("__debug_isolate", |entity_id: i64| {
            DEBUG_ISOLATED_ENTITY.store(entity_id as u64, Ordering::Relaxed);
        });

        engine.register_fn("__debug_clear_isolation", || {
            DEBUG_ISOLATED_ENTITY.store(0, Ordering::Relaxed);
        });

        // Toggle per-entity debug bounding box visualization
        engine.register_fn("__debug_toggle_bounds", |entity_id: i64| -> bool {
            let id = entity_id as u64;
            if let Ok(mut guard) = DEBUG_BOUNDS_ENTITIES.lock() {
                if guard.contains(&id) {
                    guard.remove(&id);
                    false
                } else {
                    guard.insert(id);
                    true
                }
            } else {
                false
            }
        });

        // Register debug show_events function (default options)
        engine.register_fn("__debug_show_events", |events: Arc<EventStream>| {
            add_marker_request(DebugMarkerRequest {
                events,
                options: ShowEventsOptions::default(),
            });
        });

        // Register debug show_events function with options
        engine.register_fn("__debug_show_events_opts", |events: Arc<EventStream>, options: rhai::Map| {
            let opts = parse_show_events_options(&options);
            add_marker_request(DebugMarkerRequest {
                events,
                options: opts,
            });
        });

        // Register material/post-processing debug inspection functions
        engine.register_fn("__debug_list_materials", || -> rhai::Array {
            use crate::material::MaterialRegistry;
            let registry = MaterialRegistry::new();
            registry.list_ids().into_iter()
                .map(|id| Dynamic::from(id.to_string()))
                .collect()
        });

        engine.register_fn("__debug_describe_material", |id: rhai::ImmutableString| -> rhai::Map {
            use crate::material::MaterialRegistry;
            let registry = MaterialRegistry::new();
            let mut result = rhai::Map::new();

            if let Some(material) = registry.get(&id) {
                result.insert("name".into(), Dynamic::from(material.name.clone()));
                result.insert("blend_mode".into(), Dynamic::from(format!("{:?}", material.blend_mode)));

                let params: rhai::Array = material.params.iter().map(|p| {
                    let mut param_info = rhai::Map::new();
                    param_info.insert("name".into(), Dynamic::from(p.name.clone()));
                    param_info.insert("type".into(), Dynamic::from(format!("{:?}", p.param_type)));
                    Dynamic::from(param_info)
                }).collect();
                result.insert("params".into(), Dynamic::from(params));
            }

            result
        });

        engine.register_fn("__debug_list_effects", || -> rhai::Array {
            use crate::post_processing::PostEffectRegistry;
            let registry = PostEffectRegistry::new();
            registry.list_ids().into_iter()
                .map(|id| Dynamic::from(id.to_string()))
                .collect()
        });

        engine.register_fn("__debug_describe_effect", |id: rhai::ImmutableString| -> rhai::Map {
            use crate::post_processing::PostEffectRegistry;
            let registry = PostEffectRegistry::new();
            let mut result = rhai::Map::new();

            if let Some(effect) = registry.get(&id) {
                result.insert("name".into(), Dynamic::from(effect.name.clone()));
                result.insert("description".into(), Dynamic::from(effect.description.clone()));

                let params: rhai::Array = effect.params.iter().map(|p| {
                    let mut param_info = rhai::Map::new();
                    param_info.insert("name".into(), Dynamic::from(p.name.clone()));
                    param_info.insert("type".into(), Dynamic::from(format!("{:?}", p.param_type)));
                    param_info.insert("description".into(), Dynamic::from(p.description.clone()));
                    Dynamic::from(param_info)
                }).collect();
                result.insert("params".into(), Dynamic::from(params));
            }

            result
        });

        // Register effect creation functions (fully native to avoid Rhai closure issues)
        engine.register_fn("__fx_create_bloom", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("bloom"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("threshold".into(), options.get("threshold").cloned().unwrap_or_else(|| Dynamic::from(0.8_f64)));
            effect.insert("intensity".into(), options.get("intensity").cloned().unwrap_or_else(|| Dynamic::from(0.5_f64)));
            effect.insert("radius".into(), options.get("radius").cloned().unwrap_or_else(|| Dynamic::from(4.0_f64)));
            effect.insert("downsample".into(), options.get("downsample").cloned().unwrap_or_else(|| Dynamic::from(2.0_f64)));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_color_grade", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("color_grade"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("brightness".into(), options.get("brightness").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("contrast".into(), options.get("contrast").cloned().unwrap_or_else(|| Dynamic::from(1.0_f64)));
            effect.insert("saturation".into(), options.get("saturation").cloned().unwrap_or_else(|| Dynamic::from(1.0_f64)));
            effect.insert("gamma".into(), options.get("gamma").cloned().unwrap_or_else(|| Dynamic::from(1.0_f64)));
            let default_tint = {
                let mut t = rhai::Map::new();
                t.insert("r".into(), Dynamic::from(1.0_f64));
                t.insert("g".into(), Dynamic::from(1.0_f64));
                t.insert("b".into(), Dynamic::from(1.0_f64));
                t.insert("a".into(), Dynamic::from(1.0_f64));
                Dynamic::from(t)
            };
            effect.insert("tint".into(), options.get("tint").cloned().unwrap_or(default_tint));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_vignette", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("vignette"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("intensity".into(), options.get("intensity").cloned().unwrap_or_else(|| Dynamic::from(0.3_f64)));
            effect.insert("smoothness".into(), options.get("smoothness").cloned().unwrap_or_else(|| Dynamic::from(0.5_f64)));
            let default_color = {
                let mut c = rhai::Map::new();
                c.insert("r".into(), Dynamic::from(0.0_f64));
                c.insert("g".into(), Dynamic::from(0.0_f64));
                c.insert("b".into(), Dynamic::from(0.0_f64));
                c.insert("a".into(), Dynamic::from(1.0_f64));
                Dynamic::from(c)
            };
            effect.insert("color".into(), options.get("color").cloned().unwrap_or(default_color));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_distortion", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("distortion"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("amount".into(), options.get("amount").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            let default_center = {
                let mut c = rhai::Map::new();
                c.insert("x".into(), Dynamic::from(0.5_f64));
                c.insert("y".into(), Dynamic::from(0.5_f64));
                Dynamic::from(c)
            };
            effect.insert("center".into(), options.get("center").cloned().unwrap_or(default_center));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_zoom_wrap", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("zoom_wrap"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("amount".into(), options.get("amount").cloned().unwrap_or_else(|| Dynamic::from(1.0_f64)));
            effect.insert("wrap_mode".into(), options.get("wrap_mode").cloned().unwrap_or_else(|| Dynamic::from("repeat")));
            let default_center = {
                let mut c = rhai::Map::new();
                c.insert("x".into(), Dynamic::from(0.5_f64));
                c.insert("y".into(), Dynamic::from(0.5_f64));
                Dynamic::from(c)
            };
            effect.insert("center".into(), options.get("center").cloned().unwrap_or(default_center));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_radial_blur", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("radial_blur"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("strength".into(), options.get("strength").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("samples".into(), options.get("samples").cloned().unwrap_or_else(|| Dynamic::from(8_i64)));
            let default_center = {
                let mut c = rhai::Map::new();
                c.insert("x".into(), Dynamic::from(0.5_f64));
                c.insert("y".into(), Dynamic::from(0.5_f64));
                Dynamic::from(c)
            };
            effect.insert("center".into(), options.get("center").cloned().unwrap_or(default_center));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_directional_blur", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("directional_blur"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("amount".into(), options.get("amount").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("angle".into(), options.get("angle").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("samples".into(), options.get("samples").cloned().unwrap_or_else(|| Dynamic::from(8_i64)));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_chromatic_aberration", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("chromatic_aberration"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("amount".into(), options.get("amount").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("angle".into(), options.get("angle").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_create_grain", |options: rhai::Map| -> rhai::Map {
            let id = EFFECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let mut effect = rhai::Map::new();
            effect.insert("__id".into(), Dynamic::from(id));
            effect.insert("__type".into(), Dynamic::from("post_effect"));
            effect.insert("__effect_id".into(), Dynamic::from("grain"));
            effect.insert("enabled".into(), Dynamic::from(true));
            effect.insert("amount".into(), options.get("amount").cloned().unwrap_or_else(|| Dynamic::from(0.0_f64)));
            effect.insert("scale".into(), options.get("scale").cloned().unwrap_or_else(|| Dynamic::from(1.0_f64)));
            effect.insert("seed".into(), options.get("seed").cloned().unwrap_or_else(|| Dynamic::from(0_i64)));
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().insert(id, effect.clone());
            });
            effect
        });

        engine.register_fn("__fx_clear_effects", || {
            PENDING_POST_EFFECTS.with(|cell| {
                cell.borrow_mut().clear();
            });
        });

        // Post chain management (uses module-level thread-local)
        engine.register_fn("__post_add", |effect_id: rhai::INT| {
            PENDING_POST_CHAIN.with(|cell| {
                let mut chain = cell.borrow_mut();
                if !chain.contains(&effect_id) {
                    chain.push(effect_id);
                }
            });
        });

        engine.register_fn("__post_remove", |effect_id: rhai::INT| {
            PENDING_POST_CHAIN.with(|cell| {
                let mut chain = cell.borrow_mut();
                chain.retain(|&id| id != effect_id);
            });
        });

        engine.register_fn("__post_clear", || {
            PENDING_POST_CHAIN.with(|cell| {
                cell.borrow_mut().clear();
            });
        });

        engine.register_fn("__post_get_chain", || -> rhai::Array {
            PENDING_POST_CHAIN.with(|cell| {
                cell.borrow().iter().map(|&id| Dynamic::from(id)).collect()
            })
        });

        // Register feedback builder API (fluent builder pattern)
        crate::feedback_rhai::register_feedback_builder_api(&mut engine);

        // Register feedback control native functions
        // These use thread-local storage to avoid Rhai closure capture issues
        engine.register_fn("__feedback_enable", |config: crate::feedback::FeedbackConfig| {
            PENDING_FEEDBACK_CONFIG.with(|cell| {
                *cell.borrow_mut() = Some(config);
            });
        });

        engine.register_fn("__feedback_disable", || {
            PENDING_FEEDBACK_CONFIG.with(|cell| {
                *cell.borrow_mut() = None;
            });
        });

        engine.register_fn("__feedback_is_enabled", || -> bool {
            PENDING_FEEDBACK_CONFIG.with(|cell| {
                cell.borrow().is_some()
            })
        });

        // Register Signal API types and functions
        register_signal_api(&mut engine);

        // Register Particle API types and functions
        register_particle_api(&mut engine);

        // Register host-assisted introspection helpers (describe/help/doc)
        register_introspection_api(&mut engine);

        Self {
            engine,
            ast: None,
            scope: Scope::new(),
            scene_graph: SceneGraph::new(),
            entity_maps: HashMap::new(),
            last_error: None,
            diagnostics: Vec::new(),
            user_line_offset: 0,
            init_called: false,
            available_signal_names: Vec::new(),
            available_bands: Vec::new(),
            available_stems: Vec::new(),
            available_custom_signals: Vec::new(),
            signal_state: SignalState::new(),
            signal_statistics: StatisticsCache::new(),
            post_chain: PostProcessingChain::new(),
            global_seed: 0,
            frame_count: 0,
            feedback_config: crate::feedback::FeedbackConfig::default(),
            feedback_uniforms: crate::feedback::FeedbackUniforms::default(),
            camera_config: CameraConfig::default(),
            lighting_config: LightingConfig::default(),
            lighting_uniforms: LightingUniforms::default(),
            camera_uniforms: CameraUniforms::new(),
            particle_systems: HashMap::new(),
            script_source: String::new(),
            parsed_signal_decls: HashMap::new(),
            evaluated_signals: HashMap::new(),
        }
    }

    /// Set the global seed for deterministic particle systems.
    /// This seed is used as a base when particle configs don't specify their own seed.
    pub fn set_global_seed(&mut self, seed: u64) {
        self.global_seed = seed;
        // Propagate to the global particle seed used by particle_rhai
        set_global_particle_seed(seed);
    }

    /// Get the current global seed.
    pub fn global_seed(&self) -> u64 {
        self.global_seed
    }

    fn push_diagnostic(&mut self, diag: ScriptDiagnostic) {
        // Keep a bounded queue so repeated runtime errors don't grow without limit.
        const MAX_DIAGNOSTICS: usize = 32;

        self.last_error = Some(diag.message.clone());
        self.diagnostics.push(diag);
        if self.diagnostics.len() > MAX_DIAGNOSTICS {
            let excess = self.diagnostics.len() - MAX_DIAGNOSTICS;
            self.diagnostics.drain(0..excess);
        }
    }

    /// Set the available signal names for the inputs namespace.
    /// Call this before load_script to make signals available.
    pub fn set_available_signals(&mut self, names: Vec<String>) {
        self.available_signal_names = names;
    }

    /// Set the available frequency bands for the inputs.bands namespace.
    /// Call this before load_script to make band signals available.
    ///
    /// Each band is represented as a tuple of (id, label).
    pub fn set_available_bands(&mut self, bands: Vec<(String, String)>) {
        self.available_bands = bands;
    }

    /// Set the available stems for the inputs.stems namespace.
    /// Call this before load_script to make stem signals available.
    ///
    /// Each stem is represented as a tuple of (id, label).
    pub fn set_available_stems(&mut self, stems: Vec<(String, String)>) {
        self.available_stems = stems;
    }

    /// Set the available custom signals for the inputs.customSignals namespace.
    /// Call this before load_script to make custom signals available.
    ///
    /// Each signal is represented as a tuple of (id, name).
    pub fn set_available_custom_signals(&mut self, signals: Vec<(String, String)>) {
        self.available_custom_signals = signals;
    }

    /// Initialize scope with API modules and empty entity tracking.
    fn init_scope(&mut self) {
        self.scope = Scope::new();

        // Entity registry: maps entity ID -> entity Map
        let entities = rhai::Map::new();
        self.scope.push("__entities", entities);

        // Particle systems registry: maps entity ID -> ParticleSystemHandle
        let particle_systems = rhai::Map::new();
        self.scope.push("__particle_systems", particle_systems);

        // Scene entities (IDs that are in the scene)
        let scene_ids = rhai::Array::new();
        self.scope.push("__scene_ids", scene_ids);

        // Post-processing effects registry: maps effect ID -> effect Map
        let post_effects = rhai::Map::new();
        self.scope.push("__post_effects", post_effects);

        // Post-processing chain: array of effect IDs in order
        let post_chain = rhai::Array::new();
        self.scope.push("__post_chain", post_chain);

        // Next entity ID
        self.scope.push("__next_id", 1_i64);
    }

    /// Load and compile a script.
    /// Returns true if successful, false if there was a compilation error.
    pub fn load_script(&mut self, script: &str) -> bool {
        // Reset state
        self.ast = None;
        self.init_scope();
        self.scene_graph.clear();
        self.entity_maps.clear();
        self.last_error = None;
        self.diagnostics.clear();
        self.init_called = false;
        self.signal_state.clear();
        self.signal_statistics.clear();
        self.particle_systems.clear();
        self.script_source = script.to_string();
        self.parsed_signal_decls.clear();
        self.evaluated_signals.clear();

        // Reset feedback config
        PENDING_FEEDBACK_CONFIG.with(|cell| {
            *cell.borrow_mut() = None;
        });

        // Generate inputs namespace based on available signals
        let signal_names: Vec<&str> = self.available_signal_names.iter().map(|s| s.as_str()).collect();
        let inputs_namespace = generate_inputs_namespace(&signal_names);

        // Generate bands namespace based on available frequency bands
        let bands_namespace = generate_bands_namespace(&self.available_bands);

        // Generate stems namespace based on available stems
        let stems_namespace = generate_stems_namespace(&self.available_stems);

        // Generate event streams namespace based on available named event streams
        let event_stream_names = get_named_event_stream_names();
        let event_stream_names_refs: Vec<&str> = event_stream_names.iter().map(|s| s.as_str()).collect();
        let event_streams_namespace = generate_event_streams_namespace(&event_stream_names_refs);

        // Generate custom events namespace (renamed from authored) based on available authored streams
        let authored_stream_names = get_authored_event_stream_names();
        let authored_stream_names_refs: Vec<&str> = authored_stream_names.iter().map(|s| s.as_str()).collect();
        let custom_events_namespace = generate_custom_events_namespace(&authored_stream_names_refs);

        // Generate custom signals namespace
        let custom_signals_namespace = generate_custom_signals_namespace(&self.available_custom_signals);

        // Generate particles namespace
        let particles_namespace = generate_particles_namespace();

        // Generate camera namespace
        let camera_namespace = generate_camera_namespace();

        // Generate lighting namespace
        let lighting_namespace = generate_lighting_namespace();

        // Wrap user script with API definitions.
        // Note: Rhai Maps require string keys, so we convert IDs to strings using `"" + id`.
        //
        // Important: we track the number of prelude lines so we can map Rhai error
        // positions back onto the user's script for UI reporting.
        let prelude = format!(r#"
// === API Modules ===

// Mesh module
let mesh = #{{}};
mesh.__type = "mesh_namespace";
mesh.cube = || {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "mesh_cube";

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.renderMode = "solid";
    entity.wireframeColor = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.deformations = [];
    entity.material = ();
    entity.materialParams = #{{}};
    entity.lit = true;
    entity.emissive = 0.0;
    entity.shadow = #{{ enabled: false, plane_y: 0.0, opacity: 0.5, radius: 1.0, radius_x: 1.0, radius_z: 1.0, softness: 0.3, offset_x: 0.0, offset_z: 0.0, color: #{{ r: 0.0, g: 0.0, b: 0.0 }} }};

    // Instance method - creates a new entity sharing geometry with copied properties
    entity.instance = || {{
        let id = __next_id;
        __next_id += 1;

        let clone = #{{}};
        clone.__id = id;
        clone.__type = this.__type;

        clone.position = #{{ x: this.position.x, y: this.position.y, z: this.position.z }};
        clone.rotation = #{{ x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }};
        clone.scale = this.scale;
        clone.visible = this.visible;
        clone.color = #{{ r: this.color.r, g: this.color.g, b: this.color.b, a: this.color.a }};
        clone.renderMode = this.renderMode;
        clone.wireframeColor = #{{ r: this.wireframeColor.r, g: this.wireframeColor.g, b: this.wireframeColor.b, a: this.wireframeColor.a }};
        clone.deformations = [];
        clone.material = this.material;
        clone.materialParams = #{{}};
        clone.lit = this.lit;
        clone.emissive = this.emissive;
        clone.shadow = this.shadow;
        clone.instance = this.instance;

        __entities["" + id] = clone;
        clone
    }};

    __entities["" + id] = entity;
    entity
}};

mesh.plane = || {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "mesh_plane";

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.renderMode = "solid";
    entity.wireframeColor = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.deformations = [];
    entity.material = ();
    entity.materialParams = #{{}};
    entity.lit = true;
    entity.emissive = 0.0;
    entity.shadow = #{{ enabled: false, plane_y: 0.0, opacity: 0.5, radius: 1.0, radius_x: 1.0, radius_z: 1.0, softness: 0.3, offset_x: 0.0, offset_z: 0.0, color: #{{ r: 0.0, g: 0.0, b: 0.0 }} }};

    // Instance method - creates a new entity sharing geometry with copied properties
    entity.instance = || {{
        let id = __next_id;
        __next_id += 1;

        let clone = #{{}};
        clone.__id = id;
        clone.__type = this.__type;

        clone.position = #{{ x: this.position.x, y: this.position.y, z: this.position.z }};
        clone.rotation = #{{ x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }};
        clone.scale = this.scale;
        clone.visible = this.visible;
        clone.color = #{{ r: this.color.r, g: this.color.g, b: this.color.b, a: this.color.a }};
        clone.renderMode = this.renderMode;
        clone.wireframeColor = #{{ r: this.wireframeColor.r, g: this.wireframeColor.g, b: this.wireframeColor.b, a: this.wireframeColor.a }};
        clone.deformations = [];
        clone.material = this.material;
        clone.materialParams = #{{}};
        clone.lit = this.lit;
        clone.emissive = this.emissive;
        clone.shadow = this.shadow;
        clone.instance = this.instance;

        __entities["" + id] = clone;
        clone
    }};

    __entities["" + id] = entity;
    entity
}};

mesh.sphere = || {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "mesh_sphere";

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.renderMode = "solid";
    entity.wireframeColor = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.deformations = [];
    entity.material = ();
    entity.materialParams = #{{}};
    entity.lit = true;
    entity.emissive = 0.0;
    entity.shadow = #{{ enabled: false, plane_y: 0.0, opacity: 0.5, radius: 1.0, radius_x: 1.0, radius_z: 1.0, softness: 0.3, offset_x: 0.0, offset_z: 0.0, color: #{{ r: 0.0, g: 0.0, b: 0.0 }} }};

    // Instance method - creates a new entity sharing geometry with copied properties
    entity.instance = || {{
        let id = __next_id;
        __next_id += 1;

        let clone = #{{}};
        clone.__id = id;
        clone.__type = this.__type;

        clone.position = #{{ x: this.position.x, y: this.position.y, z: this.position.z }};
        clone.rotation = #{{ x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }};
        clone.scale = this.scale;
        clone.visible = this.visible;
        clone.color = #{{ r: this.color.r, g: this.color.g, b: this.color.b, a: this.color.a }};
        clone.renderMode = this.renderMode;
        clone.wireframeColor = #{{ r: this.wireframeColor.r, g: this.wireframeColor.g, b: this.wireframeColor.b, a: this.wireframeColor.a }};
        clone.deformations = [];
        clone.material = this.material;
        clone.materialParams = #{{}};
        clone.lit = this.lit;
        clone.emissive = this.emissive;
        clone.shadow = this.shadow;
        clone.instance = this.instance;

        __entities["" + id] = clone;
        clone
    }};

    __entities["" + id] = entity;
    entity
}};

mesh.load = |asset_id| {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "mesh_asset";
    entity.__asset_id = asset_id;

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.renderMode = "solid";
    entity.wireframeColor = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.deformations = [];
    entity.material = ();
    entity.materialParams = #{{}};
    entity.lit = true;
    entity.emissive = 0.0;
    entity.shadow = #{{ enabled: false, plane_y: 0.0, opacity: 0.5, radius: 1.0, radius_x: 1.0, radius_z: 1.0, softness: 0.3, offset_x: 0.0, offset_z: 0.0, color: #{{ r: 0.0, g: 0.0, b: 0.0 }} }};

    // Instance method - creates a new entity sharing geometry with copied properties
    entity.instance = || {{
        let id = __next_id;
        __next_id += 1;

        let clone = #{{}};
        clone.__id = id;
        clone.__type = this.__type;
        if this.contains("__asset_id") {{ clone.__asset_id = this.__asset_id; }}

        clone.position = #{{ x: this.position.x, y: this.position.y, z: this.position.z }};
        clone.rotation = #{{ x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }};
        clone.scale = this.scale;
        clone.visible = this.visible;
        clone.color = #{{ r: this.color.r, g: this.color.g, b: this.color.b, a: this.color.a }};
        clone.renderMode = this.renderMode;
        clone.wireframeColor = #{{ r: this.wireframeColor.r, g: this.wireframeColor.g, b: this.wireframeColor.b, a: this.wireframeColor.a }};
        clone.deformations = [];
        clone.material = this.material;
        clone.materialParams = #{{}};
        clone.lit = this.lit;
        clone.emissive = this.emissive;
        clone.shadow = this.shadow;
        clone.instance = this.instance;

        __entities["" + id] = clone;
        clone
    }};

    __entities["" + id] = entity;
    entity
}};

// Radial module - radial primitives (rings, arcs, waves)
let radial = #{{}};
radial.__type = "radial_namespace";

// ring() accepts optional options map - if not provided or not a map, uses defaults
radial.ring = |options| {{
    // Handle case where options might not be a map (e.g., called with no args)
    let opts = if type_of(options) == "map" {{ options }} else {{ #{{}} }};

    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "radial_ring";

    // Ring-specific parameters (all support Signal | f32)
    entity.__radius = if opts.contains("radius") {{ opts.radius }} else {{ 1.0 }};
    entity.__thickness = if opts.contains("thickness") {{ opts.thickness }} else {{ 0.1 }};
    entity.__start_angle = if opts.contains("start_angle") {{ opts.start_angle }} else {{ 0.0 }};
    entity.__end_angle = if opts.contains("end_angle") {{ opts.end_angle }} else {{ 6.283185307 }}; // 2*PI
    entity.__segments = if opts.contains("segments") {{ opts.segments }} else {{ 64 }};

    // Standard entity properties
    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.renderMode = "solid";
    entity.wireframeColor = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};
    entity.deformations = [];
    entity.material = ();
    entity.materialParams = #{{}};
    entity.lit = true;
    entity.emissive = 0.0;
    entity.shadow = #{{ enabled: false, plane_y: 0.0, opacity: 0.5, radius: 1.0, radius_x: 1.0, radius_z: 1.0, softness: 0.3, offset_x: 0.0, offset_z: 0.0, color: #{{ r: 0.0, g: 0.0, b: 0.0 }} }};

    // Setter methods for fluent API
    entity.set_radius = |r| {{ this.__radius = r; this }};
    entity.set_thickness = |t| {{ this.__thickness = t; this }};
    entity.set_start_angle = |a| {{ this.__start_angle = a; this }};
    entity.set_end_angle = |a| {{ this.__end_angle = a; this }};
    entity.set_segments = |s| {{ this.__segments = s; this }};
    entity.set_position = |x, y, z| {{ this.position = #{{ x: x, y: y, z: z }}; this }};
    entity.set_rotation = |x, y, z| {{ this.rotation = #{{ x: x, y: y, z: z }}; this }};
    entity.set_scale = |s| {{ this.scale = s; this }};
    entity.set_color = |r, g, b, a| {{ this.color = #{{ r: r, g: g, b: b, a: a }}; this }};
    entity.set_visible = |v| {{ this.visible = v; this }};

    // Instance method
    entity.instance = || {{
        let id = __next_id;
        __next_id += 1;

        let clone = #{{}};
        clone.__id = id;
        clone.__type = this.__type;
        clone.__radius = this.__radius;
        clone.__thickness = this.__thickness;
        clone.__start_angle = this.__start_angle;
        clone.__end_angle = this.__end_angle;
        clone.__segments = this.__segments;

        clone.position = #{{ x: this.position.x, y: this.position.y, z: this.position.z }};
        clone.rotation = #{{ x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }};
        clone.scale = this.scale;
        clone.visible = this.visible;
        clone.color = #{{ r: this.color.r, g: this.color.g, b: this.color.b, a: this.color.a }};
        clone.renderMode = this.renderMode;
        clone.wireframeColor = #{{ r: this.wireframeColor.r, g: this.wireframeColor.g, b: this.wireframeColor.b, a: this.wireframeColor.a }};
        clone.deformations = [];
        clone.material = this.material;
        clone.materialParams = #{{}};
        clone.lit = this.lit;
        clone.emissive = this.emissive;
        clone.shadow = this.shadow;

        // Copy setter methods
        clone.set_radius = this.set_radius;
        clone.set_thickness = this.set_thickness;
        clone.set_start_angle = this.set_start_angle;
        clone.set_end_angle = this.set_end_angle;
        clone.set_segments = this.set_segments;
        clone.set_position = this.set_position;
        clone.set_rotation = this.set_rotation;
        clone.set_scale = this.set_scale;
        clone.set_color = this.set_color;
        clone.set_visible = this.set_visible;
        clone.instance = this.instance;

        __entities["" + id] = clone;
        clone
    }};

    __entities["" + id] = entity;
    entity
}};

radial.wave = |signal, options| {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "radial_wave";
    entity.__signal = signal;

    // Wave-specific parameters
    entity.__base_radius = if options.contains("base_radius") {{ options.base_radius }} else {{ 1.0 }};
    entity.__amplitude = if options.contains("amplitude") {{ options.amplitude }} else {{ 0.5 }};
    entity.__wave_frequency = if options.contains("wave_frequency") {{ options.wave_frequency }} else {{ 4 }};
    entity.__resolution = if options.contains("resolution") {{ options.resolution }} else {{ 128 }};

    // Standard entity properties
    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};

    __entities["" + id] = entity;
    entity
}};

// Points module - point cloud primitives
let points = #{{}};
points.__type = "points_namespace";

points.cloud = |options| {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "point_cloud";

    // Point cloud parameters
    entity.__count = if options.contains("count") {{ options.count }} else {{ 100 }};
    entity.__spread = if options.contains("spread") {{ options.spread }} else {{ 1.0 }};
    entity.__mode = if options.contains("mode") {{ options.mode }} else {{ "uniform" }};
    entity.__seed = if options.contains("seed") {{ options.seed }} else {{ 0 }};
    entity.__point_size = if options.contains("point_size") {{ options.point_size }} else {{ 2.0 }};

    // Standard entity properties
    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};

    __entities["" + id] = entity;
    entity
}};

// Deformation module - creates deformation descriptors for mesh.deformations
let deform = #{{}};
deform.__type = "deform_namespace";
deform.twist = |options| {{
    let d = #{{}};
    d.__type = "deform_twist";
    d.axis = if options.contains("axis") {{ options.axis }} else {{ "y" }};
    d.amount = if options.contains("amount") {{ options.amount }} else {{ 0.0 }};
    d.center = if options.contains("center") {{ options.center }} else {{ 0.0 }};
    d
}};
deform.bend = |options| {{
    let d = #{{}};
    d.__type = "deform_bend";
    d.axis = if options.contains("axis") {{ options.axis }} else {{ "y" }};
    d.amount = if options.contains("amount") {{ options.amount }} else {{ 0.0 }};
    d.center = if options.contains("center") {{ options.center }} else {{ 0.0 }};
    d
}};
deform.wave = |options| {{
    let d = #{{}};
    d.__type = "deform_wave";
    d.axis = if options.contains("axis") {{ options.axis }} else {{ "x" }};
    d.direction = if options.contains("direction") {{ options.direction }} else {{ "y" }};
    d.amplitude = if options.contains("amplitude") {{ options.amplitude }} else {{ 0.0 }};
    d.frequency = if options.contains("frequency") {{ options.frequency }} else {{ 1.0 }};
    d.phase = if options.contains("phase") {{ options.phase }} else {{ 0.0 }};
    d
}};
deform.noise = |options| {{
    let d = #{{}};
    d.__type = "deform_noise";
    d.scale = if options.contains("scale") {{ options.scale }} else {{ 1.0 }};
    d.amplitude = if options.contains("amplitude") {{ options.amplitude }} else {{ 0.0 }};
    d.seed = if options.contains("seed") {{ options.seed }} else {{ 0 }};
    d
}};

// Line module
let line = #{{}};
line.__type = "line_namespace";
line.strip = |options| {{
    let id = __next_id;
    __next_id += 1;

    let max_points = if options.contains("max_points") {{ options.max_points }} else {{ 256 }};
    let mode = if options.contains("mode") {{ options.mode }} else {{ "line" }};

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "line_strip";
    entity.__max_points = max_points;
    entity.__mode = mode;
    entity.__points = [];

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 0.0, g: 1.0, b: 0.0, a: 1.0 }};

    // Line-specific methods stored on entity
    entity.push = |x, y| {{
        let points = this.__points;
        points.push(#{{ x: x, y: y }});
        // Enforce max_points limit (ring buffer behavior)
        if points.len() > this.__max_points {{
            points.remove(0);
        }}
        this.__points = points;
    }};

    entity.clear = || {{
        this.__points = [];
    }};

    __entities["" + id] = entity;
    entity
}};

// Create a line that traces a Signal over time (X=time, Y=signal value)
// Usage: let trace = line.trace(signal, #{{{{ max_points: 256 }}}});
line.trace = |signal, options| {{
    let id = __next_id;
    __next_id += 1;

    let max_points = if options.contains("max_points") {{ options.max_points }} else {{ 256 }};
    let mode = if options.contains("mode") {{ options.mode }} else {{ "line" }};
    let x_scale = if options.contains("x_scale") {{ options.x_scale }} else {{ 1.0 }};
    let y_scale = if options.contains("y_scale") {{ options.y_scale }} else {{ 1.0 }};
    let y_offset = if options.contains("y_offset") {{ options.y_offset }} else {{ 0.0 }};

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "line_trace";
    entity.__max_points = max_points;
    entity.__mode = mode;
    entity.__points = [];
    entity.__signal = signal;
    entity.__x_scale = x_scale;
    entity.__y_scale = y_scale;
    entity.__y_offset = y_offset;
    entity.__last_time = -1.0;

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 0.0, g: 1.0, b: 0.0, a: 1.0 }};

    entity.clear = || {{
        this.__points = [];
    }};

    __entities["" + id] = entity;
    entity
}};

line.ribbon = |signal, options| {{
    let id = __next_id;
    __next_id += 1;

    let max_points = if options.contains("max_points") {{ options.max_points }} else {{ 256 }};
    let mode = if options.contains("mode") {{ options.mode }} else {{ "strip" }};
    let width = if options.contains("width") {{ options.width }} else {{ 0.1 }};
    let twist = if options.contains("twist") {{ options.twist }} else {{ 0.0 }};

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "line_ribbon";
    entity.__max_points = max_points;
    entity.__mode = mode;
    entity.__width = width;
    entity.__twist = twist;
    entity.__signal = signal;

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;
    entity.color = #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }};

    entity.clear = || {{
        // Clear will be handled in sync
        this.__clear = true;
    }};

    __entities["" + id] = entity;
    entity
}};

// Scene module
let scene = #{{}};
scene.__type = "scene_namespace";
scene.add = |entity| {{
    let id = entity.__id;
    if !__scene_ids.contains(id) {{
        __scene_ids.push(id);
    }}
}};

scene.remove = |entity| {{
    let id = entity.__id;
    let idx = __scene_ids.index_of(id);
    if idx >= 0 {{
        __scene_ids.remove(idx);
    }}
}};

scene.clear = || {{
    __scene_ids.clear();
    __entities.clear();
    __next_id = 1;
}};

scene.group = || {{
    let id = __next_id;
    __next_id += 1;

    let entity = #{{}};
    entity.__id = id;
    entity.__type = "group";
    entity.__children = [];

    entity.position = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.rotation = #{{ x: 0.0, y: 0.0, z: 0.0 }};
    entity.scale = 1.0;
    entity.visible = true;

    // Add child to group
    entity.add = |child| {{
        let child_id = child.__id;
        // Set parent reference on child
        child.__parent_id = this.__id;
        // Add to children list if not already there
        if !this.__children.contains(child_id) {{
            this.__children.push(child_id);
        }}
        // Update global entity registry
        __entities["" + child_id] = child;
    }};

    // Remove child from group
    entity.remove = |child| {{
        let child_id = child.__id;
        let idx = this.__children.index_of(child_id);
        if idx >= 0 {{
            this.__children.remove(idx);
        }}
        // Clear parent reference
        child.__parent_id = ();
        __entities["" + child_id] = child;
    }};

    __entities["" + id] = entity;
    entity
}};

// Log module - wraps native logging functions
let log = #{{}};
log.__type = "log_namespace";
log.info = |msg| {{ __log_info(msg); }};
log.warn = |msg| {{ __log_warn(msg); }};
log.error = |msg| {{ __log_error(msg); }};

// Debug module - for emitting debug signals and controlling debug visualization
// Signals are collected during analysis mode for visualization
// In playback mode, emit is a no-op
let dbg = #{{}};
dbg.__type = "dbg_namespace";
dbg.emit = |name, value| {{ __debug_emit(name, value); }};
dbg.wireframe = |enabled| {{ __debug_wireframe(enabled); }};
dbg.boundingBoxes = |enabled| {{ __debug_bounding_boxes(enabled); }};
dbg.showBounds = |entity| {{ __debug_toggle_bounds(entity.__id) }};
dbg.isolate = |entity| {{ __debug_isolate(entity.__id); }};
dbg.clearIsolation = || {{ __debug_clear_isolation(); }};
dbg.showEvents = |events| {{ __debug_show_events(events); }};
dbg.showEventsOpts = |events, options| {{ __debug_show_events_opts(events, options); }};
dbg.listMaterials = || {{ __debug_list_materials() }};
dbg.describeMaterial = |id| {{ __debug_describe_material(id) }};
dbg.listEffects = || {{ __debug_list_effects() }};
dbg.describeEffect = |id| {{ __debug_describe_effect(id) }};

// Post-processing effect factory (fx namespace)
let fx = #{{}};
fx.__type = "fx_namespace";

fx.bloom = |options| {{
    let effect = __fx_create_bloom(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.colorGrade = |options| {{
    let effect = __fx_create_color_grade(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.vignette = |options| {{
    let effect = __fx_create_vignette(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.distortion = |options| {{
    let effect = __fx_create_distortion(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.zoomWrap = |options| {{
    let effect = __fx_create_zoom_wrap(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.radialBlur = |options| {{
    let effect = __fx_create_radial_blur(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.directionalBlur = |options| {{
    let effect = __fx_create_directional_blur(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.chromaticAberration = |options| {{
    let effect = __fx_create_chromatic_aberration(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};
fx.grain = |options| {{
    let effect = __fx_create_grain(options);
    __post_effects["" + effect.__id] = effect;
    effect
}};

// Post-processing chain management (post namespace)
let post = #{{}};
post.__type = "post_namespace";

post.add = |effect| {{
    let id = effect.__id;
    // Add to chain if not already present
    let found = false;
    for existing_id in __post_chain {{
        if existing_id == id {{
            found = true;
            break;
        }}
    }}
    if !found {{
        __post_chain.push(id);
    }}
    // Update the effect registry with latest version
    __post_effects["" + id] = effect;
}};
post.remove = |effect| {{
    let id = effect.__id;
    let new_chain = [];
    for existing_id in __post_chain {{
        if existing_id != id {{
            new_chain.push(existing_id);
        }}
    }}
    __post_chain = new_chain;
}};
post.clear = || {{
    __post_chain = [];
}};
post.setOrder = |order| {{
    __post_chain = order;
}};

// === Feedback System (V7) ===
// Frame feedback for Milkdrop-style temporal visual memory
// Uses fluent builder API for easy chaining and autocomplete support

let feedback = #{{}};
feedback.__type = "feedback_namespace";

// Create a new feedback builder
// Usage:
//   let fb = feedback.builder()
//       .warp.spiral(0.5, 0.02)
//       .warp.radial(0.3)
//       .color.decay(0.95)
//       .color.hsv(0.01, 0.0, 0.0)
//       .blend.add()
//       .opacity(0.9)
//       .build();
//   feedback.enable(fb);
feedback.builder = || {{
    __feedback_builder_new()
}};

// Enable feedback with a configuration (calls native function)
feedback.enable = |config| {{
    __feedback_enable(config);
}};

// Disable feedback (calls native function)
feedback.disable = || {{
    __feedback_disable();
}};

// Check if feedback is enabled (calls native function)
feedback.is_enabled = || {{
    __feedback_is_enabled()
}};

// === Signal API ===
{SIGNAL_API_RHAI}

// === Inputs Namespace (Signal accessors) ===
{inputs_namespace}

// === Bands Namespace (Band-scoped signal accessors) ===
{bands_namespace}

// === Stems Namespace (Stem-scoped signal accessors) ===
{stems_namespace}

// === Event Streams Namespace (Named event streams) ===
{event_streams_namespace}

// === Custom Events Namespace (Human-curated event streams) ===
{custom_events_namespace}

// === Custom Signals Namespace (User-defined 1D signals from 2D data) ===
{custom_signals_namespace}

// === Particles Namespace ===
{particles_namespace}

// === Camera Namespace ===
{camera_namespace}

// === Lighting Namespace ===
{lighting_namespace}

// === User Script ===
"#);

        // Count prelude lines so we can map errors back to user code.
        self.user_line_offset = prelude.matches('\n').count();
        let full_script = format!("{prelude}{script}");

        match self.engine.compile(&full_script) {
            Ok(ast) => {
                // Run lint checks on the user script (before prelude)
                let lint_warnings = lint_script(script);
                for warning in lint_warnings {
                    self.push_diagnostic(warning);
                }

                // Run the script once to initialize global state and API
                if let Err(e) = self.engine.run_ast_with_scope(&mut self.scope, &ast) {
                    let diag = from_eval_error(ScriptPhase::Init, &e, self.user_line_offset);
                    self.push_diagnostic(diag);
                    return false;
                }
                self.ast = Some(ast);

                // Parse signal declarations from the script source
                self.parse_signal_declarations();

                true
            }
            Err(e) => {
                let diag = from_parse_error(&e, self.user_line_offset);
                self.push_diagnostic(diag);
                false
            }
        }
    }

    /// Parse the script source to find signal variable declarations.
    /// This finds patterns like `let foo = inputs.` or `let bar = gen.` etc.
    fn parse_signal_declarations(&mut self) {
        use regex::Regex;

        // Pattern to match: let <name> = <signal_expression>
        // Signal expressions typically start with: inputs., gen., time., or are method chains
        let re = Regex::new(
            r"let\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*((?:inputs\.|gen\.|time\.)[^;]+)"
        ).unwrap();

        for cap in re.captures_iter(&self.script_source) {
            if let (Some(name), Some(expr)) = (cap.get(1), cap.get(2)) {
                let name_str = name.as_str().to_string();
                let expr_str = expr.as_str().trim().to_string();
                self.parsed_signal_decls.insert(name_str, expr_str);
            }
        }

        log::debug!("Parsed {} signal declarations from script", self.parsed_signal_decls.len());
    }

    /// Call the init function if it exists.
    /// This should be called once after load_script to let the script create scene objects.
    pub fn call_init(&mut self) {
        if self.init_called {
            return;
        }
        self.init_called = true;

        let ast = match &self.ast {
            Some(ast) => ast.clone(),
            None => return,
        };

        // Create a simple context Map (can be extended later)
        let mut ctx = rhai::Map::new();
        ctx.insert("__type".into(), Dynamic::from("init_ctx"));

        // Call init if it exists
        let result: Result<(), Box<EvalAltResult>> = self.engine.call_fn(
            &mut self.scope,
            &ast,
            "init",
            (Dynamic::from(ctx),),
        );

        if let Err(e) = result {
            let err_str = e.to_string();
            if !err_str.contains("Function not found") {
                let diag = from_eval_error(ScriptPhase::Init, &e, self.user_line_offset);
                self.push_diagnostic(diag);
            } else {
                log::info!("Script has no init() function");
            }
        } else {
            log::info!("Script init() called successfully");
        }
    }

    /// Call the update function with the given per-frame inputs, then sync the scene graph.
    ///
    /// - `time`/`dt` are used for evaluating any Signal values assigned to entity properties.
    /// - `frame_inputs` are the per-frame sampled numeric inputs passed to the Rhai `update()` function.
    /// - `input_signals`/`band_signals`/`stem_signals`/`custom_signals` are the raw signal buffers used by Signal evaluation.
    ///
    /// Note: SignalMap uses Rc<InputSignal> internally, so cloning for thread-local storage is cheap
    /// (just reference count increments, not deep copies of audio data).
    pub fn update(
        &mut self,
        time: f32,
        dt: f32,
        frame_inputs: &HashMap<String, f32>,
        input_signals: &SignalMap,
        band_signals: &BandSignalMap,
        stem_signals: &BandSignalMap,
        custom_signals: &SignalMap,
        musical_time: Option<&MusicalTimeStructure>,
    ) {
        // Increment frame counter for time.frames signal
        self.frame_count += 1;

        // Reset per-frame log counter
        reset_frame_log_count();

        // Ensure init has been called
        if !self.init_called {
            self.call_init();
        }

        let ast = match &self.ast {
            Some(ast) => ast.clone(),
            None => return,
        };

        // Set up thread-local input signals for sample_at API
        set_current_input_signals(input_signals.clone(), band_signals.clone());
        set_current_custom_signals(custom_signals.clone());

        // Create inputs map from the per-frame numeric inputs
        // Note: Rhai is compiled with f32_float feature, so use f32
        let mut inputs_map = rhai::Map::new();
        inputs_map.insert("__type".into(), Dynamic::from("frame_inputs"));
        for (name, value) in frame_inputs {
            inputs_map.insert(name.clone().into(), Dynamic::from(*value));
        }

        // Log available signals for debugging (only occasionally to avoid spam)
        static LOG_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let count = LOG_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if count % 60 == 0 {
            log::info!(
                "Script update: dt={:.4}, inputs={:?}",
                dt,
                frame_inputs.keys().collect::<Vec<_>>()
            );
        }

        // Call the update function
        // Note: Pass dt as f32 since Rhai is compiled with f32_float feature
        let entities_before_update = self.scope.get_value::<rhai::Map>("__entities")
            .map(|e| e.len())
            .unwrap_or(0);
        let next_id_before = self.scope.get_value::<i64>("__next_id").unwrap_or(-1);

        time_start("rhai_update");
        let result: Result<(), Box<EvalAltResult>> = self.engine.call_fn(
            &mut self.scope,
            &ast,
            "update",
            (Dynamic::from(dt), Dynamic::from(inputs_map)),
        );
        time_end("rhai_update");

        // Log if Rhai update added entities
        if should_log_collections() {
            let entities_after_update = self.scope.get_value::<rhai::Map>("__entities")
                .map(|e| e.len())
                .unwrap_or(0);
            let next_id_after = self.scope.get_value::<i64>("__next_id").unwrap_or(-1);

            if entities_before_update != entities_after_update || next_id_before != next_id_after {
                log::warn!(
                    "[PERF] rhai_update changed state: __entities {} -> {}, __next_id {} -> {}",
                    entities_before_update, entities_after_update,
                    next_id_before, next_id_after
                );
            }
        }

        if let Err(e) = result {
            let err_str = e.to_string();
            if !err_str.contains("Function not found") {
                let diag = from_eval_error(ScriptPhase::Update, &e, self.user_line_offset);
                self.push_diagnostic(diag);
            }
        }

        // Sync entities from scope to scene graph, evaluating any Signal properties at render time.
        time_start("sync_entities");
        self.sync_entities_from_scope(time, dt, input_signals, band_signals, stem_signals, custom_signals, musical_time);
        time_end("sync_entities");

        // Log collection sizes periodically for performance profiling
        if should_log_collections() {
            self.log_collection_sizes();
        }

        // Clear thread-local input signals after update is complete
        clear_current_input_signals();
    }

    /// Log collection sizes for performance profiling.
    fn log_collection_sizes(&self) {
        let frame = self.frame_count;
        let collections = self.signal_state.get_collection_sizes();
        let scene_stats = format!(
            "entities={}, meshes={}, lines={}, clouds={}, ribbons={}",
            self.scene_graph.entities.len(),
            self.scene_graph.meshes().count(),
            self.scene_graph.lines().count(),
            self.scene_graph.point_clouds().count(),
            self.scene_graph.ribbons().count(),
        );

        let signal_state_stats: Vec<String> = collections
            .iter()
            .map(|(name, count)| format!("{}={}", name, count))
            .collect();

        log::info!(
            "[PERF] Frame {} Collections:\n  Signal State: {}\n  Scene Graph: {}\n  SignalId counter: {}",
            frame,
            signal_state_stats.join(", "),
            scene_stats,
            crate::signal::SignalId::current_count()
        );
    }

    /// Sync entity Maps from scope back to the SceneGraph.
    ///
    /// Numeric fields can be authored as either numbers (f32/i64) or `Signal` graphs.
    /// When a `Signal` is encountered, it is evaluated at the current frame time.
    fn sync_entities_from_scope(
        &mut self,
        time: f32,
        dt: f32,
        input_signals: &SignalMap,
        band_signals: &BandSignalMap,
        stem_signals: &BandSignalMap,
        custom_signals: &SignalMap,
        musical_time: Option<&MusicalTimeStructure>,
    ) {
        // Get the entities Map and scene_ids Array from scope
        let mut entities = match self.scope.get_value::<rhai::Map>("__entities") {
            Some(e) => e,
            None => return,
        };

        let scene_ids = match self.scope.get_value::<rhai::Array>("__scene_ids") {
            Some(a) => a,
            None => return,
        };

        // Convert scene_ids to a set for quick lookup
        let scene_id_set: std::collections::HashSet<i64> = scene_ids
            .iter()
            .filter_map(|d| d.as_int().ok())
            .collect();

        // Temporarily move Signal state/statistics out so we can mutate `self` while evaluating signals.
        let frame_count = self.frame_count;
        let mut signal_state = std::mem::take(&mut self.signal_state);
        let signal_statistics = std::mem::take(&mut self.signal_statistics);
        let mut eval_ctx = EvalContext::new(
            time,
            dt,
            frame_count,
            musical_time,
            input_signals,
            band_signals,
            stem_signals,
            custom_signals,
            &signal_statistics,
            &mut signal_state,
            None, // track_duration - TODO: pass actual track duration when available
        );
        let mut frame_cache: HashMap<crate::signal::SignalId, f32> = HashMap::new();

        fn eval_f32_opt(
            value: &Dynamic,
            ctx: &mut EvalContext<'_>,
            cache: &mut HashMap<crate::signal::SignalId, f32>,
        ) -> Option<f32> {
            if let Ok(f) = value.as_float() {
                return Some(f as f32);
            }
            if let Ok(i) = value.as_int() {
                return Some(i as f32);
            }
            if let Some(signal) = value.clone().try_cast::<Signal>() {
                if let Some(v) = cache.get(&signal.id) {
                    return Some(*v);
                }
                let v = signal.evaluate(ctx);
                cache.insert(signal.id, v);
                return Some(v);
            }
            None
        }

        // First, collect entity Maps from all scope variables (in case user modified local copies)
        // This handles the copy-on-write behavior of Rhai Maps
        // Also track which entity IDs are referenced by scope variables
        time_start("sync_scope_iter");
        let scope_var_count = self.scope.len();
        let entities_before = entities.len();
        let mut scope_referenced_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();

        for (name, _is_const, value) in self.scope.iter() {
            // Skip internal variables
            if name.starts_with("__") || name == "mesh" || name == "line" || name == "scene" || name == "deform" {
                continue;
            }

            // Check if this is an entity Map
            if let Some(mut scope_entity_map) = value.clone().try_cast::<rhai::Map>() {
                if let Some(id_dyn) = scope_entity_map.get("__id") {
                    if let Ok(id) = id_dyn.as_int() {
                        let key = format!("{}", id);
                        scope_referenced_ids.insert(id);

                        // Preserve internal fields from the existing entry (like __parent_id)
                        // that are managed by group methods rather than user code
                        if let Some(existing_dyn) = entities.get(key.as_str()) {
                            if let Some(existing_map) = existing_dyn.clone().try_cast::<rhai::Map>() {
                                // Preserve __parent_id if the scope variable doesn't have it
                                if scope_entity_map.get("__parent_id").is_none() {
                                    if let Some(parent_id) = existing_map.get("__parent_id") {
                                        scope_entity_map.insert("__parent_id".into(), parent_id.clone());
                                    }
                                }
                                // Preserve __children if the scope variable doesn't have it
                                if scope_entity_map.get("__children").is_none() {
                                    if let Some(children) = existing_map.get("__children") {
                                        scope_entity_map.insert("__children".into(), children.clone());
                                    }
                                }
                            }
                        }

                        // Update the central __entities map with this merged copy
                        entities.insert(key.into(), Dynamic::from(scope_entity_map));
                    }
                }
            }
        }

        // Clean up stale entries from __entities:
        // Keep only entries that are either in scene_id_set or referenced by a scope variable
        let keys_to_remove: Vec<String> = entities
            .keys()
            .filter_map(|key| {
                let key_str = key.to_string();
                if let Ok(id) = key_str.parse::<i64>() {
                    if !scene_id_set.contains(&id) && !scope_referenced_ids.contains(&id) {
                        return Some(key_str);
                    }
                }
                None
            })
            .collect();

        let removed_count = keys_to_remove.len();
        for key in &keys_to_remove {
            entities.remove(key.as_str());
        }

        // Update the scope with cleaned entities
        self.scope.set_value("__entities", entities.clone());
        time_end("sync_scope_iter");

        // Log if sync_scope_iter added/changed entity count
        let entities_after = entities.len();
        if should_log_collections() {
            if removed_count > 0 {
                log::info!(
                    "[PERF] __entities cleanup: removed {} stale entries (scope_refs={}, scene_ids={})",
                    removed_count,
                    scope_referenced_ids.len(),
                    scene_id_set.len()
                );
            }
            if entities_before != entities_after + removed_count {
                // This would indicate new entries were added during the loop
                log::warn!(
                    "[PERF] sync_scope_iter changed __entities count: {} -> {} (removed: {}, net delta: {})",
                    entities_before,
                    entities_after,
                    removed_count,
                    entities_after as i64 - entities_before as i64
                );
            }
        }

        // Log scope/entity counts periodically for profiling
        if should_log_collections() {
            // Get __next_id to understand entity creation rate
            let next_id = self.scope.get_value::<i64>("__next_id").unwrap_or(-1);

            // Find the range of keys in __entities
            let entity_keys: Vec<i64> = entities
                .keys()
                .filter_map(|k| k.to_string().parse::<i64>().ok())
                .collect();
            let min_key = entity_keys.iter().min().copied().unwrap_or(0);
            let max_key = entity_keys.iter().max().copied().unwrap_or(0);

            log::info!(
                "[PERF] sync_entities: scope_vars={}, __entities={}, scene_ids={}, __next_id={}, key_range={}..{}",
                scope_var_count,
                entities.len(),
                scene_id_set.len(),
                next_id,
                min_key,
                max_key
            );

            // If scope is unexpectedly large, dump variable names to help debug
            if scope_var_count > 100 {
                let var_names: Vec<&str> = self.scope.iter()
                    .map(|(name, _, _)| name)
                    .collect();
                log::warn!(
                    "[PERF] Large scope detected ({} vars). Names: {:?}",
                    scope_var_count,
                    var_names
                );
            }
        }

        // Collect IDs of entities that should exist
        let mut valid_entity_ids: std::collections::HashSet<EntityId> = std::collections::HashSet::new();

        // Sync each entity
        time_start("sync_entity_props");
        let mut signal_eval_count = 0usize;
        for (_key, value) in entities.iter() {
            let entity_map = match value.clone().try_cast::<rhai::Map>() {
                Some(m) => m,
                None => continue,
            };

            let id = match entity_map.get("__id").and_then(|d| d.as_int().ok()) {
                Some(id) => id as u64,
                None => continue,
            };

            let entity_type = match entity_map.get("__type").and_then(|d| d.clone().into_string().ok()) {
                Some(t) => t,
                None => continue,
            };

            let entity_id = EntityId(id);
            valid_entity_ids.insert(entity_id);

            // Create entity in scene graph if it doesn't exist
            if !self.scene_graph.exists(entity_id) {
                match entity_type.as_str() {
                    "mesh_cube" => {
                        // Manually insert with the same ID
                        self.create_entity_with_id(entity_id, MeshType::Cube);
                    }
                    "mesh_plane" => {
                        self.create_entity_with_id(entity_id, MeshType::Plane);
                    }
                    "mesh_sphere" => {
                        self.create_entity_with_id(entity_id, MeshType::Sphere);
                    }
                    "mesh_asset" => {
                        let asset_id = entity_map.get("__asset_id")
                            .and_then(|d| d.clone().into_string().ok())
                            .unwrap_or_else(|| "unknown".into());
                        self.create_entity_with_id(entity_id, MeshType::Asset(asset_id.to_string()));
                    }
                    "radial_ring" => {
                        // Read ring parameters (these can be Signals, so evaluate them)
                        let radius = entity_map.get("__radius")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        let thickness = entity_map.get("__thickness")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.1);
                        let start_angle = entity_map.get("__start_angle")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.0);
                        let end_angle = entity_map.get("__end_angle")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(std::f32::consts::TAU);
                        let segments = entity_map.get("__segments")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(64) as u32;
                        self.create_entity_with_id(entity_id, MeshType::RadialRing {
                            radius,
                            thickness,
                            start_angle,
                            end_angle,
                            segments,
                        });
                    }
                    "line_strip" | "line_trace" => {
                        let max_points = entity_map.get("__max_points")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(256) as usize;
                        let mode_str = entity_map.get("__mode")
                            .and_then(|d| d.clone().into_string().ok())
                            .unwrap_or_else(|| "line".into());
                        let mode = if mode_str == "points" { LineMode::Points } else { LineMode::Line };
                        self.create_line_with_id(entity_id, max_points, mode);
                    }
                    "group" => {
                        self.create_group_with_id(entity_id);
                    }
                    "point_cloud" => {
                        let count = entity_map.get("__count")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(100) as usize;
                        let spread = entity_map.get("__spread")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        let mode_str = entity_map.get("__mode")
                            .and_then(|d| d.clone().into_string().ok())
                            .unwrap_or_else(|| "uniform".into());
                        let mode = match mode_str.as_str() {
                            "sphere" => PointCloudMode::Sphere,
                            _ => PointCloudMode::Uniform,
                        };
                        let seed = entity_map.get("__seed")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(0) as u64;
                        let point_size = entity_map.get("__point_size")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(2.0);
                        self.create_point_cloud_with_id(entity_id, count, spread, mode, seed, point_size);
                    }
                    "radial_wave" => {
                        let base_radius = entity_map.get("__base_radius")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        let amplitude = entity_map.get("__amplitude")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.5);
                        let wave_frequency = entity_map.get("__wave_frequency")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(4.0);
                        let resolution = entity_map.get("__resolution")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(128) as usize;
                        self.create_radial_wave_with_id(entity_id, base_radius, amplitude, wave_frequency, resolution);
                    }
                    "line_ribbon" => {
                        let max_points = entity_map.get("__max_points")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(256) as usize;
                        let mode_str = entity_map.get("__mode")
                            .and_then(|d| d.clone().into_string().ok())
                            .unwrap_or_else(|| "strip".into());
                        let mode = match mode_str.as_str() {
                            "tube" => RibbonMode::Tube,
                            _ => RibbonMode::Strip,
                        };
                        let width = entity_map.get("__width")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.1);
                        let twist = entity_map.get("__twist")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.0);
                        self.create_ribbon_with_id(entity_id, max_points, mode, width, twist);
                    }
                    _ => continue,
                }
            }

            // Update entity properties from the Map
            if let Some(entity) = self.scene_graph.get_mut(entity_id) {
                // Position
                if let Some(pos) = entity_map.get("position").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                    let transform = entity.transform_mut();
                    transform.position.x = pos
                        .get("x")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                    transform.position.y = pos
                        .get("y")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                    transform.position.z = pos
                        .get("z")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                }

                // Rotation
                if let Some(rot) = entity_map.get("rotation").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                    let transform = entity.transform_mut();
                    transform.rotation.x = rot
                        .get("x")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                    transform.rotation.y = rot
                        .get("y")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                    transform.rotation.z = rot
                        .get("z")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                        .unwrap_or(0.0);
                }

                // Scale (uniform)
                if let Some(scale) = entity_map
                    .get("scale")
                    .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                {
                    let transform = entity.transform_mut();
                    transform.scale.x = scale;
                    transform.scale.y = scale;
                    transform.scale.z = scale;
                }

                // Visible
                if let Some(visible) = entity_map.get("visible").and_then(|d| d.as_bool().ok()) {
                    entity.set_visible(visible);
                }

                // Mesh-specific: sync color, renderMode, wireframeColor, and deformations
                if let SceneEntity::Mesh(mesh) = entity {
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        mesh.color[0] = color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.color[1] = color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.color[2] = color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.color[3] = color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }

                    // Sync renderMode
                    if let Some(mode_str) = entity_map.get("renderMode").and_then(|d| d.clone().into_string().ok()) {
                        mesh.render_mode = match mode_str.as_str() {
                            "wireframe" => RenderMode::Wireframe,
                            "solidWithWireframe" => RenderMode::SolidWithWireframe,
                            _ => RenderMode::Solid,
                        };
                    }

                    // Sync wireframeColor
                    if let Some(wf_color) = entity_map.get("wireframeColor").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        mesh.wireframe_color[0] = wf_color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.wireframe_color[1] = wf_color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.wireframe_color[2] = wf_color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        mesh.wireframe_color[3] = wf_color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }

                    // Sync deformations (with Signal support for numeric params)
                    if let Some(deforms) = entity_map.get("deformations").and_then(|d| d.clone().try_cast::<rhai::Array>()) {
                        mesh.deformations.clear();
                        for deform_dyn in deforms.iter() {
                            if let Some(deform_map) = deform_dyn.clone().try_cast::<rhai::Map>() {
                                if let Some(deformation) = parse_deformation(&deform_map, &mut eval_ctx, &mut frame_cache) {
                                    mesh.deformations.push(deformation);
                                }
                            }
                        }
                    }

                    // Sync material ID
                    if let Some(material_str) = entity_map.get("material").and_then(|d| d.clone().into_string().ok()) {
                        mesh.material_id = Some(material_str.to_string());
                    }

                    // Sync material params
                    if let Some(params_map) = entity_map.get("materialParams").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        mesh.material_params.clear();
                        for (param_name, param_value) in params_map.iter() {
                            if let Some(value) = parse_material_param_value(param_value, &mut eval_ctx, &mut frame_cache) {
                                mesh.material_params.set(param_name.to_string(), value);
                            }
                        }
                    }

                    // Sync lighting properties
                    if let Some(lit) = entity_map.get("lit").and_then(|d| d.as_bool().ok()) {
                        mesh.lit = lit;
                    }
                    if let Some(emissive) = entity_map.get("emissive").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                        mesh.emissive = emissive;
                    }

                    // Sync blob shadow properties
                    if let Some(shadow_map) = entity_map.get("shadow").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        if let Some(enabled) = shadow_map.get("enabled").and_then(|d| d.as_bool().ok()) {
                            mesh.shadow.enabled = enabled;
                        }
                        if let Some(plane_y) = shadow_map.get("plane_y").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.plane_y = plane_y;
                        }
                        if let Some(opacity) = shadow_map.get("opacity").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.opacity = opacity;
                        }
                        if let Some(radius_x) = shadow_map.get("radius_x").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.radius_x = radius_x;
                        }
                        if let Some(radius_z) = shadow_map.get("radius_z").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.radius_z = radius_z;
                        }
                        // Also support single "radius" for uniform shadows
                        if let Some(radius) = shadow_map.get("radius").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.radius_x = radius;
                            mesh.shadow.radius_z = radius;
                        }
                        if let Some(softness) = shadow_map.get("softness").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.softness = softness;
                        }
                        if let Some(offset_x) = shadow_map.get("offset_x").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.offset_x = offset_x;
                        }
                        if let Some(offset_z) = shadow_map.get("offset_z").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                            mesh.shadow.offset_z = offset_z;
                        }
                        // Shadow color
                        if let Some(color_map) = shadow_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                            if let Some(r) = color_map.get("r").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                                mesh.shadow.color[0] = r;
                            }
                            if let Some(g) = color_map.get("g").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                                mesh.shadow.color[1] = g;
                            }
                            if let Some(b) = color_map.get("b").and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache)) {
                                mesh.shadow.color[2] = b;
                            }
                        }
                    }

                    // Update radial ring parameters (can be Signals that change per frame)
                    if matches!(mesh.mesh_type, MeshType::RadialRing { .. }) {
                        let radius = entity_map.get("__radius")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        let thickness = entity_map.get("__thickness")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.1);
                        let start_angle = entity_map.get("__start_angle")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.0);
                        let end_angle = entity_map.get("__end_angle")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(std::f32::consts::TAU);
                        let segments = entity_map.get("__segments")
                            .and_then(|d| d.as_int().ok())
                            .unwrap_or(64) as u32;
                        mesh.mesh_type = MeshType::RadialRing {
                            radius,
                            thickness,
                            start_angle,
                            end_angle,
                            segments,
                        };
                    }
                }

                // Line-specific: sync points
                if let SceneEntity::Line(line) = entity {
                    // Sync color
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        line.color[0] = color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.0);
                        line.color[1] = color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        line.color[2] = color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(0.0);
                        line.color[3] = color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }

                    // Check if this is a line_trace (Signal-driven) or line_strip (manual push)
                    if entity_type == "line_trace" {
                        // line.trace - evaluate signal and push a point each frame
                        if let Some(signal) = entity_map.get("__signal").and_then(|d| d.clone().try_cast::<Signal>()) {
                            let x_scale = entity_map.get("__x_scale")
                                .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                                .unwrap_or(1.0);
                            let y_scale = entity_map.get("__y_scale")
                                .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                                .unwrap_or(1.0);
                            let y_offset = entity_map.get("__y_offset")
                                .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                                .unwrap_or(0.0);

                            // Evaluate the signal at current time
                            let value = if let Some(cached) = frame_cache.get(&signal.id) {
                                *cached
                            } else {
                                let v = signal.evaluate(&mut eval_ctx);
                                frame_cache.insert(signal.id, v);
                                v
                            };

                            // Push point: X = time * x_scale, Y = (value + y_offset) * y_scale
                            let x = eval_ctx.time * x_scale;
                            let y = (value + y_offset) * y_scale;
                            line.push(x, y);
                        }
                    } else {
                        // line.strip - sync points from manual push() calls
                        if let Some(points) = entity_map.get("__points").and_then(|d| d.clone().try_cast::<rhai::Array>()) {
                            // Clear existing and repopulate
                            line.clear();
                            for point_dyn in points.iter() {
                                if let Some(point_map) = point_dyn.clone().try_cast::<rhai::Map>() {
                                    let x = point_map
                                        .get("x")
                                        .and_then(|d| {
                                            d.as_float()
                                                .ok()
                                                .map(|f| f as f32)
                                                .or_else(|| d.as_int().ok().map(|i| i as f32))
                                        })
                                        .unwrap_or(0.0);
                                    let y = point_map
                                        .get("y")
                                        .and_then(|d| {
                                            d.as_float()
                                                .ok()
                                                .map(|f| f as f32)
                                                .or_else(|| d.as_int().ok().map(|i| i as f32))
                                        })
                                        .unwrap_or(0.0);
                                    line.push(x, y);
                                }
                            }
                        }
                    }
                }

                // PointCloud-specific: sync color and point_size
                if let SceneEntity::PointCloud(cloud) = entity {
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        cloud.color[0] = color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        cloud.color[1] = color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        cloud.color[2] = color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        cloud.color[3] = color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }
                    if let Some(point_size) = entity_map.get("__point_size")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        cloud.point_size = point_size;
                    }
                }

                // RadialWave-specific: sync color, parameters, and signal value
                if let SceneEntity::RadialWave(wave) = entity {
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        wave.color[0] = color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        wave.color[1] = color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        wave.color[2] = color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        wave.color[3] = color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }
                    // Update wave parameters (support Signal | f32)
                    if let Some(base_radius) = entity_map.get("__base_radius")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        wave.base_radius = base_radius;
                    }
                    if let Some(amplitude) = entity_map.get("__amplitude")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        wave.amplitude = amplitude;
                    }
                    if let Some(wave_frequency) = entity_map.get("__wave_frequency")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        wave.wave_frequency = wave_frequency;
                    }
                    // Evaluate the signal and update signal_value
                    if let Some(signal) = entity_map.get("__signal").and_then(|d| d.clone().try_cast::<Signal>()) {
                        let value = if let Some(cached) = frame_cache.get(&signal.id) {
                            *cached
                        } else {
                            let v = signal.evaluate(&mut eval_ctx);
                            frame_cache.insert(signal.id, v);
                            v
                        };
                        wave.signal_value = value;
                    }
                }

                // Ribbon-specific: sync color, update parameters, evaluate signal and push point
                if let SceneEntity::Ribbon(ribbon) = entity {
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        ribbon.color[0] = color
                            .get("r")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        ribbon.color[1] = color
                            .get("g")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        ribbon.color[2] = color
                            .get("b")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                        ribbon.color[3] = color
                            .get("a")
                            .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                            .unwrap_or(1.0);
                    }
                    // Update ribbon parameters
                    if let Some(width) = entity_map.get("__width")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        ribbon.width = width;
                    }
                    if let Some(twist) = entity_map.get("__twist")
                        .and_then(|d| eval_f32_opt(d, &mut eval_ctx, &mut frame_cache))
                    {
                        ribbon.twist = twist;
                    }
                    // Check for clear flag
                    if entity_map.get("__clear").and_then(|d| d.as_bool().ok()).unwrap_or(false) {
                        ribbon.clear();
                    }
                    // Evaluate signal and push point (x = time, y = signal value)
                    if let Some(signal) = entity_map.get("__signal").and_then(|d| d.clone().try_cast::<Signal>()) {
                        let value = if let Some(cached) = frame_cache.get(&signal.id) {
                            *cached
                        } else {
                            let v = signal.evaluate(&mut eval_ctx);
                            frame_cache.insert(signal.id, v);
                            v
                        };
                        // Push point with time on X and signal value on Y
                        ribbon.push(eval_ctx.time, value);
                    }
                }
            }

            // Sync parent-child relationships
            if let Some(parent_id_dyn) = entity_map.get("__parent_id") {
                if let Ok(parent_id_val) = parent_id_dyn.as_int() {
                    let parent_id = EntityId(parent_id_val as u64);
                    self.scene_graph.set_parent(entity_id, parent_id);
                } else {
                    // No parent (unit/empty value)
                    self.scene_graph.clear_parent(entity_id);
                }
            } else {
                // No __parent_id field means no parent
                self.scene_graph.clear_parent(entity_id);
            }

            // Add/remove from scene based on scene_ids
            if scene_id_set.contains(&(id as i64)) {
                self.scene_graph.add_to_scene(entity_id);
            } else {
                self.scene_graph.remove_from_scene(entity_id);
            }
        }
        time_end("sync_entity_props");

        // Log signal evaluation count periodically
        if should_log_collections() {
            log::info!(
                "[PERF] sync_entities completed: signals_cached={}",
                frame_cache.len()
            );
        }

        // Remove entities from scene graph that are no longer in __entities
        let entity_ids_to_remove: Vec<EntityId> = self.scene_graph
            .scene_entities()
            .map(|(id, _)| id)
            .filter(|id| !valid_entity_ids.contains(id))
            .collect();

        for entity_id in entity_ids_to_remove {
            self.scene_graph.entities.remove(&entity_id);
        }

        // Sync post-processing effects from scope
        time_start("sync_post_effects");
        self.sync_post_effects_from_scope(&mut eval_ctx, &mut frame_cache);
        time_end("sync_post_effects");

        // Sync feedback configuration from scope
        time_start("sync_feedback");
        self.sync_feedback_from_scope(&mut eval_ctx, &mut frame_cache);
        time_end("sync_feedback");

        // Sync camera configuration from scope
        time_start("sync_camera");
        let (camera_config, camera_uniforms) = sync_camera_from_scope(&self.scope, &mut eval_ctx);
        self.camera_config = camera_config;
        self.camera_uniforms = camera_uniforms;
        time_end("sync_camera");

        // Sync lighting configuration from scope
        time_start("sync_lighting");
        let (lighting_config, lighting_uniforms) = sync_lighting_from_scope(&self.scope, &mut eval_ctx);
        self.lighting_config = lighting_config;
        self.lighting_uniforms = lighting_uniforms;
        time_end("sync_lighting");

        // Sync particle systems from scope
        time_start("sync_particles");
        self.sync_particle_systems_from_scope(&mut eval_ctx, &scene_id_set);
        time_end("sync_particles");

        drop(eval_ctx);
        self.signal_state = signal_state;
        self.signal_statistics = signal_statistics;
    }

    /// Sync post-processing effects from script scope to the post_chain.
    fn sync_post_effects_from_scope(
        &mut self,
        eval_ctx: &mut EvalContext<'_>,
        frame_cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) {
        // Get effects registry from scope
        let mut post_effects = match self.scope.get_value::<rhai::Map>("__post_effects") {
            Some(e) => e,
            None => return,
        };

        // Get chain from scope
        let chain = match self.scope.get_value::<rhai::Array>("__post_chain") {
            Some(a) => a,
            None => return,
        };

        // Scan scope variables for effect maps that may have been modified
        // (similar to how entities are handled)
        time_start("post_effects_scope_scan");
        let scope_len = self.scope.len();
        for (name, _is_const, value) in self.scope.iter() {
            // Skip internal variables
            if name.starts_with("__") || name == "fx" || name == "post" || name == "feedback" {
                continue;
            }

            // Check if this is an effect Map
            if let Some(scope_effect_map) = value.clone().try_cast::<rhai::Map>() {
                // Check if it's a post_effect type
                if scope_effect_map.get("__type").and_then(|d| d.clone().into_string().ok()).as_deref() == Some("post_effect") {
                    if let Some(id_dyn) = scope_effect_map.get("__id") {
                        if let Ok(id) = id_dyn.as_int() {
                            let key = format!("{}", id);
                            // Update the effect registry with this potentially modified copy
                            post_effects.insert(key.into(), Dynamic::from(scope_effect_map));
                        }
                    }
                }
            }
        }
        time_end("post_effects_scope_scan");

        // Log scope size periodically - this is likely the cause of performance degradation
        if should_log_collections() {
            log::info!(
                "[PERF] sync_post_effects: scope_len={}, post_effects={}, chain_len={}",
                scope_len,
                post_effects.len(),
                chain.len()
            );

            // If scope is large, log what types of variables are in it
            if scope_len > 50 {
                let mut type_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
                for (_name, _is_const, value) in self.scope.iter() {
                    let type_name = value.type_name().to_string();
                    *type_counts.entry(type_name).or_insert(0) += 1;
                }
                log::warn!(
                    "[PERF] Scope variable types: {:?}",
                    type_counts
                );
            }
        }

        // Update scope with merged effects
        self.scope.set_value("__post_effects", post_effects.clone());

        // Clear existing chain and rebuild
        self.post_chain.clear();

        for id_dyn in chain.iter() {
            let id = match id_dyn.as_int() {
                Ok(i) => i,
                Err(_) => continue,
            };
            let key = format!("{}", id);
            let effect_map = match post_effects.get(key.as_str()).and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                Some(m) => m,
                None => continue,
            };

            // Get effect type
            let effect_id = match effect_map.get("__effect_id").and_then(|d| d.clone().into_string().ok()) {
                Some(s) => s.to_string(),
                None => continue,
            };

            // Create effect instance
            let mut instance = PostEffectInstance::new(&effect_id);

            // Check enabled flag
            if let Some(enabled) = effect_map.get("enabled").and_then(|d| d.as_bool().ok()) {
                instance.enabled = enabled;
            }

            // Sync effect parameters based on effect type
            match effect_id.as_str() {
                "bloom" => {
                    if let Some(v) = effect_map.get("threshold").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("threshold", v);
                    }
                    if let Some(v) = effect_map.get("intensity").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("intensity", v);
                    }
                    if let Some(v) = effect_map.get("radius").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("radius", v);
                    }
                    if let Some(v) = effect_map.get("downsample").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("downsample", v);
                    }
                }
                "color_grade" => {
                    if let Some(v) = effect_map.get("brightness").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("brightness", v);
                    }
                    if let Some(v) = effect_map.get("contrast").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("contrast", v);
                    }
                    if let Some(v) = effect_map.get("saturation").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("saturation", v);
                    }
                    if let Some(v) = effect_map.get("gamma").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("gamma", v);
                    }
                    if let Some(tint) = effect_map.get("tint").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let r = Self::eval_color_channel(tint.get("r"), 1.0, eval_ctx, frame_cache);
                        let g = Self::eval_color_channel(tint.get("g"), 1.0, eval_ctx, frame_cache);
                        let b = Self::eval_color_channel(tint.get("b"), 1.0, eval_ctx, frame_cache);
                        let a = Self::eval_color_channel(tint.get("a"), 1.0, eval_ctx, frame_cache);
                        instance.set_param("tint", EffectParamValue::Vec4([r, g, b, a]));
                    }
                }
                "vignette" => {
                    if let Some(v) = effect_map.get("intensity").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("intensity", v);
                    }
                    if let Some(v) = effect_map.get("smoothness").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("smoothness", v);
                    }
                    if let Some(color) = effect_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let r = Self::eval_color_channel(color.get("r"), 0.0, eval_ctx, frame_cache);
                        let g = Self::eval_color_channel(color.get("g"), 0.0, eval_ctx, frame_cache);
                        let b = Self::eval_color_channel(color.get("b"), 0.0, eval_ctx, frame_cache);
                        let a = Self::eval_color_channel(color.get("a"), 1.0, eval_ctx, frame_cache);
                        instance.set_param("color", EffectParamValue::Vec4([r, g, b, a]));
                    }
                }
                "distortion" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    if let Some(center) = effect_map.get("center").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let x = Self::eval_color_channel(center.get("x"), 0.5, eval_ctx, frame_cache);
                        let y = Self::eval_color_channel(center.get("y"), 0.5, eval_ctx, frame_cache);
                        instance.set_param("center", EffectParamValue::Vec2([x, y]));
                    }
                }
                "zoom_wrap" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    // wrap_mode: 0 = repeat, 1 = mirror
                    if let Some(mode) = effect_map.get("wrap_mode") {
                        let mode_val = if let Ok(s) = mode.clone().into_string() {
                            match s.as_str() {
                                "mirror" => 1.0,
                                _ => 0.0, // default to repeat
                            }
                        } else if let Ok(f) = mode.as_float() {
                            f as f32
                        } else if let Ok(i) = mode.as_int() {
                            i as f32
                        } else {
                            0.0
                        };
                        instance.set_param("wrap_mode", EffectParamValue::Float(mode_val));
                    }
                    if let Some(center) = effect_map.get("center").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let x = Self::eval_color_channel(center.get("x"), 0.5, eval_ctx, frame_cache);
                        let y = Self::eval_color_channel(center.get("y"), 0.5, eval_ctx, frame_cache);
                        instance.set_param("center", EffectParamValue::Vec2([x, y]));
                    }
                }
                "radial_blur" => {
                    if let Some(v) = effect_map.get("strength").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("strength", v);
                    }
                    if let Some(v) = effect_map.get("samples").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("samples", v);
                    }
                    if let Some(center) = effect_map.get("center").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let x = Self::eval_color_channel(center.get("x"), 0.5, eval_ctx, frame_cache);
                        let y = Self::eval_color_channel(center.get("y"), 0.5, eval_ctx, frame_cache);
                        instance.set_param("center", EffectParamValue::Vec2([x, y]));
                    }
                }
                "directional_blur" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    if let Some(v) = effect_map.get("angle").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("angle", v);
                    }
                    if let Some(v) = effect_map.get("samples").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("samples", v);
                    }
                }
                "chromatic_aberration" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    if let Some(v) = effect_map.get("angle").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("angle", v);
                    }
                }
                "grain" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    if let Some(v) = effect_map.get("scale").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("scale", v);
                    }
                    if let Some(v) = effect_map.get("seed").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("seed", v);
                    }
                }
                _ => {}
            }

            self.post_chain.add(instance);
        }
    }

    /// Evaluate a post effect parameter (can be a constant or Signal).
    fn eval_effect_param(
        value: &rhai::Dynamic,
        ctx: &mut EvalContext<'_>,
        cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) -> Option<EffectParamValue> {
        if let Ok(f) = value.as_float() {
            return Some(EffectParamValue::Float(f as f32));
        }
        if let Ok(i) = value.as_int() {
            return Some(EffectParamValue::Float(i as f32));
        }
        if let Some(signal) = value.clone().try_cast::<Signal>() {
            if let Some(v) = cache.get(&signal.id) {
                return Some(EffectParamValue::Float(*v));
            }
            let v = signal.evaluate(ctx);
            cache.insert(signal.id, v);
            return Some(EffectParamValue::Float(v));
        }
        None
    }

    /// Evaluate a color/vec channel value (can be f32, i64, or Signal).
    fn eval_color_channel(
        value: Option<&rhai::Dynamic>,
        default: f32,
        ctx: &mut EvalContext<'_>,
        cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) -> f32 {
        let value = match value {
            Some(v) => v,
            None => return default,
        };

        if let Ok(f) = value.as_float() {
            return f as f32;
        }
        if let Ok(i) = value.as_int() {
            return i as f32;
        }
        if let Some(signal) = value.clone().try_cast::<Signal>() {
            if let Some(v) = cache.get(&signal.id) {
                return *v;
            }
            let v = signal.evaluate(ctx);
            cache.insert(signal.id, v);
            return v;
        }
        default
    }

    /// Sync feedback configuration from the static storage.
    ///
    /// This also evaluates any Signal parameters in the feedback config,
    /// producing the final FeedbackUniforms for GPU upload.
    fn sync_feedback_from_scope(
        &mut self,
        eval_ctx: &mut EvalContext<'_>,
        _frame_cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) {
        use crate::feedback::FeedbackConfig;

        // Get the active feedback config from thread-local storage
        // (set by native __feedback_enable function)
        // With the new fluent builder API, the config is already a FeedbackConfig type.
        let config = PENDING_FEEDBACK_CONFIG.with(|cell| {
            cell.borrow().clone()
        });

        self.feedback_config = config.unwrap_or_else(FeedbackConfig::default);

        // Evaluate any Signal parameters to produce the final uniforms for GPU.
        // This resolves signal graphs to their current f32 values.
        self.feedback_uniforms = self.feedback_config.to_uniforms(eval_ctx);
    }

    /// Sync particle systems from script scope.
    ///
    /// Extracts ParticleSystemHandle objects from the `__particle_systems` scope variable,
    /// updates them with any property changes, and updates the particle_systems storage.
    fn sync_particle_systems_from_scope(
        &mut self,
        eval_ctx: &mut EvalContext<'_>,
        scene_ids: &std::collections::HashSet<i64>,
    ) {
        use crate::particle_rhai::ParticleSystemHandle;
        use crate::particle_eval::{update_particle_system, ParticleEvalContext};

        // Get the __particle_systems Map from scope
        let particle_systems_map = match self.scope.get_value::<rhai::Map>("__particle_systems") {
            Some(m) => m,
            None => return,
        };

        // Build evaluation context for particles
        let current_bpm = 120.0; // Default BPM, could be passed from musical_time
        let secs_per_beat = 60.0 / current_bpm;
        let particle_ctx = ParticleEvalContext {
            current_time_secs: eval_ctx.time,
            current_beat: eval_ctx.time / secs_per_beat,
            secs_per_beat,
            dt: eval_ctx.dt,
            dt_beats: eval_ctx.dt / secs_per_beat,
        };

        // Track which IDs are still valid
        let mut seen_ids: std::collections::HashSet<u64> = std::collections::HashSet::new();

        // Process each particle system handle in the scope
        for (_key, value) in particle_systems_map.iter() {
            // Try to extract the ParticleSystemHandle
            let handle = match value.clone().try_cast::<ParticleSystemHandle>() {
                Some(h) => h,
                None => continue,
            };

            // Get the entity ID
            let entity_id = match handle.entity_id {
                Some(id) => id,
                None => continue, // Not added to scene yet
            };

            // Check if this system is in the scene
            if !scene_ids.contains(&(entity_id as i64)) {
                continue;
            }

            seen_ids.insert(entity_id);

            // Update or insert the particle system
            if let Some(system) = self.particle_systems.get_mut(&entity_id) {
                // Update existing system's properties from handle
                system.transform = handle.system.transform.clone();
                system.visible = handle.system.visible;
                system.config.base_color = handle.system.config.base_color;
                system.config.base_scale = handle.system.config.base_scale;
            } else {
                // Insert new system
                self.particle_systems.insert(entity_id, handle.system.clone());
            }

            // Update the particle system (spawn/cull particles)
            if let Some(system) = self.particle_systems.get_mut(&entity_id) {
                if system.visible {
                    update_particle_system(system, &particle_ctx);
                }
            }
        }

        // Remove particle systems that are no longer in the scene
        self.particle_systems.retain(|id, _| seen_ids.contains(id));
    }

    /// Create an entity with a specific ID (for syncing from script).
    fn create_entity_with_id(&mut self, id: EntityId, mesh_type: MeshType) {
        use crate::scene_graph::{MeshInstance, SceneEntity};

        let mesh = MeshInstance::new(mesh_type);
        // Directly insert into scene graph's internal storage
        // We need to access the internal HashMap, so we'll use a different approach
        // Actually, we should modify SceneGraph to support this...

        // For now, let's create normally and map IDs later
        // This is a hack but works for MVP
        self.scene_graph.entities.insert(id, SceneEntity::Mesh(mesh));
    }

    /// Create a line with a specific ID (for syncing from script).
    fn create_line_with_id(&mut self, id: EntityId, max_points: usize, mode: LineMode) {
        use crate::scene_graph::SceneEntity;

        let line = SceneLineStrip::new(max_points, mode);
        self.scene_graph.entities.insert(id, SceneEntity::Line(line));
    }

    /// Create a group with a specific ID (for syncing from script).
    fn create_group_with_id(&mut self, id: EntityId) {
        use crate::scene_graph::{Group, SceneEntity};

        let group = Group::new();
        self.scene_graph.entities.insert(id, SceneEntity::Group(group));
    }

    /// Create a point cloud with a specific ID (for syncing from script).
    fn create_point_cloud_with_id(
        &mut self,
        id: EntityId,
        count: usize,
        spread: f32,
        mode: PointCloudMode,
        seed: u64,
        point_size: f32,
    ) {
        use crate::scene_graph::SceneEntity;

        let cloud = crate::scene_graph::PointCloud::new(count, spread, mode, seed, point_size);
        self.scene_graph.entities.insert(id, SceneEntity::PointCloud(cloud));
    }

    fn create_radial_wave_with_id(
        &mut self,
        id: EntityId,
        base_radius: f32,
        amplitude: f32,
        wave_frequency: f32,
        resolution: usize,
    ) {
        use crate::scene_graph::SceneEntity;

        let wave = RadialWave::new(base_radius, amplitude, wave_frequency, resolution);
        self.scene_graph.entities.insert(id, SceneEntity::RadialWave(wave));
    }

    fn create_ribbon_with_id(
        &mut self,
        id: EntityId,
        max_points: usize,
        mode: RibbonMode,
        width: f32,
        twist: f32,
    ) {
        use crate::scene_graph::SceneEntity;

        let ribbon = Ribbon::new(max_points, mode, width, twist);
        self.scene_graph.entities.insert(id, SceneEntity::Ribbon(ribbon));
    }

    /// Check if a script is loaded.
    pub fn has_script(&self) -> bool {
        self.ast.is_some()
    }

    /// Drain and return all pending diagnostics.
    pub fn take_diagnostics(&mut self) -> Vec<ScriptDiagnostic> {
        std::mem::take(&mut self.diagnostics)
    }

    /// Collect all signals that require statistics for normalization.
    ///
    /// This traverses the entity properties and feedback config to find Signal
    /// values that use Global or Robust normalization. Returns a list of
    /// (source_signal_id, source_signal) pairs for the signals that need stats.
    pub fn collect_signals_requiring_statistics(&self) -> Vec<(crate::signal::SignalId, Signal)> {
        let mut results = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        // Helper to extract signals from a Dynamic value
        fn extract_signal(value: &Dynamic) -> Option<Signal> {
            value.clone().try_cast::<Signal>()
        }

        // Helper to collect normalise sources from a signal
        fn collect_from_signal(
            signal: &Signal,
            results: &mut Vec<(crate::signal::SignalId, Signal)>,
            seen_ids: &mut std::collections::HashSet<crate::signal::SignalId>,
        ) {
            if let Some(sources) = signal.find_normalise_sources() {
                for source in sources {
                    if seen_ids.insert(source.id) {
                        results.push((source.id, source));
                    }
                }
            }
        }

        // Helper to recursively scan a map for Signal values
        fn scan_map(
            map: &rhai::Map,
            results: &mut Vec<(crate::signal::SignalId, Signal)>,
            seen_ids: &mut std::collections::HashSet<crate::signal::SignalId>,
        ) {
            for (_key, value) in map.iter() {
                if let Some(signal) = extract_signal(value) {
                    collect_from_signal(&signal, results, seen_ids);
                } else if let Some(nested_map) = value.clone().try_cast::<rhai::Map>() {
                    scan_map(&nested_map, results, seen_ids);
                }
            }
        }

        // Scan __entities map
        if let Some(entities) = self.scope.get_value::<rhai::Map>("__entities") {
            scan_map(&entities, &mut results, &mut seen_ids);
        }

        // Scan __post_effects map
        if let Some(post_effects) = self.scope.get_value::<rhai::Map>("__post_effects") {
            scan_map(&post_effects, &mut results, &mut seen_ids);
        }

        // Scan feedback config if it has signal params
        PENDING_FEEDBACK_CONFIG.with(|cell| {
            if let Some(config) = cell.borrow().as_ref() {
                for signal in config.collect_signals() {
                    collect_from_signal(&signal, &mut results, &mut seen_ids);
                }
            }
        });

        log::info!(
            "Collected {} signals requiring statistics for normalization",
            results.len()
        );

        results
    }

    /// Pre-compute statistics for signals that require normalization.
    ///
    /// This should be called after script init and before the main analysis loop.
    /// It samples each source signal across the track duration and computes
    /// the statistics needed for Global and Robust normalization.
    pub fn precompute_statistics(
        &mut self,
        signals_needing_stats: &[(crate::signal::SignalId, Signal)],
        input_signals: &SignalMap,
        band_signals: &BandSignalMap,
        stem_signals: &BandSignalMap,
        musical_time: Option<&MusicalTimeStructure>,
        duration: f32,
        time_step: f32,
    ) {
        use crate::signal_stats::SignalStatistics;

        let step_count = ((duration / time_step).ceil() as usize).max(1);

        for (source_id, source_signal) in signals_needing_stats {
            let mut samples = Vec::with_capacity(step_count);

            // Create a temporary state for evaluation (without caching to get true values)
            let mut temp_state = SignalState::new();
            let empty_stats = crate::signal_stats::StatisticsCache::new();

            let empty_custom_signals: SignalMap = HashMap::new();

            for step in 0..step_count {
                let time = step as f32 * time_step;

                let mut ctx = EvalContext::new(
                    time,
                    time_step,
                    step as u64,
                    musical_time,
                    input_signals,
                    band_signals,
                    stem_signals,
                    &empty_custom_signals,
                    &empty_stats,
                    &mut temp_state,
                    Some(duration), // track_duration
                );

                // Evaluate the source signal (before normalization)
                let value = source_signal.evaluate(&mut ctx);
                if value.is_finite() {
                    samples.push(value);
                }
            }

            // Compute statistics from samples
            let stats = SignalStatistics::from_samples(&samples);

            log::debug!(
                "Computed statistics for signal {:?}: min={:.3}, max={:.3}, p5={:.3}, p95={:.3}, samples={}",
                source_id,
                stats.min,
                stats.max,
                stats.percentile_5,
                stats.percentile_95,
                stats.sample_count
            );

            // Store in the engine's statistics cache
            self.signal_statistics.insert(*source_id, stats);
        }

        log::info!(
            "Pre-computed statistics for {} signals",
            signals_needing_stats.len()
        );
    }

    // === Signal Explorer API ===

    /// Get all Signal variables - from both scope and parsed declarations.
    /// Returns a list of ScriptSignalInfo with variable names and locations.
    ///
    /// Note: Line/column information is approximate (we don't have exact source locations
    /// for variable assignments, so we return 0 for both).
    pub fn get_signal_variables(&self) -> Vec<ScriptSignalInfo> {
        let mut signals = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        // First, get signals from global scope
        for (name, _is_const, value) in self.scope.iter() {
            // Skip internal variables
            if name.starts_with("__") {
                continue;
            }

            // Skip namespace objects
            if name == "mesh"
                || name == "line"
                || name == "scene"
                || name == "deform"
                || name == "log"
                || name == "dbg"
                || name == "gen"
                || name == "time"
                || name == "inputs"
                || name == "fx"
                || name == "post"
                || name == "feedback"
                || name == "particles"
            {
                continue;
            }

            // Check if this is a Signal type by trying to clone-cast it
            if value.clone().try_cast::<Signal>().is_some() {
                seen_names.insert(name.to_string());
                signals.push(ScriptSignalInfo {
                    name: name.to_string(),
                    line: 0,   // Line info not available from scope
                    column: 0, // Column info not available from scope
                });
            }
        }

        // Also include parsed signal declarations (from init() or other local scopes)
        for name in self.parsed_signal_decls.keys() {
            if !seen_names.contains(name) {
                signals.push(ScriptSignalInfo {
                    name: name.clone(),
                    line: 0,
                    column: 0,
                });
            }
        }

        // Also include already-evaluated signals
        for name in self.evaluated_signals.keys() {
            if !seen_names.contains(name) && !self.parsed_signal_decls.contains_key(name) {
                signals.push(ScriptSignalInfo {
                    name: name.clone(),
                    line: 0,
                    column: 0,
                });
            }
        }

        signals
    }

    /// Get a Signal variable by name.
    /// Checks scope first, then evaluated cache, then evaluates parsed expression.
    /// Returns None if the variable doesn't exist or isn't a Signal.
    pub fn get_signal(&mut self, name: &str) -> Option<Signal> {
        // First check scope
        if let Some(signal) = self.scope.get_value::<Signal>(name) {
            return Some(signal);
        }

        // Check evaluated cache
        if let Some(signal) = self.evaluated_signals.get(name) {
            return Some(signal.clone());
        }

        // Try to evaluate from parsed declaration
        if let Some(expr) = self.parsed_signal_decls.get(name).cloned() {
            if let Some(signal) = self.evaluate_signal_expression(&expr) {
                self.evaluated_signals.insert(name.to_string(), signal.clone());
                return Some(signal);
            }
        }

        None
    }

    /// Evaluate a signal expression string and return the Signal.
    fn evaluate_signal_expression(&mut self, expr: &str) -> Option<Signal> {
        let ast = self.ast.as_ref()?;

        // Create a mini-script that returns the expression
        let eval_script = format!("{{ {} }}", expr);

        match self.engine.compile(&eval_script) {
            Ok(eval_ast) => {
                // Merge with main AST to access the same scope/definitions
                let merged = ast.clone().merge(&eval_ast);
                match self.engine.eval_ast_with_scope::<Dynamic>(&mut self.scope, &merged) {
                    Ok(result) => result.try_cast::<Signal>(),
                    Err(e) => {
                        log::debug!("Failed to evaluate signal expression '{}': {}", expr, e);
                        None
                    }
                }
            }
            Err(e) => {
                log::debug!("Failed to compile signal expression '{}': {}", expr, e);
                None
            }
        }
    }

    /// Check if a Signal variable exists (in scope or as parsed declaration).
    pub fn has_signal(&mut self, name: &str) -> bool {
        // Check scope
        if self.scope.get_value::<Signal>(name).is_some() {
            return true;
        }
        // Check evaluated cache
        if self.evaluated_signals.contains_key(name) {
            return true;
        }
        // Check parsed declarations
        self.parsed_signal_decls.contains_key(name)
    }

    /// Analyze a signal chain with localized sampling.
    ///
    /// - `signal_name`: Name of the signal variable in the scope
    /// - `center_time`: Time to center the analysis window around (seconds)
    /// - `window_beats`: Number of beats to sample before/after center
    /// - `sample_count`: Number of samples to take
    /// - `input_signals`: Input signal buffers
    /// - `band_signals`: Band-scoped signal buffers
    /// - `musical_time`: Musical time structure for beat conversion
    ///
    /// Returns a SignalChainAnalysis with steps and samples, or an error string.
    pub fn analyze_signal_chain(
        &mut self,
        signal_name: &str,
        center_time: f32,
        window_beats: f32,
        sample_count: usize,
        input_signals: &SignalMap,
        band_signals: &BandSignalMap,
        stem_signals: &BandSignalMap,
        musical_time: Option<&MusicalTimeStructure>,
    ) -> Result<SignalChainAnalysis, String> {
        let signal = self
            .get_signal(signal_name)
            .ok_or_else(|| format!("Signal '{}' not found in scope", signal_name))?;

        let analysis = sample_signal_chain(
            &signal,
            center_time,
            window_beats,
            sample_count,
            input_signals,
            band_signals,
            stem_signals,
            &self.signal_statistics,
            &mut self.signal_state,
            musical_time,
        );

        Ok(analysis)
    }
}

impl Default for ScriptEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse a Deformation from a Rhai Map.
fn parse_deformation(
    deform_map: &rhai::Map,
    ctx: &mut crate::signal_eval::EvalContext<'_>,
    cache: &mut std::collections::HashMap<crate::signal::SignalId, f32>,
) -> Option<Deformation> {
    use crate::signal::Signal;

    // Helper to evaluate a numeric value that might be a Signal
    fn eval_f32(
        value: &rhai::Dynamic,
        default: f32,
        ctx: &mut crate::signal_eval::EvalContext<'_>,
        cache: &mut std::collections::HashMap<crate::signal::SignalId, f32>,
    ) -> f32 {
        if let Ok(f) = value.as_float() {
            return f as f32;
        }
        if let Ok(i) = value.as_int() {
            return i as f32;
        }
        if let Some(signal) = value.clone().try_cast::<Signal>() {
            if let Some(v) = cache.get(&signal.id) {
                return *v;
            }
            let v = signal.evaluate(ctx);
            cache.insert(signal.id, v);
            return v;
        }
        default
    }

    let deform_type = deform_map.get("__type")
        .and_then(|d| d.clone().into_string().ok())?;

    match deform_type.as_str() {
        "deform_twist" => {
            let axis = deform_map.get("axis")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::Y);
            let amount = deform_map.get("amount")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            let center = deform_map.get("center")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            Some(Deformation::Twist { axis, amount, center })
        }
        "deform_bend" => {
            let axis = deform_map.get("axis")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::Y);
            let amount = deform_map.get("amount")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            let center = deform_map.get("center")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            Some(Deformation::Bend { axis, amount, center })
        }
        "deform_wave" => {
            let axis = deform_map.get("axis")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::X);
            let direction = deform_map.get("direction")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::Y);
            let amplitude = deform_map.get("amplitude")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            let frequency = deform_map.get("frequency")
                .map(|d| eval_f32(d, 1.0, ctx, cache))
                .unwrap_or(1.0);
            let phase = deform_map.get("phase")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            Some(Deformation::Wave { axis, direction, amplitude, frequency, phase })
        }
        "deform_noise" => {
            let scale = deform_map.get("scale")
                .map(|d| eval_f32(d, 1.0, ctx, cache))
                .unwrap_or(1.0);
            let amplitude = deform_map.get("amplitude")
                .map(|d| eval_f32(d, 0.0, ctx, cache))
                .unwrap_or(0.0);
            let seed = deform_map.get("seed")
                .and_then(|d| d.as_int().ok())
                .unwrap_or(0) as u32;
            Some(Deformation::Noise { scale, amplitude, seed })
        }
        _ => None,
    }
}

/// Parse a material parameter value from a Rhai Dynamic.
/// Supports floats, ints, Signals, color maps, and vec3 maps.
fn parse_material_param_value(
    value: &rhai::Dynamic,
    ctx: &mut crate::signal_eval::EvalContext<'_>,
    cache: &mut std::collections::HashMap<crate::signal::SignalId, f32>,
) -> Option<crate::material::ParamValue> {
    use crate::material::ParamValue;
    use crate::signal::Signal;

    // Try as float
    if let Ok(f) = value.as_float() {
        return Some(ParamValue::Float(f as f32));
    }

    // Try as int
    if let Ok(i) = value.as_int() {
        return Some(ParamValue::Float(i as f32));
    }

    // Try as Signal
    if let Some(signal) = value.clone().try_cast::<Signal>() {
        let v = if let Some(cached) = cache.get(&signal.id) {
            *cached
        } else {
            let v = signal.evaluate(ctx);
            cache.insert(signal.id, v);
            v
        };
        return Some(ParamValue::Float(v));
    }

    // Try as color/vec map
    if let Some(map) = value.clone().try_cast::<rhai::Map>() {
        // Check if it's a color (has r component)
        if map.contains_key("r") {
            let r = map.get("r").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(1.0);
            let g = map.get("g").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(1.0);
            let b = map.get("b").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(1.0);
            let a = map.get("a").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(1.0);
            return Some(ParamValue::Vec4([r, g, b, a]));
        }
        // Check if it's a vec (has x component)
        if map.contains_key("x") {
            let x = map.get("x").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(0.0);
            let y = map.get("y").and_then(|d| eval_or_signal_f32(d, ctx, cache)).unwrap_or(0.0);
            let z = map.get("z").and_then(|d| eval_or_signal_f32(d, ctx, cache));
            let w = map.get("w").and_then(|d| eval_or_signal_f32(d, ctx, cache));

            match (z, w) {
                (Some(z), Some(w)) => return Some(ParamValue::Vec4([x, y, z, w])),
                (Some(z), None) => return Some(ParamValue::Vec3([x, y, z])),
                _ => return Some(ParamValue::Vec2([x, y])),
            }
        }
    }

    None
}

/// Helper to evaluate a Dynamic as f32, supporting floats, ints, and Signals.
fn eval_or_signal_f32(
    value: &rhai::Dynamic,
    ctx: &mut crate::signal_eval::EvalContext<'_>,
    cache: &mut std::collections::HashMap<crate::signal::SignalId, f32>,
) -> Option<f32> {
    use crate::signal::Signal;

    if let Ok(f) = value.as_float() {
        return Some(f as f32);
    }
    if let Ok(i) = value.as_int() {
        return Some(i as f32);
    }
    if let Some(signal) = value.clone().try_cast::<Signal>() {
        if let Some(v) = cache.get(&signal.id) {
            return Some(*v);
        }
        let v = signal.evaluate(ctx);
        cache.insert(signal.id, v);
        return Some(v);
    }
    None
}

/// Parse ShowEventsOptions from a Rhai Map.
fn parse_show_events_options(options: &rhai::Map) -> ShowEventsOptions {
    let mut opts = ShowEventsOptions::default();

    // Parse color
    if let Some(color_dyn) = options.get("color") {
        if let Some(color_map) = color_dyn.clone().try_cast::<rhai::Map>() {
            opts.color[0] = color_map.get("r").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
            opts.color[1] = color_map.get("g").and_then(|d| d.as_float().ok()).unwrap_or(0.5) as f32;
            opts.color[2] = color_map.get("b").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
            opts.color[3] = color_map.get("a").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
        }
    }

    // Parse size
    if let Some(size_dyn) = options.get("size") {
        if let Ok(size) = size_dyn.as_float() {
            opts.size = size as f32;
        }
    }

    // Parse duration_beats
    if let Some(duration_dyn) = options.get("duration_beats") {
        if let Ok(duration) = duration_dyn.as_float() {
            opts.duration_beats = duration as f32;
        }
    }

    // Parse spread mode
    if let Some(spread_dyn) = options.get("spread") {
        if let Ok(spread_str) = spread_dyn.clone().into_string() {
            opts.spread = MarkerSpreadMode::from_str(&spread_str);
        }
    }

    // Parse spread_spacing
    if let Some(spacing_dyn) = options.get("spread_spacing") {
        if let Ok(spacing) = spacing_dyn.as_float() {
            opts.spread_spacing = spacing as f32;
        }
    }

    opts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_signals(time: f32, dt: f32, amplitude: f32, flux: f32) -> HashMap<String, f32> {
        let mut signals = HashMap::new();
        signals.insert("time".to_string(), time);
        signals.insert("dt".to_string(), dt);
        signals.insert("amplitude".to_string(), amplitude);
        signals.insert("flux".to_string(), flux);
        signals
    }

    fn run_update(engine: &mut ScriptEngine, frame_inputs: &HashMap<String, f32>) {
        let time = frame_inputs.get("time").copied().unwrap_or(0.0);
        let dt = frame_inputs.get("dt").copied().unwrap_or(0.0);
        let input_signals: HashMap<String, InputSignal> = HashMap::new();
        let band_signals: HashMap<String, HashMap<String, InputSignal>> = HashMap::new();
        let stem_signals: HashMap<String, HashMap<String, InputSignal>> = HashMap::new();
        engine.update(time, dt, frame_inputs, &input_signals, &band_signals, &stem_signals, None);
    }

    #[test]
    fn test_mesh_creation() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube;

            fn init(ctx) {
                cube = mesh.cube();
                scene.add(cube);
            }

            fn update(dt, frame) {
                cube.rotation.y = frame.time;
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(1.5, 0.016, 0.5, 0.3);
        run_update(&mut engine, &signals);

        // Check that cube was created and added to scene
        assert_eq!(engine.scene_graph.scene_entities().count(), 1);

        // Check rotation was set
        let (_, entity) = engine.scene_graph.scene_entities().next().unwrap();
        assert!((entity.transform().rotation.y - 1.5).abs() < 0.01);
    }

    #[test]
    fn test_line_strip() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            let spark;

            fn init(ctx) {
                spark = line.strip(#{ max_points: 10 });
                scene.add(spark);
            }

            fn update(dt, frame) {
                spark.push(frame.time, frame.amplitude);
            }
        "#;

        assert!(engine.load_script(script));

        // Run a few updates
        for i in 0..5 {
            let signals = make_signals(i as f32 * 0.1, 0.016, i as f32 * 0.2, 0.0);
            run_update(&mut engine, &signals);
        }

        // Check that line was created with points
        assert_eq!(engine.scene_graph.scene_entities().count(), 1);

        // Check the line has the expected number of points
        let line_count = engine.scene_graph.lines()
            .next()
            .map(|(_, line)| line.count)
            .expect("Expected line entity");
        assert_eq!(line_count, 5);
    }

    #[test]
    fn test_empty_scene() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                // Create nothing
            }

            fn update(dt, frame) {
                // Do nothing
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Scene should be empty
        assert_eq!(engine.scene_graph.scene_entities().count(), 0);
    }

    #[test]
    fn test_scene_remove() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube;
            let removed = false;

            fn init(ctx) {
                cube = mesh.cube();
                scene.add(cube);
            }

            fn update(dt, frame) {
                if frame.time > 0.5 && !removed {
                    scene.remove(cube);
                    removed = true;
                }
            }
        "#;

        assert!(engine.load_script(script));

        // First update - cube should be in scene
        let signals = make_signals(0.1, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);
        assert_eq!(engine.scene_graph.scene_entities().count(), 1);

        // Second update after threshold - cube should be removed
        let signals = make_signals(0.6, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);
        assert_eq!(engine.scene_graph.scene_entities().count(), 0);
    }

    #[test]
    fn test_invalid_script() {
        let mut engine = ScriptEngine::new();

        let script = "this is not valid rhai syntax {{{";

        assert!(!engine.load_script(script));
        assert!(engine.last_error.is_some());
    }

    #[test]
    fn test_failed_load_clears_previous_script() {
        let mut engine = ScriptEngine::new();

        let valid_script = r#"
            let phase = 0.0;

            fn update(dt, frame) {
                phase += dt;
            }
        "#;

        assert!(engine.load_script(valid_script));
        assert!(engine.has_script());

        let invalid_script = "this is not valid rhai syntax {{{";
        assert!(!engine.load_script(invalid_script));
        assert!(!engine.has_script());

        // Drain parse error diagnostics so we only see update-time diagnostics.
        let _ = engine.take_diagnostics();

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        let diags = engine.take_diagnostics();
        assert!(diags.is_empty(), "Expected no runtime diagnostics after failed load");
    }

    #[test]
    fn test_multiple_entities() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube1;
            let cube2;
            let spark;

            fn init(ctx) {
                cube1 = mesh.cube();
                cube1.position.x = -2.0;
                scene.add(cube1);

                cube2 = mesh.cube();
                cube2.position.x = 2.0;
                scene.add(cube2);

                spark = line.strip(#{ max_points: 100 });
                scene.add(spark);
            }

            fn update(dt, frame) {
                cube1.rotation.y += dt;
                cube2.rotation.y -= dt;
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Should have 3 entities in scene
        assert_eq!(engine.scene_graph.scene_entities().count(), 3);
        assert_eq!(engine.scene_graph.meshes().count(), 2);
        assert_eq!(engine.scene_graph.lines().count(), 1);

        // Verify that the two cubes have different positions (bug: they were conflated)
        let meshes: Vec<_> = engine.scene_graph.meshes().collect();
        assert_eq!(meshes.len(), 2);

        let pos1 = meshes[0].1.transform.position.x;
        let pos2 = meshes[1].1.transform.position.x;

        // One should be at -2.0, the other at 2.0
        let (min_x, max_x) = if pos1 < pos2 { (pos1, pos2) } else { (pos2, pos1) };
        assert!((min_x - (-2.0)).abs() < 0.01, "Expected one cube at x=-2.0, got {}", min_x);
        assert!((max_x - 2.0).abs() < 0.01, "Expected one cube at x=2.0, got {}", max_x);
    }

    #[test]
    fn test_multiple_entities_with_map_assignment() {
        // This test uses whole map assignment (cube.position = #{...}) like the user's script
        // rather than nested property assignment (cube.position.x = ...)
        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube;
            let cube2;

            fn init(ctx) {
                cube = mesh.cube();
                cube2 = mesh.cube();
                scene.add(cube);
                scene.add(cube2);
                cube2.position = #{ x: 0.0, y: 1.0, z: -1.0 };
                cube.position = #{ x: 1.0, y: 1.0, z: 0.0 };
            }

            fn update(dt, frame) {
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Should have 2 entities in scene
        assert_eq!(engine.scene_graph.scene_entities().count(), 2);
        assert_eq!(engine.scene_graph.meshes().count(), 2);

        // Verify that the two cubes have different positions
        let meshes: Vec<_> = engine.scene_graph.meshes().collect();
        assert_eq!(meshes.len(), 2);

        let pos1_x = meshes[0].1.transform.position.x;
        let pos2_x = meshes[1].1.transform.position.x;
        let pos1_z = meshes[0].1.transform.position.z;
        let pos2_z = meshes[1].1.transform.position.z;

        // One should be at x=0.0, z=-1.0, the other at x=1.0, z=0.0
        let (min_x, max_x) = if pos1_x < pos2_x { (pos1_x, pos2_x) } else { (pos2_x, pos1_x) };
        let (min_z, max_z) = if pos1_z < pos2_z { (pos1_z, pos2_z) } else { (pos2_z, pos1_z) };

        assert!((min_x - 0.0).abs() < 0.01, "Expected one cube at x=0.0, got {}", min_x);
        assert!((max_x - 1.0).abs() < 0.01, "Expected one cube at x=1.0, got {}", max_x);
        assert!((min_z - (-1.0)).abs() < 0.01, "Expected one cube at z=-1.0, got {}", min_z);
        assert!((max_z - 0.0).abs() < 0.01, "Expected one cube at z=0.0, got {}", max_z);
    }

    #[test]
    fn test_logging_string() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                log.info("hello from init");
            }

            fn update(dt, frame) {
                log.info("frame update");
            }
        "#;

        assert!(engine.load_script(script));
        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);
        // No assertions needed - just verify it doesn't panic
    }

    #[test]
    fn test_logging_array() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                log.info(["energy", 0.5, "phase", 1.2]);
            }

            fn update(dt, frame) {
                log.warn(["amplitude", frame.amplitude]);
            }
        "#;

        assert!(engine.load_script(script));
        let signals = make_signals(0.0, 0.016, 0.75, 0.0);
        run_update(&mut engine, &signals);
        // No assertions needed - just verify it doesn't panic
    }

    #[test]
    fn test_logging_levels() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                log.info("info message");
                log.warn("warning message");
                log.error("error message");
            }

            fn update(dt, frame) {
                // Nothing
            }
        "#;

        assert!(engine.load_script(script));
        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);
        // No assertions needed - just verify it doesn't panic
    }

    #[test]
    fn test_logging_dynamic_values() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                log.info(42);
                log.info(3.14);
                log.info(true);
                log.info(inputs);
            }

            fn update(dt, frame) {
                log.info(frame.time);
            }
        "#;

        assert!(engine.load_script(script));
        let signals = make_signals(1.5, 0.016, 0.5, 0.3);
        run_update(&mut engine, &signals);
        // No assertions needed - just verify it doesn't panic
    }

    #[test]
    fn test_diagnostic_locations_map_to_user_script() {
        let mut engine = ScriptEngine::new();
        engine.set_available_signals(vec!["time".to_string()]);

        // Deliberate syntax error on line 2.
        let script = "fn update(dt, frame) {\n  let x = ;\n}\n";
        assert!(!engine.load_script(script));

        let diags = engine.take_diagnostics();
        assert!(!diags.is_empty());
        let d = &diags[0];
        assert_eq!(d.phase, ScriptPhase::Compile);
        assert!(d.location.is_some());
        let loc = d.location.as_ref().unwrap();
        assert_eq!(loc.line, 2);

        // Runtime error mapping: undefined variable on line 2.
        let script = "fn update(dt, frame) {\n  y = 1;\n}\n";
        assert!(engine.load_script(script));
        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);
        let diags = engine.take_diagnostics();
        assert!(!diags.is_empty());
        let d = &diags[0];
        assert_eq!(d.phase, ScriptPhase::Update);
        assert!(d.location.is_some());
        let loc = d.location.as_ref().unwrap();
        assert_eq!(loc.line, 2);
    }

    #[test]
    fn test_sphere_creation() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            let sphere;

            fn init(ctx) {
                sphere = mesh.sphere();
                sphere.position = #{ x: 1.0, y: 2.0, z: 3.0 };
                scene.add(sphere);
            }

            fn update(dt, frame) {
                sphere.scale = 2.0;
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Check sphere was created
        assert_eq!(engine.scene_graph.meshes().count(), 1);

        let (_, entity) = engine.scene_graph.scene_entities().next().unwrap();

        // Check position
        assert!((entity.transform().position.x - 1.0).abs() < 0.01);
        assert!((entity.transform().position.y - 2.0).abs() < 0.01);
        assert!((entity.transform().position.z - 3.0).abs() < 0.01);

        // Check scale
        assert!((entity.transform().scale.x - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_mesh_color() {
        use crate::scene_graph::SceneEntity;

        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube;

            fn init(ctx) {
                cube = mesh.cube();
                cube.color = #{ r: 1.0, g: 0.5, b: 0.25, a: 0.8 };
                scene.add(cube);
            }

            fn update(dt, frame) {
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Check color was synced
        let (_, entity) = engine.scene_graph.scene_entities().next().unwrap();
        if let SceneEntity::Mesh(mesh) = entity {
            assert!((mesh.color[0] - 1.0).abs() < 0.01);
            assert!((mesh.color[1] - 0.5).abs() < 0.01);
            assert!((mesh.color[2] - 0.25).abs() < 0.01);
            assert!((mesh.color[3] - 0.8).abs() < 0.01);
        } else {
            panic!("Expected mesh entity");
        }
    }

    #[test]
    fn test_group_hierarchy() {
        use crate::scene_graph::SceneEntity;

        let mut engine = ScriptEngine::new();

        let script = r#"
            let group;
            let child1;
            let child2;

            fn init(ctx) {
                group = scene.group();
                group.position = #{ x: 5.0, y: 0.0, z: 0.0 };

                child1 = mesh.cube();
                child1.position = #{ x: 1.0, y: 0.0, z: 0.0 };

                child2 = mesh.sphere();
                child2.position = #{ x: -1.0, y: 0.0, z: 0.0 };

                group.add(child1);
                group.add(child2);

                scene.add(group);
            }

            fn update(dt, frame) {
            }
        "#;

        assert!(engine.load_script(script));

        let signals = make_signals(0.0, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        // Check group was created and added to scene
        assert_eq!(engine.scene_graph.groups().count(), 1);

        // Children are not directly in the scene (only the group is),
        // but they exist in the scene graph with parent references
        let mut mesh_count = 0;
        let mut children_with_parent = 0;

        for (id, entity) in &engine.scene_graph.entities {
            if let SceneEntity::Mesh(_) = entity {
                mesh_count += 1;
                if engine.scene_graph.get_parent(*id).is_some() {
                    children_with_parent += 1;
                }
            }
        }

        assert_eq!(mesh_count, 2, "Should have 2 mesh entities");
        assert_eq!(children_with_parent, 2, "Both meshes should have parent");

        // Verify the group's position was set
        let (_, group_entity) = engine.scene_graph.groups().next().unwrap();
        assert!((group_entity.transform.position.x - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_debug_modes() {
        // Reset debug options before test
        reset_script_debug_options();

        let mut engine = ScriptEngine::new();

        let script = r#"
            let cube;

            fn init(ctx) {
                cube = mesh.cube();
                scene.add(cube);

                dbg.wireframe(true);
                dbg.boundingBoxes(true);
                dbg.isolate(cube);
            }

            fn update(dt, frame) {
                if frame.time > 0.5 {
                    dbg.clearIsolation();
                    dbg.wireframe(false);
                }
            }
        "#;

        assert!(engine.load_script(script));

        // First update - debug options should be set
        let signals = make_signals(0.1, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        let debug_opts = get_script_debug_options();
        assert!(debug_opts.wireframe, "wireframe should be enabled");
        assert!(debug_opts.bounding_boxes, "bounding_boxes should be enabled");
        assert!(debug_opts.isolated_entity.is_some(), "isolation should be set");

        // Second update after threshold - isolation and wireframe should be cleared
        let signals = make_signals(0.6, 0.016, 0.0, 0.0);
        run_update(&mut engine, &signals);

        let debug_opts = get_script_debug_options();
        assert!(!debug_opts.wireframe, "wireframe should be disabled");
        assert!(debug_opts.bounding_boxes, "bounding_boxes should still be enabled");
        assert!(debug_opts.isolated_entity.is_none(), "isolation should be cleared");

        // Reset for other tests
        reset_script_debug_options();
    }
}
