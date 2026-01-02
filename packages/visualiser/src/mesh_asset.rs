//! Mesh asset loading and management.
//!
//! This module provides support for loading external 3D meshes from OBJ format
//! and preparing them for rendering, including wireframe edge extraction.
//!
//! ## Normal Handling
//!
//! OBJ meshes use provided normals when available. Normals are generated only
//! when missing, using area-weighted averaging of adjacent face normals.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::gpu::mesh::Vertex;

/// Axis-aligned bounding box for a mesh.
#[derive(Debug, Clone, Copy, Default)]
pub struct BoundingBox {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Bounding box for the unit cube primitive (centered at origin, side length 1).
pub const CUBE_BOUNDS: BoundingBox = BoundingBox {
    min: [-0.5, -0.5, -0.5],
    max: [0.5, 0.5, 0.5],
};

/// Bounding box for the unit plane primitive (XZ plane at Y=0).
pub const PLANE_BOUNDS: BoundingBox = BoundingBox {
    min: [-0.5, 0.0, -0.5],
    max: [0.5, 0.0, 0.5],
};

/// Bounding box for the unit sphere primitive (radius 0.5, centered at origin).
pub const SPHERE_BOUNDS: BoundingBox = BoundingBox {
    min: [-0.5, -0.5, -0.5],
    max: [0.5, 0.5, 0.5],
};

impl BoundingBox {
    /// Compute bounding box from a set of vertices.
    pub fn from_vertices(vertices: &[Vertex]) -> Self {
        if vertices.is_empty() {
            return Self::default();
        }

        let mut min = [f32::MAX; 3];
        let mut max = [f32::MIN; 3];

        for v in vertices {
            for i in 0..3 {
                min[i] = min[i].min(v.position[i]);
                max[i] = max[i].max(v.position[i]);
            }
        }

        Self { min, max }
    }

    /// Get the center of the bounding box.
    pub fn center(&self) -> [f32; 3] {
        [
            (self.min[0] + self.max[0]) / 2.0,
            (self.min[1] + self.max[1]) / 2.0,
            (self.min[2] + self.max[2]) / 2.0,
        ]
    }

    /// Get the dimensions of the bounding box.
    pub fn size(&self) -> [f32; 3] {
        [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ]
    }
}

/// A loaded mesh asset with geometry data ready for rendering.
#[derive(Debug, Clone)]
pub struct MeshAsset {
    /// Unique identifier for this asset.
    pub id: String,
    /// Vertex data (position + normal + color).
    pub vertices: Vec<Vertex>,
    /// Triangle indices for solid rendering.
    pub indices: Vec<u16>,
    /// Edge indices for wireframe rendering (pairs of vertex indices).
    pub edge_indices: Vec<u16>,
    /// Axis-aligned bounding box.
    pub bounds: BoundingBox,
}

impl MeshAsset {
    /// Create a new mesh asset from raw geometry data.
    pub fn new(id: String, vertices: Vec<Vertex>, indices: Vec<u16>) -> Self {
        let bounds = BoundingBox::from_vertices(&vertices);
        let edge_indices = extract_edges(&indices);

        Self {
            id,
            vertices,
            indices,
            edge_indices,
            bounds,
        }
    }

