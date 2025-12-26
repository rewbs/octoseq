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

use crate::debug_collector::debug_emit;
use crate::scene_graph::{SceneGraph, EntityId, MeshType, LineMode, SceneEntity, LineStrip as SceneLineStrip};
use crate::script_log::{ScriptLogger, reset_frame_log_count};
use crate::script_diagnostics::{from_eval_error, from_parse_error, ScriptDiagnostic, ScriptPhase};
use crate::script_introspection::register_introspection_api;
use crate::signal_rhai::{register_signal_api, generate_inputs_namespace, generate_bands_namespace, SIGNAL_API_RHAI};

/// Global debug options set by scripts.
/// These are read by the visualiser after each update.
static DEBUG_WIREFRAME: AtomicBool = AtomicBool::new(false);
static DEBUG_BOUNDING_BOXES: AtomicBool = AtomicBool::new(false);
/// 0 means no isolation, any other value is the entity ID to isolate.
static DEBUG_ISOLATED_ENTITY: AtomicU64 = AtomicU64::new(0);

/// Debug options requested by the script.
#[derive(Debug, Clone, Default)]
pub struct ScriptDebugOptions {
    pub wireframe: bool,
    pub bounding_boxes: bool,
    /// None means render all entities, Some(id) means only render that entity.
    pub isolated_entity: Option<u64>,
}

/// Get the current debug options set by scripts.
pub fn get_script_debug_options() -> ScriptDebugOptions {
    let isolated = DEBUG_ISOLATED_ENTITY.load(Ordering::Relaxed);
    ScriptDebugOptions {
        wireframe: DEBUG_WIREFRAME.load(Ordering::Relaxed),
        bounding_boxes: DEBUG_BOUNDING_BOXES.load(Ordering::Relaxed),
        isolated_entity: if isolated == 0 { None } else { Some(isolated) },
    }
}

/// Reset script debug options to defaults.
pub fn reset_script_debug_options() {
    DEBUG_WIREFRAME.store(false, Ordering::Relaxed);
    DEBUG_BOUNDING_BOXES.store(false, Ordering::Relaxed);
    DEBUG_ISOLATED_ENTITY.store(0, Ordering::Relaxed);
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

        // Register Signal API types and functions
        register_signal_api(&mut engine);

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
        }
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

        // Generate inputs namespace based on available signals
        let signal_names: Vec<&str> = self.available_signal_names.iter().map(|s| s.as_str()).collect();
        let inputs_namespace = generate_inputs_namespace(&signal_names);

        // Generate bands namespace based on available frequency bands
        let bands_namespace = generate_bands_namespace(&self.available_bands);

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

    __entities["" + id] = entity;
    entity
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
dbg.isolate = |entity| {{ __debug_isolate(entity.__id); }};
dbg.clearIsolation = || {{ __debug_clear_isolation(); }};

// === Signal API ===
{SIGNAL_API_RHAI}

// === Inputs Namespace (Signal accessors) ===
{inputs_namespace}

