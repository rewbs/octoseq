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

use std::collections::HashMap;
use rhai::{Engine, Scope, AST, Dynamic, EvalAltResult};

use crate::scene_graph::{SceneGraph, EntityId, MeshType, LineMode, SceneEntity, LineStrip as SceneLineStrip};
use crate::script_log::{ScriptLogger, reset_frame_log_count};

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
    /// Whether init() has been called
    init_called: bool,
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

        // Register ScriptLogger type and methods
        engine
            .register_type_with_name::<ScriptLogger>("ScriptLogger")
            .register_fn("info", ScriptLogger::info)
            .register_fn("warn", ScriptLogger::warn)
            .register_fn("error", ScriptLogger::error);

        Self {
            engine,
            ast: None,
            scope: Scope::new(),
            scene_graph: SceneGraph::new(),
            entity_maps: HashMap::new(),
            last_error: None,
            init_called: false,
        }
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

        // Inject the log object for script logging
        self.scope.push_constant("log", ScriptLogger::new());
    }

    /// Load and compile a script.
    /// Returns true if successful, false if there was a compilation error.
    pub fn load_script(&mut self, script: &str) -> bool {
        // Reset state
        self.init_scope();
        self.scene_graph.clear();
        self.entity_maps.clear();
        self.last_error = None;
        self.init_called = false;

        // Wrap user script with API definitions
        // Note: Rhai Maps require string keys, so we convert IDs to strings using `"" + id`
        let full_script = format!(r#"
// === API Modules ===

// Mesh module
let mesh = #{{}};
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

    __entities["" + id] = entity;
    entity
}};

// Line module
let line = #{{}};
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

// === User Script ===
{script}
"#);

        match self.engine.compile(&full_script) {
            Ok(ast) => {
                // Run the script once to initialize global state and API
                if let Err(e) = self.engine.run_ast_with_scope(&mut self.scope, &ast) {
                    self.last_error = Some(format!("Script init error: {}", e));
                    log::error!("Script initialization error: {}", e);
                    return false;
                }
                self.ast = Some(ast);
                true
            }
            Err(e) => {
                self.last_error = Some(format!("Compile error: {}", e));
                log::error!("Script compilation error: {}", e);
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
        let ctx = rhai::Map::new();

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
                self.last_error = Some(format!("Init error: {}", e));
                log::error!("Script init() error: {}", e);
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
                self.last_error = Some(format!("Update error: {}", e));
                log::error!("Script update error: {}", e);
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
            if let Some(entity_map) = value.clone().try_cast::<rhai::Map>() {
                if let Some(id_dyn) = entity_map.get("__id") {
                    if let Ok(id) = id_dyn.as_int() {
                        // Update the central __entities map with this copy
                        let key = format!("{}", id);
                        entities.insert(key.into(), Dynamic::from(entity_map.clone()));
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
        use crate::scene_graph::{SceneEntity};

        let line = SceneLineStrip::new(max_points, mode);
        self.scene_graph.entities.insert(id, SceneEntity::Line(line));
    }

    /// Check if a script is loaded.
    pub fn has_script(&self) -> bool {
        self.ast.is_some()
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
}
