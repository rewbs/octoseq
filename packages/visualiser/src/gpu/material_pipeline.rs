//! GPU pipeline management for materials.
//!
//! This module creates and manages render pipelines for each material,
//! handling shader compilation, uniform buffers, and bind groups.

use std::collections::HashMap;
use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use crate::material::{Material, MaterialId, MaterialRegistry, ParamValue};
use crate::gpu::mesh::Vertex;

/// Maximum size for material uniform buffer (in bytes).
/// Must be large enough for any material's parameters.
const MAX_MATERIAL_UNIFORM_SIZE: u64 = 256;

/// Global uniforms shared by all materials.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GlobalUniforms {
    pub view_proj: [[f32; 4]; 4],
    pub model: [[f32; 4]; 4],
    pub time: f32,
    pub dt: f32,
    pub _padding: [f32; 2],
}

impl Default for GlobalUniforms {
    fn default() -> Self {
        Self {
            view_proj: glam::Mat4::IDENTITY.to_cols_array_2d(),
            model: glam::Mat4::IDENTITY.to_cols_array_2d(),
            time: 0.0,
            dt: 0.0,
            _padding: [0.0; 2],
        }
    }
}

/// GPU resources for a single material.
pub struct MaterialGpuResources {
    /// Render pipeline for this material.
    pub pipeline: wgpu::RenderPipeline,
    /// Wireframe pipeline (if applicable).
    pub wireframe_pipeline: Option<wgpu::RenderPipeline>,
    /// Bind group layout for material-specific uniforms.
    pub material_bind_group_layout: wgpu::BindGroupLayout,
    /// Uniform buffer for material parameters.
    pub uniform_buffer: wgpu::Buffer,
    /// Bind group for material uniforms.
    pub bind_group: wgpu::BindGroup,
}

/// Manages all material pipelines and shared GPU resources.
pub struct MaterialPipelineManager {
    /// Per-material GPU resources.
    resources: HashMap<MaterialId, MaterialGpuResources>,
    /// Global uniform buffer (shared across all materials).
    global_uniform_buffer: wgpu::Buffer,
    /// Global bind group.
    global_bind_group: wgpu::BindGroup,
    /// Global bind group layout.
    global_bind_group_layout: wgpu::BindGroupLayout,
    /// Texture format for render targets.
    format: wgpu::TextureFormat,
}

