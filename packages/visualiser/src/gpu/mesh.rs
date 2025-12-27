use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub color: [f32; 3],
}

impl Vertex {
    const fn new(pos: [f32; 3], col: [f32; 3]) -> Self {
        Self { position: pos, color: col }
    }

    pub fn desc<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x3,
                },
                wgpu::VertexAttribute {
                    offset: 12, // [f32; 3] is 12 bytes
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x3,
                },
            ],
        }
    }
}

pub fn create_cube_geometry() -> (Vec<Vertex>, Vec<u16>) {
    let vertices = vec![
        // Front face (Z+) - Red
        Vertex::new([-0.5, -0.5, 0.5], [1.0, 0.2, 0.2]),
        Vertex::new([0.5, -0.5, 0.5], [1.0, 0.2, 0.2]),
        Vertex::new([0.5, 0.5, 0.5], [1.0, 0.2, 0.2]),
        Vertex::new([-0.5, 0.5, 0.5], [1.0, 0.2, 0.2]),
        // Back face (Z-) - Blue
        Vertex::new([-0.5, -0.5, -0.5], [0.2, 0.2, 1.0]),
        Vertex::new([-0.5, 0.5, -0.5], [0.2, 0.2, 1.0]),
        Vertex::new([0.5, 0.5, -0.5], [0.2, 0.2, 1.0]),
        Vertex::new([0.5, -0.5, -0.5], [0.2, 0.2, 1.0]),
        // Top face (Y+) - Green
        Vertex::new([-0.5, 0.5, -0.5], [0.2, 1.0, 0.2]),
        Vertex::new([-0.5, 0.5, 0.5], [0.2, 1.0, 0.2]),
        Vertex::new([0.5, 0.5, 0.5], [0.2, 1.0, 0.2]),
        Vertex::new([0.5, 0.5, -0.5], [0.2, 1.0, 0.2]),
        // Bottom face (Y-) - Yellow
        Vertex::new([-0.5, -0.5, -0.5], [1.0, 1.0, 0.2]),
        Vertex::new([0.5, -0.5, -0.5], [1.0, 1.0, 0.2]),
        Vertex::new([0.5, -0.5, 0.5], [1.0, 1.0, 0.2]),
        Vertex::new([-0.5, -0.5, 0.5], [1.0, 1.0, 0.2]),
        // Right face (X+) - Magenta
        Vertex::new([0.5, -0.5, -0.5], [1.0, 0.2, 1.0]),
        Vertex::new([0.5, 0.5, -0.5], [1.0, 0.2, 1.0]),
        Vertex::new([0.5, 0.5, 0.5], [1.0, 0.2, 1.0]),
        Vertex::new([0.5, -0.5, 0.5], [1.0, 0.2, 1.0]),
        // Left face (X-) - Cyan
        Vertex::new([-0.5, -0.5, -0.5], [0.2, 1.0, 1.0]),
        Vertex::new([-0.5, -0.5, 0.5], [0.2, 1.0, 1.0]),
        Vertex::new([-0.5, 0.5, 0.5], [0.2, 1.0, 1.0]),
        Vertex::new([-0.5, 0.5, -0.5], [0.2, 1.0, 1.0]),
    ];

    let indices = vec![
        0, 1, 2, 2, 3, 0, // Front
        4, 5, 6, 6, 7, 4, // Back
        8, 9, 10, 10, 11, 8, // Top
        12, 13, 14, 14, 15, 12, // Bottom
        16, 17, 18, 18, 19, 16, // Right
        20, 21, 22, 22, 23, 20, // Left
    ];

    (vertices, indices)
}

/// Create a unit plane in the XZ plane (Y up), centered at origin.
pub fn create_plane_geometry() -> (Vec<Vertex>, Vec<u16>) {
    let vertices = vec![
        // Four corners of the plane (white/gray gradient)
        Vertex::new([-0.5, 0.0, -0.5], [0.8, 0.8, 0.8]),
        Vertex::new([0.5, 0.0, -0.5], [0.9, 0.9, 0.9]),
        Vertex::new([0.5, 0.0, 0.5], [1.0, 1.0, 1.0]),
        Vertex::new([-0.5, 0.0, 0.5], [0.9, 0.9, 0.9]),
    ];

    let indices = vec![
        0, 1, 2, 2, 3, 0, // Top face
    ];

    (vertices, indices)
}