    /// Parse a mesh asset from OBJ format content.
    ///
    /// The OBJ content should be a valid Wavefront OBJ string.
    /// Vertex positions and faces are required. Normals are used when present;
    /// otherwise they are computed using area-weighted averaging.
    pub fn from_obj(id: String, obj_content: &str) -> Result<Self, String> {
        let mut cursor = std::io::Cursor::new(obj_content.as_bytes());

        let load_options = tobj::LoadOptions {
            triangulate: true,
            single_index: true,
            ..Default::default()
        };

        let (models, _materials) = tobj::load_obj_buf(
            &mut cursor,
            &load_options,
            |_| Ok((vec![], HashMap::new())),
        )
        .map_err(|e| format!("Failed to parse OBJ: {}", e))?;

        if models.is_empty() {
            return Err("OBJ file contains no models".to_string());
        }

        // Combine all models into a single mesh
        let mut all_positions: Vec<[f32; 3]> = Vec::new();
        let mut all_normals: Vec<[f32; 3]> = Vec::new();
        let mut all_indices = Vec::new();
        let mut vertex_offset = 0u16;
        let mut has_normals = true;

        for model in &models {
            let mesh = &model.mesh;

            // Extract positions (required)
            if mesh.positions.is_empty() {
                continue;
            }

            let vertex_count = mesh.positions.len() / 3;

            // Check if this model has normals
            let model_has_normals = mesh.normals.len() == mesh.positions.len();
            if !model_has_normals {
                has_normals = false;
            }

            // Extract positions and normals
            for i in 0..vertex_count {
                let position = [
                    mesh.positions[i * 3],
                    mesh.positions[i * 3 + 1],
                    mesh.positions[i * 3 + 2],
                ];
                all_positions.push(position);

                if model_has_normals {
                    let normal = [
                        mesh.normals[i * 3],
                        mesh.normals[i * 3 + 1],
                        mesh.normals[i * 3 + 2],
                    ];
                    all_normals.push(normal);
                }
            }

            // Extract indices with offset
            for idx in &mesh.indices {
                let adjusted_idx = vertex_offset + (*idx as u16);
                all_indices.push(adjusted_idx);
            }

            vertex_offset += vertex_count as u16;
        }

        if all_positions.is_empty() {
            return Err("OBJ file contains no vertices".to_string());
        }

        // Compute normals if not provided by any model
        let normals = if has_normals && all_normals.len() == all_positions.len() {
            all_normals
        } else {
            compute_vertex_normals(&all_positions, &all_indices)
        };

        // Build final vertices with position, normal, and color
        let vertices: Vec<Vertex> = all_positions
            .iter()
            .zip(normals.iter())
            .map(|(position, normal)| {
                // Use vertex position-based coloring for visual interest
                let color = [
                    (position[0].abs() * 0.5 + 0.5).clamp(0.3, 1.0),
                    (position[1].abs() * 0.5 + 0.5).clamp(0.3, 1.0),
                    (position[2].abs() * 0.5 + 0.5).clamp(0.3, 1.0),
                ];
                Vertex::new(*position, *normal, color)
            })
            .collect();

        Ok(Self::new(id, vertices, all_indices))
    }

    /// Get the number of triangles in the mesh.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Get the number of edges in the mesh (for wireframe).
    pub fn edge_count(&self) -> usize {
        self.edge_indices.len() / 2
    }
}

/// Extract unique edges from triangle indices for wireframe rendering.
///
/// Returns a flat array of vertex index pairs: [a0, b0, a1, b1, ...]
fn extract_edges(indices: &[u16]) -> Vec<u16> {
    let mut edges: HashSet<(u16, u16)> = HashSet::new();

    // Process each triangle
    for tri in indices.chunks(3) {
        if tri.len() != 3 {
            continue;
        }

        // Add three edges per triangle, normalized to ensure uniqueness
        for (a, b) in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
            let edge = if a < b { (a, b) } else { (b, a) };
            edges.insert(edge);
        }
    }

    // Flatten to index array
    edges.into_iter().flat_map(|(a, b)| [a, b]).collect()
}

/// Compute area-weighted vertex normals from face normals.
///
/// For each vertex, accumulates the (unnormalized) face normal of each adjacent triangle.
/// The resulting normal is normalized. This gives area-weighted averaging since
/// larger triangles contribute proportionally more to the normal.
fn compute_vertex_normals(positions: &[[f32; 3]], indices: &[u16]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0f32; 3]; positions.len()];

    // Process each triangle and accumulate face normals to vertices
    for tri in indices.chunks(3) {
        if tri.len() != 3 {
            continue;
        }

        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        // Skip degenerate triangles
        if i0 >= positions.len() || i1 >= positions.len() || i2 >= positions.len() {
            continue;
        }

        let p0 = positions[i0];
        let p1 = positions[i1];
        let p2 = positions[i2];

        // Compute edge vectors
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

        // Cross product (unnormalized face normal, magnitude = 2 * triangle area)
        let face_normal = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];

        // Accumulate to each vertex (area-weighted)
        for &idx in &[i0, i1, i2] {
            normals[idx][0] += face_normal[0];
            normals[idx][1] += face_normal[1];
            normals[idx][2] += face_normal[2];
        }
    }

    // Normalize all vertex normals
    for normal in &mut normals {
        let len = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if len > 1e-6 {
            normal[0] /= len;
            normal[1] /= len;
            normal[2] /= len;
        } else {
            // Degenerate normal, use Y-up as fallback
            *normal = [0.0, 1.0, 0.0];
        }
    }

    normals
}

