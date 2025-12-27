//! Rhai scripting integration for the visualiser.
//!
//! Scripts can define:
//! - `fn init(ctx)` - Called once after script load to create scene objects
//! - `fn update(dt, inputs)` - Called each frame with delta time and signal inputs
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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, LazyLock};
use std::collections::HashSet as StdHashSet;

use crate::debug_collector::debug_emit;
use crate::debug_markers::{add_marker_request, DebugMarkerRequest, ShowEventsOptions, MarkerSpreadMode};
use crate::event_stream::EventStream;
use crate::input::InputSignal;
use crate::musical_time::MusicalTimeStructure;
use crate::scene_graph::{SceneGraph, EntityId, MeshType, RenderMode, LineMode, SceneEntity, LineStrip as SceneLineStrip};
use crate::deformation::{Deformation, DeformAxis};
use crate::script_log::{ScriptLogger, reset_frame_log_count};
use crate::script_diagnostics::{from_eval_error, from_parse_error, ScriptDiagnostic, ScriptPhase};
use crate::script_introspection::register_introspection_api;
use crate::signal_rhai::{register_signal_api, generate_inputs_namespace, generate_bands_namespace, SIGNAL_API_RHAI};
use crate::signal::Signal;
use crate::signal_eval::EvalContext;
use crate::signal_state::SignalState;
use crate::signal_stats::StatisticsCache;
use crate::particle_rhai::{register_particle_api, generate_particles_namespace, set_global_particle_seed};
use crate::post_processing::{PostProcessingChain, PostEffectInstance, EffectParamValue};
use std::sync::Arc;

