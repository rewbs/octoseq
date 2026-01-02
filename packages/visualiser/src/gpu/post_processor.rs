//! GPU post-processing pipeline.
//!
//! Handles intermediate render targets and effect chain execution.
//! Also includes frame feedback for temporal visual memory (V7).

use std::collections::HashMap;
use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use crate::feedback::{FeedbackConfig, FeedbackSamplingMode, FeedbackUniforms};
use crate::gpu::bloom_processor::{BloomProcessor, BloomParams};
use crate::post_processing::{PostProcessingChain, PostEffectRegistry, EffectParamValue};

/// Maximum size for effect uniform buffer (in bytes).
const MAX_EFFECT_UNIFORM_SIZE: u64 = 128;

/// Vertex for fullscreen quad rendering.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct QuadVertex {
    position: [f32; 2],
    uv: [f32; 2],
}

impl QuadVertex {
    const ATTRIBS: [wgpu::VertexAttribute; 2] = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2];

    fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<QuadVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBS,
        }
    }
}

/// Fullscreen quad vertices (two triangles covering NDC).
const QUAD_VERTICES: &[QuadVertex] = &[
    QuadVertex { position: [-1.0, -1.0], uv: [0.0, 1.0] },
    QuadVertex { position: [ 1.0, -1.0], uv: [1.0, 1.0] },
    QuadVertex { position: [ 1.0,  1.0], uv: [1.0, 0.0] },
    QuadVertex { position: [-1.0, -1.0], uv: [0.0, 1.0] },
    QuadVertex { position: [ 1.0,  1.0], uv: [1.0, 0.0] },
    QuadVertex { position: [-1.0,  1.0], uv: [0.0, 0.0] },
];

/// GPU resources for a single effect.
struct EffectResources {
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

/// GPU post-processing system.
pub struct PostProcessor {
    /// Intermediate render targets (ping-pong).
    intermediate_textures: [wgpu::Texture; 2],
    intermediate_views: [wgpu::TextureView; 2],
    /// Scene render target (for initial scene render).
    scene_texture: wgpu::Texture,
    scene_view: wgpu::TextureView,
    /// Per-effect GPU resources.
    effect_resources: HashMap<String, EffectResources>,
    /// Fullscreen quad vertex buffer.
    quad_vertex_buffer: wgpu::Buffer,
    /// Sampler for effect textures.
    sampler: wgpu::Sampler,
    /// Bind group layout for input texture.
    texture_bind_group_layout: wgpu::BindGroupLayout,
    /// Bind group layout for effect uniforms.
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    /// Blit pipeline (for simple copy).
    blit_pipeline: wgpu::RenderPipeline,
    blit_bind_group: wgpu::BindGroup,
    /// Current dimensions.
    width: u32,
    height: u32,
    /// Texture format.
    format: wgpu::TextureFormat,

    // === Feedback system (V7) ===
    /// Feedback texture (stores previous frame, persists across frames).
    feedback_texture: wgpu::Texture,
    feedback_view: wgpu::TextureView,
    /// Feedback render pipeline.
    feedback_pipeline: wgpu::RenderPipeline,
    /// Feedback uniform buffer.
    feedback_uniform_buffer: wgpu::Buffer,
    /// Bind group layout for feedback (2 textures + sampler).
    feedback_texture_bind_group_layout: wgpu::BindGroupLayout,
    /// Bind group for feedback uniforms.
    feedback_uniform_bind_group: wgpu::BindGroup,
    /// Whether feedback was applied this frame (for determining post-process input).
    feedback_applied_this_frame: bool,
    /// Whether the feedback texture needs to be cleared (first use or after resize).
    feedback_needs_clear: bool,

    // === Optimized bloom processor ===
    /// Multi-pass bloom processor (separable blur + downsampling)
    bloom_processor: BloomProcessor,
}

impl PostProcessor {
    /// Create a new post-processor.
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
        registry: &PostEffectRegistry,
    ) -> Self {
        let size = wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        };

