//! WGPU Stylized 3D Engine + Optional 5-Target AI Conditioning MRT (`Scene3DPass`).
//!
//! Ports Lactoseq's OpenGL 4.5 `Scene3DPass` to `wgpu` / WGSL so declarative
//! `scene_rig.v1` / `scene_rig.v2` rigs and sanitized `.glb` meshes run identically
//! on both native headless GPU and WebGPU/WASM.

use bytemuck::{Pod, Zeroable};
use std::f32::consts::PI;
use wgpu::util::DeviceExt;

use crate::glb_loader::{GlbAsset, RigVertex};
use crate::rig_loader::{
    ActiveSceneRig, RigMusicalUniforms, RigOutputMode, RigTemplate, SceneRigConfig,
};

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
const MRT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const UNIFORM_ALIGN: usize = 256;
const MAX_MESH_DRAWS: usize = 64;
const MAX_VOLUMETRIC_DRAWS: usize = 8;

/// Deterministic SplitMix64 hash -> [0, 1) matching `scene3d_pass.cpp::Hash01`.
fn hash01(seed: u64, a: u64, b: u64) -> f32 {
    let mut z = seed
        ^ a.wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ b.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (((z >> 40) & 0x00FF_FFFF) as f32) / 16_777_216.0
}

fn srgb_to_linear_ch(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct Scene3DUniforms {
    view: [[f32; 4]; 4],
    proj: [[f32; 4]; 4],
    prev_view_proj: [[f32; 4]; 4],
    time_params: [f32; 4],
    depth_params: [f32; 4],
    react_params: [f32; 4],
    grid_params: [u32; 4],
    col_drums: [f32; 4],
    col_bass: [f32; 4],
    col_vocals: [f32; 4],
    col_other: [f32; 4],
    musical0: [f32; 4],
    musical1: [f32; 4],
    musical2: [f32; 4],
    musical3: [f32; 4],
    stem_weights: [f32; 4],
    answer: [f32; 4],
    tonal: [f32; 4],
    v2_gains: [f32; 4],
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct MeshDrawUniforms {
    model: [[f32; 4]; 4],
    prev_model: [[f32; 4]; 4],
    color_zone: [f32; 4],
    morph_params: [f32; 4],
    extra_params: [f32; 4],
    _pad: [[f32; 4]; 5], // 176 + 80 = 256 bytes exact
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct VolumetricDrawUniforms {
    model: [[f32; 4]; 4],
    view: [[f32; 4]; 4],
    proj: [[f32; 4]; 4],
    beam_color_intensity: [f32; 4],
    params: [f32; 4],
    _pad: [[f32; 4]; 2], // 224 + 32 = 256 bytes exact
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct QuadParams {
    mode: u32,
    convert_srgb_to_linear: u32,
    _pad0: u32,
    _pad1: u32,
}

struct GpuMesh {
    vertex_buffer: wgpu::Buffer,
    vertex_count: u32,
}

struct MrtTargets {
    width: u32,
    height: u32,
    depth_tex: wgpu::Texture,
    depth_view: wgpu::TextureView,
    normal_tex: wgpu::Texture,
    normal_view: wgpu::TextureView,
    wire_tex: wgpu::Texture,
    wire_view: wgpu::TextureView,
    flat_tex: wgpu::Texture,
    flat_view: wgpu::TextureView,
    motion_tex: wgpu::Texture,
    motion_view: wgpu::TextureView,
    quad_bind_group: wgpu::BindGroup,
    single_bind_groups: [wgpu::BindGroup; 5], // depth, normal, wire, flat, motion
}

struct InstancedPipelines {
    cathedral: wgpu::RenderPipeline,
    orbital: wgpu::RenderPipeline,
    megastructure: wgpu::RenderPipeline,
    tunnel: wgpu::RenderPipeline,
    mesh: wgpu::RenderPipeline,
}

/// GPU resources for rendering `scene_rig.v1` / `scene_rig.v2` scenes.
pub struct Scene3DPass {
    beauty_format: wgpu::TextureFormat,
    width: u32,
    height: u32,

    // Depth buffer
    depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,

    // Uniform buffers & bind groups
    scene_uniform_buffer: wgpu::Buffer,
    scene_bind_group_layout: wgpu::BindGroupLayout,
    scene_bind_group: wgpu::BindGroup,

    mesh_draw_buffer: wgpu::Buffer,
    mesh_draw_bind_group_layout: wgpu::BindGroupLayout,
    mesh_draw_bind_group: wgpu::BindGroup,

    volumetric_buffer: wgpu::Buffer,
    volumetric_bind_group: wgpu::BindGroup,

    quad_uniform_buffer: wgpu::Buffer,
    quad_bind_group_layout: wgpu::BindGroupLayout,
    quad_pipeline: wgpu::RenderPipeline,

    // Pipelines (beauty-only always created; 3+3 MRT pipelines created lazily on first MRT frame)
    beauty_pipelines: InstancedPipelines,
    mrt_pipelines_a: Option<InstancedPipelines>,
    mrt_pipelines_b: Option<InstancedPipelines>,
    volumetric_pipeline: wgpu::RenderPipeline,

    // Procedural barycentric meshes
    cube_mesh: GpuMesh,
    cone_mesh: GpuMesh,
    icosa_mesh: GpuMesh,
    torus_mesh: GpuMesh,

    // Optional loaded GLB hero mesh + embedded albedo
    glb_hero_mesh: Option<GpuMesh>,
    glb_has_base_color: bool,
    glb_base_color: [f32; 3],
    glb_has_albedo_tex: bool,
    glb_albedo_texture: Option<wgpu::Texture>,
    fallback_white_texture: wgpu::Texture,
    albedo_sampler: wgpu::Sampler,
    loaded_generation: u64,

    // Optional 5-target MRT conditioning textures (allocated only when MRT is active)
    mrt_targets: Option<MrtTargets>,
}

// ============================================================================
// Procedural Barycentric Mesh Generators (matching scene3d_pass.cpp 1:1)
// ============================================================================

pub fn build_cube_mesh() -> Vec<RigVertex> {
    struct Face {
        n: [f32; 3],
        v: [[f32; 3]; 4],
        uv: [[f32; 2]; 4],
    }
    const FACES: [Face; 6] = [
        Face {
            n: [0.0, 0.0, 1.0],
            v: [
                [-0.5, -0.5, 0.5],
                [0.5, -0.5, 0.5],
                [0.5, 0.5, 0.5],
                [-0.5, 0.5, 0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
        Face {
            n: [0.0, 0.0, -1.0],
            v: [
                [0.5, -0.5, -0.5],
                [-0.5, -0.5, -0.5],
                [-0.5, 0.5, -0.5],
                [0.5, 0.5, -0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
        Face {
            n: [1.0, 0.0, 0.0],
            v: [
                [0.5, -0.5, 0.5],
                [0.5, -0.5, -0.5],
                [0.5, 0.5, -0.5],
                [0.5, 0.5, 0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
        Face {
            n: [-1.0, 0.0, 0.0],
            v: [
                [-0.5, -0.5, -0.5],
                [-0.5, -0.5, 0.5],
                [-0.5, 0.5, 0.5],
                [-0.5, 0.5, -0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
        Face {
            n: [0.0, 1.0, 0.0],
            v: [
                [-0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
                [0.5, 0.5, -0.5],
                [-0.5, 0.5, -0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
        Face {
            n: [0.0, -1.0, 0.0],
            v: [
                [-0.5, -0.5, -0.5],
                [0.5, -0.5, -0.5],
                [0.5, -0.5, 0.5],
                [-0.5, -0.5, 0.5],
            ],
            uv: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
    ];
    // Quad-edge barycentrics so cube diagonals stay hidden while all 4 outer edges stay crisp!
    const B_TRI1: [[f32; 3]; 3] = [[1.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 1.0, 1.0]];
    const B_TRI2: [[f32; 3]; 3] = [[0.0, 1.0, 1.0], [1.0, 0.0, 1.0], [0.0, 0.0, 1.0]];
    const IDX1: [usize; 3] = [0, 1, 2];
    const IDX2: [usize; 3] = [0, 2, 3];

    let mut out = Vec::with_capacity(36);
    for f in &FACES {
        for k in 0..3 {
            let idx = IDX1[k];
            out.push(RigVertex::new(f.v[idx], f.n, f.uv[idx], B_TRI1[k]));
        }
        for k in 0..3 {
            let idx = IDX2[k];
            out.push(RigVertex::new(f.v[idx], f.n, f.uv[idx], B_TRI2[k]));
        }
    }
    out
}

pub fn build_cone_mesh(radial_segs: usize) -> Vec<RigVertex> {
    let n = radial_segs.max(8);
    let apex = glam::Vec3::ZERO;
    const BARY: [[f32; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut out = Vec::with_capacity(n * 3);
    for i in 0..n {
        let a0 = (i as f32 / n as f32) * 2.0 * PI;
        let a1 = ((i + 1) as f32 / n as f32) * 2.0 * PI;
        let p0 = glam::Vec3::new(a0.cos(), -1.0, a0.sin());
        let p1 = glam::Vec3::new(a1.cos(), -1.0, a1.sin());
        let n0 = glam::Vec3::new(a0.cos(), 1.0, a0.sin()).normalize();
        let n1 = glam::Vec3::new(a1.cos(), 1.0, a1.sin()).normalize();
        let na = (n0 + n1).normalize();
        let ps = [apex, p1, p0];
        let ns = [na, n1, n0];
        let us = [
            (i as f32 + 0.5) / n as f32,
            (i + 1) as f32 / n as f32,
            i as f32 / n as f32,
        ];
        let vs = [0.0, 1.0, 1.0];
        for k in 0..3 {
            out.push(RigVertex::new(
                ps[k].to_array(),
                ns[k].to_array(),
                [us[k], vs[k]],
                BARY[k],
            ));
        }
    }
    out
}

pub fn build_icosahedron_mesh(subdivisions: usize) -> Vec<RigVertex> {
    let t = (1.0 + 5.0f32.sqrt()) * 0.5;
    let pts = [
        glam::Vec3::new(-1.0, t, 0.0).normalize(),
        glam::Vec3::new(1.0, t, 0.0).normalize(),
        glam::Vec3::new(-1.0, -t, 0.0).normalize(),
        glam::Vec3::new(1.0, -t, 0.0).normalize(),
        glam::Vec3::new(0.0, -1.0, t).normalize(),
        glam::Vec3::new(0.0, 1.0, t).normalize(),
        glam::Vec3::new(0.0, -1.0, -t).normalize(),
        glam::Vec3::new(0.0, 1.0, -t).normalize(),
        glam::Vec3::new(t, 0.0, -1.0).normalize(),
        glam::Vec3::new(t, 0.0, 1.0).normalize(),
        glam::Vec3::new(-t, 0.0, -1.0).normalize(),
        glam::Vec3::new(-t, 0.0, 1.0).normalize(),
    ];
    const BASE_IDX: [[usize; 3]; 20] = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
    ];
    let mut tris: Vec<[glam::Vec3; 3]> = BASE_IDX
        .iter()
        .map(|idx| [pts[idx[0]], pts[idx[1]], pts[idx[2]]])
        .collect();
    for _ in 0..subdivisions {
        let mut next = Vec::with_capacity(tris.len() * 4);
        for [a, b, c] in tris {
            let ab = ((a + b) * 0.5).normalize();
            let bc = ((b + c) * 0.5).normalize();
            let ca = ((c + a) * 0.5).normalize();
            next.push([a, ab, ca]);
            next.push([b, bc, ab]);
            next.push([c, ca, bc]);
            next.push([ab, bc, ca]);
        }
        tris = next;
    }
    const BARY: [[f32; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut out = Vec::with_capacity(tris.len() * 3);
    for vs in tris {
        let fn_v = (vs[1] - vs[0]).cross(vs[2] - vs[0]).normalize();
        for k in 0..3 {
            let uv = [
                vs[k].z.atan2(vs[k].x) / (2.0 * PI) + 0.5,
                vs[k].y.clamp(-1.0, 1.0).asin() / PI + 0.5,
            ];
            out.push(RigVertex::new(vs[k].to_array(), fn_v.to_array(), uv, BARY[k]));
        }
    }
    out
}

pub fn build_torus_knot_mesh(tubular_segs: usize, radial_segs: usize) -> Vec<RigVertex> {
    let p = 2.0f32;
    let q = 3.0f32;
    let r_big = 1.6f32;
    let tube_r = 0.42f32;
    let eval_curve = |u: f32| -> glam::Vec3 {
        let cu = u.cos();
        let su = u.sin();
        let qu_p = q * u / p;
        let cs = qu_p.cos();
        glam::Vec3::new(
            r_big * (2.0 + cs) * 0.5 * cu,
            r_big * (2.0 + cs) * 0.5 * su,
            r_big * qu_p.sin() * 0.5,
        )
    };
    let stride = radial_segs + 1;
    let total = (tubular_segs + 1) * stride;
    let mut ring_pos = vec![glam::Vec3::ZERO; total];
    let mut ring_norm = vec![glam::Vec3::Y; total];
    let mut ring_uv = vec![[0.0f32; 2]; total];

    for i in 0..=tubular_segs {
        let u = (i as f32 / tubular_segs as f32) * p * 2.0 * PI;
        let p1 = eval_curve(u);
        let p2 = eval_curve(u + 0.01);
        let t_dir = (p2 - p1).normalize();
        let mut n_dir = (p2 + p1).normalize();
        let b_dir = t_dir.cross(n_dir).normalize();
        n_dir = b_dir.cross(t_dir).normalize();

        for j in 0..=radial_segs {
            let v = (j as f32 / radial_segs as f32) * 2.0 * PI;
            let cx = -tube_r * v.cos();
            let cy = tube_r * v.sin();
            let pos = p1 + n_dir * cx + b_dir * cy;
            let norm = (pos - p1).normalize();
            let idx = i * stride + j;
            ring_pos[idx] = pos;
            ring_norm[idx] = norm;
            ring_uv[idx] = [i as f32 / tubular_segs as f32 * 4.0, j as f32 / radial_segs as f32];
        }
    }

    const BARY: [[f32; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut out = Vec::with_capacity(tubular_segs * radial_segs * 6);
    for i in 0..tubular_segs {
        for j in 0..radial_segs {
            let a = i * stride + j;
            let b = (i + 1) * stride + j;
            let c = (i + 1) * stride + (j + 1);
            let d = i * stride + (j + 1);
            for tri in [[a, b, c], [a, c, d]] {
                for k in 0..3 {
                    let idx = tri[k];
                    out.push(RigVertex::new(
                        ring_pos[idx].to_array(),
                        ring_norm[idx].to_array(),
                        ring_uv[idx],
                        BARY[k],
                    ));
                }
            }
        }
    }
    out
}

fn upload_gpu_mesh(device: &wgpu::Device, label: &str, verts: &[RigVertex]) -> GpuMesh {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(label),
        contents: bytemuck::cast_slice(verts),
        usage: wgpu::BufferUsages::VERTEX,
    });
    GpuMesh {
        vertex_buffer,
        vertex_count: verts.len() as u32,
    }
}

fn create_depth_texture(device: &wgpu::Device, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Scene3D Depth Texture"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    (tex, view)
}

fn create_mrt_tex(device: &wgpu::Device, label: &str, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: MRT_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    (tex, view)
}

#[derive(Clone, Copy)]
enum PassKind {
    BeautyOnly,
    /// MRT Pass A (3 targets = 24 bytes/sample <= WebGPU 32-byte cap): beauty, depth, normal
    MrtA,
    /// MRT Pass B (3 targets = 24 bytes/sample <= WebGPU 32-byte cap, depth LessEqual read-only): wireframe, flat, motion
    MrtB,
}

fn build_pipelines(
    device: &wgpu::Device,
    beauty_format: wgpu::TextureFormat,
    instanced_layout: &wgpu::PipelineLayout,
    mesh_layout: &wgpu::PipelineLayout,
    instanced_shader: &wgpu::ShaderModule,
    mesh_shader: &wgpu::ShaderModule,
    kind: PassKind,
) -> InstancedPipelines {
    let fs_entry = match kind {
        PassKind::BeautyOnly => "fs_beauty",
        PassKind::MrtA => "fs_mrt_a",
        PassKind::MrtB => "fs_mrt_b",
    };
    let color_targets_beauty = [Some(wgpu::ColorTargetState {
        format: beauty_format,
        blend: Some(wgpu::BlendState::REPLACE),
        write_mask: wgpu::ColorWrites::ALL,
    })];
    let color_targets_mrt_a = [
        Some(wgpu::ColorTargetState {
            format: beauty_format,
            blend: Some(wgpu::BlendState::REPLACE),
            write_mask: wgpu::ColorWrites::ALL,
        }),
        Some(wgpu::ColorTargetState {
            format: MRT_FORMAT,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        }),
        Some(wgpu::ColorTargetState {
            format: MRT_FORMAT,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        }),
    ];
    let color_targets_mrt_b = [
        Some(wgpu::ColorTargetState {
            format: MRT_FORMAT,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        }),
        Some(wgpu::ColorTargetState {
            format: MRT_FORMAT,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        }),
        Some(wgpu::ColorTargetState {
            format: MRT_FORMAT,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        }),
    ];
    let targets: &[Option<wgpu::ColorTargetState>] = match kind {
        PassKind::BeautyOnly => &color_targets_beauty,
        PassKind::MrtA => &color_targets_mrt_a,
        PassKind::MrtB => &color_targets_mrt_b,
    };
    let (depth_write_enabled, depth_compare) = match kind {
        PassKind::BeautyOnly | PassKind::MrtA => (true, wgpu::CompareFunction::Less),
        PassKind::MrtB => (false, wgpu::CompareFunction::LessEqual),
    };

    let make_pipe = |label: &str,
                     layout: &wgpu::PipelineLayout,
                     module: &wgpu::ShaderModule,
                     vs_entry: &str| {
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module,
                entry_point: Some(vs_entry),
                buffers: &[RigVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module,
                entry_point: Some(fs_entry),
                targets,
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled,
                depth_compare,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        })
    };

    let tag = match kind {
        PassKind::BeautyOnly => "Beauty",
        PassKind::MrtA => "MRT-A",
        PassKind::MrtB => "MRT-B",
    };
    InstancedPipelines {
        cathedral: make_pipe(
            &format!("Scene3D Cathedral ({tag})"),
            instanced_layout,
            instanced_shader,
            "vs_cathedral",
        ),
        orbital: make_pipe(
            &format!("Scene3D Orbital ({tag})"),
            instanced_layout,
            instanced_shader,
            "vs_orbital",
        ),
        megastructure: make_pipe(
            &format!("Scene3D Megastructure ({tag})"),
            instanced_layout,
            instanced_shader,
            "vs_megastructure",
        ),
        tunnel: make_pipe(
            &format!("Scene3D Tunnel ({tag})"),
            instanced_layout,
            instanced_shader,
            "vs_tunnel",
        ),
        mesh: make_pipe(
            &format!("Scene3D Mesh ({tag})"),
            mesh_layout,
            mesh_shader,
            "vs_mesh",
        ),
    }
}

/// Compute deterministic camera view + projection matrices matching `scene3d_pass.cpp`.
pub fn compute_camera_matrices(
    cfg: &SceneRigConfig,
    m: &RigMusicalUniforms,
    ts: f32,
    aspect: f32,
    seed: u64,
) -> (glam::Mat4, glam::Mat4) {
    let beat_pos = m.musical0[0];
    let bar_phase = m.musical0[2];
    let section_prog = m.musical0[3];
    let kick = m.musical1[0];
    let drum_fill = m.musical2[1];
    let hit_env = m.answer[0];
    let hit_count = m.answer[1];
    let hit_gather = m.answer[2];

    let bars_per_cut = (4 * cfg.camera.cut_every_bars.max(1)) as f32;
    let bar_group = (beat_pos / bars_per_cut).floor().max(0.0) as u64;
    let cam_shot = (hash01(seed, bar_group, 77) * 4.0).floor() as i32 & 3;

    let orbit_a = ts * cfg.camera.orbit_speed
        + drum_fill * 0.35 * cfg.reactivity.fill_turbulence
        + (cam_shot as f32) * 1.15;

    let (cam_pos, cam_target) = match cfg.template {
        RigTemplate::InstancedMegastructure => {
            let fly_z = (ts * 4.5) % 36.0 - 18.0;
            match cam_shot {
                0 => (
                    glam::Vec3::new(
                        orbit_a.sin() * 2.2,
                        2.6 + 0.6 * kick * cfg.reactivity.kick_punch,
                        fly_z + 12.0,
                    ),
                    glam::Vec3::new(0.0, 1.2, fly_z - 14.0),
                ),
                1 => (
                    glam::Vec3::new(
                        orbit_a.cos() * 18.0,
                        11.0 + 2.0 * section_prog,
                        orbit_a.sin() * 18.0,
                    ),
                    glam::Vec3::new(0.0, 0.5, 0.0),
                ),
                2 => (
                    glam::Vec3::new(
                        (orbit_a * 1.4).sin() * 11.0,
                        1.2,
                        (orbit_a * 1.4).cos() * 11.0,
                    ),
                    glam::Vec3::new(0.0, 3.2, 0.0),
                ),
                _ => (
                    glam::Vec3::new(
                        (orbit_a * 0.7).cos() * 24.0,
                        16.5,
                        (orbit_a * 0.7).sin() * 24.0,
                    ),
                    glam::Vec3::new(0.0, -1.0, 0.0),
                ),
            }
        }
        RigTemplate::CyberWireframeTunnel => {
            let sx = (ts * 0.10).sin() * 0.18;
            let sy = (ts * 0.09).cos() * 0.12;
            (
                glam::Vec3::new(sx, sy, 4.5),
                glam::Vec3::new(
                    (ts * 0.10 + 0.4).sin() * 0.22,
                    (ts * 0.09 + 0.4).cos() * 0.15,
                    -26.0,
                ),
            )
        }
        RigTemplate::SacredPolyhedraCathedral => {
            let sx = (ts * 0.04 + hit_count * 0.42 * cfg.reactivity.staying_step_gain).sin() * 0.72;
            let sy = 0.45
                + (ts * 0.035 + hit_count * 0.25 * cfg.reactivity.staying_step_gain).cos() * 0.32;
            let z_off =
                6.2 + 0.16 * hit_gather * cfg.reactivity.hit_gather_gain - 0.22 * hit_env;
            (
                glam::Vec3::new(sx, sy, z_off),
                glam::Vec3::new(0.0, 0.45, -24.0),
            )
        }
        RigTemplate::OrbitalPrismArray => {
            let stay_orbit = ts * cfg.camera.orbit_speed * 0.35
                + hit_count * 0.26 * cfg.reactivity.staying_step_gain;
            let rad = 12.4 + 0.22 * hit_gather * cfg.reactivity.hit_gather_gain - 0.28 * hit_env;
            let elev = 1.6
                + 0.35 * (ts * 0.035 + hit_count * 0.35 * cfg.reactivity.staying_step_gain).sin();
            (
                glam::Vec3::new(stay_orbit.cos() * rad, elev, stay_orbit.sin() * rad),
                glam::Vec3::ZERO,
            )
        }
        RigTemplate::VolumetricConcertStage => {
            let rad = match cam_shot {
                0 => 11.2,
                1 => 9.2,
                2 => 13.8,
                _ => 10.4,
            };
            let elev = if cam_shot == 2 {
                5.6
            } else {
                2.1 + 1.1 * (bar_phase * 2.0 * PI).sin()
            };
            (
                glam::Vec3::new(orbit_a.cos() * rad, elev, orbit_a.sin() * rad),
                glam::Vec3::new(0.0, 0.8, 0.0),
            )
        }
        _ => {
            let base_rad = if cfg.template == RigTemplate::HybridMonolithStage {
                12.2
            } else {
                9.8
            };
            let rad = match cam_shot {
                0 => base_rad,
                1 => base_rad - 1.2,
                2 => base_rad + 3.2,
                _ => base_rad + 0.8,
            };
            let elev = if cam_shot == 2 {
                6.2
            } else {
                2.4 + 1.4 * (bar_phase * 2.0 * PI).sin()
            };
            (
                glam::Vec3::new(orbit_a.cos() * rad, elev, orbit_a.sin() * rad),
                glam::Vec3::new(0.0, 0.35, 0.0),
            )
        }
    };

    let is_v2_staying = matches!(
        cfg.template,
        RigTemplate::SacredPolyhedraCathedral | RigTemplate::OrbitalPrismArray
    );
    let (fov_dyn, roll) = if is_v2_staying {
        let fov = (cfg.camera.fov_deg - 1.2 * hit_env * cfg.reactivity.kick_punch
            + 2.0 * drum_fill * cfg.reactivity.fill_turbulence)
            .clamp(24.0, 95.0);
        let r = 0.045 * (hit_count * 0.78539816 * cfg.reactivity.staying_step_gain).sin()
            + 0.04 * drum_fill * cfg.reactivity.fill_turbulence;
        (fov, r)
    } else {
        let fov = (cfg.camera.fov_deg - 4.5 * kick * cfg.reactivity.kick_punch
            + 7.5 * drum_fill * cfg.reactivity.fill_turbulence)
            .clamp(24.0, 95.0);
        let r = 0.08 * (bar_phase * 2.0 * PI).sin()
            + 0.14 * drum_fill * cfg.reactivity.fill_turbulence;
        (fov, r)
    };
    let up = glam::Vec3::new(roll.sin(), roll.cos(), 0.0);

    let view = glam::Mat4::look_at_rh(cam_pos, cam_target, up);
    let proj = glam::Mat4::perspective_rh(
        fov_dyn.to_radians(),
        aspect.max(0.01),
        cfg.camera.near,
        cfg.camera.far,
    );
    (view, proj)
}

impl Scene3DPass {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        beauty_format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let (depth_texture, depth_view) = create_depth_texture(device, width, height);

        // 1x1 white fallback albedo texture
        let fallback_white_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Scene3D White Fallback Texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &fallback_white_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[255u8, 255, 255, 255],
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let fallback_view =
            fallback_white_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let albedo_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Scene3D Albedo Sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        let scene_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scene3D Uniform Buffer"),
            size: std::mem::size_of::<Scene3DUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let scene_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Scene3D Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(
                                std::mem::size_of::<Scene3DUniforms>() as u64,
                            ),
                        },
                        count: None,
                    },
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
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        let scene_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scene3D Bind Group"),
            layout: &scene_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: scene_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&fallback_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&albedo_sampler),
                },
            ],
        });

        let mesh_draw_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scene3D Mesh Draw Uniform Buffer"),
            size: (UNIFORM_ALIGN * MAX_MESH_DRAWS) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mesh_draw_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Scene3D Mesh Draw Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: true,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<MeshDrawUniforms>() as u64,
                        ),
                    },
                    count: None,
                }],
            });
        let mesh_draw_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scene3D Mesh Draw Bind Group"),
            layout: &mesh_draw_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &mesh_draw_buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(std::mem::size_of::<MeshDrawUniforms>() as u64),
                }),
            }],
        });

        // Volumetric spotlight cones
        let volumetric_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scene3D Volumetric Uniform Buffer"),
            size: (UNIFORM_ALIGN * MAX_VOLUMETRIC_DRAWS) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let volumetric_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Scene3D Volumetric Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(
                        std::mem::size_of::<VolumetricDrawUniforms>() as u64,
                    ),
                },
                count: None,
            }],
        });
        let volumetric_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scene3D Volumetric Bind Group"),
            layout: &volumetric_bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &volumetric_buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(
                        std::mem::size_of::<VolumetricDrawUniforms>() as u64,
                    ),
                }),
            }],
        });
        let volumetric_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scene3D Volumetric Shader"),
            source: wgpu::ShaderSource::Wgsl(
                include_str!("shader_scene3d_volumetric.wgsl").into(),
            ),
        });
        let volumetric_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Scene3D Volumetric Pipeline Layout"),
            bind_group_layouts: &[&volumetric_bgl],
            push_constant_ranges: &[],
        });
        let volumetric_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Scene3D Volumetric Pipeline"),
            layout: Some(&volumetric_layout),
            vertex: wgpu::VertexState {
                module: &volumetric_shader,
                entry_point: Some("vs_volumetric"),
                buffers: &[RigVertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &volumetric_shader,
                entry_point: Some("fs_volumetric"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: beauty_format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::Zero,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Conditioning quad / channel blit pipeline
        let quad_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scene3D Quad Uniform Buffer"),
            size: std::mem::size_of::<QuadParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let tex_entry = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let quad_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Scene3D Quad Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(
                                std::mem::size_of::<QuadParams>() as u64,
                            ),
                        },
                        count: None,
                    },
                    tex_entry(1),
                    tex_entry(2),
                    tex_entry(3),
                    tex_entry(4),
                    wgpu::BindGroupLayoutEntry {
                        binding: 5,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let quad_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scene3D Quad Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_scene3d_quad.wgsl").into()),
        });
        let quad_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Scene3D Quad Pipeline Layout"),
            bind_group_layouts: &[&quad_bind_group_layout],
            push_constant_ranges: &[],
        });
        let quad_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Scene3D Quad Pipeline"),
            layout: Some(&quad_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &quad_shader,
                entry_point: Some("vs_fullscreen"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &quad_shader,
                entry_point: Some("fs_quad"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: beauty_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Instanced + mesh beauty pipelines
        let instanced_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scene3D Instanced Shader"),
            source: wgpu::ShaderSource::Wgsl(
                include_str!("shader_scene3d_instanced.wgsl").into(),
            ),
        });
        let mesh_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scene3D Mesh Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader_scene3d_mesh.wgsl").into()),
        });
        let instanced_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Scene3D Instanced Pipeline Layout"),
            bind_group_layouts: &[&scene_bind_group_layout],
            push_constant_ranges: &[],
        });
        let mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Scene3D Mesh Pipeline Layout"),
            bind_group_layouts: &[&scene_bind_group_layout, &mesh_draw_bind_group_layout],
            push_constant_ranges: &[],
        });
        let beauty_pipelines = build_pipelines(
            device,
            beauty_format,
            &instanced_layout,
            &mesh_layout,
            &instanced_shader,
            &mesh_shader,
            PassKind::BeautyOnly,
        );

        // Build procedural barycentric meshes
        let cube_mesh = upload_gpu_mesh(device, "Scene3D Cube", &build_cube_mesh());
        let cone_mesh = upload_gpu_mesh(device, "Scene3D Cone", &build_cone_mesh(32));
        let icosa_mesh = upload_gpu_mesh(device, "Scene3D Icosahedron", &build_icosahedron_mesh(2));
        let torus_mesh = upload_gpu_mesh(device, "Scene3D TorusKnot", &build_torus_knot_mesh(96, 16));

        Self {
            beauty_format,
            width: width.max(1),
            height: height.max(1),
            depth_texture,
            depth_view,
            scene_uniform_buffer,
            scene_bind_group_layout,
            scene_bind_group,
            mesh_draw_buffer,
            mesh_draw_bind_group_layout,
            mesh_draw_bind_group,
            volumetric_buffer,
            volumetric_bind_group,
            quad_uniform_buffer,
            quad_bind_group_layout,
            quad_pipeline,
            beauty_pipelines,
            mrt_pipelines_a: None,
            mrt_pipelines_b: None,
            volumetric_pipeline,
            cube_mesh,
            cone_mesh,
            icosa_mesh,
            torus_mesh,
            glb_hero_mesh: None,
            glb_has_base_color: false,
            glb_base_color: [1.0, 1.0, 1.0],
            glb_has_albedo_tex: false,
            glb_albedo_texture: None,
            fallback_white_texture,
            albedo_sampler,
            loaded_generation: 0,
            mrt_targets: None,
        }
    }

    pub fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        let w = width.max(1);
        let h = height.max(1);
        if self.width == w && self.height == h {
            return;
        }
        self.width = w;
        self.height = h;
        let (dt, dv) = create_depth_texture(device, w, h);
        self.depth_texture = dt;
        self.depth_view = dv;
        // Recreate MRT targets lazily on next MRT render
        self.mrt_targets = None;
    }

    fn ensure_mrt_resources(&mut self, device: &wgpu::Device) {
        if self.mrt_pipelines_a.is_none() {
            let instanced_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Scene3D Instanced Shader (MRT)"),
                source: wgpu::ShaderSource::Wgsl(
                    include_str!("shader_scene3d_instanced.wgsl").into(),
                ),
            });
            let mesh_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Scene3D Mesh Shader (MRT)"),
                source: wgpu::ShaderSource::Wgsl(include_str!("shader_scene3d_mesh.wgsl").into()),
            });
            let instanced_layout =
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("Scene3D Instanced MRT Layout"),
                    bind_group_layouts: &[&self.scene_bind_group_layout],
                    push_constant_ranges: &[],
                });
            let mesh_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Scene3D Mesh MRT Layout"),
                bind_group_layouts: &[
                    &self.scene_bind_group_layout,
                    &self.mesh_draw_bind_group_layout,
                ],
                push_constant_ranges: &[],
            });
            self.mrt_pipelines_a = Some(build_pipelines(
                device,
                self.beauty_format,
                &instanced_layout,
                &mesh_layout,
                &instanced_shader,
                &mesh_shader,
                PassKind::MrtA,
            ));
            self.mrt_pipelines_b = Some(build_pipelines(
                device,
                self.beauty_format,
                &instanced_layout,
                &mesh_layout,
                &instanced_shader,
                &mesh_shader,
                PassKind::MrtB,
            ));
        }

        let needs_alloc = match &self.mrt_targets {
            Some(t) => t.width != self.width || t.height != self.height,
            None => true,
        };
        if needs_alloc {
            let (depth_tex, depth_view) =
                create_mrt_tex(device, "Scene3D MRT Depth", self.width, self.height);
            let (normal_tex, normal_view) =
                create_mrt_tex(device, "Scene3D MRT Normal", self.width, self.height);
            let (wire_tex, wire_view) =
                create_mrt_tex(device, "Scene3D MRT Wireframe", self.width, self.height);
            let (flat_tex, flat_view) =
                create_mrt_tex(device, "Scene3D MRT Flat", self.width, self.height);
            let (motion_tex, motion_view) =
                create_mrt_tex(device, "Scene3D MRT Motion", self.width, self.height);

            let make_bg = |label: &str,
                           v0: &wgpu::TextureView,
                           v1: &wgpu::TextureView,
                           v2: &wgpu::TextureView,
                           v3: &wgpu::TextureView| {
                device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(label),
                    layout: &self.quad_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: self.quad_uniform_buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(v0),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::TextureView(v1),
                        },
                        wgpu::BindGroupEntry {
                            binding: 3,
                            resource: wgpu::BindingResource::TextureView(v2),
                        },
                        wgpu::BindGroupEntry {
                            binding: 4,
                            resource: wgpu::BindingResource::TextureView(v3),
                        },
                        wgpu::BindGroupEntry {
                            binding: 5,
                            resource: wgpu::BindingResource::Sampler(&self.albedo_sampler),
                        },
                    ],
                })
            };

            // Quad order: TL=flat, TR=depth, BL=normal, BR=wire
            let quad_bind_group = make_bg(
                "Scene3D Quad Bind Group",
                &flat_view,
                &depth_view,
                &normal_view,
                &wire_view,
            );
            let single_bind_groups = [
                make_bg("Scene3D Single Depth", &depth_view, &depth_view, &depth_view, &depth_view),
                make_bg("Scene3D Single Normal", &normal_view, &normal_view, &normal_view, &normal_view),
                make_bg("Scene3D Single Wire", &wire_view, &wire_view, &wire_view, &wire_view),
                make_bg("Scene3D Single Flat", &flat_view, &flat_view, &flat_view, &flat_view),
                make_bg("Scene3D Single Motion", &motion_view, &motion_view, &motion_view, &motion_view),
            ];

            self.mrt_targets = Some(MrtTargets {
                width: self.width,
                height: self.height,
                depth_tex,
                depth_view,
                normal_tex,
                normal_view,
                wire_tex,
                wire_view,
                flat_tex,
                flat_view,
                motion_tex,
                motion_view,
                quad_bind_group,
                single_bind_groups,
            });
        }
    }

    fn sync_glb_asset(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, active: &ActiveSceneRig) {
        if self.loaded_generation == active.generation {
            return;
        }
        self.loaded_generation = active.generation;

        if let Some(asset) = active.glb_asset.as_ref() {
            self.upload_glb_asset(device, queue, asset);
        } else {
            self.glb_hero_mesh = None;
            self.glb_has_base_color = false;
            self.glb_base_color = [1.0, 1.0, 1.0];
            self.glb_has_albedo_tex = false;
            self.glb_albedo_texture = None;
            let fallback_view = self
                .fallback_white_texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            self.scene_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Scene3D Bind Group (Fallback)"),
                layout: &self.scene_bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: self.scene_uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&fallback_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&self.albedo_sampler),
                    },
                ],
            });
        }
    }

    fn upload_glb_asset(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, asset: &GlbAsset) {
        self.glb_hero_mesh = Some(upload_gpu_mesh(device, "Scene3D GLB Hero Mesh", &asset.vertices));
        self.glb_has_base_color = asset.has_base_color_factor;
        self.glb_base_color = asset.base_color_factor;

        let tex_view = if let Some(ref rgba) = asset.albedo_rgba {
            let tex = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Scene3D GLB Albedo Texture"),
                size: wgpu::Extent3d {
                    width: asset.albedo_width,
                    height: asset.albedo_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture: &tex,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                rgba,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(4 * asset.albedo_width),
                    rows_per_image: Some(asset.albedo_height),
                },
                wgpu::Extent3d {
                    width: asset.albedo_width,
                    height: asset.albedo_height,
                    depth_or_array_layers: 1,
                },
            );
            let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
            self.glb_albedo_texture = Some(tex);
            self.glb_has_albedo_tex = true;
            view
        } else {
            self.glb_albedo_texture = None;
            self.glb_has_albedo_tex = false;
            self.fallback_white_texture
                .create_view(&wgpu::TextureViewDescriptor::default())
        };

        self.scene_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scene3D Bind Group (GLB)"),
            layout: &self.scene_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.scene_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&tex_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.albedo_sampler),
                },
            ],
        });
    }

    pub fn depth_texture(&self) -> Option<&wgpu::Texture> {
        self.mrt_targets.as_ref().map(|t| &t.depth_tex)
    }
    pub fn normal_texture(&self) -> Option<&wgpu::Texture> {
        self.mrt_targets.as_ref().map(|t| &t.normal_tex)
    }
    pub fn wireframe_texture(&self) -> Option<&wgpu::Texture> {
        self.mrt_targets.as_ref().map(|t| &t.wire_tex)
    }
    pub fn flat_texture(&self) -> Option<&wgpu::Texture> {
        self.mrt_targets.as_ref().map(|t| &t.flat_tex)
    }
    pub fn motion_texture(&self) -> Option<&wgpu::Texture> {
        self.mrt_targets.as_ref().map(|t| &t.motion_tex)
    }

    /// Render the active 3D rig into `beauty_view` (which is typically `PostProcessor`'s HDR scene target).
    ///
    /// When `convert_srgb_to_linear` is true (default when writing to Octoseq's linear `Rgba16Float`
    /// pipeline that presents into `Rgba8UnormSrgb`), the beauty output is converted via sRGB EOTF
    /// so the final 8-bit image matches Lactoseq's `GL_RGBA8` brightness and dark-space contrast.
    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        beauty_view: &wgpu::TextureView,
        active: &ActiveSceneRig,
        convert_srgb_to_linear: bool,
    ) {
        self.sync_glb_asset(device, queue, active);

        let cfg = &active.config;
        let m = &active.musical;
        let t = active.time_sec;
        let prev_t = (t - active.frame_dt).max(0.0);
        let aspect = self.width as f32 / self.height.max(1) as f32;
        let supports_mrt = device.limits().max_color_attachments >= 3;
        let mrt_active = cfg.mrt_active() && supports_mrt;
        if cfg.mrt_active() && !supports_mrt {
            log::warn!(
                "Scene3D MRT requires 3 color attachments (device limit: {}); falling back to beauty-only",
                device.limits().max_color_attachments
            );
        }
        if mrt_active {
            self.ensure_mrt_resources(device);
        }

        let (view_mat, proj_mat) = compute_camera_matrices(cfg, m, t, aspect, active.seed);
        let (prev_view_mat, prev_proj_mat) =
            compute_camera_matrices(cfg, m, prev_t, aspect, active.seed);
        let prev_view_proj = prev_proj_mat * prev_view_mat;

        // Resolution-scaled wireframe thickness matching scene3d_pass.cpp line 2341
        let res_wire_scale = (self.height as f32 / 1080.0).max(0.5);
        let wire_thickness = cfg.conditioning.wireframe_thickness * res_wire_scale;

        let (param_a, param_b, spacing, inst_count) = match cfg.template {
            RigTemplate::InstancedMegastructure => {
                let n = cfg.geometry.instance_count.clamp(1, 50_000);
                let side = (n as f64).sqrt().ceil().max(1.0) as u32;
                (side, side, 1.35f32, n)
            }
            RigTemplate::CyberWireframeTunnel => {
                let sides = 12u32;
                let rings = (cfg.geometry.instance_count / sides).clamp(24, 240);
                (sides, rings, 1.65f32, sides * rings)
            }
            RigTemplate::SacredPolyhedraCathedral => {
                let rings = 12u32;
                let per_ring = (cfg.geometry.instance_count / rings).clamp(12, 120);
                (rings, per_ring, 0.0f32, rings * per_ring)
            }
            RigTemplate::OrbitalPrismArray => {
                let shells = 8u32;
                let per_shell = (cfg.geometry.instance_count / shells).clamp(16, 160);
                (shells, per_shell, 0.0f32, shells * per_shell)
            }
            _ => (1u32, 1u32, 1.0f32, 1u32),
        };

        let scene_uniforms = Scene3DUniforms {
            view: view_mat.to_cols_array_2d(),
            proj: proj_mat.to_cols_array_2d(),
            prev_view_proj: prev_view_proj.to_cols_array_2d(),
            time_params: [t, prev_t, spacing, wire_thickness],
            depth_params: [
                cfg.conditioning.depth_near,
                cfg.conditioning.depth_far,
                cfg.reactivity.wireframe_glow,
                cfg.reactivity.kick_punch,
            ],
            react_params: [
                cfg.reactivity.fill_turbulence,
                cfg.reactivity.bar_wave_amp,
                if convert_srgb_to_linear { 1.0 } else { 0.0 },
                if self.glb_has_albedo_tex { 1.0 } else { 0.0 },
            ],
            grid_params: [
                (active.seed & 0xFFFF_FFFF) as u32,
                param_a,
                param_b,
                cfg.material_style.code(),
            ],
            col_drums: [
                cfg.palette.drums_rgb[0],
                cfg.palette.drums_rgb[1],
                cfg.palette.drums_rgb[2],
                1.0,
            ],
            col_bass: [
                cfg.palette.bass_rgb[0],
                cfg.palette.bass_rgb[1],
                cfg.palette.bass_rgb[2],
                1.0,
            ],
            col_vocals: [
                cfg.palette.vocals_rgb[0],
                cfg.palette.vocals_rgb[1],
                cfg.palette.vocals_rgb[2],
                1.0,
            ],
            col_other: [
                cfg.palette.other_rgb[0],
                cfg.palette.other_rgb[1],
                cfg.palette.other_rgb[2],
                1.0,
            ],
            musical0: m.musical0,
            musical1: m.musical1,
            musical2: m.musical2,
            musical3: m.musical3,
            stem_weights: m.stem_weights,
            answer: m.answer,
            tonal: m.tonal,
            v2_gains: m.v2_gains,
        };
        queue.write_buffer(
            &self.scene_uniform_buffer,
            0,
            bytemuck::bytes_of(&scene_uniforms),
        );

        // Prepare per-draw mesh uniforms (all uploaded BEFORE the render pass!)
        #[derive(Clone, Copy)]
        enum DrawMeshKind {
            Hero,
            Cube,
        }
        let mut mesh_draws: Vec<(DrawMeshKind, MeshDrawUniforms)> = Vec::new();
        let mut volumetric_draws: Vec<VolumetricDrawUniforms> = Vec::new();

        let hero_col = if self.glb_has_base_color {
            self.glb_base_color
        } else {
            cfg.palette.vocals_rgb
        };
        let use_glb_tex_f = if self.glb_has_albedo_tex { 1.0 } else { 0.0 };
        let p_cols = [
            cfg.palette.drums_rgb,
            cfg.palette.bass_rgb,
            cfg.palette.vocals_rgb,
            cfg.palette.other_rgb,
        ];
        let p_weights = m.stem_weights;

        match cfg.template {
            RigTemplate::OrbitalPrismArray => {
                let hit_env = m.answer[0];
                let hit_count = m.answer[1];
                let hit_gather = m.answer[2];
                let harm_ch = m.tonal[1];
                let hero_scale = 1.40 - 0.18 * hit_gather * cfg.reactivity.hit_gather_gain
                    + 0.36 * hit_env * cfg.reactivity.kick_punch;
                let hero_angle = t * 0.10 + hit_count * 0.392699 * cfg.reactivity.staying_step_gain;
                let prev_hero_angle =
                    prev_t * 0.10 + hit_count * 0.392699 * cfg.reactivity.staying_step_gain;
                let axis = glam::Vec3::new(0.25, 1.0, 0.2).normalize();
                let hero_m = glam::Mat4::from_axis_angle(axis, hero_angle)
                    * glam::Mat4::from_scale(glam::Vec3::splat(hero_scale));
                let prev_hero_m = glam::Mat4::from_axis_angle(axis, prev_hero_angle)
                    * glam::Mat4::from_scale(glam::Vec3::splat(hero_scale));
                let morph_amp = 0.06 * (0.25 + 0.75 * hit_env + 0.40 * harm_ch);
                mesh_draws.push((
                    DrawMeshKind::Hero,
                    MeshDrawUniforms {
                        model: hero_m.to_cols_array_2d(),
                        prev_model: prev_hero_m.to_cols_array_2d(),
                        color_zone: [hero_col[0], hero_col[1], hero_col[2], 2.0],
                        morph_params: [morph_amp, t * 0.35, morph_amp, prev_t * 0.35],
                        extra_params: [0.85, use_glb_tex_f, 0.0, 0.0],
                        _pad: [[0.0; 4]; 5],
                    },
                ));
            }
            RigTemplate::VolumetricConcertStage => {
                let kick = m.musical1[0];
                let drum_fill = m.musical2[1];
                let lead_e = m.musical3[0];
                let beat_pos = m.musical0[0];
                let pulse = 1.48 + 0.30 * kick * cfg.reactivity.kick_punch + 0.22 * lead_e;
                let morph_amp = if self.glb_hero_mesh.is_none() {
                    0.14
                } else {
                    0.05
                } * (0.4 + 0.8 * lead_e + 0.6 * kick);
                let axis = glam::Vec3::new(0.25, 1.0, 0.15).normalize();
                let hero_m = glam::Mat4::from_translation(glam::Vec3::new(0.0, 0.9, 0.0))
                    * glam::Mat4::from_axis_angle(axis, t * 0.65 + drum_fill * 1.2)
                    * glam::Mat4::from_scale(glam::Vec3::splat(pulse));
                let prev_hero_m = glam::Mat4::from_translation(glam::Vec3::new(0.0, 0.9, 0.0))
                    * glam::Mat4::from_axis_angle(axis, prev_t * 0.65 + drum_fill * 1.2)
                    * glam::Mat4::from_scale(glam::Vec3::splat(pulse));
                mesh_draws.push((
                    DrawMeshKind::Hero,
                    MeshDrawUniforms {
                        model: hero_m.to_cols_array_2d(),
                        prev_model: prev_hero_m.to_cols_array_2d(),
                        color_zone: [hero_col[0], hero_col[1], hero_col[2], 2.0],
                        morph_params: [morph_amp, t, morph_amp, prev_t],
                        extra_params: [0.75, use_glb_tex_f, 0.0, 0.0],
                        _pad: [[0.0; 4]; 5],
                    },
                ));

                // Stage pedestal
                let ped_m = glam::Mat4::from_translation(glam::Vec3::new(0.0, -2.35, 0.0))
                    * glam::Mat4::from_scale(glam::Vec3::new(6.8, 0.45, 6.8));
                mesh_draws.push((
                    DrawMeshKind::Cube,
                    MeshDrawUniforms {
                        model: ped_m.to_cols_array_2d(),
                        prev_model: ped_m.to_cols_array_2d(),
                        color_zone: [
                            cfg.palette.other_rgb[0],
                            cfg.palette.other_rgb[1],
                            cfg.palette.other_rgb[2],
                            3.0,
                        ],
                        morph_params: [0.0, t, 0.0, prev_t],
                        extra_params: [0.35, 0.0, 0.0, 0.0],
                        _pad: [[0.0; 4]; 5],
                    },
                ));

                // 8 overhead truss bars + 8 perimeter EQ columns
                for i in 0..8usize {
                    let ang = (i as f32 / 8.0) * 2.0 * PI;
                    let c = p_cols[i & 3];
                    let tm = glam::Mat4::from_translation(glam::Vec3::new(
                        ang.cos() * 6.2,
                        6.4,
                        ang.sin() * 6.2,
                    )) * glam::Mat4::from_rotation_y(-ang)
                        * glam::Mat4::from_scale(glam::Vec3::new(0.45, 0.45, 4.9));
                    mesh_draws.push((
                        DrawMeshKind::Cube,
                        MeshDrawUniforms {
                            model: tm.to_cols_array_2d(),
                            prev_model: tm.to_cols_array_2d(),
                            color_zone: [c[0], c[1], c[2], (i & 3) as f32],
                            morph_params: [0.0, t, 0.0, prev_t],
                            extra_params: [0.55, 0.0, 0.0, 0.0],
                            _pad: [[0.0; 4]; 5],
                        },
                    ));

                    let wave = 0.5 + 0.5 * (i as f32 * 1.1 - beat_pos * 1.57).sin();
                    let col_h = 2.4
                        + 3.8 * p_weights[i & 3]
                        + 1.8 * wave
                        + 1.2 * kick * cfg.reactivity.kick_punch;
                    let cm = glam::Mat4::from_translation(glam::Vec3::new(
                        ang.cos() * 7.6,
                        col_h * 0.5 - 2.6,
                        ang.sin() * 7.6,
                    )) * glam::Mat4::from_rotation_y(-ang)
                        * glam::Mat4::from_scale(glam::Vec3::new(0.75, col_h, 0.75));
                    mesh_draws.push((
                        DrawMeshKind::Cube,
                        MeshDrawUniforms {
                            model: cm.to_cols_array_2d(),
                            prev_model: cm.to_cols_array_2d(),
                            color_zone: [c[0], c[1], c[2], (i & 3) as f32],
                            morph_params: [0.0, t, 0.0, prev_t],
                            extra_params: [0.75, 0.0, 0.0, 0.0],
                            _pad: [[0.0; 4]; 5],
                        },
                    ));
                }

                // 4 Analytical Fresnel volumetric spotlight cones (beauty-only pass)
                let lead_stem_id = (m.musical2[3] + 0.5).floor() as i32;
                for s in 0..4usize {
                    let base_ang = (s as f32) * (PI * 0.5) + PI * 0.25;
                    let origin =
                        glam::Vec3::new(base_ang.cos() * 5.8, 6.2, base_ang.sin() * 5.8);
                    let sweep = (t * 1.15 + (s as f32) * 1.57 + drum_fill * 2.0).sin() * 2.2;
                    let aim = glam::Vec3::new(
                        sweep * base_ang.sin(),
                        -0.8 + 1.2 * kick,
                        -sweep * base_ang.cos(),
                    );
                    let dir = (aim - origin).normalize();
                    let down = glam::Vec3::NEG_Y;
                    let rot_axis = down.cross(dir);
                    let rot_len = rot_axis.length();
                    let rot_ang = down.dot(dir).clamp(-1.0, 1.0).acos();
                    let mut bm = glam::Mat4::from_translation(origin);
                    if rot_len > 1e-4 {
                        bm *= glam::Mat4::from_axis_angle(rot_axis / rot_len, rot_ang);
                    }
                    let cone_len = 11.8f32;
                    let cone_rad = 2.65 + 0.55 * p_weights[s];
                    bm *= glam::Mat4::from_scale(glam::Vec3::new(cone_rad, cone_len, cone_rad));
                    let lead_boost = if lead_stem_id == s as i32 { 0.35 } else { 0.0 };
                    let intensity =
                        (0.32 + 0.52 * p_weights[s] + 0.25 * kick + lead_boost).clamp(0.15, 0.95);
                    volumetric_draws.push(VolumetricDrawUniforms {
                        model: bm.to_cols_array_2d(),
                        view: view_mat.to_cols_array_2d(),
                        proj: proj_mat.to_cols_array_2d(),
                        beam_color_intensity: [p_cols[s][0], p_cols[s][1], p_cols[s][2], intensity],
                        params: [
                            t,
                            if convert_srgb_to_linear { 1.0 } else { 0.0 },
                            0.0,
                            0.0,
                        ],
                        _pad: [[0.0; 4]; 2],
                    });
                }
            }
            RigTemplate::GlbStage | RigTemplate::HybridMonolithStage | RigTemplate::KineticStageStateful => {
                let kick = m.musical1[0];
                let drum_fill = m.musical2[1];
                let lead_e = m.musical3[0];
                let beat_pos = m.musical0[0];
                let pulse = 1.45 + 0.35 * kick * cfg.reactivity.kick_punch + 0.25 * lead_e;
                let axis = glam::Vec3::new(0.3, 1.0, 0.2).normalize();
                let hero_m = glam::Mat4::from_axis_angle(axis, t * 0.55 + drum_fill * 1.4)
                    * glam::Mat4::from_scale(glam::Vec3::splat(pulse));
                let prev_hero_m =
                    glam::Mat4::from_axis_angle(axis, prev_t * 0.55 + drum_fill * 1.4)
                        * glam::Mat4::from_scale(glam::Vec3::splat(pulse));
                let morph_amp = if self.glb_hero_mesh.is_none() {
                    0.07 * (0.3 + lead_e)
                } else {
                    0.0
                };
                mesh_draws.push((
                    DrawMeshKind::Hero,
                    MeshDrawUniforms {
                        model: hero_m.to_cols_array_2d(),
                        prev_model: prev_hero_m.to_cols_array_2d(),
                        color_zone: [hero_col[0], hero_col[1], hero_col[2], 2.0],
                        morph_params: [morph_amp, t, morph_amp, prev_t],
                        extra_params: [0.80, use_glb_tex_f, 0.0, 0.0],
                        _pad: [[0.0; 4]; 5],
                    },
                ));

                for i in 0..12usize {
                    let ang = (i as f32 / 12.0) * 2.0 * PI + t * 0.12;
                    let p_ang = (i as f32 / 12.0) * 2.0 * PI + prev_t * 0.12;
                    let wave = 0.5 + 0.5 * (i as f32 * 0.8 - beat_pos * 1.57).sin();
                    let h = 3.2 + 2.8 * wave + 1.2 * kick * cfg.reactivity.kick_punch;
                    let mm = glam::Mat4::from_translation(glam::Vec3::new(
                        ang.cos() * 6.5,
                        h * 0.5 - 2.8,
                        ang.sin() * 6.5,
                    )) * glam::Mat4::from_rotation_y(-ang + PI * 0.5)
                        * glam::Mat4::from_scale(glam::Vec3::new(1.85, h, 0.28));
                    let prev_mm = glam::Mat4::from_translation(glam::Vec3::new(
                        p_ang.cos() * 6.5,
                        h * 0.5 - 2.8,
                        p_ang.sin() * 6.5,
                    )) * glam::Mat4::from_rotation_y(-p_ang + PI * 0.5)
                        * glam::Mat4::from_scale(glam::Vec3::new(1.85, h, 0.28));
                    let c = p_cols[i & 3];
                    mesh_draws.push((
                        DrawMeshKind::Cube,
                        MeshDrawUniforms {
                            model: mm.to_cols_array_2d(),
                            prev_model: prev_mm.to_cols_array_2d(),
                            color_zone: [c[0], c[1], c[2], (i & 3) as f32],
                            morph_params: [0.0, t, 0.0, prev_t],
                            extra_params: [0.70, 0.0, 0.0, 0.0],
                            _pad: [[0.0; 4]; 5],
                        },
                    ));
                }
            }
            _ => {}
        }

        for (slot, (_, draw_u)) in mesh_draws.iter().take(MAX_MESH_DRAWS).enumerate() {
            queue.write_buffer(
                &self.mesh_draw_buffer,
                (slot * UNIFORM_ALIGN) as u64,
                bytemuck::bytes_of(draw_u),
            );
        }
        for (slot, vol_u) in volumetric_draws
            .iter()
            .take(MAX_VOLUMETRIC_DRAWS)
            .enumerate()
        {
            queue.write_buffer(
                &self.volumetric_buffer,
                (slot * UNIFORM_ALIGN) as u64,
                bytemuck::bytes_of(vol_u),
            );
        }

        // Background clear color (converted to linear when writing to HDR linear target)
        let bg = cfg.palette.bg_rgb;
        let clear_beauty = if convert_srgb_to_linear {
            wgpu::Color {
                r: srgb_to_linear_ch(bg[0]) as f64,
                g: srgb_to_linear_ch(bg[1]) as f64,
                b: srgb_to_linear_ch(bg[2]) as f64,
                a: 1.0,
            }
        } else {
            wgpu::Color {
                r: bg[0] as f64,
                g: bg[1] as f64,
                b: bg[2] as f64,
                a: 1.0,
            }
        };

        let hero_mesh: &GpuMesh = if let Some(ref glb) = self.glb_hero_mesh {
            glb
        } else if matches!(
            cfg.template,
            RigTemplate::VolumetricConcertStage | RigTemplate::HybridMonolithStage
        ) {
            &self.torus_mesh
        } else {
            &self.icosa_mesh
        };

        let record_geometry = |pass: &mut wgpu::RenderPass<'_>, pipelines: &InstancedPipelines| {
            match cfg.template {
                RigTemplate::SacredPolyhedraCathedral => {
                    pass.set_pipeline(&pipelines.cathedral);
                    pass.set_bind_group(0, &self.scene_bind_group, &[]);
                    pass.set_vertex_buffer(0, self.cube_mesh.vertex_buffer.slice(..));
                    pass.draw(0..self.cube_mesh.vertex_count, 0..inst_count);
                }
                RigTemplate::OrbitalPrismArray => {
                    pass.set_pipeline(&pipelines.orbital);
                    pass.set_bind_group(0, &self.scene_bind_group, &[]);
                    pass.set_vertex_buffer(0, self.cube_mesh.vertex_buffer.slice(..));
                    pass.draw(0..self.cube_mesh.vertex_count, 0..inst_count);
                }
                RigTemplate::InstancedMegastructure => {
                    pass.set_pipeline(&pipelines.megastructure);
                    pass.set_bind_group(0, &self.scene_bind_group, &[]);
                    pass.set_vertex_buffer(0, self.cube_mesh.vertex_buffer.slice(..));
                    pass.draw(0..self.cube_mesh.vertex_count, 0..inst_count);
                }
                RigTemplate::CyberWireframeTunnel => {
                    pass.set_pipeline(&pipelines.tunnel);
                    pass.set_bind_group(0, &self.scene_bind_group, &[]);
                    pass.set_vertex_buffer(0, self.cube_mesh.vertex_buffer.slice(..));
                    pass.draw(0..self.cube_mesh.vertex_count, 0..inst_count);
                }
                _ => {}
            }

            if !mesh_draws.is_empty() {
                pass.set_pipeline(&pipelines.mesh);
                pass.set_bind_group(0, &self.scene_bind_group, &[]);
                for (slot, (kind, _)) in mesh_draws.iter().take(MAX_MESH_DRAWS).enumerate() {
                    let offset = (slot * UNIFORM_ALIGN) as u32;
                    pass.set_bind_group(1, &self.mesh_draw_bind_group, &[offset]);
                    let m_gpu = match kind {
                        DrawMeshKind::Hero => hero_mesh,
                        DrawMeshKind::Cube => &self.cube_mesh,
                    };
                    pass.set_vertex_buffer(0, m_gpu.vertex_buffer.slice(..));
                    pass.draw(0..m_gpu.vertex_count, 0..1);
                }
            }
        };

        // Main opaque 3D pass:
        // - Beauty-only: 1 color attachment (zero extra MRT bandwidth)
        // - MRT enabled: 3+3 split (24 bytes/sample each <= WebGPU's 32-byte limit)
        {
            let beauty_att = Some(wgpu::RenderPassColorAttachment {
                view: beauty_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_beauty),
                    store: wgpu::StoreOp::Store,
                },
            });

            if mrt_active {
                let mrt = self.mrt_targets.as_ref().unwrap();
                let pipelines_a = self.mrt_pipelines_a.as_ref().unwrap();
                let mrt_a_attachments = [
                    beauty_att,
                    Some(wgpu::RenderPassColorAttachment {
                        view: &mrt.depth_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                    Some(wgpu::RenderPassColorAttachment {
                        view: &mrt.normal_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.5,
                                g: 0.5,
                                b: 1.0,
                                a: 1.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                ];
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Scene3D MRT Pass A (Beauty+Depth+Normal)"),
                        color_attachments: &mrt_a_attachments,
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &self.depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Clear(1.0),
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                    record_geometry(&mut pass, pipelines_a);
                }

                // Pass B: wireframe, flat, motion reusing Pass A's depth buffer (LessEqual, read-only)
                let pipelines_b = self.mrt_pipelines_b.as_ref().unwrap();
                let mrt_b_attachments = [
                    Some(wgpu::RenderPassColorAttachment {
                        view: &mrt.wire_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                    Some(wgpu::RenderPassColorAttachment {
                        view: &mrt.flat_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: bg[0] as f64,
                                g: bg[1] as f64,
                                b: bg[2] as f64,
                                a: 0.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                    Some(wgpu::RenderPassColorAttachment {
                        view: &mrt.motion_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.5,
                                g: 0.5,
                                b: 0.0,
                                a: 1.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                ];
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Scene3D MRT Pass B (Wire+Flat+Motion)"),
                        color_attachments: &mrt_b_attachments,
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &self.depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                    record_geometry(&mut pass, pipelines_b);
                }
            } else {
                let beauty_only_attachments = [beauty_att];
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Scene3D Opaque Pass (Beauty-Only)"),
                    color_attachments: &beauty_only_attachments,
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.depth_view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(1.0),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                record_geometry(&mut pass, &self.beauty_pipelines);
            }
        }

        // 3. Beauty-only additive Fresnel volumetric cones (depth-test ON, depth-write OFF,
        //    only targets beauty_view so MRT depth/normal/wire/flat/motion stay 100% clean!)
        if !volumetric_draws.is_empty() {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Scene3D Volumetric Cones (Beauty-Only)"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: beauty_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.volumetric_pipeline);
            pass.set_vertex_buffer(0, self.cone_mesh.vertex_buffer.slice(..));
            for slot in 0..volumetric_draws.len().min(MAX_VOLUMETRIC_DRAWS) {
                let offset = (slot * UNIFORM_ALIGN) as u32;
                pass.set_bind_group(0, &self.volumetric_bind_group, &[offset]);
                pass.draw(0..self.cone_mesh.vertex_count, 0..1);
            }
        }

        // 4. Optional conditioning channel display / 2x2 quad pack
        if cfg.output_mode != RigOutputMode::Beauty {
            if let Some(ref mrt) = self.mrt_targets {
                let (mode, bg) = match cfg.output_mode {
                    RigOutputMode::Depth => (0u32, &mrt.single_bind_groups[0]),
                    RigOutputMode::Normal => (0u32, &mrt.single_bind_groups[1]),
                    RigOutputMode::Wireframe => (0u32, &mrt.single_bind_groups[2]),
                    RigOutputMode::Flat => (0u32, &mrt.single_bind_groups[3]),
                    RigOutputMode::Motion => (0u32, &mrt.single_bind_groups[4]),
                    RigOutputMode::QuadConditioning => (1u32, &mrt.quad_bind_group),
                    RigOutputMode::Beauty => unreachable!(),
                };
                let qp = QuadParams {
                    mode,
                    convert_srgb_to_linear: if convert_srgb_to_linear { 1 } else { 0 },
                    _pad0: 0,
                    _pad1: 0,
                };
                queue.write_buffer(&self.quad_uniform_buffer, 0, bytemuck::bytes_of(&qp));

                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Scene3D Conditioning Blit"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: beauty_view,
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
                pass.set_pipeline(&self.quad_pipeline);
                pass.set_bind_group(0, bg, &[]);
                pass.draw(0..3, 0..1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validate_wgsl(name: &str, source: &str) {
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|e| panic!("WGSL parse failed in {name}: {e}"));
        let mut validator = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        );
        validator
            .validate(&module)
            .unwrap_or_else(|e| panic!("WGSL validation failed in {name}: {e}"));
    }

    #[test]
    fn all_scene3d_wgsl_shaders_validate() {
        validate_wgsl(
            "shader_scene3d_instanced.wgsl",
            include_str!("shader_scene3d_instanced.wgsl"),
        );
        validate_wgsl(
            "shader_scene3d_mesh.wgsl",
            include_str!("shader_scene3d_mesh.wgsl"),
        );
        validate_wgsl(
            "shader_scene3d_volumetric.wgsl",
            include_str!("shader_scene3d_volumetric.wgsl"),
        );
        validate_wgsl(
            "shader_scene3d_quad.wgsl",
            include_str!("shader_scene3d_quad.wgsl"),
        );
    }

    #[test]
    fn uniform_structs_match_wgpu_alignment() {
        assert_eq!(std::mem::size_of::<MeshDrawUniforms>(), UNIFORM_ALIGN);
        assert_eq!(std::mem::size_of::<VolumetricDrawUniforms>(), UNIFORM_ALIGN);
        assert_eq!(std::mem::size_of::<Scene3DUniforms>() % 16, 0);
        assert_eq!(std::mem::size_of::<RigVertex>(), 44);
    }

    #[test]
    fn procedural_barycentric_meshes_have_valid_triangles() {
        let cube = build_cube_mesh();
        assert_eq!(cube.len(), 36);
        let cone = build_cone_mesh(32);
        assert_eq!(cone.len(), 96);
        let icosa = build_icosahedron_mesh(2);
        assert_eq!(icosa.len(), 20 * 16 * 3);
        let torus = build_torus_knot_mesh(96, 16);
        assert_eq!(torus.len(), 96 * 16 * 6);
    }
}