/// Global debug options set by scripts.
/// These are read by the visualiser after each update.
static DEBUG_WIREFRAME: AtomicBool = AtomicBool::new(false);
static DEBUG_BOUNDING_BOXES: AtomicBool = AtomicBool::new(false);
/// 0 means no isolation, any other value is the entity ID to isolate.
static DEBUG_ISOLATED_ENTITY: AtomicU64 = AtomicU64::new(0);
/// Per-entity debug bounding box toggles.
static DEBUG_BOUNDS_ENTITIES: LazyLock<Mutex<StdHashSet<u64>>> = LazyLock::new(|| Mutex::new(StdHashSet::new()));

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
    /// Runtime state for stateful Signal operations (smooth, gates, delay, etc.)
    signal_state: SignalState,
    /// Precomputed signal statistics for normalization (optional/empty until populated).
    signal_statistics: StatisticsCache,
    /// Post-processing effect chain
    pub post_chain: PostProcessingChain,
    /// Global seed for deterministic particle systems.
    /// Used as base seed when particle configs don't specify their own.
    global_seed: u64,
    /// Frame feedback configuration (V7)
    pub feedback_config: crate::feedback::FeedbackConfig,
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
        engine.set_max_array_size(1_000);
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
            signal_state: SignalState::new(),
            signal_statistics: StatisticsCache::new(),
            post_chain: PostProcessingChain::new(),
            global_seed: 0,
            feedback_config: crate::feedback::FeedbackConfig::default(),
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

    /// Initialize scope with API modules and empty entity tracking.
    fn init_scope(&mut self) {
        self.scope = Scope::new();

        // Entity registry: maps entity ID -> entity Map
        let entities = rhai::Map::new();
        self.scope.push("__entities", entities);

        // Scene entities (IDs that are in the scene)
        let scene_ids = rhai::Array::new();
        self.scope.push("__scene_ids", scene_ids);

        // Next entity ID
        self.scope.push("__next_id", 1_i64);
    }

    /// Load and compile a script.
    /// Returns true if successful, false if there was a compilation error.
    pub fn load_script(&mut self, script: &str) -> bool {
        // Reset state
        self.init_scope();
        self.scene_graph.clear();
        self.entity_maps.clear();
        self.last_error = None;
        self.diagnostics.clear();
        self.init_called = false;
        self.signal_state.clear();
        self.signal_statistics.clear();

        // Generate inputs namespace based on available signals
        let signal_names: Vec<&str> = self.available_signal_names.iter().map(|s| s.as_str()).collect();
        let inputs_namespace = generate_inputs_namespace(&signal_names);

        // Generate bands namespace based on available frequency bands
        let bands_namespace = generate_bands_namespace(&self.available_bands);

        // Generate particles namespace
        let particles_namespace = generate_particles_namespace();

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
let __next_effect_id = 0;
let __post_effects = #{{}};

fx.bloom = |options| {{
    let id = __next_effect_id;
    __next_effect_id += 1;
    let effect = #{{}};
    effect.__id = id;
    effect.__type = "post_effect";
    effect.__effect_id = "bloom";
    effect.enabled = true;
    effect.threshold = if options.contains("threshold") {{ options.threshold }} else {{ 0.8 }};
    effect.intensity = if options.contains("intensity") {{ options.intensity }} else {{ 0.5 }};
    effect.radius = if options.contains("radius") {{ options.radius }} else {{ 4.0 }};
    __post_effects["" + id] = effect;
    effect
}};

fx.colorGrade = |options| {{
    let id = __next_effect_id;
    __next_effect_id += 1;
    let effect = #{{}};
    effect.__id = id;
    effect.__type = "post_effect";
    effect.__effect_id = "color_grade";
    effect.enabled = true;
    effect.brightness = if options.contains("brightness") {{ options.brightness }} else {{ 0.0 }};
    effect.contrast = if options.contains("contrast") {{ options.contrast }} else {{ 1.0 }};
    effect.saturation = if options.contains("saturation") {{ options.saturation }} else {{ 1.0 }};
    effect.gamma = if options.contains("gamma") {{ options.gamma }} else {{ 1.0 }};
    effect.tint = if options.contains("tint") {{ options.tint }} else {{ #{{ r: 1.0, g: 1.0, b: 1.0, a: 1.0 }} }};
    __post_effects["" + id] = effect;
    effect
}};

fx.vignette = |options| {{
    let id = __next_effect_id;
    __next_effect_id += 1;
    let effect = #{{}};
    effect.__id = id;
    effect.__type = "post_effect";
    effect.__effect_id = "vignette";
    effect.enabled = true;
    effect.intensity = if options.contains("intensity") {{ options.intensity }} else {{ 0.3 }};
    effect.smoothness = if options.contains("smoothness") {{ options.smoothness }} else {{ 0.5 }};
    effect.color = if options.contains("color") {{ options.color }} else {{ #{{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 }} }};
    __post_effects["" + id] = effect;
    effect
}};

fx.distortion = |options| {{
    let id = __next_effect_id;
    __next_effect_id += 1;
    let effect = #{{}};
    effect.__id = id;
    effect.__type = "post_effect";
    effect.__effect_id = "distortion";
    effect.enabled = true;
    effect.amount = if options.contains("amount") {{ options.amount }} else {{ 0.0 }};
    effect.center = if options.contains("center") {{ options.center }} else {{ #{{ x: 0.5, y: 0.5 }} }};
    __post_effects["" + id] = effect;
    effect
}};

// Post-processing chain management (post namespace)
let post = #{{}};
post.__type = "post_namespace";
post.__chain = [];

post.add = |effect| {{
    let id = effect.__id;
    if !post.__chain.contains(id) {{
        post.__chain.push(id);
    }}
}};

post.remove = |effect| {{
    let id = effect.__id;
    let idx = post.__chain.index_of(id);
    if idx >= 0 {{
        post.__chain.remove(idx);
    }}
}};

post.clear = || {{
    post.__chain = [];
}};

post.setOrder = |order| {{
    // Reorder based on effect IDs
    let new_chain = [];
    for effect_id in order {{
        if post.__chain.contains(effect_id) {{
            new_chain.push(effect_id);
        }}
    }}
    // Add any remaining effects not in the order
    for id in post.__chain {{
        if !new_chain.contains(id) {{
            new_chain.push(id);
        }}
    }}
    post.__chain = new_chain;
}};

// === Feedback System (V7) ===
// Frame feedback for Milkdrop-style temporal visual memory

let feedback = #{{}};
feedback.__type = "feedback_namespace";
feedback.__config = ();  // Active config, () means disabled

// Create a feedback configuration
// Options:
//   warp: "none"|"affine"|"radial"|"spiral"|"noise"|"shear"
//   warp_params: #{{ strength, scale, rotation, translate, frequency, falloff, seed }}
//   color: "none"|"decay"|"hsv_shift"|"posterize"|"channel_offset"
//   color_params: #{{ rate, hsv_shift: #{{ h, s, v }}, levels, offset: #{{ x, y }} }}
//   blend: "alpha"|"add"|"multiply"|"screen"|"overlay"|"difference"|"max"
//   opacity: 0.0..1.0
feedback.create = |options| {{
    let config = #{{}};
    config.__type = "feedback_config";
    config.enabled = if options.contains("enabled") {{ options.enabled }} else {{ true }};

    // Warp settings
    config.warp = if options.contains("warp") {{ options.warp }} else {{ "none" }};
    config.warp_params = if options.contains("warp_params") {{
        let wp = options.warp_params;
        #{{
            strength: if wp.contains("strength") {{ wp.strength }} else {{ 0.0 }},
            scale: if wp.contains("scale") {{ wp.scale }} else {{ 1.0 }},
            rotation: if wp.contains("rotation") {{ wp.rotation }} else {{ 0.0 }},
            translate: if wp.contains("translate") {{ wp.translate }} else {{ #{{ x: 0.0, y: 0.0 }} }},
            frequency: if wp.contains("frequency") {{ wp.frequency }} else {{ 1.0 }},
            falloff: if wp.contains("falloff") {{ wp.falloff }} else {{ 0.0 }},
            seed: if wp.contains("seed") {{ wp.seed }} else {{ 0 }}
        }}
    }} else {{
        #{{ strength: 0.0, scale: 1.0, rotation: 0.0, translate: #{{ x: 0.0, y: 0.0 }}, frequency: 1.0, falloff: 0.0, seed: 0 }}
    }};

    // Colour settings
    config.color = if options.contains("color") {{ options.color }} else {{ "none" }};
    config.color_params = if options.contains("color_params") {{
        let cp = options.color_params;
        #{{
            rate: if cp.contains("rate") {{ cp.rate }} else {{ 0.95 }},
            hsv_shift: if cp.contains("hsv_shift") {{ cp.hsv_shift }} else {{ #{{ h: 0.0, s: 0.0, v: 0.0 }} }},
            levels: if cp.contains("levels") {{ cp.levels }} else {{ 8.0 }},
            offset: if cp.contains("offset") {{ cp.offset }} else {{ #{{ x: 0.0, y: 0.0 }} }}
        }}
    }} else {{
        #{{ rate: 0.95, hsv_shift: #{{ h: 0.0, s: 0.0, v: 0.0 }}, levels: 8.0, offset: #{{ x: 0.0, y: 0.0 }} }}
    }};

    // Blend settings
    config.blend = if options.contains("blend") {{ options.blend }} else {{ "alpha" }};
    config.opacity = if options.contains("opacity") {{ options.opacity }} else {{ 0.8 }};

    config
}};

// Enable feedback with a configuration
feedback.enable = |config| {{
    feedback.__config = config;
}};

// Disable feedback
feedback.disable = || {{
    feedback.__config = ();
}};

// Check if feedback is enabled
feedback.is_enabled = || {{
    feedback.__config != ()
}};

// === Signal API ===
{SIGNAL_API_RHAI}

// === Inputs Namespace (Signal accessors) ===
{inputs_namespace}

// === Bands Namespace (Band-scoped signal accessors) ===
{bands_namespace}

// === Particles Namespace ===
{particles_namespace}

// === User Script ===
"#);

        // Count prelude lines so we can map errors back to user code.
        self.user_line_offset = prelude.matches('\n').count();
        let full_script = format!("{prelude}{script}");

        match self.engine.compile(&full_script) {
            Ok(ast) => {
                // Run the script once to initialize global state and API
                if let Err(e) = self.engine.run_ast_with_scope(&mut self.scope, &ast) {
                    let diag = from_eval_error(ScriptPhase::Init, &e, self.user_line_offset);
                    self.push_diagnostic(diag);
                    return false;
                }
                self.ast = Some(ast);
                true
            }
            Err(e) => {
                let diag = from_parse_error(&e, self.user_line_offset);
                self.push_diagnostic(diag);
                false
            }
        }
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
    /// - `input_signals`/`band_signals` are the raw signal buffers used by Signal evaluation.
    pub fn update(
        &mut self,
        time: f32,
        dt: f32,
        frame_inputs: &HashMap<String, f32>,
        input_signals: &HashMap<String, InputSignal>,
        band_signals: &HashMap<String, HashMap<String, InputSignal>>,
        musical_time: Option<&MusicalTimeStructure>,
    ) {
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
        let result: Result<(), Box<EvalAltResult>> = self.engine.call_fn(
            &mut self.scope,
            &ast,
            "update",
            (Dynamic::from(dt), Dynamic::from(inputs_map)),
        );

        if let Err(e) = result {
            let err_str = e.to_string();
            if !err_str.contains("Function not found") {
                let diag = from_eval_error(ScriptPhase::Update, &e, self.user_line_offset);
                self.push_diagnostic(diag);
            }
        }

        // Sync entities from scope to scene graph, evaluating any Signal properties at render time.
        self.sync_entities_from_scope(time, dt, input_signals, band_signals, musical_time);
    }

    /// Sync entity Maps from scope back to the SceneGraph.
    ///
    /// Numeric fields can be authored as either numbers (f32/i64) or `Signal` graphs.
    /// When a `Signal` is encountered, it is evaluated at the current frame time.
    fn sync_entities_from_scope(
        &mut self,
        time: f32,
        dt: f32,
        input_signals: &HashMap<String, InputSignal>,
        band_signals: &HashMap<String, HashMap<String, InputSignal>>,
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
        let mut signal_state = std::mem::take(&mut self.signal_state);
        let signal_statistics = std::mem::take(&mut self.signal_statistics);
        let mut eval_ctx = EvalContext::new(
            time,
            dt,
            musical_time,
            input_signals,
            band_signals,
            &signal_statistics,
            &mut signal_state,
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

        // Update the scope with merged entities
        self.scope.set_value("__entities", entities.clone());

        // Sync each entity
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
                    "line_strip" => {
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

                    // Sync deformations
                    if let Some(deforms) = entity_map.get("deformations").and_then(|d| d.clone().try_cast::<rhai::Array>()) {
                        mesh.deformations.clear();
                        for deform_dyn in deforms.iter() {
                            if let Some(deform_map) = deform_dyn.clone().try_cast::<rhai::Map>() {
                                if let Some(deformation) = parse_deformation(&deform_map) {
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
                    if let Some(params_map) = entity_map.get("params").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        mesh.material_params.clear();
                        for (param_name, param_value) in params_map.iter() {
                            if let Some(value) = parse_material_param_value(param_value, &mut eval_ctx, &mut frame_cache) {
                                mesh.material_params.set(param_name.to_string(), value);
                            }
                        }
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

                    // Sync points array
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

        // Sync post-processing effects from scope
        self.sync_post_effects_from_scope(&mut eval_ctx, &mut frame_cache);

        // Sync feedback configuration from scope
        self.sync_feedback_from_scope(&mut eval_ctx, &mut frame_cache);

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
        // Get the post namespace and __post_effects map from scope
        let post_namespace = match self.scope.get_value::<rhai::Map>("post") {
            Some(p) => p,
            None => return,
        };

        let chain = match post_namespace.get("__chain").and_then(|d| d.clone().try_cast::<rhai::Array>()) {
            Some(c) => c,
            None => return,
        };

        let post_effects = match self.scope.get_value::<rhai::Map>("__post_effects") {
            Some(e) => e,
            None => return,
        };

        // Clear existing chain and rebuild
        self.post_chain.clear();

        for id_dyn in chain.iter() {
            let id = match id_dyn.as_int().ok() {
                Some(i) => i,
                None => continue,
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
                        let r = tint.get("r").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        let g = tint.get("g").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        let b = tint.get("b").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        let a = tint.get("a").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
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
                        let r = color.get("r").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                        let g = color.get("g").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                        let b = color.get("b").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                        let a = color.get("a").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        instance.set_param("color", EffectParamValue::Vec4([r, g, b, a]));
                    }
                }
                "distortion" => {
                    if let Some(v) = effect_map.get("amount").and_then(|d| Self::eval_effect_param(d, eval_ctx, frame_cache)) {
                        instance.set_param("amount", v);
                    }
                    if let Some(center) = effect_map.get("center").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        let x = center.get("x").and_then(|d| d.as_float().ok()).unwrap_or(0.5) as f32;
                        let y = center.get("y").and_then(|d| d.as_float().ok()).unwrap_or(0.5) as f32;
                        instance.set_param("center", EffectParamValue::Vec2([x, y]));
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

    /// Sync feedback configuration from the script scope.
    fn sync_feedback_from_scope(
        &mut self,
        eval_ctx: &mut EvalContext<'_>,
        frame_cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) {
        use crate::feedback::{FeedbackConfig, WarpOperator, ColorOperator, FeedbackBlend, WarpParams, ColorParams};

        // Get the feedback namespace from scope
        let feedback_namespace = match self.scope.get_value::<rhai::Map>("feedback") {
            Some(f) => f,
            None => {
                self.feedback_config = FeedbackConfig::default();
                return;
            }
        };

        // Get the active config (may be () if disabled)
        let config_dyn = match feedback_namespace.get("__config") {
            Some(c) => c.clone(),
            None => {
                self.feedback_config = FeedbackConfig::default();
                return;
            }
        };

        // Check if config is unit () meaning disabled
        if config_dyn.is_unit() {
            self.feedback_config = FeedbackConfig::default();
            return;
        }

        // Try to cast to Map
        let config_map = match config_dyn.try_cast::<rhai::Map>() {
            Some(m) => m,
            None => {
                self.feedback_config = FeedbackConfig::default();
                return;
            }
        };

        // Build the FeedbackConfig from the Map
        let mut config = FeedbackConfig::default();
        config.enabled = true;

        // Parse warp operator
        if let Some(warp_str) = config_map.get("warp").and_then(|d| d.clone().into_string().ok()) {
            config.warp = WarpOperator::from_str(&warp_str);
        }

        // Parse warp params
        if let Some(wp) = config_map.get("warp_params").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
            config.warp_params = WarpParams {
                strength: Self::eval_f32_from_dyn(wp.get("strength"), eval_ctx, frame_cache).unwrap_or(0.0),
                scale: Self::eval_f32_from_dyn(wp.get("scale"), eval_ctx, frame_cache).unwrap_or(1.0),
                rotation: Self::eval_f32_from_dyn(wp.get("rotation"), eval_ctx, frame_cache).unwrap_or(0.0),
                translate: {
                    let t = wp.get("translate").and_then(|d| d.clone().try_cast::<rhai::Map>());
                    if let Some(t) = t {
                        [
                            Self::eval_f32_from_dyn(t.get("x"), eval_ctx, frame_cache).unwrap_or(0.0),
                            Self::eval_f32_from_dyn(t.get("y"), eval_ctx, frame_cache).unwrap_or(0.0),
                        ]
                    } else {
                        [0.0, 0.0]
                    }
                },
                frequency: Self::eval_f32_from_dyn(wp.get("frequency"), eval_ctx, frame_cache).unwrap_or(1.0),
                falloff: Self::eval_f32_from_dyn(wp.get("falloff"), eval_ctx, frame_cache).unwrap_or(0.0),
                seed: wp.get("seed").and_then(|d| d.as_int().ok()).unwrap_or(0) as u32,
            };
        }

        // Parse color operator
        if let Some(color_str) = config_map.get("color").and_then(|d| d.clone().into_string().ok()) {
            config.color = ColorOperator::from_str(&color_str);
        }

        // Parse color params
        if let Some(cp) = config_map.get("color_params").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
            config.color_params = ColorParams {
                decay_rate: Self::eval_f32_from_dyn(cp.get("rate"), eval_ctx, frame_cache).unwrap_or(0.95),
                hsv_shift: {
                    let hsv = cp.get("hsv_shift").and_then(|d| d.clone().try_cast::<rhai::Map>());
                    if let Some(hsv) = hsv {
                        [
                            Self::eval_f32_from_dyn(hsv.get("h"), eval_ctx, frame_cache).unwrap_or(0.0),
                            Self::eval_f32_from_dyn(hsv.get("s"), eval_ctx, frame_cache).unwrap_or(0.0),
                            Self::eval_f32_from_dyn(hsv.get("v"), eval_ctx, frame_cache).unwrap_or(0.0),
                        ]
                    } else {
                        [0.0, 0.0, 0.0]
                    }
                },
                posterize_levels: Self::eval_f32_from_dyn(cp.get("levels"), eval_ctx, frame_cache).unwrap_or(8.0),
                channel_offset: {
                    let off = cp.get("offset").and_then(|d| d.clone().try_cast::<rhai::Map>());
                    if let Some(off) = off {
                        [
                            Self::eval_f32_from_dyn(off.get("x"), eval_ctx, frame_cache).unwrap_or(0.0),
                            Self::eval_f32_from_dyn(off.get("y"), eval_ctx, frame_cache).unwrap_or(0.0),
                        ]
                    } else {
                        [0.0, 0.0]
                    }
                },
            };
        }

        // Parse blend mode
        if let Some(blend_str) = config_map.get("blend").and_then(|d| d.clone().into_string().ok()) {
            config.blend = FeedbackBlend::from_str(&blend_str);
        }

        // Parse opacity
        config.opacity = Self::eval_f32_from_dyn(config_map.get("opacity"), eval_ctx, frame_cache).unwrap_or(0.8);

        self.feedback_config = config;
    }

    /// Helper to evaluate a Dynamic value that may be a float, int, or Signal.
    fn eval_f32_from_dyn(
        value: Option<&rhai::Dynamic>,
        ctx: &mut EvalContext<'_>,
        cache: &mut HashMap<crate::signal::SignalId, f32>,
    ) -> Option<f32> {
        let value = value?;
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

    /// Check if a script is loaded.
    pub fn has_script(&self) -> bool {
        self.ast.is_some()
    }

    /// Drain and return all pending diagnostics.
    pub fn take_diagnostics(&mut self) -> Vec<ScriptDiagnostic> {
        std::mem::take(&mut self.diagnostics)
    }
}

impl Default for ScriptEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse a Deformation from a Rhai Map.
fn parse_deformation(deform_map: &rhai::Map) -> Option<Deformation> {
    let deform_type = deform_map.get("__type")
        .and_then(|d| d.clone().into_string().ok())?;

    match deform_type.as_str() {
        "deform_twist" => {
            let axis = deform_map.get("axis")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::Y);
            let amount = deform_map.get("amount")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
            let center = deform_map.get("center")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
            Some(Deformation::Twist { axis, amount, center })
        }
        "deform_bend" => {
            let axis = deform_map.get("axis")
                .and_then(|d| d.clone().into_string().ok())
                .and_then(|s| DeformAxis::from_str(&s))
                .unwrap_or(DeformAxis::Y);
            let amount = deform_map.get("amount")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
            let center = deform_map.get("center")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
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
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
            let frequency = deform_map.get("frequency")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(1.0) as f32;
            let phase = deform_map.get("phase")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
            Some(Deformation::Wave { axis, direction, amplitude, frequency, phase })
        }
        "deform_noise" => {
            let scale = deform_map.get("scale")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(1.0) as f32;
            let amplitude = deform_map.get("amplitude")
                .and_then(|d| d.as_float().ok())
                .unwrap_or(0.0) as f32;
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
        engine.update(time, dt, frame_inputs, &input_signals, &band_signals, None);
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

            fn update(dt, inputs) {
                cube.rotation.y = inputs.time;
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

            fn update(dt, inputs) {
                spark.push(inputs.time, inputs.amplitude);
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

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
                if inputs.time > 0.5 && !removed {
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

            fn update(dt, inputs) {
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
    }

    #[test]
    fn test_logging_string() {
        let mut engine = ScriptEngine::new();

        let script = r#"
            fn init(ctx) {
                log.info("hello from init");
            }

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
                log.warn(["amplitude", inputs.amplitude]);
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

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
                log.info(inputs.time);
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
        let script = "fn update(dt, inputs) {\n  let x = ;\n}\n";
        assert!(!engine.load_script(script));

        let diags = engine.take_diagnostics();
        assert!(!diags.is_empty());
        let d = &diags[0];
        assert_eq!(d.phase, ScriptPhase::Compile);
        assert!(d.location.is_some());
        let loc = d.location.as_ref().unwrap();
        assert_eq!(loc.line, 2);

        // Runtime error mapping: undefined variable on line 2.
        let script = "fn update(dt, inputs) {\n  y = 1;\n}\n";
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

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
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

            fn update(dt, inputs) {
                if inputs.time > 0.5 {
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
