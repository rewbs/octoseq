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
