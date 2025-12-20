//! Scene graph for script-driven visualization.
//!
//! This module provides the data structures for a dynamic scene graph where
//! all entities are created and managed by Rhai scripts.

use std::collections::HashMap;

/// Unique identifier for scene entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityId(pub u64);

/// Types of meshes available for instantiation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeshType {
    Cube,
    Plane,
}

/// 3D position/vector.
#[derive(Debug, Clone, Copy, Default)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn splat(v: f32) -> Self {
        Self { x: v, y: v, z: v }
    }
}

/// Transform component for scene entities.
#[derive(Debug, Clone)]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Vec3, // Euler angles in radians
    pub scale: Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: Vec3::default(),
            rotation: Vec3::default(),
            scale: Vec3::splat(1.0),
        }
    }
}

/// A mesh instance - references shared geometry with its own transform.
#[derive(Debug, Clone)]
pub struct MeshInstance {
    pub mesh_type: MeshType,
    pub transform: Transform,
    pub visible: bool,
}

impl MeshInstance {
    pub fn new(mesh_type: MeshType) -> Self {
        Self {
            mesh_type,
            transform: Transform::default(),
            visible: true,
        }
    }
}

/// A 2D point for line strips.
#[derive(Debug, Clone, Copy, Default)]
pub struct Point2 {
    pub x: f32,
    pub y: f32,
}

impl Point2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

/// Render mode for line strips.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineMode {
    #[default]
    Line,
    Points,
}

/// A procedural line strip primitive.
/// Points are stored in a ring buffer, oldest points are discarded when full.
#[derive(Debug, Clone)]
pub struct LineStrip {
    pub max_points: usize,
    pub points: Vec<Point2>,
    pub cursor: usize, // Write position in ring buffer
    pub count: usize,  // Number of valid points (up to max_points)
    pub mode: LineMode,
    pub transform: Transform,
    pub visible: bool,
    pub color: [f32; 4], // RGBA color
}

impl LineStrip {
    pub fn new(max_points: usize, mode: LineMode) -> Self {
        Self {
            max_points,
            points: vec![Point2::default(); max_points],
            cursor: 0,
            count: 0,
            mode,
            transform: Transform::default(),
            visible: true,
            color: [0.0, 1.0, 0.0, 1.0], // Default green
        }
    }

    /// Push a new point to the ring buffer.
    /// If the buffer is full, the oldest point is overwritten.
    pub fn push(&mut self, x: f32, y: f32) {
        self.points[self.cursor] = Point2::new(x, y);
        self.cursor = (self.cursor + 1) % self.max_points;
        if self.count < self.max_points {
            self.count += 1;
        }
    }

    /// Clear all points from the line strip.
    pub fn clear(&mut self) {
        self.cursor = 0;
        self.count = 0;
        // Reset all points to default
        for p in &mut self.points {
            *p = Point2::default();
        }
    }

    /// Get points in order (oldest to newest) for rendering.
    /// Returns an iterator over valid points.
    pub fn ordered_points(&self) -> impl Iterator<Item = &Point2> {
        let start = if self.count < self.max_points {
            0
        } else {
            self.cursor
        };

        (0..self.count).map(move |i| {
            let idx = (start + i) % self.max_points;
            &self.points[idx]
        })
    }

    /// Get a flat array of point data for GPU upload [x0, y0, x1, y1, ...]
    pub fn to_gpu_data(&self) -> Vec<f32> {
        let mut data = Vec::with_capacity(self.max_points * 2);

        // Output all points in ring buffer order for GPU
        // The shader will handle the ring buffer semantics
        for point in &self.points {
            data.push(point.x);
            data.push(point.y);
        }

        data
    }
}

/// A scene entity - either a mesh instance or a line strip.
#[derive(Debug, Clone)]
pub enum SceneEntity {
    Mesh(MeshInstance),
    Line(LineStrip),
}

impl SceneEntity {
    /// Get a reference to the entity's transform.
    pub fn transform(&self) -> &Transform {
        match self {
            SceneEntity::Mesh(m) => &m.transform,
            SceneEntity::Line(l) => &l.transform,
        }
    }

    /// Get a mutable reference to the entity's transform.
    pub fn transform_mut(&mut self) -> &mut Transform {
        match self {
            SceneEntity::Mesh(m) => &mut m.transform,
            SceneEntity::Line(l) => &mut l.transform,
        }
    }

    /// Check if the entity is visible.
    pub fn visible(&self) -> bool {
        match self {
            SceneEntity::Mesh(m) => m.visible,
            SceneEntity::Line(l) => l.visible,
        }
    }

    /// Set the entity's visibility.
    pub fn set_visible(&mut self, visible: bool) {
        match self {
            SceneEntity::Mesh(m) => m.visible = visible,
            SceneEntity::Line(l) => l.visible = visible,
        }
    }
}

/// The scene graph - manages all entities created by scripts.
#[derive(Debug)]
pub struct SceneGraph {
    /// All entities indexed by their ID.
    /// Public for direct access from scripting module when syncing entities.
    pub entities: HashMap<EntityId, SceneEntity>,
    /// Entities that have been added to the scene (will be rendered).
    scene_entities: Vec<EntityId>,
    /// Next entity ID to assign.
    next_id: u64,
}

impl SceneGraph {
    pub fn new() -> Self {
        Self {
            entities: HashMap::new(),
            scene_entities: Vec::new(),
            next_id: 1,
        }
    }