/// Registry for loaded mesh assets.
///
/// Caches assets to avoid redundant loading and allows sharing across instances.
#[derive(Debug, Default)]
pub struct MeshAssetRegistry {
    assets: HashMap<String, Arc<MeshAsset>>,
}

impl MeshAssetRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a mesh asset from OBJ content.
    ///
    /// Returns true if the asset was registered successfully.
    pub fn register_from_obj(&mut self, asset_id: &str, obj_content: &str) -> Result<(), String> {
        let asset = MeshAsset::from_obj(asset_id.to_string(), obj_content)?;
        self.assets.insert(asset_id.to_string(), Arc::new(asset));
        Ok(())
    }

    /// Register a pre-built mesh asset.
    pub fn register(&mut self, asset: MeshAsset) {
        self.assets.insert(asset.id.clone(), Arc::new(asset));
    }

    /// Get a mesh asset by ID.
    pub fn get(&self, asset_id: &str) -> Option<Arc<MeshAsset>> {
        self.assets.get(asset_id).cloned()
    }

    /// Check if an asset is registered.
    pub fn contains(&self, asset_id: &str) -> bool {
        self.assets.contains_key(asset_id)
    }

    /// Unregister an asset.
    pub fn unregister(&mut self, asset_id: &str) -> bool {
        self.assets.remove(asset_id).is_some()
    }

    /// Get all registered asset IDs.
    pub fn asset_ids(&self) -> Vec<&str> {
        self.assets.keys().map(|s| s.as_str()).collect()
    }

    /// Clear all registered assets.
    pub fn clear(&mut self) {
        self.assets.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bounding_box_from_vertices() {
        let vertices = vec![
            Vertex::new([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
            Vertex::new([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
            Vertex::new([0.0, 2.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
        ];

        let bounds = BoundingBox::from_vertices(&vertices);
        assert_eq!(bounds.min, [-1.0, 0.0, 0.0]);
        assert_eq!(bounds.max, [1.0, 2.0, 0.0]);
    }

    #[test]
    fn test_edge_extraction() {
        // Single triangle
        let indices = vec![0, 1, 2];
        let edges = extract_edges(&indices);

        // Should have 3 edges = 6 indices
        assert_eq!(edges.len(), 6);

        // Two triangles sharing an edge (0-1)
        let indices = vec![0, 1, 2, 0, 1, 3];
        let edges = extract_edges(&indices);

        // Should have 5 unique edges (shared edge counted once)
        assert_eq!(edges.len(), 10);
    }

    #[test]
    fn test_obj_parsing() {
        let obj_content = r#"
            v 0 0 0
            v 1 0 0
            v 0 1 0
            f 1 2 3
        "#;

        let asset = MeshAsset::from_obj("test".to_string(), obj_content).unwrap();
        assert_eq!(asset.vertices.len(), 3);
        assert_eq!(asset.indices.len(), 3);
        assert_eq!(asset.triangle_count(), 1);
        assert_eq!(asset.edge_count(), 3);
    }

    #[test]
    fn test_registry() {
        let mut registry = MeshAssetRegistry::new();

        let obj_content = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";
        registry.register_from_obj("test", obj_content).unwrap();

        assert!(registry.contains("test"));
        assert!(!registry.contains("nonexistent"));

        let asset = registry.get("test").unwrap();
        assert_eq!(asset.id, "test");

        registry.unregister("test");
        assert!(!registry.contains("test"));
    }
}