        // Create intermediate textures for ping-pong rendering
        // Need COPY_SRC for copying to feedback texture
        let create_texture = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            })
        };

        // Feedback texture needs COPY_DST for receiving copies
        let create_feedback_texture = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            })
        };

        let tex_a = create_texture("Post-Process Texture A");
        let tex_b = create_texture("Post-Process Texture B");
        let scene_tex = create_texture("Scene Texture");
        let feedback_tex = create_feedback_texture("Feedback Texture");

        let view_a = tex_a.create_view(&wgpu::TextureViewDescriptor::default());
        let view_b = tex_b.create_view(&wgpu::TextureViewDescriptor::default());
        let scene_view = scene_tex.create_view(&wgpu::TextureViewDescriptor::default());
        let feedback_view = feedback_tex.create_view(&wgpu::TextureViewDescriptor::default());

        // Fullscreen quad
        let quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Fullscreen Quad Buffer"),
            contents: bytemuck::cast_slice(QUAD_VERTICES),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Sampler
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Post-Process Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Texture bind group layout (for input texture + sampler)
        let texture_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Post-Process Texture Bind Group Layout"),
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

        // Uniform bind group layout (for effect parameters)
        let uniform_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Post-Process Uniform Bind Group Layout"),
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

        // Feedback texture bind group layout (current + feedback textures + sampler)
        let feedback_texture_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Feedback Texture Bind Group Layout"),
            entries: &[
                // Binding 0: current frame texture
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
                // Binding 1: feedback (previous frame) texture
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Binding 2: sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        // Create blit pipeline
        let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Blit Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_post_blit.wgsl").into()),
        });

        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Blit Pipeline Layout"),
            bind_group_layouts: &[&texture_bind_group_layout],
            push_constant_ranges: &[],
        });

        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Blit Pipeline"),
            layout: Some(&blit_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &blit_shader,
                entry_point: Some("vs_main"),
                buffers: &[QuadVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &blit_shader,
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
        });

        // Create bind group for blit (using scene texture as input)
        let blit_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Blit Bind Group"),
            layout: &texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&scene_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });

        // === Feedback pipeline ===
        let feedback_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Feedback Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_post_feedback.wgsl").into()),
        });

        let feedback_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Feedback Pipeline Layout"),
            bind_group_layouts: &[&feedback_texture_bind_group_layout, &uniform_bind_group_layout],
            push_constant_ranges: &[],
        });

        let feedback_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Feedback Pipeline"),
            layout: Some(&feedback_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &feedback_shader,
                entry_point: Some("vs_main"),
                buffers: &[QuadVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &feedback_shader,
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
        });

        // Feedback uniform buffer
        let feedback_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Feedback Uniform Buffer"),
            size: std::mem::size_of::<FeedbackUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Feedback uniform bind group
        let feedback_uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Feedback Uniform Bind Group"),
            layout: &uniform_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: feedback_uniform_buffer.as_entire_binding(),
            }],
        });

        // Create optimized bloom processor
        let bloom_processor = BloomProcessor::new(device, format, width, height);

        let mut processor = Self {
            intermediate_textures: [tex_a, tex_b],
            intermediate_views: [view_a, view_b],
            scene_texture: scene_tex,
            scene_view,
            effect_resources: HashMap::new(),
            quad_vertex_buffer,
            sampler,
            texture_bind_group_layout,
            uniform_bind_group_layout,
            blit_pipeline,
            blit_bind_group,
            width,
            height,
            format,
            // Feedback resources
            feedback_texture: feedback_tex,
            feedback_view,
            feedback_pipeline,
            feedback_uniform_buffer,
            feedback_texture_bind_group_layout,
            feedback_uniform_bind_group,
            feedback_applied_this_frame: false,
            feedback_needs_clear: true,
            // Bloom processor
            bloom_processor,
        };

        // Create pipelines for registered effects
        for id in registry.list_ids() {
            if let Err(e) = processor.create_effect_pipeline(device, id) {
                log::error!("Failed to create pipeline for effect '{}': {}", id, e);
            }
        }

        processor
    }

    /// Create GPU resources for an effect.
    fn create_effect_pipeline(&mut self, device: &wgpu::Device, effect_id: &str) -> Result<(), String> {
        let shader_source = match effect_id {
            "bloom" => include_str!("shader_post_bloom.wgsl"),
            "color_grade" => include_str!("shader_post_color_grade.wgsl"),
            "vignette" => include_str!("shader_post_vignette.wgsl"),
            "distortion" => include_str!("shader_post_distortion.wgsl"),
            "zoom_wrap" => include_str!("shader_post_zoom_wrap.wgsl"),
            "radial_blur" => include_str!("shader_post_radial_blur.wgsl"),
            "directional_blur" => include_str!("shader_post_directional_blur.wgsl"),
            "chromatic_aberration" => include_str!("shader_post_chromatic_aberration.wgsl"),
            "grain" => include_str!("shader_post_grain.wgsl"),
            _ => return Err(format!("Unknown effect: {}", effect_id)),
        };

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(&format!("Effect Shader: {}", effect_id)),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(&format!("Effect Pipeline Layout: {}", effect_id)),
            bind_group_layouts: &[&self.texture_bind_group_layout, &self.uniform_bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(&format!("Effect Pipeline: {}", effect_id)),
            layout: Some(&pipeline_layout),
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
                    format: self.format,
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
        });

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(&format!("Effect Uniform Buffer: {}", effect_id)),
            size: MAX_EFFECT_UNIFORM_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&format!("Effect Uniform Bind Group: {}", effect_id)),
            layout: &self.uniform_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        self.effect_resources.insert(
            effect_id.to_string(),
            EffectResources {
                pipeline,
                uniform_buffer,
                bind_group,
            },
        );

        Ok(())
    }

    /// Get the scene render target view.
    /// Render the scene to this view when post-processing is enabled.
    pub fn scene_view(&self) -> &wgpu::TextureView {
        &self.scene_view
    }

    /// Resize the post-processor.
    pub fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if width == self.width && height == self.height {
            return;
        }

        self.width = width.max(1);
        self.height = height.max(1);

        let size = wgpu::Extent3d {
            width: self.width,
            height: self.height,
            depth_or_array_layers: 1,
        };

        let create_texture = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            })
        };

        let create_feedback_texture = || {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Feedback Texture"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            })
        };

        self.intermediate_textures[0] = create_texture("Post-Process Texture A");
        self.intermediate_textures[1] = create_texture("Post-Process Texture B");
        self.scene_texture = create_texture("Scene Texture");
        self.feedback_texture = create_feedback_texture();

        self.intermediate_views[0] = self.intermediate_textures[0].create_view(&wgpu::TextureViewDescriptor::default());
        self.intermediate_views[1] = self.intermediate_textures[1].create_view(&wgpu::TextureViewDescriptor::default());
        self.scene_view = self.scene_texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.feedback_view = self.feedback_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Mark feedback texture as needing clear (new texture has undefined contents)
        self.feedback_needs_clear = true;

        // Resize bloom processor with default downsample
        self.bloom_processor.resize(device, self.width, self.height, self.bloom_processor.current_downsample());

        // Recreate blit bind group with new scene view
        self.blit_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Blit Bind Group"),
            layout: &self.texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&self.scene_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
    }

    /// Process the post-processing chain.
    /// Takes the scene render target and applies effects to the final output.
    ///
    /// If feedback was applied this frame (via `process_feedback`), uses
    /// the feedback output as the input instead of the raw scene.
    pub fn process(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        output_view: &wgpu::TextureView,
        chain: &PostProcessingChain,
        evaluated_params: &HashMap<String, Vec<EffectParamValue>>,
    ) {
        let enabled_effects: Vec<_> = chain.enabled_effects().collect();

        // Determine the input: feedback output if feedback was applied, else scene
        let initial_input_view = self.feedback_input_view();

        if enabled_effects.is_empty() {
            // No effects - blit input directly to output
            // Need to create a blit bind group for the appropriate input
            if self.feedback_applied_this_frame {
                let blit_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Blit Bind Group (Feedback)"),
                    layout: &self.texture_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(initial_input_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                self.blit(encoder, initial_input_view, output_view, &blit_bind_group);
            } else {
                self.blit(encoder, initial_input_view, output_view, &self.blit_bind_group);
            }
            return;
        }

        // Process effects in chain order
        let mut current_input_view = initial_input_view;
        // If feedback was applied, intermediate[0] is already used, start ping-pong at 1
        let mut ping = if self.feedback_applied_this_frame { 1 } else { 0 };

        for (i, effect) in enabled_effects.iter().enumerate() {
            let is_last = i == enabled_effects.len() - 1;
            let output = if is_last {
                output_view
            } else {
                &self.intermediate_views[ping]
            };

            // Check if this is a bloom effect - route through optimized BloomProcessor
            if effect.effect_id == "bloom" {
                // Extract bloom parameters
                let bloom_params = if let Some(params) = evaluated_params.get(&effect.effect_id) {
                    let threshold = params.get(0).map(|p| p.as_float()).unwrap_or(0.8);
                    let intensity = params.get(1).map(|p| p.as_float()).unwrap_or(0.5);
                    let radius = params.get(2).map(|p| p.as_float()).unwrap_or(4.0);
                    let downsample = params.get(3).map(|p| p.as_float() as u32).unwrap_or(2);
                    BloomParams {
                        threshold,
                        intensity,
                        radius,
                        downsample,
                    }
                } else {
                    BloomParams::default()
                };

                // Process through optimized multi-pass bloom
                self.bloom_processor.process(
                    device,
                    encoder,
                    queue,
                    current_input_view,
                    output,
                    &bloom_params,
                );
            } else {
                // Standard single-pass effect processing
                // Update effect uniforms
                if let Some(params) = evaluated_params.get(&effect.effect_id) {
                    self.update_effect_uniforms(queue, &effect.effect_id, params);
                }

                // Create texture bind group for this pass
                let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(&format!("Effect Texture Bind Group: {}", effect.effect_id)),
                    layout: &self.texture_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(current_input_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });

                // Render effect
                self.render_effect(encoder, output, &effect.effect_id, &texture_bind_group);
            }

            // Update for next pass
            if !is_last {
                current_input_view = &self.intermediate_views[ping];
                ping = 1 - ping;
            }
        }
    }

    fn blit(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        _input: &wgpu::TextureView,
        output: &wgpu::TextureView,
        bind_group: &wgpu::BindGroup,
    ) {
        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Blit Pass"),
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

        render_pass.set_pipeline(&self.blit_pipeline);
        render_pass.set_bind_group(0, bind_group, &[]);
        render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        render_pass.draw(0..6, 0..1);
    }

    fn render_effect(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        output: &wgpu::TextureView,
        effect_id: &str,
        texture_bind_group: &wgpu::BindGroup,
    ) {
        let resources = match self.effect_resources.get(effect_id) {
            Some(r) => r,
            None => {
                log::warn!("No resources for effect: {}", effect_id);
                return;
            }
        };

        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(&format!("Effect Pass: {}", effect_id)),
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

        render_pass.set_pipeline(&resources.pipeline);
        render_pass.set_bind_group(0, texture_bind_group, &[]);
        render_pass.set_bind_group(1, &resources.bind_group, &[]);
        render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        render_pass.draw(0..6, 0..1);
    }

    fn update_effect_uniforms(&self, queue: &wgpu::Queue, effect_id: &str, params: &[EffectParamValue]) {
        if let Some(resources) = self.effect_resources.get(effect_id) {
            let mut data = Vec::new();
            for param in params {
                data.extend(param.to_bytes());
            }

            // Pad to 16-byte alignment
            while data.len() % 16 != 0 {
                data.push(0);
            }

            if data.len() as u64 <= MAX_EFFECT_UNIFORM_SIZE {
                queue.write_buffer(&resources.uniform_buffer, 0, &data);
            }
        }
    }

    /// Check if post-processing has resources for an effect.
    pub fn has_effect(&self, effect_id: &str) -> bool {
        self.effect_resources.contains_key(effect_id)
    }

    // === Feedback system methods ===

    /// Process frame feedback.
    ///
    /// This should be called before `process()` each frame.
    /// It blends the previous frame (with spatial warp and colour transform) with the current scene.
    ///
    /// The result is written to `intermediate_textures[0]` and copied to `feedback_texture`
    /// for the next frame.
    ///
    /// # Arguments
    /// * `device` - wgpu device
    /// * `encoder` - command encoder
    /// * `queue` - wgpu queue
    /// * `config` - feedback configuration (for enabled flag)
    /// * `uniforms` - pre-evaluated uniforms (all signals resolved to f32)
    pub fn process_feedback(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        config: &FeedbackConfig,
        uniforms: &FeedbackUniforms,
    ) {
        self.feedback_applied_this_frame = false;

        if !config.enabled {
            return;
        }

        // Clear feedback texture on first use to avoid undefined/garbage data
        if self.feedback_needs_clear {
            self.clear_feedback(encoder);
            self.feedback_needs_clear = false;
        }

        // Update feedback uniforms (already evaluated, just write to GPU)
        queue.write_buffer(&self.feedback_uniform_buffer, 0, bytemuck::bytes_of(uniforms));

        // Create texture bind group for this frame
        // Bindings: 0 = current (scene), 1 = feedback (previous), 2 = sampler
        let feedback_texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Feedback Texture Bind Group"),
            layout: &self.feedback_texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&self.scene_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&self.feedback_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        // Render feedback pass: scene + previous frame -> intermediate[0]
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Feedback Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.intermediate_views[0],
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

            render_pass.set_pipeline(&self.feedback_pipeline);
            render_pass.set_bind_group(0, &feedback_texture_bind_group, &[]);
            render_pass.set_bind_group(1, &self.feedback_uniform_bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
            render_pass.draw(0..6, 0..1);
        }

        // Copy result to feedback texture for next frame
        let size = wgpu::Extent3d {
            width: self.width,
            height: self.height,
            depth_or_array_layers: 1,
        };

        encoder.copy_texture_to_texture(
            wgpu::ImageCopyTexture {
                texture: &self.intermediate_textures[0],
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyTexture {
                texture: &self.feedback_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            size,
        );

        self.feedback_applied_this_frame = true;
    }

    /// Clear the feedback buffer to black.
    ///
    /// Call this when seeking to ensure clean feedback state.
    pub fn clear_feedback(&self, encoder: &mut wgpu::CommandEncoder) {
        let _render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Clear Feedback Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.feedback_view,
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
        // Pass ends immediately, clearing the texture
    }

    /// Get the input view for the post-processing chain.
    ///
    /// Returns `intermediate_views[0]` if feedback was applied this frame,
    /// otherwise returns `scene_view`.
    pub fn feedback_input_view(&self) -> &wgpu::TextureView {
        if self.feedback_applied_this_frame {
            &self.intermediate_views[0]
        } else {
            &self.scene_view
        }
    }

    /// Check if feedback was applied this frame.
    pub fn feedback_applied(&self) -> bool {
        self.feedback_applied_this_frame
    }

    /// Process both feedback and post-processing in the correct order based on sampling mode.
    ///
    /// This is the recommended entry point for combined feedback + post-FX processing.
    /// It handles the ordering:
    /// - PreFx (default): feedback → post-FX
    /// - PostFx: post-FX → feedback
    ///
    /// # Arguments
    /// * `device` - wgpu device
    /// * `encoder` - command encoder
    /// * `queue` - wgpu queue
    /// * `output_view` - final render target
    /// * `feedback_config` - feedback configuration
    /// * `feedback_uniforms` - pre-evaluated feedback uniforms
    /// * `post_chain` - post-processing effect chain
    /// * `evaluated_params` - pre-evaluated effect parameters
    pub fn process_all(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        output_view: &wgpu::TextureView,
        feedback_config: &FeedbackConfig,
        feedback_uniforms: &FeedbackUniforms,
        post_chain: &PostProcessingChain,
        evaluated_params: &HashMap<String, Vec<EffectParamValue>>,
    ) {
        match feedback_config.sampling_mode {
            FeedbackSamplingMode::PreFx => {
                // Default: feedback samples scene, then post-FX is applied
                self.process_feedback(device, encoder, queue, feedback_config, feedback_uniforms);
                self.process(device, encoder, queue, output_view, post_chain, evaluated_params);
            }
            FeedbackSamplingMode::PostFx => {
                // Post-FX first, then feedback samples the processed result
                self.process_feedback_post_fx(
                    device,
                    encoder,
                    queue,
                    output_view,
                    feedback_config,
                    feedback_uniforms,
                    post_chain,
                    evaluated_params,
                );
            }
        }
    }

    /// Process with PostFx sampling mode: post-FX first, then feedback.
    ///
    /// The flow is:
    /// 1. Apply post-FX chain to scene → intermediate
    /// 2. Feedback samples from post-FX result
    /// 3. Output feedback result to final target
    fn process_feedback_post_fx(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        output_view: &wgpu::TextureView,
        feedback_config: &FeedbackConfig,
        feedback_uniforms: &FeedbackUniforms,
        post_chain: &PostProcessingChain,
        evaluated_params: &HashMap<String, Vec<EffectParamValue>>,
    ) {
        self.feedback_applied_this_frame = false;
        let has_effects = post_chain.has_enabled_effects();
        let has_feedback = feedback_config.enabled;

        // Handle trivial cases
        if !has_effects && !has_feedback {
            // Nothing to do - just blit scene to output
            self.blit(encoder, &self.scene_view, output_view, &self.blit_bind_group);
            return;
        }

        if !has_feedback {
            // No feedback, just run post-FX normally
            // Note: feedback_applied_this_frame is already false
            self.process(device, encoder, queue, output_view, post_chain, evaluated_params);
            return;
        }

        // We have feedback. First, run post-FX if any.
        let post_fx_result_view = if has_effects {
            // Run post-FX chain to intermediate[1] (we'll use 0 for feedback output)
            self.process_to_intermediate(device, encoder, queue, post_chain, evaluated_params, 1);
            &self.intermediate_views[1]
        } else {
            &self.scene_view
        };

        // Clear feedback texture on first use
        if self.feedback_needs_clear {
            self.clear_feedback(encoder);
            self.feedback_needs_clear = false;
        }

        // Update feedback uniforms
        queue.write_buffer(&self.feedback_uniform_buffer, 0, bytemuck::bytes_of(feedback_uniforms));

        // Create texture bind group for feedback pass
        // Bindings: 0 = post-FX result (or scene), 1 = feedback (previous), 2 = sampler
        let feedback_texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Feedback Texture Bind Group (PostFx mode)"),
            layout: &self.feedback_texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(post_fx_result_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&self.feedback_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        // Render feedback pass directly to output
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Feedback Pass (PostFx mode)"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: output_view,
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

            render_pass.set_pipeline(&self.feedback_pipeline);
            render_pass.set_bind_group(0, &feedback_texture_bind_group, &[]);
            render_pass.set_bind_group(1, &self.feedback_uniform_bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
            render_pass.draw(0..6, 0..1);
        }

        // Copy output to feedback texture for next frame
        // We need to copy from output, but we can't read from swapchain.
        // Instead, we'll render feedback to intermediate[0] AND output simultaneously.
        // Actually, we need to render to intermediate[0] first, then blit to output.
        // Let me refactor this...

        // Render feedback to intermediate[0]
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Feedback Pass to Intermediate (PostFx mode)"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.intermediate_views[0],
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

            render_pass.set_pipeline(&self.feedback_pipeline);
            render_pass.set_bind_group(0, &feedback_texture_bind_group, &[]);
            render_pass.set_bind_group(1, &self.feedback_uniform_bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
            render_pass.draw(0..6, 0..1);
        }

        // Copy to feedback texture for next frame
        let size = wgpu::Extent3d {
            width: self.width,
            height: self.height,
            depth_or_array_layers: 1,
        };

        encoder.copy_texture_to_texture(
            wgpu::ImageCopyTexture {
                texture: &self.intermediate_textures[0],
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyTexture {
                texture: &self.feedback_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            size,
        );

        // Blit intermediate[0] to output
        let blit_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Blit Bind Group (PostFx feedback)"),
            layout: &self.texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&self.intermediate_views[0]),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        self.blit(encoder, &self.intermediate_views[0], output_view, &blit_bind_group);

        self.feedback_applied_this_frame = true;
    }

    /// Process post-FX chain to an intermediate texture (for PostFx sampling mode).
    fn process_to_intermediate(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        chain: &PostProcessingChain,
        evaluated_params: &HashMap<String, Vec<EffectParamValue>>,
        target_intermediate: usize,
    ) {
        let enabled_effects: Vec<_> = chain.enabled_effects().collect();
        let num_effects = enabled_effects.len();

        if num_effects == 0 {
            return;
        }

        let other_intermediate = 1 - target_intermediate;

        // Process effects in chain order
        let mut current_input_view = &self.scene_view;

        for (i, effect) in enabled_effects.iter().enumerate() {
            // Compute output index by working backwards from target.
            // This ensures each effect reads from a different texture than it writes to.
            // Pattern (from end): last->target, second-to-last->other, third-to-last->target, etc.
            let k = num_effects - 1 - i; // distance from end
            let output_idx = if k % 2 == 0 { target_intermediate } else { other_intermediate };
            let output = &self.intermediate_views[output_idx];

            // Check if this is a bloom effect
            if effect.effect_id == "bloom" {
                let bloom_params = if let Some(params) = evaluated_params.get(&effect.effect_id) {
                    let threshold = params.get(0).map(|p| p.as_float()).unwrap_or(0.8);
                    let intensity = params.get(1).map(|p| p.as_float()).unwrap_or(0.5);
                    let radius = params.get(2).map(|p| p.as_float()).unwrap_or(4.0);
                    let downsample = params.get(3).map(|p| p.as_float() as u32).unwrap_or(2);
                    BloomParams {
                        threshold,
                        intensity,
                        radius,
                        downsample,
                    }
                } else {
                    BloomParams::default()
                };

                self.bloom_processor.process(
                    device,
                    encoder,
                    queue,
                    current_input_view,
                    output,
                    &bloom_params,
                );
            } else {
                if let Some(params) = evaluated_params.get(&effect.effect_id) {
                    self.update_effect_uniforms(queue, &effect.effect_id, params);
                }

                let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(&format!("Effect Texture Bind Group: {}", effect.effect_id)),
                    layout: &self.texture_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(current_input_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });

                self.render_effect(encoder, output, &effect.effect_id, &texture_bind_group);
            }

            // Update input for next pass
            current_input_view = output;
        }
    }
}