    /// Generate a new unique entity ID.
    fn new_id(&mut self) -> EntityId {
        let id = EntityId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Create a new mesh instance and return its ID.
    /// The mesh is NOT added to the scene automatically.
    pub fn create_mesh(&mut self, mesh_type: MeshType) -> EntityId {
        let id = self.new_id();
        let mesh = MeshInstance::new(mesh_type);
        self.entities.insert(id, SceneEntity::Mesh(mesh));
        id
    }

    /// Create a new line strip and return its ID.
    /// The line is NOT added to the scene automatically.
    pub fn create_line(&mut self, max_points: usize, mode: LineMode) -> EntityId {
        let id = self.new_id();
        let line = LineStrip::new(max_points, mode);
        self.entities.insert(id, SceneEntity::Line(line));
        id
    }

    /// Add an entity to the scene (make it renderable).
    /// Returns true if the entity was added, false if already in scene or doesn't exist.
    pub fn add_to_scene(&mut self, id: EntityId) -> bool {
        if !self.entities.contains_key(&id) {
            return false;
        }
        if self.scene_entities.contains(&id) {
            return false; // Already in scene
        }
        self.scene_entities.push(id);
        true
    }

    /// Remove an entity from the scene (stop rendering it).
    /// The entity still exists and can be re-added.
    /// Returns true if the entity was removed, false if not in scene.
    pub fn remove_from_scene(&mut self, id: EntityId) -> bool {
        if let Some(pos) = self.scene_entities.iter().position(|&e| e == id) {
            self.scene_entities.remove(pos);
            true
        } else {
            false
        }
    }

    /// Destroy an entity completely (removes from scene and deletes).
    pub fn destroy(&mut self, id: EntityId) -> bool {
        self.remove_from_scene(id);
        self.entities.remove(&id).is_some()
    }

    /// Get a reference to an entity by ID.
    pub fn get(&self, id: EntityId) -> Option<&SceneEntity> {
        self.entities.get(&id)
    }

    /// Get a mutable reference to an entity by ID.
    pub fn get_mut(&mut self, id: EntityId) -> Option<&mut SceneEntity> {
        self.entities.get_mut(&id)
    }

    /// Get all entities currently in the scene (for rendering).
    pub fn scene_entities(&self) -> impl Iterator<Item = (EntityId, &SceneEntity)> {
        self.scene_entities.iter()
            .filter_map(|&id| self.entities.get(&id).map(|e| (id, e)))
    }

    /// Get all mesh instances in the scene.
    pub fn meshes(&self) -> impl Iterator<Item = (EntityId, &MeshInstance)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::Mesh(mesh) = entity {
                    Some((id, mesh))
                } else {
                    None
                }
            })
    }

    /// Get all line strips in the scene.
    pub fn lines(&self) -> impl Iterator<Item = (EntityId, &LineStrip)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::Line(line) = entity {
                    Some((id, line))
                } else {
                    None
                }
            })
    }

    /// Clear all entities and the scene.
    pub fn clear(&mut self) {
        self.entities.clear();
        self.scene_entities.clear();
    }

    /// Check if an entity exists.
    pub fn exists(&self, id: EntityId) -> bool {
        self.entities.contains_key(&id)
    }

    /// Check if an entity is in the scene.
    pub fn is_in_scene(&self, id: EntityId) -> bool {
        self.scene_entities.contains(&id)
    }
}

impl Default for SceneGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_mesh() {
        let mut scene = SceneGraph::new();
        let id = scene.create_mesh(MeshType::Cube);

        assert!(scene.exists(id));
        assert!(!scene.is_in_scene(id));

        if let Some(SceneEntity::Mesh(mesh)) = scene.get(id) {
            assert_eq!(mesh.mesh_type, MeshType::Cube);
            assert!(mesh.visible);
        } else {
            panic!("Expected mesh entity");
        }
    }

    #[test]
    fn test_add_to_scene() {
        let mut scene = SceneGraph::new();
        let id = scene.create_mesh(MeshType::Cube);

        assert!(scene.add_to_scene(id));
        assert!(scene.is_in_scene(id));

        // Adding again should return false
        assert!(!scene.add_to_scene(id));
    }

    #[test]
    fn test_line_strip_ring_buffer() {
        let mut line = LineStrip::new(3, LineMode::Line);

        line.push(1.0, 1.0);
        line.push(2.0, 2.0);
        assert_eq!(line.count, 2);

        line.push(3.0, 3.0);
        assert_eq!(line.count, 3);

        // Now full, next push should wrap
        line.push(4.0, 4.0);
        assert_eq!(line.count, 3);

        // Verify oldest point was overwritten
        let points: Vec<_> = line.ordered_points().collect();
        assert_eq!(points.len(), 3);
        assert_eq!(points[0].x, 2.0);
        assert_eq!(points[1].x, 3.0);
        assert_eq!(points[2].x, 4.0);
    }

    #[test]
    fn test_line_strip_clear() {
        let mut line = LineStrip::new(10, LineMode::Line);
        line.push(1.0, 1.0);
        line.push(2.0, 2.0);

        line.clear();
        assert_eq!(line.count, 0);
        assert_eq!(line.cursor, 0);
    }

    #[test]
    fn test_remove_from_scene() {
        let mut scene = SceneGraph::new();
        let id = scene.create_mesh(MeshType::Cube);

        scene.add_to_scene(id);
        assert!(scene.remove_from_scene(id));
        assert!(!scene.is_in_scene(id));
        assert!(scene.exists(id)); // Still exists, just not in scene
    }

    #[test]
    fn test_destroy() {
        let mut scene = SceneGraph::new();
        let id = scene.create_mesh(MeshType::Cube);
        scene.add_to_scene(id);

        assert!(scene.destroy(id));
        assert!(!scene.exists(id));
        assert!(!scene.is_in_scene(id));
    }
}
