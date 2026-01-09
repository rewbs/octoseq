//! Scene graph for script-driven visualization.
//!
//! This module provides the data structures for a dynamic scene graph where
//! all entities are created and managed by Rhai scripts.

use std::collections::{HashMap, HashSet};

use glam::Vec2;

use crate::deformation::Deformation;
use crate::material::ParamValue;

/// Unique identifier for scene entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityId(pub u64);

/// Types of meshes available for instantiation.
#[derive(Debug, Clone, PartialEq)]
pub enum MeshType {
    Cube,
    Plane,
    Sphere,
    /// Reference to a loaded mesh asset by ID.
    Asset(String),
    /// A radial ring/arc, optionally extruded in Z for 3D depth.
    RadialRing {
        radius: f32,
        thickness: f32,
        start_angle: f32,
        end_angle: f32,
        segments: u32,
        depth: f32,
    },
}

/// Rendering mode for meshes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RenderMode {
    /// Render as solid geometry (default).
    #[default]
    Solid,
    /// Render as wireframe only.
    Wireframe,
    /// Render both solid and wireframe overlaid.
    SolidWithWireframe,
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

/// Blob shadow configuration for a mesh instance.
/// Renders a soft ellipse on a ground plane to simulate contact shadows.
#[derive(Debug, Clone)]
pub struct BlobShadowConfig {
    /// Whether the shadow is enabled.
    pub enabled: bool,
    /// Y position of the shadow plane.
    pub plane_y: f32,
    /// Shadow opacity (0.0 = invisible, 1.0 = fully opaque).
    pub opacity: f32,
    /// Shadow radius in X direction.
    pub radius_x: f32,
    /// Shadow radius in Z direction.
    pub radius_z: f32,
    /// Shadow softness (0.0 = hard edge, 1.0 = very soft).
    pub softness: f32,
    /// Shadow offset in X from entity position.
    pub offset_x: f32,
    /// Shadow offset in Z from entity position.
    pub offset_z: f32,
    /// Shadow color (RGB, 0.0-1.0).
    pub color: [f32; 3],
}

impl Default for BlobShadowConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            plane_y: 0.0,
            opacity: 0.5,
            radius_x: 1.0,
            radius_z: 1.0,
            softness: 0.3,
            offset_x: 0.0,
            offset_z: 0.0,
            color: [0.0, 0.0, 0.0], // Black shadow
        }
    }
}

/// Material parameter bindings for a mesh instance.
/// Contains the resolved parameter values ready for rendering.
#[derive(Debug, Clone, Default)]
pub struct MaterialParams {
    /// Parameter values keyed by parameter name.
    pub values: HashMap<String, ParamValue>,
}

impl MaterialParams {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set a parameter value.
    pub fn set(&mut self, name: impl Into<String>, value: ParamValue) {
        self.values.insert(name.into(), value);
    }

    /// Get a parameter value.
    pub fn get(&self, name: &str) -> Option<&ParamValue> {
        self.values.get(name)
    }

    /// Clear all parameter bindings.
    pub fn clear(&mut self) {
        self.values.clear();
    }
}

/// A mesh instance - references shared geometry with its own transform.
#[derive(Debug, Clone)]
pub struct MeshInstance {
    pub mesh_type: MeshType,
    pub transform: Transform,
    pub visible: bool,
    /// RGBA color tint (multiplied with vertex colors). Default is white (no tint).
    pub color: [f32; 4],
    /// Rendering mode (solid, wireframe, or both).
    pub render_mode: RenderMode,
    /// Wireframe color (used when render_mode includes wireframe).
    pub wireframe_color: [f32; 4],
    /// Deformations to apply to this mesh instance.
    pub deformations: Vec<Deformation>,
    /// Material ID (None = use default material).
    pub material_id: Option<String>,
    /// Material parameter bindings (evaluated each frame).
    pub material_params: MaterialParams,
    /// Whether this mesh is affected by global lighting. Default: true.
    pub lit: bool,
    /// Emissive intensity multiplier (adds to base color, unaffected by lighting). Default: 0.0.
    pub emissive: f32,
    /// Blob shadow configuration for this mesh.
    pub shadow: BlobShadowConfig,
}

