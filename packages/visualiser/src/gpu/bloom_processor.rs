//! Multi-pass bloom processor.
//!
//! Implements efficient bloom using:
//! 1. Threshold pass - extract bright pixels
//! 2. Downscale - process at lower resolution
//! 3. Separable blur - horizontal then vertical passes
//! 4. Composite - blend bloom back with original

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

/// Maximum blur radius (caps GPU cost)
pub const MAX_BLOOM_RADIUS: f32 = 32.0;

/// Default downsample factor (1 = full res, 2 = half res, etc.)
pub const DEFAULT_DOWNSAMPLE: u32 = 2;

/// Bloom parameters from script
#[derive(Clone, Debug)]
pub struct BloomParams {
    pub threshold: f32,
    pub intensity: f32,
    pub radius: f32,
    pub downsample: u32,
}

impl Default for BloomParams {
    fn default() -> Self {
        Self {
            threshold: 0.8,
            intensity: 0.5,
            radius: 4.0,
            downsample: DEFAULT_DOWNSAMPLE,
        }
    }
}

impl BloomParams {
    /// Clamp parameters to safe ranges
    pub fn sanitize(&self) -> Self {
        Self {
            threshold: self.threshold.max(0.0),
            intensity: self.intensity.max(0.0),
            radius: self.radius.clamp(0.0, MAX_BLOOM_RADIUS),
            downsample: self.downsample.clamp(1, 8),
        }
    }
}

/// Uniforms for threshold pass
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct ThresholdUniforms {
    threshold: f32,
    soft_knee: f32,
    _padding: [f32; 2],
}

/// Uniforms for blur pass
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct BlurUniforms {
    direction_and_radius: [f32; 4], // xy = direction, z = radius, w = unused
}

/// Uniforms for composite pass
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct CompositeUniforms {
    intensity: f32,
    _padding: [f32; 3],
}

/// Vertex for fullscreen quad
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct QuadVertex {
    position: [f32; 2],
    uv: [f32; 2],
}

impl QuadVertex {
    const ATTRIBS: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2];

    fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<QuadVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBS,
        }
    }
}

const QUAD_VERTICES: &[QuadVertex] = &[
    QuadVertex { position: [-1.0, -1.0], uv: [0.0, 1.0] },
    QuadVertex { position: [ 1.0, -1.0], uv: [1.0, 1.0] },
    QuadVertex { position: [ 1.0,  1.0], uv: [1.0, 0.0] },
    QuadVertex { position: [-1.0, -1.0], uv: [0.0, 1.0] },
    QuadVertex { position: [ 1.0,  1.0], uv: [1.0, 0.0] },
    QuadVertex { position: [-1.0,  1.0], uv: [0.0, 0.0] },
];

/// Multi-pass bloom processor
pub struct BloomProcessor {
    // Textures for bloom processing (downsampled resolution)
    bloom_texture_a: wgpu::Texture,
    bloom_texture_b: wgpu::Texture,
    bloom_view_a: wgpu::TextureView,
    bloom_view_b: wgpu::TextureView,

    // Pipelines
    threshold_pipeline: wgpu::RenderPipeline,
    blur_pipeline: wgpu::RenderPipeline,
    composite_pipeline: wgpu::RenderPipeline,

    // Bind group layouts
    single_texture_layout: wgpu::BindGroupLayout,
    uniform_layout: wgpu::BindGroupLayout,
    composite_layout: wgpu::BindGroupLayout,

    // Uniform buffers
    threshold_uniform_buffer: wgpu::Buffer,
    blur_uniform_buffer: wgpu::Buffer,
    composite_uniform_buffer: wgpu::Buffer,

    // Uniform bind groups
    threshold_uniform_bind_group: wgpu::BindGroup,
    blur_uniform_bind_group: wgpu::BindGroup,
    composite_uniform_bind_group: wgpu::BindGroup,

    // Shared resources
    quad_vertex_buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,

    // Current dimensions
    full_width: u32,
    full_height: u32,
    bloom_width: u32,
    bloom_height: u32,
    format: wgpu::TextureFormat,
    current_downsample: u32,
}

impl BloomProcessor {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let downsample = DEFAULT_DOWNSAMPLE;
        let bloom_width = (width / downsample).max(1);
        let bloom_height = (height / downsample).max(1);

        // Create bloom textures
        let (bloom_texture_a, bloom_view_a) =
            Self::create_bloom_texture(device, format, bloom_width, bloom_height, "Bloom A");
        let (bloom_texture_b, bloom_view_b) =
            Self::create_bloom_texture(device, format, bloom_width, bloom_height, "Bloom B");

