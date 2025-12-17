use wgpu::util::DeviceExt;
use crate::gpu::mesh;
use crate::gpu::pipeline;
use crate::visualiser::VisualiserState;
use bytemuck::{Pod, Zeroable};
use std::iter;

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

    fn update_view_proj(&mut self, size: wgpu::Extent3d, state: &VisualiserState) {
        let aspect = size.width as f32 / size.height as f32;
        // Create view matrix (camera)
        let _base_dist = 4.0;
        // Make zoom pull camera closer (negative effect) or push away?
        // Let's say input [0,1] -> zoom increases.
        // If zoom is positive, maybe we want to get closer?
        // Let's subtract zoom from dist.
        // config.zoom_sensitivity is e.g. 5.0.
        // If input is 1.0 -> dist = 4.0 - 5.0 = -1.0 (inside cube).
        // Maybe we want base to be further or sensitivity lower?
        // Let's do: dist = 6.0 - zoom.
        let dist = (6.0 - state.zoom).max(1.5); // Clamp so we don't clip inside too much

        let view = glam::Mat4::look_at_rh(
            glam::Vec3::new(dist, dist * 0.5, dist), // Camera position
            glam::Vec3::ZERO, // Target
            glam::Vec3::Y,    // Up
        );
        let proj = glam::Mat4::perspective_rh(
            45.0f32.to_radians(),
            aspect,
            0.1,
            100.0,
        );
        self.view_proj = (proj * view).to_cols_array_2d();
    }

    fn update_model(&mut self, rotation: f32) {
        self.model = glam::Mat4::from_rotation_y(rotation).to_cols_array_2d();
    }
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    render_pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    uniforms: Uniforms,
    size: wgpu::Extent3d, // Added size storage
}

impl Renderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat, width: u32, height: u32) -> Self {
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };

        // Uniforms
        let mut uniforms = Uniforms::new();
        // Create temp state for initial projection
        let temp_state = VisualiserState::new();
        uniforms.update_view_proj(size, &temp_state);

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Uniform Buffer"),
            contents: bytemuck::cast_slice(&[uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
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
            label: Some("uniform_bind_group_layout"),
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
            label: Some("uniform_bind_group"),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Render Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let render_pipeline = pipeline::create_render_pipeline(&device, &pipeline_layout, format);

        // Mesh
        let (vertices, indices) = mesh::create_cube_geometry();
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Vertex Buffer"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Index Buffer"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let num_indices = indices.len() as u32;

        Self {
            device,
            queue,
            render_pipeline,
            vertex_buffer,
            index_buffer,
            num_indices,
            uniform_buffer,
            bind_group,
            uniforms,
            size,
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

    pub fn render(&mut self, view: &wgpu::TextureView, state: &VisualiserState) {
        // Update uniforms
        self.uniforms.update_model(state.rotation);
        // Important: Update view_proj with new zoom from state!
        self.uniforms.update_view_proj(self.size, state);

        self.queue.write_buffer(
            &self.uniform_buffer,
            0,
            bytemuck::cast_slice(&[self.uniforms]),
        );

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
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

            render_pass.set_pipeline(&self.render_pipeline);
            render_pass.set_bind_group(0, &self.bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            render_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
            render_pass.draw_indexed(0..self.num_indices, 0, 0..1);
        }

        self.queue.submit(iter::once(encoder.finish()));
    }
}