impl MeshInstance {
    pub fn new(mesh_type: MeshType) -> Self {
        Self {
            mesh_type,
            transform: Transform::default(),
            visible: true,
            color: [1.0, 1.0, 1.0, 1.0], // Default: no tint (white)
            render_mode: RenderMode::default(),
            wireframe_color: [1.0, 1.0, 1.0, 1.0], // Default: white wireframe
            deformations: Vec::new(),
            material_id: None, // Use default material
            material_params: MaterialParams::new(),
            lit: true,     // Default: affected by lighting
            emissive: 0.0, // Default: no emission
            shadow: BlobShadowConfig::default(),
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

/// A group entity that contains other entities with a parent transform.
#[derive(Debug, Clone)]
pub struct Group {
    pub transform: Transform,
    pub children: Vec<EntityId>,
    pub visible: bool,
}

impl Group {
    pub fn new() -> Self {
        Self {
            transform: Transform::default(),
            children: Vec::new(),
            visible: true,
        }
    }
}

impl Default for Group {
    fn default() -> Self {
        Self::new()
    }
}

/// Distribution mode for point clouds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PointCloudMode {
    /// Uniform random distribution in a cube.
    #[default]
    Uniform,
    /// Points distributed on the surface of a sphere.
    Sphere,
}

/// A point cloud primitive - a set of GL points with deterministic positions.
#[derive(Debug, Clone)]
pub struct PointCloud {
    /// Number of points.
    pub count: usize,
    /// Distribution spread (half-extent for uniform, radius for sphere).
    pub spread: f32,
    /// Distribution mode.
    pub mode: PointCloudMode,
    /// Random seed for deterministic positions.
    pub seed: u64,
    /// Point size in pixels.
    pub point_size: f32,
    /// Pre-computed point positions (generated from seed).
    pub positions: Vec<Vec3>,
    /// Transform.
    pub transform: Transform,
    /// Visibility.
    pub visible: bool,
    /// RGBA color.
    pub color: [f32; 4],
}

impl PointCloud {
    /// Create a new point cloud with deterministic positions based on seed.
    pub fn new(count: usize, spread: f32, mode: PointCloudMode, seed: u64, point_size: f32) -> Self {
        let positions = Self::generate_positions(count, spread, mode, seed);
        Self {
            count,
            spread,
            mode,
            seed,
            point_size,
            positions,
            transform: Transform::default(),
            visible: true,
            color: [1.0, 1.0, 1.0, 1.0],
        }
    }

    /// Generate deterministic positions from seed.
    fn generate_positions(count: usize, spread: f32, mode: PointCloudMode, seed: u64) -> Vec<Vec3> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut positions = Vec::with_capacity(count);
        for i in 0..count {
            // Simple deterministic pseudo-random based on seed and index
            let mut hasher = DefaultHasher::new();
            seed.hash(&mut hasher);
            (i as u64).hash(&mut hasher);
            let h1 = hasher.finish();

            hasher = DefaultHasher::new();
            h1.hash(&mut hasher);
            let h2 = hasher.finish();

            hasher = DefaultHasher::new();
            h2.hash(&mut hasher);
            let h3 = hasher.finish();

            // Convert to [0, 1) range
            let r1 = (h1 as f32) / (u64::MAX as f32);
            let r2 = (h2 as f32) / (u64::MAX as f32);
            let r3 = (h3 as f32) / (u64::MAX as f32);

            let pos = match mode {
                PointCloudMode::Uniform => {
                    // Uniform distribution in [-spread, spread] cube
                    Vec3::new(
                        (r1 * 2.0 - 1.0) * spread,
                        (r2 * 2.0 - 1.0) * spread,
                        (r3 * 2.0 - 1.0) * spread,
                    )
                }
                PointCloudMode::Sphere => {
                    // Uniform distribution on sphere surface
                    let theta = r1 * std::f32::consts::TAU;
                    let phi = (r2 * 2.0 - 1.0).acos();
                    Vec3::new(
                        spread * phi.sin() * theta.cos(),
                        spread * phi.sin() * theta.sin(),
                        spread * phi.cos(),
                    )
                }
            };
            positions.push(pos);
        }
        positions
    }

    /// Regenerate positions if parameters changed.
    pub fn update(&mut self, count: usize, spread: f32, mode: PointCloudMode, seed: u64, point_size: f32) {
        if self.count != count || self.spread != spread || self.mode != mode || self.seed != seed {
            self.count = count;
            self.spread = spread;
            self.mode = mode;
            self.seed = seed;
            self.positions = Self::generate_positions(count, spread, mode, seed);
        }
        self.point_size = point_size;
    }
}

/// A radial wave - signal-modulated circular line.
/// The radius at each angle is: base_radius + amplitude * signal_value * sin(angle * wave_frequency)
#[derive(Debug, Clone)]
pub struct RadialWave {
    /// Base radius.
    pub base_radius: f32,
    /// Amplitude of wave modulation.
    pub amplitude: f32,
    /// Number of waves per revolution.
    pub wave_frequency: f32,
    /// Number of line segments around the circle.
    pub resolution: usize,
    /// Current signal value (evaluated each frame).
    pub signal_value: f32,
    /// Transform.
    pub transform: Transform,
    /// Visibility.
    pub visible: bool,
    /// RGBA color.
    pub color: [f32; 4],
}

impl RadialWave {
    /// Create a new radial wave.
    pub fn new(base_radius: f32, amplitude: f32, wave_frequency: f32, resolution: usize) -> Self {
        Self {
            base_radius,
            amplitude,
            wave_frequency,
            resolution,
            signal_value: 0.0,
            transform: Transform::default(),
            visible: true,
            color: [1.0, 1.0, 1.0, 1.0],
        }
    }

