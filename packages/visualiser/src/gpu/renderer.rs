//! GPU renderer for the scene graph.
//!
//! Renders meshes and line strips from the script-driven scene graph.

use wgpu::util::DeviceExt;
use crate::gpu::mesh::{self, Vertex};
use crate::gpu::pipeline;
use crate::gpu::material_pipeline::{MaterialPipelineManager, GlobalUniforms};
use crate::gpu::post_processor::PostProcessor;
use crate::visualiser::VisualiserState;
use crate::camera::CameraUniforms;
use crate::scene_graph::{MeshType, RenderMode, Transform};
use crate::deformation::apply_deformations;
use crate::mesh_asset::{MeshAsset, BoundingBox, CUBE_BOUNDS, PLANE_BOUNDS, SPHERE_BOUNDS};
use crate::material::{MaterialRegistry, ParamValue};
use crate::particle_eval::{GpuMeshParticleInstance, GpuParticleInstance};
use crate::post_processing::PostEffectRegistry;
use bytemuck::{Pod, Zeroable};
use std::collections::HashMap;
use std::iter;
use std::sync::Arc;

/// Maximum number of mesh particle instances per draw call.
const MAX_MESH_PARTICLE_INSTANCES: usize = 500;

/// Maximum points per line strip.
const MAX_POINTS_PER_LINE: usize = 1024;

/// Maximum points per point cloud.
const MAX_POINTS_PER_CLOUD: usize = 10000;

/// Maximum number of meshes that can be rendered per frame.
/// Each mesh needs its own uniform slot in the dynamic uniform buffer.
const MAX_MESHES_PER_FRAME: usize = 256;

/// Uniform buffer alignment (WebGPU minUniformBufferOffsetAlignment is typically 256 bytes)
const UNIFORM_ALIGNMENT: usize = 256;

#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct Uniforms {
    view_proj: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
    instance_color: [f32; 4],
    // Padding to reach 256-byte alignment (144 bytes of data + 112 bytes padding)
    _padding: [f32; 28],
}

/// Uniforms for blob shadow rendering.
/// Matches shader_blob_shadow.wgsl ShadowUniforms struct.
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct ShadowUniforms {
    /// Shadow center position (x, y, z, unused)
    center: [f32; 4],
    /// Shadow color (rgb) and opacity (a)
    color: [f32; 4],
    /// Radius (x, z) and softness (z), w unused
    params: [f32; 4],
}

impl Uniforms {
    fn new() -> Self {
        Self {
            view_proj: glam::Mat4::IDENTITY.to_cols_array_2d(),
            model: glam::Mat4::IDENTITY.to_cols_array_2d(),
            instance_color: [1.0, 1.0, 1.0, 1.0], // Default: no tint
            _padding: [0.0; 28],
        }
    }

    fn update_view_proj(&mut self, size: wgpu::Extent3d, camera: &CameraUniforms) {
        let aspect = size.width as f32 / size.height as f32;

        // Use the view-projection matrix from camera uniforms
        self.view_proj = camera.view_projection_matrix(aspect).to_cols_array_2d();
    }

    fn update_model(&mut self, transform: &Transform) {
        // Position
        let translation = glam::Mat4::from_translation(glam::Vec3::new(
            transform.position.x,
            transform.position.y,
            transform.position.z,
        ));

        // Rotation (Euler XYZ)
        let rotation = glam::Mat4::from_euler(
            glam::EulerRot::XYZ,
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
        );

        // Scale (use x component for uniform scale, or full scale)
        let scale = glam::Mat4::from_scale(glam::Vec3::new(
            transform.scale.x,
            transform.scale.y,
            transform.scale.z,
        ));

        // Model = Translation * Rotation * Scale
        self.model = (translation * rotation * scale).to_cols_array_2d();
    }

    fn update_model_with_parent(&mut self, local_transform: &Transform, parent_model: glam::Mat4) {
        // Compute local model matrix
        let translation = glam::Mat4::from_translation(glam::Vec3::new(
            local_transform.position.x,
            local_transform.position.y,
            local_transform.position.z,
        ));
        let rotation = glam::Mat4::from_euler(
            glam::EulerRot::XYZ,
            local_transform.rotation.x,
            local_transform.rotation.y,
            local_transform.rotation.z,
        );
        let scale = glam::Mat4::from_scale(glam::Vec3::new(
            local_transform.scale.x,
            local_transform.scale.y,
            local_transform.scale.z,
        ));
        let local_model = translation * rotation * scale;

        // World = Parent * Local
        self.model = (parent_model * local_model).to_cols_array_2d();
    }
}

/// Compute the world transform matrix for an entity, walking up the parent chain.
fn compute_world_matrix(entity_id: crate::scene_graph::EntityId, scene_graph: &crate::scene_graph::SceneGraph) -> glam::Mat4 {
    let entity = match scene_graph.get(entity_id) {
        Some(e) => e,
        None => return glam::Mat4::IDENTITY,
    };

    let local_transform = entity.transform();
    let translation = glam::Mat4::from_translation(glam::Vec3::new(
        local_transform.position.x,
        local_transform.position.y,
        local_transform.position.z,
    ));
    let rotation = glam::Mat4::from_euler(
        glam::EulerRot::XYZ,
        local_transform.rotation.x,
        local_transform.rotation.y,
        local_transform.rotation.z,
    );
    let scale = glam::Mat4::from_scale(glam::Vec3::new(
        local_transform.scale.x,
        local_transform.scale.y,
        local_transform.scale.z,
    ));
    let local_matrix = translation * rotation * scale;

    // Check for parent
    if let Some(parent_id) = scene_graph.get_parent(entity_id) {
        let parent_matrix = compute_world_matrix(parent_id, scene_graph);
        parent_matrix * local_matrix
    } else {
        local_matrix
    }
}

/// Compute world-space bounding box vertices from local bounds and world transform.
/// Returns 8 vertices with the given color.
fn compute_world_bounds_vertices(
    local_bounds: &BoundingBox,
    world_matrix: glam::Mat4,
    color: [f32; 3],
) -> [Vertex; 8] {
    let min = local_bounds.min;
    let max = local_bounds.max;

    // 8 corners of the local AABB (same order as DEBUG_CUBE_VERTICES)
    let local_corners = [
        glam::Vec3::new(min[0], min[1], min[2]),
        glam::Vec3::new(max[0], min[1], min[2]),
        glam::Vec3::new(max[0], max[1], min[2]),
        glam::Vec3::new(min[0], max[1], min[2]),
        glam::Vec3::new(min[0], min[1], max[2]),
        glam::Vec3::new(max[0], min[1], max[2]),
        glam::Vec3::new(max[0], max[1], max[2]),
        glam::Vec3::new(min[0], max[1], max[2]),
    ];

    // Transform each corner to world space
    // For debug wireframe, use a default normal (not used in shading)
    let default_normal = [0.0, 1.0, 0.0];
    let mut vertices = [Vertex::new([0.0; 3], default_normal, color); 8];
    for (i, corner) in local_corners.iter().enumerate() {
        let world_pos = world_matrix.transform_point3(*corner);
        vertices[i].position = [world_pos.x, world_pos.y, world_pos.z];
    }
    vertices
}

