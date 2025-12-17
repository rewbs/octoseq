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

#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
struct SparklineUniforms {
    color: [f32; 4],
    offset: [f32; 2],
    scale: [f32; 2],
    capacity: f32, // Passed as float
    _padding: [f32; 3], // Padding to 16-byte alignment if needed, but 4+2+2+1 = 9 floats = 36 bytes.
                        // Uniforms need 16-byte alignment.
                        // vec4 (16) + vec2 (8) + vec2 (8) + f32 (4) = 36 bytes.
                        // Next item alignment?
                        // Struct size must be multiple of 16 for uniform buffers in some backends?
                        // Actually WebGPU std140 layout:
                        // color: offset 0 (16 bytes)
                        // offset: offset 16 (8 bytes)
                        // scale: offset 24 (8 bytes)
                        // capacity: offset 32 (4 bytes)
                        // Total 36 bytes. Round up to 48 (multiple of 16).
                        // So 12 bytes padding (3 floats).
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

    // Sparkline Resources
    sparkline_pipeline: wgpu::RenderPipeline,
    sparkline_rot_vk_buf: wgpu::Buffer, // Vertex buffer for signal data
    sparkline_zoom_vk_buf: wgpu::Buffer,
    sparkline_rot_uni_buf: wgpu::Buffer,
    sparkline_zoom_uni_buf: wgpu::Buffer,
    sparkline_rot_bind: wgpu::BindGroup,
    sparkline_zoom_bind: wgpu::BindGroup,
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

        // --- Sparkline Initialization ---

        let spark_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
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
            label: Some("sparkline_bind_group_layout"),
        });

        let spark_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Sparkline Pipeline Layout"),
            bind_group_layouts: &[&spark_bind_group_layout],
            push_constant_ranges: &[],
        });

        let sparkline_pipeline = pipeline::create_sparkline_pipeline(&device, &spark_pipeline_layout, format);

        // Initial Data
        let capacity = 500;
        let zero_data = vec![0.0f32; capacity];

        // Rotation Sparkline Resources
        let sparkline_rot_vk_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Rot Sparkline Vertex Buffer"),
            contents: bytemuck::cast_slice(&zero_data),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });

        let rot_uniforms = SparklineUniforms {
            color: [0.0, 1.0, 0.0, 1.0], // Green
            offset: [-0.95, 0.5],        // Top Left
            scale: [0.9, 0.4],           // Width 0.9, Height 0.4
            capacity: capacity as f32,
            _padding: [0.0; 3],
        };

        let sparkline_rot_uni_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Rot Sparkline Uniform Buffer"),
            contents: bytemuck::cast_slice(&[rot_uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let sparkline_rot_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &spark_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: sparkline_rot_uni_buf.as_entire_binding(),
            }],
            label: Some("Rot Sparkline Bind Group"),
        });

        // Zoom Sparkline Resources
        let sparkline_zoom_vk_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Zoom Sparkline Vertex Buffer"),
            contents: bytemuck::cast_slice(&zero_data),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });

        let zoom_uniforms = SparklineUniforms {
            color: [0.0, 0.8, 1.0, 1.0], // Cyan
            offset: [-0.95, -0.9],       // Bottom Left
            scale: [0.9, 0.4],
            capacity: capacity as f32,
            _padding: [0.0; 3],
        };

        let sparkline_zoom_uni_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Zoom Sparkline Uniform Buffer"),
            contents: bytemuck::cast_slice(&[zoom_uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let sparkline_zoom_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &spark_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: sparkline_zoom_uni_buf.as_entire_binding(),
            }],
            label: Some("Zoom Sparkline Bind Group"),
        });

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
            sparkline_pipeline,
            sparkline_rot_vk_buf,
            sparkline_zoom_vk_buf,
            sparkline_rot_uni_buf,
            sparkline_zoom_uni_buf,
            sparkline_rot_bind,
            sparkline_zoom_bind,
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

        // Update Sparkline Buffers
        self.queue.write_buffer(
            &self.sparkline_rot_vk_buf,
            0,
            bytemuck::cast_slice(&state.rot_sparkline.data),
        );
        self.queue.write_buffer(
            &self.sparkline_zoom_vk_buf,
            0,
            bytemuck::cast_slice(&state.zoom_sparkline.data),
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

            // --- Sparklines ---
            render_pass.set_pipeline(&self.sparkline_pipeline);

            // Draw Rotation Sparkline
            render_pass.set_bind_group(0, &self.sparkline_rot_bind, &[]);
            render_pass.set_vertex_buffer(0, self.sparkline_rot_vk_buf.slice(..));
            // Only draw up to capacity (fixed 500)
            render_pass.draw(0..500, 0..1);

            // Draw Zoom Sparkline
            render_pass.set_bind_group(0, &self.sparkline_zoom_bind, &[]);
            render_pass.set_vertex_buffer(0, self.sparkline_zoom_vk_buf.slice(..));
            render_pass.draw(0..500, 0..1);
        }

        self.queue.submit(iter::once(encoder.finish()));
    }
}