impl MaterialPipelineManager {
    /// Create a new material pipeline manager.
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        registry: &MaterialRegistry,
    ) -> Self {
        // Create global bind group layout
        let global_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Material Global Bind Group Layout"),
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
        });

        // Create global uniform buffer
        let global_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Material Global Uniform Buffer"),
            contents: bytemuck::cast_slice(&[GlobalUniforms::default()]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Create global bind group
        let global_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Material Global Bind Group"),
            layout: &global_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: global_uniform_buffer.as_entire_binding(),
            }],
        });

        let mut manager = Self {
            resources: HashMap::new(),
            global_uniform_buffer,
            global_bind_group,
            global_bind_group_layout,
            format,
        };

        // Create pipelines for all registered materials
        for id in registry.list_ids() {
            if let Some(material) = registry.get(id) {
                if let Err(e) = manager.create_material_pipeline(device, &material) {
                    log::error!("Failed to create pipeline for material '{}': {}", id, e);
                }
            }
        }

        manager
    }

    /// Create GPU resources for a single material.
    fn create_material_pipeline(
        &mut self,
        device: &wgpu::Device,
        material: &Material,
    ) -> Result<(), String> {
        // Create material bind group layout
        let material_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(&format!("Material Bind Group Layout: {}", material.id)),
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
        });

        // Create uniform buffer for material parameters
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(&format!("Material Uniform Buffer: {}", material.id)),
            size: MAX_MATERIAL_UNIFORM_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create bind group
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&format!("Material Bind Group: {}", material.id)),
            layout: &material_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(&format!("Material Pipeline Layout: {}", material.id)),
            bind_group_layouts: &[&self.global_bind_group_layout, &material_bind_group_layout],
            push_constant_ranges: &[],
        });

        // Load shader module for this material
        let shader = self.load_material_shader(device, &material.id)?;

        // Create solid pipeline
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(&format!("Material Pipeline: {}", material.id)),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some(&material.vertex_entry),
                buffers: &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some(&material.fragment_entry),
                targets: &[Some(wgpu::ColorTargetState {
                    format: self.format,
                    blend: Some(material.blend_mode.to_blend_state()),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: material.cull_mode,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Create wireframe pipeline if needed
        let wireframe_pipeline = if material.wireframe_only {
            None // Wireframe-only materials use the solid pipeline with line topology
        } else {
            Some(device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(&format!("Material Wireframe Pipeline: {}", material.id)),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(&material.vertex_entry),
                    buffers: &[Vertex::desc()],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(&material.fragment_entry),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: self.format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::LineList,
                    strip_index_format: None,
                    front_face: wgpu::FrontFace::Ccw,
                    cull_mode: None,
                    polygon_mode: wgpu::PolygonMode::Fill,
                    unclipped_depth: false,
                    conservative: false,
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            }))
        };

        self.resources.insert(
            material.id.clone(),
            MaterialGpuResources {
                pipeline,
                wireframe_pipeline,
                material_bind_group_layout,
                uniform_buffer,
                bind_group,
            },
        );

        Ok(())
    }

    /// Load the shader module for a material.
    fn load_material_shader(&self, device: &wgpu::Device, material_id: &str) -> Result<wgpu::ShaderModule, String> {
        // For now, all materials use the same base shader with different entry points
        // In the future, we can have material-specific shaders
        let shader_source = match material_id {
            "default" => include_str!("shader_material_default.wgsl"),
            "emissive" => include_str!("shader_material_emissive.wgsl"),
            "wire_glow" => include_str!("shader_material_wire_glow.wgsl"),
            "soft_additive" => include_str!("shader_material_soft_additive.wgsl"),
            "gradient" => include_str!("shader_material_gradient.wgsl"),
            _ => {
                // Fall back to default shader for unknown materials
                log::warn!("Unknown material '{}', using default shader", material_id);
                include_str!("shader_material_default.wgsl")
            }
        };

        Ok(device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(&format!("Material Shader: {}", material_id)),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        }))
    }

    /// Get GPU resources for a material.
    pub fn get(&self, id: &str) -> Option<&MaterialGpuResources> {
        self.resources.get(id)
    }

    /// Update global uniforms.
    pub fn update_global_uniforms(&self, queue: &wgpu::Queue, uniforms: &GlobalUniforms) {
        queue.write_buffer(&self.global_uniform_buffer, 0, bytemuck::cast_slice(&[*uniforms]));
    }

    /// Update material-specific uniforms.
    pub fn update_material_uniforms(
        &self,
        queue: &wgpu::Queue,
        material_id: &str,
        params: &[ParamValue],
    ) {
        if let Some(resources) = self.resources.get(material_id) {
            let mut data = Vec::new();
            for param in params {
                data.extend(param.to_bytes());
            }

            // Pad to 16-byte alignment
            while data.len() % 16 != 0 {
                data.push(0);
            }

            // Ensure we don't exceed buffer size
            if data.len() as u64 <= MAX_MATERIAL_UNIFORM_SIZE {
                queue.write_buffer(&resources.uniform_buffer, 0, &data);
            } else {
                log::error!(
                    "Material uniform data for '{}' exceeds buffer size ({} > {})",
                    material_id,
                    data.len(),
                    MAX_MATERIAL_UNIFORM_SIZE
                );
            }
        }
    }

    /// Get the global bind group.
    pub fn global_bind_group(&self) -> &wgpu::BindGroup {
        &self.global_bind_group
    }

    /// Check if a material has GPU resources.
    pub fn has_resources(&self, id: &str) -> bool {
        self.resources.contains_key(id)
    }
}

/// Evaluated material parameters ready for GPU upload.
#[derive(Debug, Clone, Default)]
pub struct EvaluatedMaterialParams {
    /// Parameter values in the order defined by the material.
    pub values: Vec<ParamValue>,
}

impl EvaluatedMaterialParams {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, value: ParamValue) {
        self.values.push(value);
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::new();
        for value in &self.values {
            data.extend(value.to_bytes());
        }
        // Pad to 16-byte alignment
        while data.len() % 16 != 0 {
            data.push(0);
        }
        data
    }
}