// === Bands Namespace (Band-scoped signal accessors) ===
{bands_namespace}

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

        // Sync entities from scope to scene graph
        self.sync_entities_from_scope();

        // Log what was created
        log::info!(
            "After init: {} entities in scene, {} meshes, {} lines",
            self.scene_graph.scene_entities().count(),
            self.scene_graph.meshes().count(),
            self.scene_graph.lines().count()
        );
    }

    /// Call the update function with the given inputs.
    pub fn update(&mut self, dt: f32, signals: &HashMap<String, f32>) {
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

        // Create inputs map from the signals HashMap
        // Note: Rhai is compiled with f32_float feature, so use f32
        let mut inputs_map = rhai::Map::new();
        inputs_map.insert("__type".into(), Dynamic::from("frame_inputs"));
        for (name, value) in signals {
            inputs_map.insert(name.clone().into(), Dynamic::from(*value));
        }

        // Log available signals for debugging (only occasionally to avoid spam)
        static LOG_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let count = LOG_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if count % 60 == 0 {
            log::info!("Script update: dt={:.4}, signals={:?}", dt, signals.keys().collect::<Vec<_>>());
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

        // Sync entities from scope to scene graph
        self.sync_entities_from_scope();
    }

    /// Sync entity Maps from scope back to the SceneGraph.
    fn sync_entities_from_scope(&mut self) {
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

        // First, collect entity Maps from all scope variables (in case user modified local copies)
        // This handles the copy-on-write behavior of Rhai Maps
        for (name, _is_const, value) in self.scope.iter() {
            // Skip internal variables
            if name.starts_with("__") || name == "mesh" || name == "line" || name == "scene" {
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
                    transform.position.x = pos.get("x").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                    transform.position.y = pos.get("y").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                    transform.position.z = pos.get("z").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                }

                // Rotation
                if let Some(rot) = entity_map.get("rotation").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                    let transform = entity.transform_mut();

                    // Helper to extract float from Dynamic (handles both f32 and i64)
                    fn get_float(d: &Dynamic) -> f32 {
                        if let Ok(f) = d.as_float() {
                            return f as f32;
                        }
                        if let Ok(i) = d.as_int() {
                            return i as f32;
                        }
                        0.0
                    }

                    transform.rotation.x = rot.get("x").map(|d| get_float(d)).unwrap_or(0.0);
                    transform.rotation.y = rot.get("y").map(|d| get_float(d)).unwrap_or(0.0);
                    transform.rotation.z = rot.get("z").map(|d| get_float(d)).unwrap_or(0.0);
                }

                // Scale (uniform)
                if let Some(scale) = entity_map.get("scale").and_then(|d| d.as_float().ok()) {
                    let transform = entity.transform_mut();
                    transform.scale.x = scale as f32;
                    transform.scale.y = scale as f32;
                    transform.scale.z = scale as f32;
                }

                // Visible
                if let Some(visible) = entity_map.get("visible").and_then(|d| d.as_bool().ok()) {
                    entity.set_visible(visible);
                }

                // Mesh-specific: sync color
                if let SceneEntity::Mesh(mesh) = entity {
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        mesh.color[0] = color.get("r").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        mesh.color[1] = color.get("g").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        mesh.color[2] = color.get("b").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        mesh.color[3] = color.get("a").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                    }
                }

                // Line-specific: sync points
                if let SceneEntity::Line(line) = entity {
                    // Sync color
                    if let Some(color) = entity_map.get("color").and_then(|d| d.clone().try_cast::<rhai::Map>()) {
                        line.color[0] = color.get("r").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                        line.color[1] = color.get("g").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                        line.color[2] = color.get("b").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                        line.color[3] = color.get("a").and_then(|d| d.as_float().ok()).unwrap_or(1.0) as f32;
                    }

                    // Sync points array
                    if let Some(points) = entity_map.get("__points").and_then(|d| d.clone().try_cast::<rhai::Array>()) {
                        // Clear existing and repopulate
                        line.clear();
                        for point_dyn in points.iter() {
                            if let Some(point_map) = point_dyn.clone().try_cast::<rhai::Map>() {
                                let x = point_map.get("x").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
                                let y = point_map.get("y").and_then(|d| d.as_float().ok()).unwrap_or(0.0) as f32;
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
        engine.update(0.016, &signals);

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
            engine.update(0.016, &signals);
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
        engine.update(0.016, &signals);

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
        engine.update(0.016, &signals);
        assert_eq!(engine.scene_graph.scene_entities().count(), 1);

        // Second update after threshold - cube should be removed
        let signals = make_signals(0.6, 0.016, 0.0, 0.0);
        engine.update(0.016, &signals);
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
        engine.update(0.016, &signals);

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
        engine.update(0.016, &signals);
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
        engine.update(0.016, &signals);
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
        engine.update(0.016, &signals);
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
        engine.update(0.016, &signals);
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
        engine.update(0.016, &make_signals(0.0, 0.016, 0.0, 0.0));
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
        engine.update(0.016, &signals);

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
        engine.update(0.016, &signals);

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
        engine.update(0.016, &signals);

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
        engine.update(0.016, &signals);

        let debug_opts = get_script_debug_options();
        assert!(debug_opts.wireframe, "wireframe should be enabled");
        assert!(debug_opts.bounding_boxes, "bounding_boxes should be enabled");
        assert!(debug_opts.isolated_entity.is_some(), "isolation should be set");

        // Second update after threshold - isolation and wireframe should be cleared
        let signals = make_signals(0.6, 0.016, 0.0, 0.0);
        engine.update(0.016, &signals);

        let debug_opts = get_script_debug_options();
        assert!(!debug_opts.wireframe, "wireframe should be disabled");
        assert!(debug_opts.bounding_boxes, "bounding_boxes should still be enabled");
        assert!(debug_opts.isolated_entity.is_none(), "isolation should be cleared");

        // Reset for other tests
        reset_script_debug_options();
    }
}