        // Sampler
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Bloom Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Quad vertex buffer
        let quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Bloom Quad Buffer"),
            contents: bytemuck::cast_slice(QUAD_VERTICES),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Bind group layouts
        let single_texture_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Bloom Single Texture Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Bloom Uniform Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        // Composite needs two textures
        let composite_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Bloom Composite Layout"),
                entries: &[
                    // Scene texture
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    // Bloom texture
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        // Create pipelines
        let threshold_pipeline = Self::create_threshold_pipeline(
            device,
            format,
            &single_texture_layout,
            &uniform_layout,
        );
        let blur_pipeline =
            Self::create_blur_pipeline(device, format, &single_texture_layout, &uniform_layout);
        let composite_pipeline =
            Self::create_composite_pipeline(device, format, &composite_layout, &uniform_layout);

        // Create uniform buffers
        let threshold_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Bloom Threshold Uniform Buffer"),
            size: std::mem::size_of::<ThresholdUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let blur_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Bloom Blur Uniform Buffer"),
            size: std::mem::size_of::<BlurUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let composite_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Bloom Composite Uniform Buffer"),
            size: std::mem::size_of::<CompositeUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create uniform bind groups
        let threshold_uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Threshold Uniform Bind Group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: threshold_uniform_buffer.as_entire_binding(),
            }],
        });

        let blur_uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Blur Uniform Bind Group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: blur_uniform_buffer.as_entire_binding(),
            }],
        });

        let composite_uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Composite Uniform Bind Group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: composite_uniform_buffer.as_entire_binding(),
            }],
        });

        Self {
            bloom_texture_a,
            bloom_texture_b,
            bloom_view_a,
            bloom_view_b,
            threshold_pipeline,
            blur_pipeline,
            composite_pipeline,
            single_texture_layout,
            uniform_layout,
            composite_layout,
            threshold_uniform_buffer,
            blur_uniform_buffer,
            composite_uniform_buffer,
            threshold_uniform_bind_group,
            blur_uniform_bind_group,
            composite_uniform_bind_group,
            quad_vertex_buffer,
            sampler,
            full_width: width,
            full_height: height,
            bloom_width,
            bloom_height,
            format,
            current_downsample: downsample,
        }
    }

    fn create_bloom_texture(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
        label: &str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }

    fn create_threshold_pipeline(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        texture_layout: &wgpu::BindGroupLayout,
        uniform_layout: &wgpu::BindGroupLayout,
    ) -> wgpu::RenderPipeline {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Bloom Threshold Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_post_bloom_threshold.wgsl").into()),
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Bloom Threshold Pipeline Layout"),
            bind_group_layouts: &[texture_layout, uniform_layout],
            push_constant_ranges: &[],
        });

        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Bloom Threshold Pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[QuadVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        })
    }

    fn create_blur_pipeline(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        texture_layout: &wgpu::BindGroupLayout,
        uniform_layout: &wgpu::BindGroupLayout,
    ) -> wgpu::RenderPipeline {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Bloom Blur Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_post_bloom_blur.wgsl").into()),
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Bloom Blur Pipeline Layout"),
            bind_group_layouts: &[texture_layout, uniform_layout],
            push_constant_ranges: &[],
        });

        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Bloom Blur Pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[QuadVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        })
    }

    fn create_composite_pipeline(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        composite_layout: &wgpu::BindGroupLayout,
        uniform_layout: &wgpu::BindGroupLayout,
    ) -> wgpu::RenderPipeline {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Bloom Composite Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_post_bloom_composite.wgsl").into()),
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Bloom Composite Pipeline Layout"),
            bind_group_layouts: &[composite_layout, uniform_layout],
            push_constant_ranges: &[],
        });

        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Bloom Composite Pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[QuadVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        })
    }

    /// Resize bloom textures
    pub fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32, downsample: u32) {
        let ds = downsample.clamp(1, 8);
        let bloom_w = (width / ds).max(1);
        let bloom_h = (height / ds).max(1);

        if bloom_w == self.bloom_width && bloom_h == self.bloom_height {
            return;
        }

        self.full_width = width;
        self.full_height = height;
        self.bloom_width = bloom_w;
        self.bloom_height = bloom_h;
        self.current_downsample = ds;

        let (tex_a, view_a) =
            Self::create_bloom_texture(device, self.format, bloom_w, bloom_h, "Bloom A");
        let (tex_b, view_b) =
            Self::create_bloom_texture(device, self.format, bloom_w, bloom_h, "Bloom B");

        self.bloom_texture_a = tex_a;
        self.bloom_texture_b = tex_b;
        self.bloom_view_a = view_a;
        self.bloom_view_b = view_b;
    }

    /// Get current downsample factor
    pub fn current_downsample(&self) -> u32 {
        self.current_downsample
    }

    /// Process bloom effect
    ///
    /// # Arguments
    /// * `input_view` - Source scene texture
    /// * `output_view` - Destination texture to render to
    /// * `params` - Bloom parameters
    pub fn process(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        input_view: &wgpu::TextureView,
        output_view: &wgpu::TextureView,
        params: &BloomParams,
    ) {
        let params = params.sanitize();

        // Skip if intensity is zero
        if params.intensity <= 0.0 {
            // Just blit input to output
            self.blit(device, encoder, input_view, output_view);
            return;
        }

        // 1. Threshold pass: scene -> bloom_a (downsampled)
        self.render_threshold(device, encoder, queue, input_view, params.threshold);

        // 2. Horizontal blur: bloom_a -> bloom_b
        self.render_blur(device, encoder, queue, &self.bloom_view_a, &self.bloom_view_b,
                         [1.0, 0.0], params.radius);

        // 3. Vertical blur: bloom_b -> bloom_a
        self.render_blur(device, encoder, queue, &self.bloom_view_b, &self.bloom_view_a,
                         [0.0, 1.0], params.radius);

        // 4. Composite: scene + bloom_a -> output
        self.render_composite(device, encoder, queue, input_view, &self.bloom_view_a,
                              output_view, params.intensity);
    }

    fn blit(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        input: &wgpu::TextureView,
        output: &wgpu::TextureView,
    ) {
        // Simple blit using threshold pipeline with threshold=0 (pass everything)
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Blit Bind Group"),
            layout: &self.single_texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(input),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Bloom Blit Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        pass.set_pipeline(&self.threshold_pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_bind_group(1, &self.threshold_uniform_bind_group, &[]);
        pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        pass.draw(0..6, 0..1);
    }

    fn render_threshold(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        input: &wgpu::TextureView,
        threshold: f32,
    ) {
        // Update uniforms
        let uniforms = ThresholdUniforms {
            threshold,
            soft_knee: 0.5, // Reasonable default for soft threshold
            _padding: [0.0; 2],
        };
        queue.write_buffer(&self.threshold_uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        // Create texture bind group
        let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Threshold Texture Bind Group"),
            layout: &self.single_texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(input),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Bloom Threshold Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.bloom_view_a,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        pass.set_pipeline(&self.threshold_pipeline);
        pass.set_bind_group(0, &texture_bind_group, &[]);
        pass.set_bind_group(1, &self.threshold_uniform_bind_group, &[]);
        pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        pass.draw(0..6, 0..1);
    }

    fn render_blur(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        input: &wgpu::TextureView,
        output: &wgpu::TextureView,
        direction: [f32; 2],
        radius: f32,
    ) {
        // Update uniforms
        let uniforms = BlurUniforms {
            direction_and_radius: [direction[0], direction[1], radius, 0.0],
        };
        queue.write_buffer(&self.blur_uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        // Create texture bind group
        let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Blur Texture Bind Group"),
            layout: &self.single_texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(input),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Bloom Blur Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        pass.set_pipeline(&self.blur_pipeline);
        pass.set_bind_group(0, &texture_bind_group, &[]);
        pass.set_bind_group(1, &self.blur_uniform_bind_group, &[]);
        pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        pass.draw(0..6, 0..1);
    }

    fn render_composite(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        scene: &wgpu::TextureView,
        bloom: &wgpu::TextureView,
        output: &wgpu::TextureView,
        intensity: f32,
    ) {
        // Update uniforms
        let uniforms = CompositeUniforms {
            intensity,
            _padding: [0.0; 3],
        };
        queue.write_buffer(&self.composite_uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        // Create combined texture bind group
        let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Bloom Composite Texture Bind Group"),
            layout: &self.composite_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(scene),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(bloom),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Bloom Composite Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        pass.set_pipeline(&self.composite_pipeline);
        pass.set_bind_group(0, &texture_bind_group, &[]);
        pass.set_bind_group(1, &self.composite_uniform_bind_group, &[]);
        pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        pass.draw(0..6, 0..1);
    }
}