/// Create a UV sphere centered at origin with radius 0.5.
/// Uses 16 latitude rings and 32 longitude segments.
pub fn create_sphere_geometry() -> (Vec<Vertex>, Vec<u16>) {
    let lat_segments = 16;
    let lon_segments = 32;
    let radius = 0.5;

    let mut vertices = Vec::new();
    let mut indices = Vec::new();

    // Generate vertices
    for lat in 0..=lat_segments {
        let theta = std::f32::consts::PI * (lat as f32) / (lat_segments as f32);
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();

        for lon in 0..=lon_segments {
            let phi = 2.0 * std::f32::consts::PI * (lon as f32) / (lon_segments as f32);
            let sin_phi = phi.sin();
            let cos_phi = phi.cos();

            let x = cos_phi * sin_theta;
            let y = cos_theta;
            let z = sin_phi * sin_theta;

            let position = [x * radius, y * radius, z * radius];

            // Color gradient: poles are cool (blue), equator is warm (orange/red)
            let t = (y + 1.0) / 2.0; // 0 at bottom, 1 at top
            let equator_dist = (0.5 - t).abs() * 2.0; // 0 at equator, 1 at poles

            // Interpolate: equator (warm orange) -> poles (cool blue)
            let color = [
                1.0 - equator_dist * 0.7,  // R: high at equator, lower at poles
                0.4 + equator_dist * 0.4,  // G: medium everywhere
                0.2 + equator_dist * 0.8,  // B: low at equator, high at poles
            ];

            vertices.push(Vertex::new(position, color));
        }
    }

    // Generate indices
    for lat in 0..lat_segments {
        for lon in 0..lon_segments {
            let first = (lat * (lon_segments + 1) + lon) as u16;
            let second = first + lon_segments as u16 + 1;

            // Two triangles per quad
            indices.push(first);
            indices.push(second);
            indices.push(first + 1);

            indices.push(second);
            indices.push(second + 1);
            indices.push(first + 1);
        }
    }

    (vertices, indices)
}

/// 8 corners of a unit cube for debug bounding box rendering.
/// Order: 4 corners on Z- face, then 4 corners on Z+ face.
pub const DEBUG_CUBE_VERTICES: [[f32; 3]; 8] = [
    [-0.5, -0.5, -0.5], // 0: left-bottom-back
    [ 0.5, -0.5, -0.5], // 1: right-bottom-back
    [ 0.5,  0.5, -0.5], // 2: right-top-back
    [-0.5,  0.5, -0.5], // 3: left-top-back
    [-0.5, -0.5,  0.5], // 4: left-bottom-front
    [ 0.5, -0.5,  0.5], // 5: right-bottom-front
    [ 0.5,  0.5,  0.5], // 6: right-top-front
    [-0.5,  0.5,  0.5], // 7: left-top-front
];

/// 12 edges of a cube as vertex index pairs (24 indices for LineList topology).
/// Edges: 4 on back face, 4 on front face, 4 connecting front to back.
pub const DEBUG_CUBE_EDGES: [u16; 24] = [
    // Back face (Z-)
    0, 1, 1, 2, 2, 3, 3, 0,
    // Front face (Z+)
    4, 5, 5, 6, 6, 7, 7, 4,
    // Connecting edges
    0, 4, 1, 5, 2, 6, 3, 7,
];

/// Create debug cube geometry for bounding box visualization.
/// Returns vertices (with yellow color for visibility) and edge indices.
pub fn create_debug_cube_geometry() -> (Vec<Vertex>, Vec<u16>) {
    let color = [1.0, 0.9, 0.0]; // Yellow for debug bounds
    let vertices: Vec<Vertex> = DEBUG_CUBE_VERTICES
        .iter()
        .map(|&pos| Vertex::new(pos, color))
        .collect();
    let indices = DEBUG_CUBE_EDGES.to_vec();
    (vertices, indices)
}

/// Extract unique edges from triangle indices for wireframe rendering.
///
/// Returns a flat array of vertex index pairs: [a0, b0, a1, b1, ...]
pub fn extract_edges(indices: &[u16]) -> Vec<u16> {
    use std::collections::HashSet;

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