    /// Generate line points for rendering.
    /// Returns points in XY plane (facing +Z).
    pub fn generate_points(&self) -> Vec<Vec3> {
        let mut points = Vec::with_capacity(self.resolution + 1);
        for i in 0..=self.resolution {
            let angle = (i as f32 / self.resolution as f32) * std::f32::consts::TAU;
            let radius = self.base_radius + self.amplitude * self.signal_value * (angle * self.wave_frequency).sin();
            points.push(Vec3::new(
                radius * angle.cos(),
                radius * angle.sin(),
                0.0,
            ));
        }
        points
    }
}

/// Ribbon render mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RibbonMode {
    /// Flat strip with two edges.
    Strip,
    /// Cylindrical tube.
    Tube,
}

/// A ribbon - signal-driven extruded path.
/// Each frame, a new point is added based on the signal value.
/// Points form a continuous path that can be rendered as a strip or tube.
#[derive(Debug, Clone)]
pub struct Ribbon {
    /// Maximum points in the ring buffer.
    pub max_points: usize,
    /// Render mode.
    pub mode: RibbonMode,
    /// Width of the ribbon (strip) or diameter (tube).
    pub width: f32,
    /// Twist amount (rotation per point).
    pub twist: f32,
    /// Ring buffer of points (x, y coordinates from signal).
    pub points: Vec<Vec2>,
    /// Current write position in ring buffer.
    pub cursor: usize,
    /// Number of valid points.
    pub count: usize,
    /// Transform.
    pub transform: Transform,
    /// Visibility.
    pub visible: bool,
    /// RGBA color.
    pub color: [f32; 4],
}

impl Ribbon {
    /// Create a new ribbon.
    pub fn new(max_points: usize, mode: RibbonMode, width: f32, twist: f32) -> Self {
        Self {
            max_points,
            mode,
            width,
            twist,
            points: vec![Vec2::ZERO; max_points],
            cursor: 0,
            count: 0,
            transform: Transform::default(),
            visible: true,
            color: [1.0, 1.0, 1.0, 1.0],
        }
    }

    /// Push a new point to the ribbon.
    pub fn push(&mut self, x: f32, y: f32) {
        self.points[self.cursor] = Vec2::new(x, y);
        self.cursor = (self.cursor + 1) % self.max_points;
        if self.count < self.max_points {
            self.count += 1;
        }
    }

    /// Clear all points.
    pub fn clear(&mut self) {
        self.cursor = 0;
        self.count = 0;
    }

    /// Generate 3D positions for rendering (strip mode).
    /// Returns points along the center line of the ribbon in 3D space.
    pub fn generate_center_points(&self) -> Vec<Vec3> {
        let mut result = Vec::with_capacity(self.count);
        for i in 0..self.count {
            let idx = if self.count < self.max_points {
                i
            } else {
                (self.cursor + i) % self.max_points
            };
            let p = self.points[idx];
            // Map x, y to 3D: x along X axis, y along Y axis, z based on position in ribbon
            let z = (i as f32 / self.max_points as f32) * 2.0 - 1.0;
            result.push(Vec3::new(p.x, p.y, z));
        }
        result
    }
}

/// A scene entity - mesh, line, group, point cloud, radial wave, or ribbon.
#[derive(Debug, Clone)]
pub enum SceneEntity {
    Mesh(MeshInstance),
    Line(LineStrip),
    Group(Group),
    PointCloud(PointCloud),
    RadialWave(RadialWave),
    Ribbon(Ribbon),
}

impl SceneEntity {
    /// Get a reference to the entity's transform.
    pub fn transform(&self) -> &Transform {
        match self {
            SceneEntity::Mesh(m) => &m.transform,
            SceneEntity::Line(l) => &l.transform,
            SceneEntity::Group(g) => &g.transform,
            SceneEntity::PointCloud(p) => &p.transform,
            SceneEntity::RadialWave(w) => &w.transform,
            SceneEntity::Ribbon(r) => &r.transform,
        }
    }

    /// Get a mutable reference to the entity's transform.
    pub fn transform_mut(&mut self) -> &mut Transform {
        match self {
            SceneEntity::Mesh(m) => &mut m.transform,
            SceneEntity::Line(l) => &mut l.transform,
            SceneEntity::Group(g) => &mut g.transform,
            SceneEntity::PointCloud(p) => &mut p.transform,
            SceneEntity::RadialWave(w) => &mut w.transform,
            SceneEntity::Ribbon(r) => &mut r.transform,
        }
    }

