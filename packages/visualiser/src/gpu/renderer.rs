//! GPU renderer for the scene graph.
//!
//! Renders meshes and line strips from the script-driven scene graph.

use wgpu::util::DeviceExt;
use crate::gpu::mesh;
use crate::gpu::pipeline;
use crate::visualiser::VisualiserState;
use crate::scene_graph::{MeshType, Transform};
use bytemuck::{Pod, Zeroable};
use std::iter;

/// Maximum points per line strip.
const MAX_POINTS_PER_LINE: usize = 1024;

#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct Uniforms {
    view_proj: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
}

impl Uniforms {
    fn new() -> Self {
        Self {
            view_proj: glam::Mat4::IDENTITY.to_cols_array_2d(),
            model: glam::Mat4::IDENTITY.to_cols_array_2d(),
        }
    }

    fn update_view_proj(&mut self, size: wgpu::Extent3d, _state: &VisualiserState) {
        let aspect = size.width as f32 / size.height as f32;

        // Fixed camera position for now
        let dist = 4.0;
        let view = glam::Mat4::look_at_rh(
            glam::Vec3::new(dist, dist * 0.5, dist),
            glam::Vec3::ZERO,
            glam::Vec3::Y,
        );
        let proj = glam::Mat4::perspective_rh(
            45.0f32.to_radians(),
            aspect,
            0.1,
            100.0,
        );
        self.view_proj = (proj * view).to_cols_array_2d();
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

/// Shared geometry for a mesh type.
struct MeshGeometry {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    size: wgpu::Extent3d,

    // Mesh rendering
    mesh_pipeline: wgpu::RenderPipeline,
    #[allow(dead_code)]
    mesh_bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    mesh_bind_group: wgpu::BindGroup,
    uniforms: Uniforms,

    // Shared geometry
    cube_geometry: MeshGeometry,
    plane_geometry: MeshGeometry,

    // Line rendering
    line_pipeline: wgpu::RenderPipeline,
    #[allow(dead_code)]
    line_bind_group_layout: wgpu::BindGroupLayout,

    // Dynamic line buffers (reused each frame)
    line_vertex_buffer: wgpu::Buffer,
    line_uniform_buffer: wgpu::Buffer,
    line_bind_group: wgpu::BindGroup,
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
        let temp_state = VisualiserState::new();
        uniforms.update_view_proj(size, &temp_state);

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Mesh Uniform Buffer"),
            contents: bytemuck::cast_slice(&[uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let mesh_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
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
            label: Some("mesh_bind_group_layout"),
        });

        let mesh_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &mesh_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
            label: Some("mesh_bind_group"),
        });

        let mesh_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mesh Pipeline Layout"),
            bind_group_layouts: &[&mesh_bind_group_layout],
            push_constant_ranges: &[],
        });

        let mesh_pipeline = pipeline::create_render_pipeline(&device, &mesh_pipeline_layout, format);

        // === Geometry Setup ===

        // Cube geometry
        let (cube_vertices, cube_indices) = mesh::create_cube_geometry();
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
        let cube_geometry = MeshGeometry {
            vertex_buffer: cube_vertex_buffer,
            index_buffer: cube_index_buffer,
            num_indices: cube_indices.len() as u32,
        };

        // Plane geometry
        let (plane_vertices, plane_indices) = mesh::create_plane_geometry();
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
        let plane_geometry = MeshGeometry {
            vertex_buffer: plane_vertex_buffer,
            index_buffer: plane_index_buffer,
            num_indices: plane_indices.len() as u32,
        };

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

        Self {
            device,
            queue,
            size,
            mesh_pipeline,
            mesh_bind_group_layout,
            uniform_buffer,
            mesh_bind_group,
            uniforms,
            cube_geometry,
            plane_geometry,
            line_pipeline,
            line_bind_group_layout,
            line_vertex_buffer,
            line_uniform_buffer,
            line_bind_group,
        }
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    pub fn resize(&mut self, width: u32, height: u32, state: &VisualiserState) {
        if width > 0 && height > 0 {
            self.size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
            self.uniforms.update_view_proj(self.size, state);
        }
    }

    fn get_geometry(&self, mesh_type: MeshType) -> &MeshGeometry {
        match mesh_type {
            MeshType::Cube => &self.cube_geometry,
            MeshType::Plane => &self.plane_geometry,
        }
    }

    pub fn render(&mut self, view: &wgpu::TextureView, state: &VisualiserState) {
        let scene_graph = state.scene_graph();

        // Update view projection
        self.uniforms.update_view_proj(self.size, state);

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Encoder"),
        });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
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

            // Render meshes
            render_pass.set_pipeline(&self.mesh_pipeline);

            for (_, mesh) in scene_graph.meshes() {
                if !mesh.visible {
                    continue;
                }

                // Update model matrix for this instance
                self.uniforms.update_model(&mesh.transform);
                self.queue.write_buffer(
                    &self.uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[self.uniforms]),
                );

                let geometry = self.get_geometry(mesh.mesh_type);

                render_pass.set_bind_group(0, &self.mesh_bind_group, &[]);
                render_pass.set_vertex_buffer(0, geometry.vertex_buffer.slice(..));
                render_pass.set_index_buffer(geometry.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                render_pass.draw_indexed(0..geometry.num_indices, 0, 0..1);
            }

            // Render line strips
            render_pass.set_pipeline(&self.line_pipeline);

            for (idx, (_, line)) in scene_graph.lines().enumerate() {
                if !line.visible || line.count == 0 {
                    continue;
                }

                // Upload line points
                let points_data = line.to_gpu_data();
                self.queue.write_buffer(
                    &self.line_vertex_buffer,
                    0,
                    bytemuck::cast_slice(&points_data),
                );

                // Calculate vertical offset for multiple lines
                let base_y = 0.5 - (idx as f32 * 0.3);

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
        }

        self.queue.submit(iter::once(encoder.finish()));
    }
}