/// Check if an entity or any of its ancestors is invisible.
fn is_entity_visible(entity_id: crate::scene_graph::EntityId, scene_graph: &crate::scene_graph::SceneGraph) -> bool {
    let entity = match scene_graph.get(entity_id) {
        Some(e) => e,
        None => return false,
    };

    if !entity.visible() {
        return false;
    }

    // Check parent visibility
    if let Some(parent_id) = scene_graph.get_parent(entity_id) {
        is_entity_visible(parent_id, scene_graph)
    } else {
        true
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct LineUniforms {
    color: [f32; 4],
    offset: [f32; 2],
    scale: [f32; 2],
    count: f32,        // Number of valid points
    max_points: f32,   // Capacity
    _padding: [f32; 2],
}

/// Uniforms for point cloud rendering.
/// Matches shader_point_cloud.wgsl PointCloudUniforms struct.
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct PointCloudUniforms {
    view_proj: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
    color: [f32; 4],
    point_size: f32,
    _padding: [f32; 3],
}

/// Shared geometry for a mesh type.
struct MeshGeometry {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
    num_vertices: u32,
    /// Edge indices for wireframe rendering.
    wireframe_index_buffer: Option<wgpu::Buffer>,
    num_edges: u32,
}

/// Buffers for a loaded mesh asset.
struct LoadedMeshBuffers {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    wireframe_index_buffer: wgpu::Buffer,
    num_indices: u32,
    num_edges: u32,
    num_vertices: u32,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    size: wgpu::Extent3d,

    // Mesh rendering
    mesh_pipeline: wgpu::RenderPipeline,
    wireframe_pipeline: wgpu::RenderPipeline,
    #[allow(dead_code)]
    mesh_bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    mesh_bind_group: wgpu::BindGroup,
    uniforms: Uniforms,

    // Shared geometry
    cube_geometry: MeshGeometry,
    plane_geometry: MeshGeometry,
    sphere_geometry: MeshGeometry,

    // Debug bounding box geometry (8-vertex cube with 12 edges)
    debug_cube_geometry: MeshGeometry,
    debug_bounds_vertex_buffer: wgpu::Buffer,

    // Loaded mesh assets (created on demand)
    loaded_mesh_buffers: HashMap<String, LoadedMeshBuffers>,

    // Dynamic radial ring geometry (regenerated when parameters change)
    radial_ring_geometry: Option<MeshGeometry>,
    radial_ring_params: Option<(f32, f32, f32, f32, u32, f32)>, // (radius, thickness, start, end, segments, depth)

    // Staging buffer for deformed vertices (reused each frame)
    deformed_vertex_staging: wgpu::Buffer,

    // Line rendering
    line_pipeline: wgpu::RenderPipeline,
    #[allow(dead_code)]
    line_bind_group_layout: wgpu::BindGroupLayout,

    // Dynamic line buffers (reused each frame)
    line_vertex_buffer: wgpu::Buffer,
    line_uniform_buffer: wgpu::Buffer,
    line_bind_group: wgpu::BindGroup,

    // Point cloud rendering
    point_cloud_pipeline: wgpu::RenderPipeline,
    #[allow(dead_code)]
    point_cloud_bind_group_layout: wgpu::BindGroupLayout,
    point_cloud_vertex_buffer: wgpu::Buffer,
    point_cloud_uniform_buffer: wgpu::Buffer,
    point_cloud_bind_group: wgpu::BindGroup,

    // Mesh particle rendering
    mesh_particle_pipeline: wgpu::RenderPipeline,
    mesh_particle_instance_buffer: wgpu::Buffer,
    mesh_particle_view_buffer: wgpu::Buffer,
    /// Bind group for mesh particles (uses view_proj only)
    mesh_particle_bind_group: wgpu::BindGroup,

    // Billboard particle rendering
    billboard_particle_pipeline: wgpu::RenderPipeline,
    billboard_particle_instance_buffer: wgpu::Buffer,
    billboard_particle_uniform_buffer: wgpu::Buffer,
    billboard_particle_bind_group: wgpu::BindGroup,
    billboard_quad_vertex_buffer: wgpu::Buffer,
    billboard_quad_index_buffer: wgpu::Buffer,

    // Material system
    material_registry: MaterialRegistry,
    material_pipeline_manager: MaterialPipelineManager,
    /// Global uniforms for material pipelines (time, dt, etc.)
    material_global_uniforms: GlobalUniforms,

    // Blob shadow rendering
    shadow_pipeline: wgpu::RenderPipeline,
    shadow_uniform_buffer: wgpu::Buffer,
    shadow_bind_group: wgpu::BindGroup,
    #[allow(dead_code)]
    shadow_bind_group_layout: wgpu::BindGroupLayout,

    // Post-processing and feedback
    post_processor: PostProcessor,
    post_effect_registry: PostEffectRegistry,
    format: wgpu::TextureFormat,
}

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat, width: u32, height: u32) -> Self {
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };

        // === Mesh Pipeline Setup ===

        let mut uniforms = Uniforms::new();
        let default_camera = CameraUniforms::new();
        uniforms.update_view_proj(size, &default_camera);

        // Create a large uniform buffer for dynamic uniform binding (one slot per mesh)
        let uniform_buffer_size = (UNIFORM_ALIGNMENT * MAX_MESHES_PER_FRAME) as u64;
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Mesh Uniform Buffer (Dynamic)"),
            size: uniform_buffer_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mesh_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true, // Enable dynamic offsets
                    min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
                },
                count: None,
            }],
            label: Some("mesh_bind_group_layout"),
        });

        let mesh_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &mesh_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &uniform_buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
                }),
            }],
            label: Some("mesh_bind_group"),
        });

        let mesh_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mesh Pipeline Layout"),
            bind_group_layouts: &[&mesh_bind_group_layout],
            push_constant_ranges: &[],
        });

        let mesh_pipeline = pipeline::create_render_pipeline(&device, &mesh_pipeline_layout, format);
        let wireframe_pipeline = pipeline::create_wireframe_pipeline(&device, &mesh_pipeline_layout, format);

        // === Geometry Setup ===

        // Cube geometry
        let (cube_vertices, cube_indices) = mesh::create_cube_geometry();
        let cube_edge_indices = mesh::extract_edges(&cube_indices);
        let cube_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Cube Vertex Buffer"),
            contents: bytemuck::cast_slice(&cube_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let cube_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Cube Index Buffer"),
            contents: bytemuck::cast_slice(&cube_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let cube_wireframe_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Cube Wireframe Index Buffer"),
            contents: bytemuck::cast_slice(&cube_edge_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let cube_geometry = MeshGeometry {
            vertex_buffer: cube_vertex_buffer,
            index_buffer: cube_index_buffer,
            num_indices: cube_indices.len() as u32,
            num_vertices: cube_vertices.len() as u32,
            wireframe_index_buffer: Some(cube_wireframe_index_buffer),
            num_edges: cube_edge_indices.len() as u32,
        };

        // Plane geometry
        let (plane_vertices, plane_indices) = mesh::create_plane_geometry();
        let plane_edge_indices = mesh::extract_edges(&plane_indices);
        let plane_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Plane Vertex Buffer"),
            contents: bytemuck::cast_slice(&plane_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let plane_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Plane Index Buffer"),
            contents: bytemuck::cast_slice(&plane_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let plane_wireframe_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Plane Wireframe Index Buffer"),
            contents: bytemuck::cast_slice(&plane_edge_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let plane_geometry = MeshGeometry {
            vertex_buffer: plane_vertex_buffer,
            index_buffer: plane_index_buffer,
            num_indices: plane_indices.len() as u32,
            num_vertices: plane_vertices.len() as u32,
            wireframe_index_buffer: Some(plane_wireframe_index_buffer),
            num_edges: plane_edge_indices.len() as u32,
        };

        // Sphere geometry
        let (sphere_vertices, sphere_indices) = mesh::create_sphere_geometry();
        let sphere_edge_indices = mesh::extract_edges(&sphere_indices);
        let sphere_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sphere Vertex Buffer"),
            contents: bytemuck::cast_slice(&sphere_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let sphere_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sphere Index Buffer"),
            contents: bytemuck::cast_slice(&sphere_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let sphere_wireframe_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sphere Wireframe Index Buffer"),
            contents: bytemuck::cast_slice(&sphere_edge_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let sphere_geometry = MeshGeometry {
            vertex_buffer: sphere_vertex_buffer,
            index_buffer: sphere_index_buffer,
            num_indices: sphere_indices.len() as u32,
            num_vertices: sphere_vertices.len() as u32,
            wireframe_index_buffer: Some(sphere_wireframe_index_buffer),
            num_edges: sphere_edge_indices.len() as u32,
        };

        // Debug cube geometry (8 vertices, 12 edges for wireframe bounding box)
        let (debug_cube_vertices, debug_cube_edges) = mesh::create_debug_cube_geometry();
        let debug_cube_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Debug Cube Vertex Buffer"),
            contents: bytemuck::cast_slice(&debug_cube_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let debug_cube_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Debug Cube Index Buffer"),
            contents: bytemuck::cast_slice(&debug_cube_edges),
            usage: wgpu::BufferUsages::INDEX,
        });
        let debug_cube_geometry = MeshGeometry {
            vertex_buffer: debug_cube_vertex_buffer,
            index_buffer: debug_cube_index_buffer,
            num_indices: 0, // Not used for debug cube (we only draw wireframe)
            num_vertices: debug_cube_vertices.len() as u32,
            wireframe_index_buffer: None, // We use index_buffer directly for edges
            num_edges: debug_cube_edges.len() as u32,
        };

        // Staging buffer for transformed debug bounding box vertices
        // 8 vertices per bounding box
        let debug_bounds_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Debug Bounds Vertex Buffer"),
            size: (8 * std::mem::size_of::<Vertex>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Deformed vertex staging buffer (for CPU-side deformations)
        // Size to hold up to 65536 vertices (maximum for u16 indices)
        let max_deformed_vertices = 65536;
        let deformed_vertex_staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Deformed Vertex Staging Buffer"),
            size: (max_deformed_vertices * std::mem::size_of::<Vertex>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // === Line Pipeline Setup ===

        let line_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
            label: Some("line_bind_group_layout"),
        });

        let line_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Line Pipeline Layout"),
            bind_group_layouts: &[&line_bind_group_layout],
            push_constant_ranges: &[],
        });

        let line_pipeline = pipeline::create_sparkline_pipeline(&device, &line_pipeline_layout, format);

        // Line vertex buffer (stores x,y pairs as floats)
        let line_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Line Vertex Buffer"),
            size: (MAX_POINTS_PER_LINE * 2 * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Line uniforms
        let line_uniforms = LineUniforms {
            color: [0.0, 1.0, 0.0, 1.0],
            offset: [-0.9, 0.0],
            scale: [1.8, 0.4],
            count: 0.0,
            max_points: MAX_POINTS_PER_LINE as f32,
            _padding: [0.0; 2],
        };

        let line_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Line Uniform Buffer"),
            contents: bytemuck::cast_slice(&[line_uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let line_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &line_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: line_uniform_buffer.as_entire_binding(),
            }],
            label: Some("line_bind_group"),
        });

        // === Point Cloud Pipeline Setup ===

        let point_cloud_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
            label: Some("point_cloud_bind_group_layout"),
        });

        let point_cloud_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Point Cloud Pipeline Layout"),
            bind_group_layouts: &[&point_cloud_bind_group_layout],
            push_constant_ranges: &[],
        });

        let point_cloud_pipeline = pipeline::create_point_cloud_pipeline(&device, &point_cloud_pipeline_layout, format);

        // Point cloud vertex buffer (stores vec3 positions)
        let point_cloud_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Point Cloud Vertex Buffer"),
            size: (MAX_POINTS_PER_CLOUD * 3 * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Point cloud uniforms
        let point_cloud_uniforms = PointCloudUniforms {
            view_proj: [[0.0; 4]; 4],
            model: [[0.0; 4]; 4],
            color: [1.0, 1.0, 1.0, 1.0],
            point_size: 2.0,
            _padding: [0.0; 3],
        };

        let point_cloud_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Point Cloud Uniform Buffer"),
            contents: bytemuck::cast_slice(&[point_cloud_uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let point_cloud_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &point_cloud_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: point_cloud_uniform_buffer.as_entire_binding(),
            }],
            label: Some("point_cloud_bind_group"),
        });

        // === Mesh Particle Pipeline Setup ===

        // Create a view-only uniform buffer for mesh particles (just view_proj matrix)
        let mesh_particle_view_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Mesh Particle View Buffer"),
            contents: bytemuck::cast_slice(&uniforms.view_proj),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Create bind group layout for mesh particles (view_proj only)
        let mesh_particle_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
            label: Some("mesh_particle_bind_group_layout"),
        });

        let mesh_particle_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &mesh_particle_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: mesh_particle_view_buffer.as_entire_binding(),
            }],
            label: Some("mesh_particle_bind_group"),
        });

        let mesh_particle_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mesh Particle Pipeline Layout"),
            bind_group_layouts: &[&mesh_particle_bind_group_layout],
            push_constant_ranges: &[],
        });

        let mesh_particle_pipeline = pipeline::create_mesh_particle_pipeline(&device, &mesh_particle_pipeline_layout, format);

        // Instance buffer for mesh particles
        let mesh_particle_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Mesh Particle Instance Buffer"),
            size: (MAX_MESH_PARTICLE_INSTANCES * std::mem::size_of::<GpuMeshParticleInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // === Billboard Particle Pipeline Setup ===

        // Billboard uniforms: view_proj (mat4) + camera_right (vec4) + camera_up (vec4)
        // Total: 16 + 4 + 4 = 24 floats = 96 bytes
        let billboard_uniform_data: [f32; 24] = [0.0; 24];
        let billboard_particle_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Billboard Particle Uniform Buffer"),
            contents: bytemuck::cast_slice(&billboard_uniform_data),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Bind group layout for billboard particles (view_proj + camera vectors)
        let billboard_particle_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
            label: Some("billboard_particle_bind_group_layout"),
        });

        let billboard_particle_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &billboard_particle_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: billboard_particle_uniform_buffer.as_entire_binding(),
            }],
            label: Some("billboard_particle_bind_group"),
        });

        let billboard_particle_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Billboard Particle Pipeline Layout"),
            bind_group_layouts: &[&billboard_particle_bind_group_layout],
            push_constant_ranges: &[],
        });

        let billboard_particle_pipeline = pipeline::create_billboard_particle_pipeline(&device, &billboard_particle_pipeline_layout, format);

        // Instance buffer for billboard particles
        let billboard_particle_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Billboard Particle Instance Buffer"),
            size: (MAX_MESH_PARTICLE_INSTANCES * std::mem::size_of::<GpuParticleInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Quad geometry for billboard particles (4 vertices, 6 indices)
        // Positions: (-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)
        let quad_vertices: [f32; 8] = [
            -0.5, -0.5,  // bottom-left
             0.5, -0.5,  // bottom-right
             0.5,  0.5,  // top-right
            -0.5,  0.5,  // top-left
        ];
        let quad_indices: [u16; 6] = [0, 1, 2, 0, 2, 3];

        let billboard_quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Billboard Quad Vertex Buffer"),
            contents: bytemuck::cast_slice(&quad_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let billboard_quad_index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Billboard Quad Index Buffer"),
            contents: bytemuck::cast_slice(&quad_indices),
            usage: wgpu::BufferUsages::INDEX,
        });

        // === Material System Setup ===
        let material_registry = MaterialRegistry::new();
        let material_pipeline_manager = MaterialPipelineManager::new(&device, format, &material_registry);
        let material_global_uniforms = GlobalUniforms::default();

        // === Blob Shadow Pipeline Setup ===
        let shadow_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Blob Shadow Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_blob_shadow.wgsl").into()),
        });

        // Create shadow bind group layout (uses global uniforms + shadow-specific uniforms)
        let shadow_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Shadow Bind Group Layout"),
            entries: &[
                // Global uniforms (view_proj, etc.) - reuse material global layout pattern
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Create shadow-specific bind group layout
        let shadow_params_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Shadow Params Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let shadow_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Shadow Pipeline Layout"),
            bind_group_layouts: &[&shadow_bind_group_layout, &shadow_params_bind_group_layout],
            push_constant_ranges: &[],
        });

        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Blob Shadow Pipeline"),
            layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shadow_shader,
                entry_point: Some("vs_main"),
                buffers: &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shadow_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    // Multiply blend for shadow (darkens the background)
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::Zero,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent::OVER,
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None, // Render both sides
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Shadow uniform buffer (per-shadow)
        let shadow_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Shadow Uniform Buffer"),
            contents: bytemuck::cast_slice(&[ShadowUniforms {
                center: [0.0, 0.0, 0.0, 0.0],
                color: [0.0, 0.0, 0.0, 0.5],
                params: [1.0, 1.0, 0.3, 0.0],
            }]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Shadow bind group (uses material global uniform buffer for globals)
        let shadow_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Shadow Bind Group"),
            layout: &shadow_params_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: shadow_uniform_buffer.as_entire_binding(),
            }],
        });

        // === Post-processing and Feedback ===
        let post_effect_registry = PostEffectRegistry::new();
        let post_processor = PostProcessor::new(&device, format, width, height, &post_effect_registry);

        Self {
            device,
            queue,
            size,
            mesh_pipeline,
            wireframe_pipeline,
            mesh_bind_group_layout,
            uniform_buffer,
            mesh_bind_group,
            uniforms,
            cube_geometry,
            plane_geometry,
            sphere_geometry,
            debug_cube_geometry,
            debug_bounds_vertex_buffer,
            loaded_mesh_buffers: HashMap::new(),
            radial_ring_geometry: None,
            radial_ring_params: None,
            deformed_vertex_staging,
            line_pipeline,
            line_bind_group_layout,
            line_vertex_buffer,
            line_uniform_buffer,
            line_bind_group,
            point_cloud_pipeline,
            point_cloud_bind_group_layout,
            point_cloud_vertex_buffer,
            point_cloud_uniform_buffer,
            point_cloud_bind_group,
            mesh_particle_pipeline,
            mesh_particle_instance_buffer,
            mesh_particle_view_buffer,
            mesh_particle_bind_group,
            billboard_particle_pipeline,
            billboard_particle_instance_buffer,
            billboard_particle_uniform_buffer,
            billboard_particle_bind_group,
            billboard_quad_vertex_buffer,
            billboard_quad_index_buffer,
            material_registry,
            material_pipeline_manager,
            material_global_uniforms,
            shadow_pipeline,
            shadow_uniform_buffer,
            shadow_bind_group,
            shadow_bind_group_layout,
            post_processor,
            post_effect_registry,
            format,
        }
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// Get the material registry.
    pub fn material_registry(&self) -> &MaterialRegistry {
        &self.material_registry
    }

    /// Get the material pipeline manager.
    pub fn material_pipeline_manager(&self) -> &MaterialPipelineManager {
        &self.material_pipeline_manager
    }

    /// Evaluate material parameters from a mesh instance.
    /// Resolves parameters in the order defined by the material schema,
    /// using mesh overrides where provided, falling back to defaults.
    fn evaluate_material_params(
        &self,
        material_id: &str,
        mesh_params: &crate::scene_graph::MaterialParams,
    ) -> Vec<ParamValue> {
        let material = match self.material_registry.get(material_id) {
            Some(m) => m,
            None => return vec![],
        };

        let mut values = Vec::new();
        for param_def in &material.params {
            // Check if mesh provides an override
            let value = mesh_params.values.get(&param_def.name)
                .cloned()
                .unwrap_or_else(|| param_def.default_value.clone());
            values.push(value);
        }
        values
    }

    pub fn resize(&mut self, width: u32, height: u32, state: &VisualiserState) {
        if width > 0 && height > 0 {
            self.size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
            self.uniforms.update_view_proj(self.size, state.camera_uniforms());
            self.post_processor.resize(&self.device, width, height);
        }
    }

    fn get_geometry(&self, mesh_type: &MeshType) -> Option<&MeshGeometry> {
        match mesh_type {
            MeshType::Cube => Some(&self.cube_geometry),
            MeshType::Plane => Some(&self.plane_geometry),
            MeshType::Sphere => Some(&self.sphere_geometry),
            MeshType::Asset(_) => None, // Loaded mesh assets handled separately
            MeshType::RadialRing { .. } => None, // Dynamic geometry handled separately
        }
    }

    /// Get or create geometry for a radial ring, regenerating if parameters changed.
    fn get_or_create_radial_ring_geometry(
        &mut self,
        radius: f32,
        thickness: f32,
        start_angle: f32,
        end_angle: f32,
        segments: u32,
        depth: f32,
    ) -> &MeshGeometry {
        let params = (radius, thickness, start_angle, end_angle, segments, depth);

        // Regenerate if parameters changed
        if self.radial_ring_params != Some(params) {
            let (vertices, indices) = mesh::create_radial_ring_geometry(
                radius,
                thickness,
                start_angle,
                end_angle,
                segments,
                depth,
            );

            let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Radial Ring Vertex Buffer"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });

            let index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Radial Ring Index Buffer"),
                contents: bytemuck::cast_slice(&indices),
                usage: wgpu::BufferUsages::INDEX,
            });

            let edge_indices = mesh::extract_edges(&indices);
            let wireframe_index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Radial Ring Wireframe Index Buffer"),
                contents: bytemuck::cast_slice(&edge_indices),
                usage: wgpu::BufferUsages::INDEX,
            });

            self.radial_ring_geometry = Some(MeshGeometry {
                vertex_buffer,
                index_buffer,
                wireframe_index_buffer: Some(wireframe_index_buffer),
                num_indices: indices.len() as u32,
                num_edges: edge_indices.len() as u32,
                num_vertices: vertices.len() as u32,
            });
            self.radial_ring_params = Some(params);
        }

        self.radial_ring_geometry.as_ref().unwrap()
    }

    /// Get or create GPU buffers for a loaded mesh asset.
    fn get_or_create_loaded_mesh_buffers(&mut self, asset: &Arc<MeshAsset>) -> &LoadedMeshBuffers {
        if !self.loaded_mesh_buffers.contains_key(&asset.id) {
            let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(&format!("Loaded Mesh Vertex Buffer: {}", asset.id)),
                contents: bytemuck::cast_slice(&asset.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(&format!("Loaded Mesh Index Buffer: {}", asset.id)),
                contents: bytemuck::cast_slice(&asset.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            let wireframe_index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(&format!("Loaded Mesh Wireframe Index Buffer: {}", asset.id)),
                contents: bytemuck::cast_slice(&asset.edge_indices),
                usage: wgpu::BufferUsages::INDEX,
            });

            self.loaded_mesh_buffers.insert(asset.id.clone(), LoadedMeshBuffers {
                vertex_buffer,
                index_buffer,
                wireframe_index_buffer,
                num_indices: asset.indices.len() as u32,
                num_edges: asset.edge_indices.len() as u32,
                num_vertices: asset.vertices.len() as u32,
            });
        }
        self.loaded_mesh_buffers.get(&asset.id).unwrap()
    }

    pub fn render(&mut self, view: &wgpu::TextureView, state: &VisualiserState) {
        let scene_graph = state.scene_graph();
        let camera = state.camera_uniforms();
        let lighting = state.lighting_uniforms();

        // Update view projection
        self.uniforms.update_view_proj(self.size, camera);

        // Update global material uniforms with lighting data (once per frame)
        self.material_global_uniforms.light_direction = lighting.direction;
        self.material_global_uniforms.light_color = lighting.color;
        self.material_global_uniforms.light_intensity = lighting.intensity;
        self.material_global_uniforms.ambient_intensity = lighting.ambient;
        self.material_global_uniforms.rim_intensity = lighting.rim_intensity;
        self.material_global_uniforms.rim_power = lighting.rim_power;
        self.material_global_uniforms.lighting_enabled = lighting.enabled;
        self.material_global_uniforms.camera_position = camera.position;

        // Collect meshes to render (we need to clone data to avoid borrow conflicts)
        // Include entity_id for debug bounds checking
        let meshes_to_render: Vec<_> = scene_graph.meshes()
            .filter(|(entity_id, _mesh)| {
                // Check isolation mode
                if let Some(isolated_id) = state.debug_options.isolated_entity {
                    if *entity_id != isolated_id {
                        return false;
                    }
                }
                // Check visibility
                is_entity_visible(*entity_id, scene_graph)
            })
            .map(|(entity_id, mesh)| {
                let world_matrix = compute_world_matrix(entity_id, scene_graph);
                (entity_id, mesh.clone(), world_matrix)
            })
            .collect();

        // Collect lines to render
        let lines_to_render: Vec<_> = scene_graph.lines()
            .enumerate()
            .filter(|(_, (entity_id, line))| {
                if let Some(isolated_id) = state.debug_options.isolated_entity {
                    if *entity_id != isolated_id {
                        return false;
                    }
                }
                is_entity_visible(*entity_id, scene_graph) && line.count > 0
            })
            .map(|(idx, (_entity_id, line))| (idx, line.clone()))
            .collect();

        // Collect point clouds to render
        let point_clouds_to_render: Vec<_> = scene_graph.point_clouds()
            .filter(|(entity_id, cloud)| {
                if let Some(isolated_id) = state.debug_options.isolated_entity {
                    if *entity_id != isolated_id {
                        return false;
                    }
                }
                is_entity_visible(*entity_id, scene_graph) && !cloud.positions.is_empty()
            })
            .map(|(entity_id, cloud)| {
                let world_matrix = compute_world_matrix(entity_id, scene_graph);
                (cloud.clone(), world_matrix)
            })
            .collect();

        // Collect radial waves to render
        let radial_waves_to_render: Vec<_> = scene_graph.radial_waves()
            .filter(|(entity_id, _wave)| {
                if let Some(isolated_id) = state.debug_options.isolated_entity {
                    if *entity_id != isolated_id {
                        return false;
                    }
                }
                is_entity_visible(*entity_id, scene_graph)
            })
            .map(|(entity_id, wave)| {
                let world_matrix = compute_world_matrix(entity_id, scene_graph);
                (wave.clone(), world_matrix)
            })
            .collect();

        // Collect ribbons to render
        let ribbons_to_render: Vec<_> = scene_graph.ribbons()
            .filter(|(entity_id, ribbon)| {
                if let Some(isolated_id) = state.debug_options.isolated_entity {
                    if *entity_id != isolated_id {
                        return false;
                    }
                }
                is_entity_visible(*entity_id, scene_graph) && ribbon.count > 0
            })
            .map(|(entity_id, ribbon)| {
                let world_matrix = compute_world_matrix(entity_id, scene_graph);
                (ribbon.clone(), world_matrix)
            })
            .collect();

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Encoder"),
        });

        // Pre-write all mesh uniform data to the buffer BEFORE the render pass.
        // This is critical: queue.write_buffer() is immediate, not recorded in the command stream.
        // If we write during the render pass, all meshes would use the last mesh's data.
        for (mesh_idx, (_entity_id, mesh, world_matrix)) in meshes_to_render.iter().enumerate() {
            if mesh_idx >= MAX_MESHES_PER_FRAME {
                log::warn!("Too many meshes ({} > {}), some will not be rendered", meshes_to_render.len(), MAX_MESHES_PER_FRAME);
                break;
            }

            self.uniforms.model = world_matrix.to_cols_array_2d();
            self.uniforms.instance_color = mesh.color;

            let offset = (mesh_idx * UNIFORM_ALIGNMENT) as u64;
            self.queue.write_buffer(
                &self.uniform_buffer,
                offset,
                bytemuck::cast_slice(&[self.uniforms]),
            );
        }

        // Pre-write material global uniforms for all meshes BEFORE the render pass.
        // This fixes the bug where multiple meshes with the same material would all
        // use the last mesh's transform (because queue.write_buffer is immediate).
        //
        // First, write base uniforms to slot 0 for shadow pipeline (which only uses view_proj)
        self.material_global_uniforms.view_proj = self.uniforms.view_proj;
        self.material_global_uniforms.model = glam::Mat4::IDENTITY.to_cols_array_2d();
        self.material_global_uniforms.time = state.time;
        self.material_global_uniforms.dt = 0.016;
        self.material_global_uniforms.lighting_enabled = lighting.enabled;
        self.material_global_uniforms.entity_emissive = 0.0;
        self.material_pipeline_manager.update_global_uniforms_at(
            &self.queue,
            &self.material_global_uniforms,
            0,
        );

        // Then write per-entity uniforms for all meshes with materials
        for (mesh_idx, (_entity_id, mesh, world_matrix)) in meshes_to_render.iter().enumerate() {
            if mesh_idx >= MAX_MESHES_PER_FRAME {
                break;
            }

            // Only pre-write for meshes that have materials
            if mesh.material_id.is_some() {
                self.material_global_uniforms.view_proj = self.uniforms.view_proj;
                self.material_global_uniforms.model = world_matrix.to_cols_array_2d();
                self.material_global_uniforms.time = state.time;
                self.material_global_uniforms.dt = 0.016; // ~60fps default
                self.material_global_uniforms.lighting_enabled = if mesh.lit {
                    lighting.enabled
                } else {
                    0
                };
                self.material_global_uniforms.entity_emissive = mesh.emissive;

                self.material_pipeline_manager.update_global_uniforms_at(
                    &self.queue,
                    &self.material_global_uniforms,
                    mesh_idx,
                );
            }
        }

        // Render scene to post-processor's scene texture
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Scene Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: self.post_processor.scene_view(),
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.1,
                            b: 0.1,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // === Render Blob Shadows ===
            // Shadows are rendered before meshes so they appear under objects
            render_pass.set_pipeline(&self.shadow_pipeline);
            render_pass.set_vertex_buffer(0, self.plane_geometry.vertex_buffer.slice(..));
            render_pass.set_index_buffer(self.plane_geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
            // Bind globals (group 0) with offset 0 - shadow shader only uses view_proj which is same for all
            render_pass.set_bind_group(0, self.material_pipeline_manager.global_bind_group(), &[0]);

            for (_entity_id, mesh, _world_matrix) in meshes_to_render.iter() {
                if !mesh.shadow.enabled {
                    continue;
                }

                // Calculate shadow position from mesh position + offsets
                let shadow_x = mesh.transform.position.x + mesh.shadow.offset_x;
                let shadow_z = mesh.transform.position.z + mesh.shadow.offset_z;

                // Update shadow uniforms
                let shadow_uniforms = ShadowUniforms {
                    center: [shadow_x, mesh.shadow.plane_y, shadow_z, 0.0],
                    color: [
                        mesh.shadow.color[0],
                        mesh.shadow.color[1],
                        mesh.shadow.color[2],
                        mesh.shadow.opacity,
                    ],
                    params: [mesh.shadow.radius_x, mesh.shadow.radius_z, mesh.shadow.softness, 0.0],
                };
                self.queue.write_buffer(
                    &self.shadow_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[shadow_uniforms]),
                );

                // Bind shadow params (group 1)
                render_pass.set_bind_group(1, &self.shadow_bind_group, &[]);

                // Draw shadow quad
                render_pass.draw_indexed(0..self.plane_geometry.num_indices, 0, 0..1);
            }

            // === Render Meshes ===
            // Render meshes using pre-written uniform data with dynamic offsets
            for (mesh_idx, (_entity_id, mesh, world_matrix)) in meshes_to_render.iter().enumerate() {
                if mesh_idx >= MAX_MESHES_PER_FRAME {
                    break;
                }

                let dynamic_offset = (mesh_idx * UNIFORM_ALIGNMENT) as u32;

                match &mesh.mesh_type {
                    MeshType::Asset(asset_id) => {
                        // Look up the loaded mesh asset
                        if let Some(asset) = state.asset_registry.get(asset_id) {
                            // Apply deformations if any
                            let deformed_vertices = if mesh.deformations.is_empty() {
                                None
                            } else {
                                Some(apply_deformations(&asset.vertices, &mesh.deformations))
                            };

                            // Ensure buffers exist for this asset
                            let _buffers = self.get_or_create_loaded_mesh_buffers(&asset);
                            let buffers = self.loaded_mesh_buffers.get(asset_id).unwrap();

                            // Determine which vertex buffer to use
                            let use_deformed = deformed_vertices.is_some();
                            if let Some(ref vertices) = deformed_vertices {
                                self.queue.write_buffer(
                                    &self.deformed_vertex_staging,
                                    0,
                                    bytemuck::cast_slice(vertices),
                                );
                            }

                            // Render based on mode
                            match mesh.render_mode {
                                RenderMode::Solid => {
                                    // Check if mesh has a material
                                    let material_id = mesh.material_id.as_ref()
                                        .filter(|id| self.material_registry.exists(id));

                                    if let Some(mat_id) = material_id {
                                        // Get material topology
                                        let material_topology = self.material_registry.get(mat_id)
                                            .map(|m| m.topology)
                                            .unwrap_or_default();

                                        // Use material pipeline
                                        if let Some(resources) = self.material_pipeline_manager.get(mat_id) {
                                            // Global uniforms are pre-written before render pass,
                                            // use dynamic offset to index into the correct slot

                                            // Evaluate and update material params
                                            let params = self.evaluate_material_params(mat_id, &mesh.material_params);
                                            self.material_pipeline_manager.update_material_uniforms(
                                                &self.queue,
                                                mat_id,
                                                &params,
                                            );

                                            // Draw with material using dynamic offset for per-entity uniforms
                                            let material_dynamic_offset = MaterialPipelineManager::dynamic_offset_for_slot(mesh_idx);
                                            render_pass.set_pipeline(&resources.pipeline);
                                            render_pass.set_bind_group(0, self.material_pipeline_manager.global_bind_group(), &[material_dynamic_offset]);
                                            render_pass.set_bind_group(1, &resources.bind_group, &[]);
                                            if use_deformed {
                                                render_pass.set_vertex_buffer(0, self.deformed_vertex_staging.slice(..));
                                            } else {
                                                render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                                            }

                                            // Draw based on material topology
                                            if material_topology.uses_edge_indices() {
                                                // Lines: use edge indices
                                                render_pass.set_index_buffer(buffers.wireframe_index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                                render_pass.draw_indexed(0..buffers.num_edges, 0, 0..1);
                                            } else if material_topology.uses_indices() {
                                                // Triangles: use triangle indices
                                                render_pass.set_index_buffer(buffers.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                                render_pass.draw_indexed(0..buffers.num_indices, 0, 0..1);
                                            } else {
                                                // Points: draw vertices directly without indices
                                                render_pass.draw(0..buffers.num_vertices, 0..1);
                                            }
                                        }
                                    } else {
                                        // Fallback to legacy pipeline - use pre-written uniforms with dynamic offset
                                        render_pass.set_pipeline(&self.mesh_pipeline);
                                        render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                        if use_deformed {
                                            render_pass.set_vertex_buffer(0, self.deformed_vertex_staging.slice(..));
                                        } else {
                                            render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                                        }
                                        render_pass.set_index_buffer(buffers.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                        render_pass.draw_indexed(0..buffers.num_indices, 0, 0..1);
                                    }
                                }
                                RenderMode::Wireframe => {
                                    // TODO: wireframe_color needs separate uniform slot
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    if use_deformed {
                                        render_pass.set_vertex_buffer(0, self.deformed_vertex_staging.slice(..));
                                    } else {
                                        render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                                    }
                                    render_pass.set_index_buffer(buffers.wireframe_index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..buffers.num_edges, 0, 0..1);
                                }
                                RenderMode::SolidWithWireframe => {
                                    // First pass: solid - use pre-written uniforms with dynamic offset
                                    render_pass.set_pipeline(&self.mesh_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    if use_deformed {
                                        render_pass.set_vertex_buffer(0, self.deformed_vertex_staging.slice(..));
                                    } else {
                                        render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                                    }
                                    render_pass.set_index_buffer(buffers.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..buffers.num_indices, 0, 0..1);

                                    // Second pass: wireframe overlay - also use dynamic offset
                                    // TODO: wireframe_color needs separate handling
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    if use_deformed {
                                        render_pass.set_vertex_buffer(0, self.deformed_vertex_staging.slice(..));
                                    } else {
                                        render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                                    }
                                    render_pass.set_index_buffer(buffers.wireframe_index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..buffers.num_edges, 0, 0..1);
                                }
                            }
                        }
                    }
                    MeshType::RadialRing { radius, thickness, start_angle, end_angle, segments, depth } => {
                        // Generate or get cached radial ring geometry
                        let _geom = self.get_or_create_radial_ring_geometry(
                            *radius, *thickness, *start_angle, *end_angle, *segments, *depth
                        );
                        let geometry = self.radial_ring_geometry.as_ref().unwrap();
                        let num_indices = geometry.num_indices;
                        let num_edges = geometry.num_edges;
                        let num_vertices = geometry.num_vertices;

                        // Render based on mode (similar to primitives)
                        match mesh.render_mode {
                            RenderMode::Solid => {
                                let geometry = self.radial_ring_geometry.as_ref().unwrap();
                                let material_id = mesh.material_id.as_ref()
                                    .filter(|id| self.material_registry.exists(id));

                                if let Some(mat_id) = material_id {
                                    let material_topology = self.material_registry.get(mat_id)
                                        .map(|m| m.topology)
                                        .unwrap_or_default();

                                    if let Some(resources) = self.material_pipeline_manager.get(mat_id) {
                                        // Global uniforms are pre-written before render pass,
                                        // use dynamic offset to index into the correct slot

                                        // Evaluate and update material params
                                        let params = self.evaluate_material_params(mat_id, &mesh.material_params);
                                        self.material_pipeline_manager.update_material_uniforms(
                                            &self.queue,
                                            mat_id,
                                            &params,
                                        );

                                        // Draw with material using dynamic offset for per-entity uniforms
                                        let material_dynamic_offset = MaterialPipelineManager::dynamic_offset_for_slot(mesh_idx);
                                        render_pass.set_pipeline(&resources.pipeline);
                                        render_pass.set_bind_group(0, self.material_pipeline_manager.global_bind_group(), &[material_dynamic_offset]);
                                        render_pass.set_bind_group(1, &resources.bind_group, &[]);
                                        render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));

                                        if material_topology.uses_edge_indices() {
                                            if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                                render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                                render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                            }
                                        } else if material_topology.uses_indices() {
                                            render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                            render_pass.draw_indexed(0..num_indices, 0, 0..1);
                                        } else {
                                            render_pass.draw(0..num_vertices, 0..1);
                                        }
                                    }
                                } else {
                                    render_pass.set_pipeline(&self.mesh_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_indices, 0, 0..1);
                                }
                            }
                            RenderMode::Wireframe => {
                                let geometry = self.radial_ring_geometry.as_ref().unwrap();
                                if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                }
                            }
                            RenderMode::SolidWithWireframe => {
                                let geometry = self.radial_ring_geometry.as_ref().unwrap();
                                render_pass.set_pipeline(&self.mesh_pipeline);
                                render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                render_pass.draw_indexed(0..num_indices, 0, 0..1);

                                if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                }
                            }
                        }
                    }
                    _ => {
                        // Primitive mesh types (Cube, Plane, Sphere)
                        // Get geometry reference based on type, avoiding borrow conflicts
                        let geometry = match &mesh.mesh_type {
                            MeshType::Cube => &self.cube_geometry,
                            MeshType::Plane => &self.plane_geometry,
                            MeshType::Sphere => &self.sphere_geometry,
                            MeshType::Asset(_) | MeshType::RadialRing { .. } => continue, // Already handled above
                        };

                        let num_indices = geometry.num_indices;
                        let num_edges = geometry.num_edges;
                        let num_vertices = geometry.num_vertices;

                        match mesh.render_mode {
                            RenderMode::Solid => {
                                let geometry = match &mesh.mesh_type {
                                    MeshType::Cube => &self.cube_geometry,
                                    MeshType::Plane => &self.plane_geometry,
                                    MeshType::Sphere => &self.sphere_geometry,
                                    _ => continue,
                                };

                                // Check if mesh has a material
                                let material_id = mesh.material_id.as_ref()
                                    .filter(|id| self.material_registry.exists(id));

                                if let Some(mat_id) = material_id {
                                    // Get material topology
                                    let material_topology = self.material_registry.get(mat_id)
                                        .map(|m| m.topology)
                                        .unwrap_or_default();

                                    // Use material pipeline
                                    if let Some(resources) = self.material_pipeline_manager.get(mat_id) {
                                        // Global uniforms are pre-written before render pass,
                                        // use dynamic offset to index into the correct slot

                                        // Evaluate and update material params
                                        let params = self.evaluate_material_params(mat_id, &mesh.material_params);
                                        self.material_pipeline_manager.update_material_uniforms(
                                            &self.queue,
                                            mat_id,
                                            &params,
                                        );

                                        // Draw with material using dynamic offset for per-entity uniforms
                                        let material_dynamic_offset = MaterialPipelineManager::dynamic_offset_for_slot(mesh_idx);
                                        render_pass.set_pipeline(&resources.pipeline);
                                        render_pass.set_bind_group(0, self.material_pipeline_manager.global_bind_group(), &[material_dynamic_offset]);
                                        render_pass.set_bind_group(1, &resources.bind_group, &[]);
                                        render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));

                                        // Draw based on material topology
                                        if material_topology.uses_edge_indices() {
                                            // Lines: use edge indices
                                            if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                                render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                                render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                            }
                                        } else if material_topology.uses_indices() {
                                            // Triangles: use triangle indices
                                            render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                            render_pass.draw_indexed(0..num_indices, 0, 0..1);
                                        } else {
                                            // Points: draw vertices directly without indices
                                            render_pass.draw(0..num_vertices, 0..1);
                                        }
                                    }
                                } else {
                                    // Fallback to legacy pipeline - use pre-written uniforms with dynamic offset
                                    render_pass.set_pipeline(&self.mesh_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_indices, 0, 0..1);
                                }
                            }
                            RenderMode::Wireframe => {
                                // TODO: wireframe_color needs separate uniform slot to avoid conflation
                                // For now, use pre-written uniforms (will use solid color instead of wireframe_color)
                                let geometry = match &mesh.mesh_type {
                                    MeshType::Cube => &self.cube_geometry,
                                    MeshType::Plane => &self.plane_geometry,
                                    MeshType::Sphere => &self.sphere_geometry,
                                    _ => continue,
                                };
                                if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                }
                            }
                            RenderMode::SolidWithWireframe => {
                                // First pass: solid - use pre-written uniforms with dynamic offset
                                let geometry = match &mesh.mesh_type {
                                    MeshType::Cube => &self.cube_geometry,
                                    MeshType::Plane => &self.plane_geometry,
                                    MeshType::Sphere => &self.sphere_geometry,
                                    _ => continue,
                                };
                                render_pass.set_pipeline(&self.mesh_pipeline);
                                render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                render_pass.draw_indexed(0..num_indices, 0, 0..1);

                                // Second pass: wireframe overlay - also use dynamic offset
                                // TODO: wireframe_color needs separate handling
                                let geometry = match &mesh.mesh_type {
                                    MeshType::Cube => &self.cube_geometry,
                                    MeshType::Plane => &self.plane_geometry,
                                    MeshType::Sphere => &self.sphere_geometry,
                                    _ => continue,
                                };
                                if let Some(ref wireframe_buffer) = geometry.wireframe_index_buffer {
                                    render_pass.set_pipeline(&self.wireframe_pipeline);
                                    render_pass.set_bind_group(0, &self.mesh_bind_group, &[dynamic_offset]);
                                    render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                                    render_pass.set_index_buffer(wireframe_buffer.slice(..), wgpu::IndexFormat::Uint16);
                                    render_pass.draw_indexed(0..num_edges, 0, 0..1);
                                }
                            }
                        }
                    }
                }
            }

            // Render debug bounding boxes
            // Show if: global bounding_boxes enabled OR per-entity debug bounds enabled
            let show_all_bounds = state.debug_options.bounding_boxes;
            let per_entity_bounds = &state.debug_options.debug_bounds_entities;

            if show_all_bounds || !per_entity_bounds.is_empty() {
                render_pass.set_pipeline(&self.wireframe_pipeline);
                // Debug bounds uses offset 0 since it writes its own uniforms
                render_pass.set_bind_group(0, &self.mesh_bind_group, &[0]);

                // Debug bounds color: yellow
                let debug_color = [1.0f32, 0.9, 0.0];

                for (entity_id, mesh, world_matrix) in &meshes_to_render {
                    // Check if we should render bounds for this mesh
                    let should_show = show_all_bounds || per_entity_bounds.contains(&entity_id.0);
                    if !should_show {
                        continue;
                    }

                    // Get local bounds based on mesh type
                    let local_bounds = match &mesh.mesh_type {
                        MeshType::Cube => CUBE_BOUNDS,
                        MeshType::Plane => PLANE_BOUNDS,
                        MeshType::Sphere => SPHERE_BOUNDS,
                        MeshType::Asset(asset_id) => {
                            state.asset_registry.get(asset_id)
                                .map(|a| a.bounds)
                                .unwrap_or_default()
                        }
                        MeshType::RadialRing { radius, thickness, .. } => {
                            // Approximate bounds for radial ring
                            let outer = radius + thickness / 2.0;
                            BoundingBox {
                                min: [-outer, -outer, -0.01],
                                max: [outer, outer, 0.01],
                            }
                        }
                    };

                    // Compute world-space bounding box vertices
                    let vertices = compute_world_bounds_vertices(&local_bounds, *world_matrix, debug_color);

                    // Upload vertices to staging buffer
                    self.queue.write_buffer(
                        &self.debug_bounds_vertex_buffer,
                        0,
                        bytemuck::cast_slice(&vertices),
                    );

                    // Set identity model matrix (vertices are already in world space)
                    self.uniforms.model = glam::Mat4::IDENTITY.to_cols_array_2d();
                    self.uniforms.instance_color = [debug_color[0], debug_color[1], debug_color[2], 1.0];
                    self.queue.write_buffer(
                        &self.uniform_buffer,
                        0,
                        bytemuck::cast_slice(&[self.uniforms]),
                    );

                    // Draw wireframe cube
                    render_pass.set_vertex_buffer(0, self.debug_bounds_vertex_buffer.slice(..));
                    render_pass.set_index_buffer(self.debug_cube_geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                    render_pass.draw_indexed(0..self.debug_cube_geometry.num_edges, 0, 0..1);
                }
            }

            // Render line strips
            render_pass.set_pipeline(&self.line_pipeline);

            for (idx, line) in &lines_to_render {
                // Upload line points
                let points_data = line.to_gpu_data();
                self.queue.write_buffer(
                    &self.line_vertex_buffer,
                    0,
                    bytemuck::cast_slice(&points_data),
                );

                // Calculate vertical offset for multiple lines
                let base_y = 0.5 - (*idx as f32 * 0.3);

                // Update line uniforms
                let line_uniforms = LineUniforms {
                    color: line.color,
                    offset: [-0.9, base_y],
                    scale: [1.8, 0.2],
                    count: line.count as f32,
                    max_points: line.max_points as f32,
                    _padding: [0.0; 2],
                };
                self.queue.write_buffer(
                    &self.line_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[line_uniforms]),
                );

                render_pass.set_bind_group(0, &self.line_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.line_vertex_buffer.slice(..));
                render_pass.draw(0..line.count as u32, 0..1);
            }

            // Render point clouds
            render_pass.set_pipeline(&self.point_cloud_pipeline);

            for (cloud, world_matrix) in &point_clouds_to_render {
                // Upload point positions (as flat f32 array: x, y, z, x, y, z, ...)
                let point_count = cloud.positions.len().min(MAX_POINTS_PER_CLOUD);
                let positions_data: Vec<f32> = cloud.positions.iter()
                    .take(point_count)
                    .flat_map(|p| [p.x, p.y, p.z])
                    .collect();
                self.queue.write_buffer(
                    &self.point_cloud_vertex_buffer,
                    0,
                    bytemuck::cast_slice(&positions_data),
                );

                // Update point cloud uniforms
                let view_proj = self.uniforms.view_proj;
                let point_cloud_uniforms = PointCloudUniforms {
                    view_proj,
                    model: world_matrix.to_cols_array_2d(),
                    color: cloud.color,
                    point_size: cloud.point_size,
                    _padding: [0.0; 3],
                };
                self.queue.write_buffer(
                    &self.point_cloud_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[point_cloud_uniforms]),
                );

                render_pass.set_bind_group(0, &self.point_cloud_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.point_cloud_vertex_buffer.slice(..));
                render_pass.draw(0..point_count as u32, 0..1);
            }

            // Render radial waves (using point cloud pipeline with generated line points)
            for (wave, world_matrix) in &radial_waves_to_render {
                // Generate points for the wave
                let points = wave.generate_points();
                let point_count = points.len().min(MAX_POINTS_PER_CLOUD);
                if point_count == 0 {
                    continue;
                }

                // Upload wave points
                let positions_data: Vec<f32> = points.iter()
                    .take(point_count)
                    .flat_map(|p| [p.x, p.y, p.z])
                    .collect();
                self.queue.write_buffer(
                    &self.point_cloud_vertex_buffer,
                    0,
                    bytemuck::cast_slice(&positions_data),
                );

                // Update point cloud uniforms (use larger point size for better line appearance)
                let view_proj = self.uniforms.view_proj;
                let point_cloud_uniforms = PointCloudUniforms {
                    view_proj,
                    model: world_matrix.to_cols_array_2d(),
                    color: wave.color,
                    point_size: 2.0, // Fixed size for wave visualization
                    _padding: [0.0; 3],
                };
                self.queue.write_buffer(
                    &self.point_cloud_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[point_cloud_uniforms]),
                );

                render_pass.set_bind_group(0, &self.point_cloud_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.point_cloud_vertex_buffer.slice(..));
                render_pass.draw(0..point_count as u32, 0..1);
            }

            // Render ribbons (using point cloud pipeline with generated center line points)
            for (ribbon, world_matrix) in &ribbons_to_render {
                // Generate center line points for the ribbon
                let points = ribbon.generate_center_points();
                let point_count = points.len().min(MAX_POINTS_PER_CLOUD);
                if point_count == 0 {
                    continue;
                }

                // Upload ribbon points
                let positions_data: Vec<f32> = points.iter()
                    .take(point_count)
                    .flat_map(|p| [p.x, p.y, p.z])
                    .collect();
                self.queue.write_buffer(
                    &self.point_cloud_vertex_buffer,
                    0,
                    bytemuck::cast_slice(&positions_data),
                );

                // Update point cloud uniforms
                let view_proj = self.uniforms.view_proj;
                let point_cloud_uniforms = PointCloudUniforms {
                    view_proj,
                    model: world_matrix.to_cols_array_2d(),
                    color: ribbon.color,
                    point_size: 2.0, // Fixed size for ribbon visualization
                    _padding: [0.0; 3],
                };
                self.queue.write_buffer(
                    &self.point_cloud_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[point_cloud_uniforms]),
                );

                render_pass.set_bind_group(0, &self.point_cloud_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.point_cloud_vertex_buffer.slice(..));
                render_pass.draw(0..point_count as u32, 0..1);
            }
        }

        // Render particle systems
        self.render_particles_to_scene(&mut encoder, state);

        // Apply frame feedback and post-processing chain (V7+)
        // Uses process_all which handles ordering based on feedback sampling mode:
        // - PreFx (default): feedback → post-FX
        // - PostFx: post-FX → feedback
        let feedback_config = state.feedback_config();
        let feedback_uniforms = state.feedback_uniforms();
        let post_chain = state.post_chain();
        let evaluated_params = post_chain.build_params_map(&self.post_effect_registry);
        self.post_processor.process_all(
            &self.device,
            &mut encoder,
            &self.queue,
            view,
            feedback_config,
            feedback_uniforms,
            post_chain,
            &evaluated_params,
        );

        self.queue.submit(iter::once(encoder.finish()));
    }

    /// Render mesh particles as instanced geometry.
    ///
    /// This method renders a batch of mesh particles using GPU instancing.
    /// Each particle is rendered as an instance of the specified mesh asset.
    ///
    /// # Arguments
    /// * `view` - The texture view to render to
    /// * `instances` - GPU-ready particle instance data
    /// * `asset` - The mesh asset to instance
    /// * `state` - Visualiser state for view projection
    pub fn render_mesh_particles(
        &mut self,
        view: &wgpu::TextureView,
        instances: &[GpuMeshParticleInstance],
        asset: &Arc<MeshAsset>,
        state: &VisualiserState,
    ) {
        if instances.is_empty() {
            return;
        }

        // Clamp to max instances
        let instance_count = instances.len().min(MAX_MESH_PARTICLE_INSTANCES);
        let instances = &instances[..instance_count];

        // Ensure mesh buffers exist
        let _ = self.get_or_create_loaded_mesh_buffers(asset);
        let buffers = match self.loaded_mesh_buffers.get(&asset.id) {
            Some(b) => b,
            None => return,
        };

        // Update view projection matrix
        self.uniforms.update_view_proj(self.size, state.camera_uniforms());
        self.queue.write_buffer(
            &self.mesh_particle_view_buffer,
            0,
            bytemuck::cast_slice(&self.uniforms.view_proj),
        );

        // Upload instance data
        self.queue.write_buffer(
            &self.mesh_particle_instance_buffer,
            0,
            bytemuck::cast_slice(instances),
        );

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Mesh Particle Encoder"),
        });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Mesh Particle Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load, // Don't clear, render on top of existing content
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.mesh_particle_pipeline);
            render_pass.set_bind_group(0, &self.mesh_particle_bind_group, &[]);

            // Slot 0: Mesh vertices
            render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
            // Slot 1: Instance data
            render_pass.set_vertex_buffer(1, self.mesh_particle_instance_buffer.slice(..));

            render_pass.set_index_buffer(buffers.index_buffer.slice(..), wgpu::IndexFormat::Uint16);

            // Draw instanced
            render_pass.draw_indexed(0..buffers.num_indices, 0, 0..instance_count as u32);
        }

        self.queue.submit(iter::once(encoder.finish()));
    }

    /// Render particle systems to the scene texture.
    ///
    /// This is called during the main render pass to add particles to the scene
    /// before feedback and post-processing are applied.
    fn render_particles_to_scene(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        state: &VisualiserState,
    ) {
        use crate::particle::ParticleGeometry;
        use crate::particle_eval::{generate_gpu_instances, generate_mesh_particle_instances, ParticleEvalContext};

        let particle_systems = state.particle_systems();
        if particle_systems.is_empty() {
            return;
        }

        // Build particle evaluation context
        let bpm = state.bpm();
        let secs_per_beat = 60.0 / bpm;
        let particle_ctx = ParticleEvalContext {
            current_time_secs: state.time,
            current_beat: state.time / secs_per_beat,
            secs_per_beat,
            dt: 0.016, // Approximate frame time
            dt_beats: 0.016 / secs_per_beat,
        };

        // Collect all particle instances by type
        let mut mesh_instances_by_asset: std::collections::HashMap<String, Vec<GpuMeshParticleInstance>>
            = std::collections::HashMap::new();
        let mut billboard_instances: Vec<GpuParticleInstance> = Vec::new();

        for (_id, system) in particle_systems.iter() {
            if !system.visible || system.instances.is_empty() {
                continue;
            }

            match &system.geometry {
                ParticleGeometry::Billboard { .. } | ParticleGeometry::Point { .. } => {
                    // Collect billboard/point particle instances
                    let instances = generate_gpu_instances(system, &particle_ctx);
                    billboard_instances.extend(instances);
                }
                ParticleGeometry::Mesh { asset_id, base_scale } => {
                    // Generate GPU instances for mesh particles
                    let instances = generate_mesh_particle_instances(system, &particle_ctx, *base_scale);
                    if !instances.is_empty() {
                        mesh_instances_by_asset
                            .entry(asset_id.clone())
                            .or_default()
                            .extend(instances);
                    }
                }
            }
        }

        // Render billboard particles
        if !billboard_instances.is_empty() {
            let instance_count = billboard_instances.len().min(MAX_MESH_PARTICLE_INSTANCES);
            let instances = &billboard_instances[..instance_count];

            // Update billboard uniforms (view_proj + camera vectors)
            let camera = state.camera_uniforms();
            self.uniforms.update_view_proj(self.size, camera);

            // Compute camera vectors from dynamic camera uniforms
            let right = camera.right();
            let cam_up = camera.camera_up();

            let camera_right = [right.x, right.y, right.z, 0.0];
            let camera_up = [cam_up.x, cam_up.y, cam_up.z, 0.0];

            // Build billboard uniform data: view_proj (16) + camera_right (4) + camera_up (4)
            // Flatten the 4x4 matrix to [f32; 16]
            let vp = &self.uniforms.view_proj;
            let view_proj_flat: [f32; 16] = [
                vp[0][0], vp[0][1], vp[0][2], vp[0][3],
                vp[1][0], vp[1][1], vp[1][2], vp[1][3],
                vp[2][0], vp[2][1], vp[2][2], vp[2][3],
                vp[3][0], vp[3][1], vp[3][2], vp[3][3],
            ];

            let mut billboard_uniforms: [f32; 24] = [0.0; 24];
            billboard_uniforms[0..16].copy_from_slice(&view_proj_flat);
            billboard_uniforms[16..20].copy_from_slice(&camera_right);
            billboard_uniforms[20..24].copy_from_slice(&camera_up);

            self.queue.write_buffer(
                &self.billboard_particle_uniform_buffer,
                0,
                bytemuck::cast_slice(&billboard_uniforms),
            );

            // Upload instance data
            self.queue.write_buffer(
                &self.billboard_particle_instance_buffer,
                0,
                bytemuck::cast_slice(instances),
            );

            // Create render pass for billboard particles
            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Billboard Particle Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: self.post_processor.scene_view(),
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                render_pass.set_pipeline(&self.billboard_particle_pipeline);
                render_pass.set_bind_group(0, &self.billboard_particle_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.billboard_quad_vertex_buffer.slice(..));
                render_pass.set_vertex_buffer(1, self.billboard_particle_instance_buffer.slice(..));
                render_pass.set_index_buffer(self.billboard_quad_index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                render_pass.draw_indexed(0..6, 0, 0..instance_count as u32);
            }
        }

        // Render mesh particles
        for (asset_id, instances) in mesh_instances_by_asset.iter() {
            if instances.is_empty() {
                continue;
            }

            // Look up the mesh asset
            let asset = match state.asset_registry.get(asset_id) {
                Some(a) => a,
                None => {
                    log::warn!("Particle mesh asset not found: {}", asset_id);
                    continue;
                }
            };

            // Clamp to max instances
            let instance_count = instances.len().min(MAX_MESH_PARTICLE_INSTANCES);
            let instances = &instances[..instance_count];

            // Ensure mesh buffers exist
            let _ = self.get_or_create_loaded_mesh_buffers(&asset);
            let buffers = match self.loaded_mesh_buffers.get(asset_id) {
                Some(b) => b,
                None => continue,
            };

            // Update view projection matrix
            self.uniforms.update_view_proj(self.size, state.camera_uniforms());
            self.queue.write_buffer(
                &self.mesh_particle_view_buffer,
                0,
                bytemuck::cast_slice(&self.uniforms.view_proj),
            );

            // Upload instance data
            self.queue.write_buffer(
                &self.mesh_particle_instance_buffer,
                0,
                bytemuck::cast_slice(instances),
            );

            // Create render pass to scene view
            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Mesh Particle Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: self.post_processor.scene_view(),
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                render_pass.set_pipeline(&self.mesh_particle_pipeline);
                render_pass.set_bind_group(0, &self.mesh_particle_bind_group, &[]);
                render_pass.set_vertex_buffer(0, buffers.vertex_buffer.slice(..));
                render_pass.set_vertex_buffer(1, self.mesh_particle_instance_buffer.slice(..));
                render_pass.set_index_buffer(buffers.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                render_pass.draw_indexed(0..buffers.num_indices, 0, 0..instance_count as u32);
            }
        }
    }
}