    /// Check if the entity is visible.
    pub fn visible(&self) -> bool {
        match self {
            SceneEntity::Mesh(m) => m.visible,
            SceneEntity::Line(l) => l.visible,
            SceneEntity::Group(g) => g.visible,
            SceneEntity::PointCloud(p) => p.visible,
            SceneEntity::RadialWave(w) => w.visible,
            SceneEntity::Ribbon(r) => r.visible,
        }
    }

    /// Set the entity's visibility.
    pub fn set_visible(&mut self, visible: bool) {
        match self {
            SceneEntity::Mesh(m) => m.visible = visible,
            SceneEntity::Line(l) => l.visible = visible,
            SceneEntity::Group(g) => g.visible = visible,
            SceneEntity::PointCloud(p) => p.visible = visible,
            SceneEntity::RadialWave(w) => w.visible = visible,
            SceneEntity::Ribbon(r) => r.visible = visible,
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
    /// Parent-child relationships for hierarchical transforms.
    /// Maps child ID -> parent ID.
    parent_ids: HashMap<EntityId, EntityId>,
    /// Entities with debug bounding box visualization enabled.
    debug_bounds_entities: HashSet<EntityId>,
}

impl SceneGraph {
    pub fn new() -> Self {
        Self {
            entities: HashMap::new(),
            scene_entities: Vec::new(),
            next_id: 1,
            parent_ids: HashMap::new(),
            debug_bounds_entities: HashSet::new(),
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

    /// Create a new group and return its ID.
    /// The group is NOT added to the scene automatically.
    pub fn create_group(&mut self) -> EntityId {
        let id = self.new_id();
        let group = Group::new();
        self.entities.insert(id, SceneEntity::Group(group));
        id
    }

    /// Set the parent of an entity (for hierarchical transforms).
    /// Returns true if successful, false if either ID doesn't exist.
    pub fn set_parent(&mut self, child_id: EntityId, parent_id: EntityId) -> bool {
        if !self.entities.contains_key(&child_id) || !self.entities.contains_key(&parent_id) {
            return false;
        }
        self.parent_ids.insert(child_id, parent_id);
        true
    }

    /// Clear the parent of an entity.
    pub fn clear_parent(&mut self, child_id: EntityId) {
        self.parent_ids.remove(&child_id);
    }

    /// Get the parent of an entity.
    pub fn get_parent(&self, child_id: EntityId) -> Option<EntityId> {
        self.parent_ids.get(&child_id).copied()
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

    /// Get all groups in the scene.
    pub fn groups(&self) -> impl Iterator<Item = (EntityId, &Group)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::Group(group) = entity {
                    Some((id, group))
                } else {
                    None
                }
            })
    }

    /// Get all point clouds in the scene.
    pub fn point_clouds(&self) -> impl Iterator<Item = (EntityId, &PointCloud)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::PointCloud(cloud) = entity {
                    Some((id, cloud))
                } else {
                    None
                }
            })
    }

    /// Get all radial waves in the scene.
    pub fn radial_waves(&self) -> impl Iterator<Item = (EntityId, &RadialWave)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::RadialWave(wave) = entity {
                    Some((id, wave))
                } else {
                    None
                }
            })
    }

    /// Get all ribbons in the scene.
    pub fn ribbons(&self) -> impl Iterator<Item = (EntityId, &Ribbon)> {
        self.scene_entities()
            .filter_map(|(id, entity)| {
                if let SceneEntity::Ribbon(ribbon) = entity {
                    Some((id, ribbon))
                } else {
                    None
                }
            })
    }

    /// Toggle debug bounding box visualization for an entity.
    /// Returns the new state (true = showing, false = hidden).
    pub fn toggle_debug_bounds(&mut self, id: EntityId) -> bool {
        if self.debug_bounds_entities.contains(&id) {
            self.debug_bounds_entities.remove(&id);
            false
        } else {
            self.debug_bounds_entities.insert(id);
            true
        }
    }

    /// Check if an entity has debug bounding box visualization enabled.
    pub fn has_debug_bounds(&self, id: EntityId) -> bool {
        self.debug_bounds_entities.contains(&id)
    }

    /// Get all entities with debug bounding boxes enabled.
    pub fn debug_bounds_entities(&self) -> &HashSet<EntityId> {
        &self.debug_bounds_entities
    }

    /// Clear all entities and the scene.
    pub fn clear(&mut self) {
        self.entities.clear();
        self.scene_entities.clear();
        self.parent_ids.clear();
        self.debug_bounds_entities.clear();
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
