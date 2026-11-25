//! Sanitized binary glTF 2.0 (`.glb`) loader with embedded albedo texture support.
//!
//! Enforces the same security & determinism contract as Lactoseq's
//! `Scene3DPass::LoadSafeGlbMesh` and `rig_validator.py`:
//! - Verifies GLB header magic (`glTF`) and version (`2`) and chunk bounds
//! - Rejects any `"uri"` field (external files or data-URI scripts/payloads)
//! - Rejects `extensionsRequired` and unsupported glTF extensions
//! - Enforces caps: `<= 64 MiB` file, `<= 250,000` vertices, `<= 1,000,000` indices,
//!   `<= 2048x2048` / `<= 16 MiB` embedded PNG/JPEG `baseColorTexture`
//! - Normalizes bounding sphere to unit radius and assigns per-triangle barycentrics
//!   `(1,0,0) / (0,1,0) / (0,0,1)` for single-pass `fwidth` wireframe rendering.

use bytemuck::{Pod, Zeroable};
use serde_json::Value;

pub const GLB_MAGIC: u32 = 0x4654_6C67; // "glTF"
pub const GLB_VERSION: u32 = 2;
pub const CHUNK_TYPE_JSON: u32 = 0x4E4F_534A; // "JSON"
pub const CHUNK_TYPE_BIN: u32 = 0x004E_4942; // "BIN\0"

pub const MAX_GLB_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_GLB_VERTICES: u32 = 250_000;
pub const MAX_GLB_INDICES: u32 = 1_000_000;
pub const MAX_GLB_TEXTURE_DIM: u32 = 2048;
pub const MAX_GLB_TEXTURE_BYTES: usize = 16 * 1024 * 1024;

/// Allowed non-executable glTF extensions (empty by default for strict sandboxing).
const ALLOWED_EXTENSIONS: &[&str] = &[];

/// Interleaved non-indexed triangle vertex used by `Scene3DPass` and loaded `.glb` meshes.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct RigVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub bary: [f32; 3],
}

impl RigVertex {
    pub const fn new(
        position: [f32; 3],
        normal: [f32; 3],
        uv: [f32; 2],
        bary: [f32; 3],
    ) -> Self {
        Self {
            position,
            normal,
            uv,
            bary,
        }
    }

    pub fn desc<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<RigVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x3, // position
                },
                wgpu::VertexAttribute {
                    offset: 12,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x3, // normal
                },
                wgpu::VertexAttribute {
                    offset: 24,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x2, // uv
                },
                wgpu::VertexAttribute {
                    offset: 32,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Float32x3, // bary
                },
            ],
        }
    }
}

/// Sanitized `.glb` asset ready for GPU upload.
#[derive(Debug, Clone)]
pub struct GlbAsset {
    pub vertices: Vec<RigVertex>,
    pub base_color_factor: [f32; 3],
    pub has_base_color_factor: bool,
    pub albedo_rgba: Option<Vec<u8>>,
    pub albedo_width: u32,
    pub albedo_height: u32,
}

fn read_u32_le(data: &[u8], off: usize) -> Result<u32, String> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .ok_or_else(|| "Unexpected EOF reading GLB u32".to_string())?
        .try_into()
        .unwrap();
    Ok(u32::from_le_bytes(bytes))
}

fn read_u16_le(data: &[u8], off: usize) -> Result<u16, String> {
    let bytes: [u8; 2] = data
        .get(off..off + 2)
        .ok_or_else(|| "Unexpected EOF reading GLB u16".to_string())?
        .try_into()
        .unwrap();
    Ok(u16::from_le_bytes(bytes))
}

fn read_f32_le(data: &[u8], off: usize) -> Result<f32, String> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .ok_or_else(|| "Unexpected EOF reading GLB f32".to_string())?
        .try_into()
        .unwrap();
    Ok(f32::from_le_bytes(bytes))
}

/// Recursively reject any `"uri"` key anywhere in the glTF JSON tree.
fn reject_any_uri(val: &Value) -> Result<(), String> {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                if k.eq_ignore_ascii_case("uri") {
                    return Err(
                        "Security violation: external/data URI disallowed in GLB".to_string()
                    );
                }
                reject_any_uri(v)?;
            }
        }
        Value::Array(arr) => {
            for item in arr {
                reject_any_uri(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Parse, security-audit, and unit-normalize a binary glTF 2.0 (`.glb`) buffer.
pub fn load_safe_glb_bytes(data: &[u8]) -> Result<GlbAsset, String> {
    if data.len() < 28 || data.len() > MAX_GLB_BYTES {
        return Err(format!(
            "GLB size {} out of allowed bounds (28B..{}MiB)",
            data.len(),
            MAX_GLB_BYTES / (1024 * 1024)
        ));
    }

    let magic = read_u32_le(data, 0)?;
    let version = read_u32_le(data, 4)?;
    let total_len = read_u32_le(data, 8)? as usize;
    if magic != GLB_MAGIC || version != GLB_VERSION {
        return Err("Invalid GLB header (expected glTF v2)".to_string());
    }
    if total_len > data.len() || total_len < 28 {
        return Err("Truncated or invalid GLB total length".to_string());
    }

    let json_len = read_u32_le(data, 12)? as usize;
    let json_type = read_u32_le(data, 16)?;
    let bin_hdr = 20usize
        .checked_add(json_len)
        .ok_or_else(|| "GLB JSON length overflow".to_string())?;
    if json_type != CHUNK_TYPE_JSON || bin_hdr + 8 > total_len {
        return Err("Malformed GLB JSON chunk".to_string());
    }

    let json_str = std::str::from_utf8(&data[20..bin_hdr])
        .map_err(|e| format!("Invalid UTF-8 in GLB JSON chunk: {}", e))?;
    let doc: Value =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid GLB JSON: {}", e))?;

    // Security check 1: reject all external or data URIs anywhere in the JSON.
    reject_any_uri(&doc)?;

    // Security check 2: reject unsupported / required extensions.
    for ext_key in ["extensionsRequired", "extensionsUsed"] {
        if let Some(exts) = doc.get(ext_key).and_then(|v| v.as_array()) {
            for ext in exts {
                let name = ext.as_str().unwrap_or("<non-string>");
                if !ALLOWED_EXTENSIONS.contains(&name) {
                    return Err(format!(
                        "Security violation: unsupported glTF extension '{}' in {}",
                        name, ext_key
                    ));
                }
            }
        }
    }

    // Parse BIN chunk
    let bin_len = read_u32_le(data, bin_hdr)? as usize;
    let bin_type = read_u32_le(data, bin_hdr + 4)?;
    let bin_off = bin_hdr + 8;
    if bin_type != CHUNK_TYPE_BIN || bin_off.checked_add(bin_len).map_or(true, |e| e > total_len) {
        return Err("Malformed GLB BIN chunk".to_string());
    }
    let bin = &data[bin_off..bin_off + bin_len];

    let accessors = doc
        .get("accessors")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GLB missing accessors array".to_string())?;
    let buffer_views = doc
        .get("bufferViews")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GLB missing bufferViews array".to_string())?;
    let meshes = doc
        .get("meshes")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GLB missing meshes array".to_string())?;
    if meshes.is_empty() {
        return Err("GLB contains zero meshes".to_string());
    }

    let primitives = meshes[0]
        .get("primitives")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GLB mesh[0] missing primitives".to_string())?;

    struct RawTri {
        p: [glam::Vec3; 3],
        n: [glam::Vec3; 3],
        uv: [glam::Vec2; 3],
        has_n: bool,
        has_uv: bool,
    }

    let mut raw_tris: Vec<RawTri> = Vec::new();
    let mut total_verts_loaded: u32 = 0;
    let mut total_indices_loaded: u32 = 0;

    let get_acc_usize = |idx: usize, field: &str| -> Option<usize> {
        accessors
            .get(idx)?
            .get(field)?
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
    };
    let get_bv_usize = |idx: usize, field: &str| -> Option<usize> {
        buffer_views
            .get(idx)?
            .get(field)?
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
    };

    for prim in primitives {
        let attrs = match prim.get("attributes").and_then(|v| v.as_object()) {
            Some(a) => a,
            None => continue,
        };
        let pos_acc = match attrs.get("POSITION").and_then(|v| v.as_u64()) {
            Some(i) => i as usize,
            None => continue,
        };
        let norm_acc = attrs.get("NORMAL").and_then(|v| v.as_u64()).map(|i| i as usize);
        let uv_acc = attrs
            .get("TEXCOORD_0")
            .and_then(|v| v.as_u64())
            .map(|i| i as usize);
        let idx_acc = prim.get("indices").and_then(|v| v.as_u64()).map(|i| i as usize);

        // POSITION (VEC3 float32 = componentType 5126)
        let pos_comp = get_acc_usize(pos_acc, "componentType").unwrap_or(5126);
        if pos_comp != 5126 {
            return Err(format!("Unsupported POSITION componentType {}", pos_comp));
        }
        let pos_bv = get_acc_usize(pos_acc, "bufferView")
            .ok_or_else(|| "GLB POSITION accessor missing bufferView".to_string())?;
        let pos_count = get_acc_usize(pos_acc, "count")
            .ok_or_else(|| "GLB POSITION accessor missing count".to_string())?;
        if pos_count == 0
            || total_verts_loaded
                .checked_add(pos_count as u32)
                .map_or(true, |v| v > MAX_GLB_VERTICES)
        {
            return Err(format!(
                "GLB POSITION vertex count {} exceeds security cap {}",
                pos_count, MAX_GLB_VERTICES
            ));
        }
        let pos_acc_off = get_acc_usize(pos_acc, "byteOffset").unwrap_or(0);
        let pos_bv_off = get_bv_usize(pos_bv, "byteOffset").unwrap_or(0);
        let pos_stride = get_bv_usize(pos_bv, "byteStride").unwrap_or(12).max(12);
        let pos_start = pos_bv_off
            .checked_add(pos_acc_off)
            .ok_or_else(|| "GLB POSITION offset overflow".to_string())?;
        let pos_end = pos_start
            .checked_add(pos_count.saturating_sub(1) * pos_stride + 12)
            .ok_or_else(|| "GLB POSITION end overflow".to_string())?;
        if pos_end > bin.len() {
            return Err("GLB POSITION bufferView out of BIN bounds".to_string());
        }
        total_verts_loaded += pos_count as u32;

        let mut positions = Vec::with_capacity(pos_count);
        for i in 0..pos_count {
            let off = pos_start + i * pos_stride;
            let x = read_f32_le(bin, off)?;
            let y = read_f32_le(bin, off + 4)?;
            let z = read_f32_le(bin, off + 8)?;
            if !(x.is_finite() && y.is_finite() && z.is_finite()) {
                return Err("GLB POSITION contains non-finite float".to_string());
            }
            positions.push(glam::Vec3::new(x, y, z));
        }

        // Optional NORMAL
        let mut normals: Vec<glam::Vec3> = Vec::new();
        if let Some(na) = norm_acc {
            if get_acc_usize(na, "componentType").unwrap_or(5126) == 5126 {
                if let (Some(n_bv), Some(n_count)) = (
                    get_acc_usize(na, "bufferView"),
                    get_acc_usize(na, "count"),
                ) {
                    let n_acc_off = get_acc_usize(na, "byteOffset").unwrap_or(0);
                    let n_bv_off = get_bv_usize(n_bv, "byteOffset").unwrap_or(0);
                    let n_stride = get_bv_usize(n_bv, "byteStride").unwrap_or(12).max(12);
                    if n_count == pos_count {
                        if let Some(n_start) = n_bv_off.checked_add(n_acc_off) {
                            if n_start + n_count.saturating_sub(1) * n_stride + 12 <= bin.len() {
                                normals.reserve(n_count);
                                for i in 0..n_count {
                                    let off = n_start + i * n_stride;
                                    let nv = glam::Vec3::new(
                                        read_f32_le(bin, off)?,
                                        read_f32_le(bin, off + 4)?,
                                        read_f32_le(bin, off + 8)?,
                                    );
                                    let nl = nv.length();
                                    normals.push(if nl > 1e-6 && nl.is_finite() {
                                        nv / nl
                                    } else {
                                        glam::Vec3::Y
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Optional TEXCOORD_0
        let mut uvs: Vec<glam::Vec2> = Vec::new();
        if let Some(ua) = uv_acc {
            if get_acc_usize(ua, "componentType").unwrap_or(5126) == 5126 {
                if let (Some(u_bv), Some(u_count)) = (
                    get_acc_usize(ua, "bufferView"),
                    get_acc_usize(ua, "count"),
                ) {
                    let u_acc_off = get_acc_usize(ua, "byteOffset").unwrap_or(0);
                    let u_bv_off = get_bv_usize(u_bv, "byteOffset").unwrap_or(0);
                    let u_stride = get_bv_usize(u_bv, "byteStride").unwrap_or(8).max(8);
                    if u_count == pos_count {
                        if let Some(u_start) = u_bv_off.checked_add(u_acc_off) {
                            if u_start + u_count.saturating_sub(1) * u_stride + 8 <= bin.len() {
                                uvs.reserve(u_count);
                                for i in 0..u_count {
                                    let off = u_start + i * u_stride;
                                    uvs.push(glam::Vec2::new(
                                        read_f32_le(bin, off)?,
                                        read_f32_le(bin, off + 4)?,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Optional indices (u8=5121, u16=5123, u32=5125)
        let indices: Vec<u32> = if let Some(ia) = idx_acc {
            let i_bv = get_acc_usize(ia, "bufferView")
                .ok_or_else(|| "GLB indices accessor missing bufferView".to_string())?;
            let i_count = get_acc_usize(ia, "count")
                .ok_or_else(|| "GLB indices accessor missing count".to_string())?;
            let i_comp = get_acc_usize(ia, "componentType").unwrap_or(5123);
            let comp_sz = match i_comp {
                5121 => 1usize,
                5123 => 2usize,
                5125 => 4usize,
                _ => return Err(format!("Unsupported GLB index componentType {}", i_comp)),
            };
            if i_count == 0
                || total_indices_loaded
                    .checked_add(i_count as u32)
                    .map_or(true, |v| v > MAX_GLB_INDICES)
            {
                return Err(format!(
                    "GLB index count {} exceeds security cap {}",
                    i_count, MAX_GLB_INDICES
                ));
            }
            let i_acc_off = get_acc_usize(ia, "byteOffset").unwrap_or(0);
            let i_bv_off = get_bv_usize(i_bv, "byteOffset").unwrap_or(0);
            let i_start = i_bv_off
                .checked_add(i_acc_off)
                .ok_or_else(|| "GLB index offset overflow".to_string())?;
            let i_end = i_start
                .checked_add(i_count * comp_sz)
                .ok_or_else(|| "GLB index end overflow".to_string())?;
            if i_end > bin.len() {
                return Err("GLB indices out of BIN bounds".to_string());
            }
            total_indices_loaded += i_count as u32;

            let mut out = Vec::with_capacity(i_count);
            for i in 0..i_count {
                let v = match comp_sz {
                    1 => bin[i_start + i] as u32,
                    2 => read_u16_le(bin, i_start + i * 2)? as u32,
                    4 => read_u32_le(bin, i_start + i * 4)?,
                    _ => unreachable!(),
                };
                out.push(v);
            }
            out
        } else {
            (0..positions.len() as u32).collect()
        };

        for tri in indices.chunks_exact(3) {
            let (i0, i1, i2) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
            if i0 >= positions.len() || i1 >= positions.len() || i2 >= positions.len() {
                continue;
            }
            let has_n = !normals.is_empty();
            let has_uv = !uvs.is_empty();
            raw_tris.push(RawTri {
                p: [positions[i0], positions[i1], positions[i2]],
                n: if has_n {
                    [normals[i0], normals[i1], normals[i2]]
                } else {
                    [glam::Vec3::Y; 3]
                },
                uv: if has_uv {
                    [uvs[i0], uvs[i1], uvs[i2]]
                } else {
                    [glam::Vec2::ZERO; 3]
                },
                has_n,
                has_uv,
            });
        }
    }

    if raw_tris.is_empty() {
        return Err("GLB contained zero valid triangles".to_string());
    }

    // Normalize bounding box to unit radius
    let mut bmin = glam::Vec3::splat(f32::MAX);
    let mut bmax = glam::Vec3::splat(f32::MIN);
    for rt in &raw_tris {
        for p in &rt.p {
            bmin = bmin.min(*p);
            bmax = bmax.max(*p);
        }
    }
    let center = (bmin + bmax) * 0.5;
    let extent = ((bmax - bmin).length() * 0.5).max(0.001);

    const BARY: [[f32; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut vertices = Vec::with_capacity(raw_tris.len() * 3);
    for rt in &raw_tris {
        let ps = [
            (rt.p[0] - center) / extent,
            (rt.p[1] - center) / extent,
            (rt.p[2] - center) / extent,
        ];
        let fn_raw = (ps[1] - ps[0]).cross(ps[2] - ps[0]);
        let fn_len = fn_raw.length();
        let face_n = if fn_len > 1e-6 {
            fn_raw / fn_len
        } else {
            glam::Vec3::Y
        };
        for k in 0..3 {
            let nv = if rt.has_n { rt.n[k] } else { face_n };
            let uv = if rt.has_uv {
                [rt.uv[k].x, rt.uv[k].y]
            } else {
                [ps[k].x * 0.5 + 0.5, ps[k].y * 0.5 + 0.5]
            };
            vertices.push(RigVertex::new(
                [ps[k].x, ps[k].y, ps[k].z],
                [nv.x, nv.y, nv.z],
                uv,
                BARY[k],
            ));
        }
    }

    // Optional material baseColorFactor & baseColorTexture
    let mut base_color_factor = [1.0f32, 1.0, 1.0];
    let mut has_base_color_factor = false;
    let mut albedo_image_idx: Option<usize> = None;

    if let Some(materials) = doc.get("materials").and_then(|v| v.as_array()) {
        if let Some(pbr) = materials
            .first()
            .and_then(|m| m.get("pbrMetallicRoughness"))
        {
            if let Some(bcf) = pbr.get("baseColorFactor").and_then(|v| v.as_array()) {
                if bcf.len() >= 3 {
                    base_color_factor = [
                        bcf[0].as_f64().unwrap_or(1.0) as f32,
                        bcf[1].as_f64().unwrap_or(1.0) as f32,
                        bcf[2].as_f64().unwrap_or(1.0) as f32,
                    ];
                    has_base_color_factor = true;
                }
            }
            if let Some(tex_idx) = pbr
                .get("baseColorTexture")
                .and_then(|t| t.get("index"))
                .and_then(|i| i.as_u64())
                .map(|i| i as usize)
            {
                albedo_image_idx = doc
                    .get("textures")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.get(tex_idx))
                    .and_then(|t| t.get("source"))
                    .and_then(|s| s.as_u64())
                    .map(|s| s as usize);
            }
        }
    }

    // Fallback to images[0] if textures/materials didn't specify an index (matches Lactoseq)
    let images = doc.get("images").and_then(|v| v.as_array());
    if albedo_image_idx.is_none() && images.is_some_and(|imgs| !imgs.is_empty()) {
        albedo_image_idx = Some(0);
    }

    let mut albedo_rgba = None;
    let mut albedo_width = 0u32;
    let mut albedo_height = 0u32;

    if let (Some(imgs), Some(img_idx)) = (images, albedo_image_idx) {
        if let Some(img_obj) = imgs.get(img_idx) {
            if let Some(img_bv) = img_obj
                .get("bufferView")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
            {
                let img_off = get_bv_usize(img_bv, "byteOffset").unwrap_or(0);
                let img_len = get_bv_usize(img_bv, "byteLength").unwrap_or(0);
                if img_len > MAX_GLB_TEXTURE_BYTES {
                    return Err(format!(
                        "Security violation: embedded GLB texture {} bytes exceeds {} MiB cap",
                        img_len,
                        MAX_GLB_TEXTURE_BYTES / (1024 * 1024)
                    ));
                }
                if img_len > 0 {
                    let img_end = img_off
                        .checked_add(img_len)
                        .ok_or_else(|| "GLB image offset overflow".to_string())?;
                    if img_end > bin.len() {
                        return Err("GLB embedded image bufferView out of BIN bounds".to_string());
                    }
                    let img_bytes = &bin[img_off..img_end];
                    let decoded = image::load_from_memory(img_bytes)
                        .map_err(|e| format!("Failed decoding embedded GLB texture: {}", e))?;
                    let w = decoded.width();
                    let h = decoded.height();
                    if w == 0 || h == 0 || w > MAX_GLB_TEXTURE_DIM || h > MAX_GLB_TEXTURE_DIM {
                        return Err(format!(
                            "Security violation: embedded GLB texture {}x{} exceeds {}x{} cap",
                            w, h, MAX_GLB_TEXTURE_DIM, MAX_GLB_TEXTURE_DIM
                        ));
                    }
                    let rgba = decoded.to_rgba8();
                    albedo_width = w;
                    albedo_height = h;
                    albedo_rgba = Some(rgba.into_raw());
                }
            }
        }
    }

    Ok(GlbAsset {
        vertices,
        base_color_factor,
        has_base_color_factor,
        albedo_rgba,
        albedo_width,
        albedo_height,
    })
}

/// Load a sanitized `.glb` file from disk (native only).
#[cfg(not(target_arch = "wasm32"))]
pub fn load_safe_glb_file(path: &std::path::Path) -> Result<GlbAsset, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("Cannot stat GLB asset {:?}: {}", path, e))?;
    if meta.len() as usize > MAX_GLB_BYTES {
        return Err(format!(
            "GLB file {:?} ({} bytes) exceeds 64 MiB limit",
            path,
            meta.len()
        ));
    }
    let data = std::fs::read(path)
        .map_err(|e| format!("Cannot read GLB asset {:?}: {}", path, e))?;
    load_safe_glb_bytes(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_glb(gltf_json: &str, bin_chunk: &[u8]) -> Vec<u8> {
        let mut json_bytes = gltf_json.as_bytes().to_vec();
        while json_bytes.len() % 4 != 0 {
            json_bytes.push(b' ');
        }
        let mut bin_bytes = bin_chunk.to_vec();
        while bin_bytes.len() % 4 != 0 {
            bin_bytes.push(0);
        }
        let total_len = 12 + 8 + json_bytes.len() + 8 + bin_bytes.len();
        let mut out = Vec::with_capacity(total_len);
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&GLB_VERSION.to_le_bytes());
        out.extend_from_slice(&(total_len as u32).to_le_bytes());
        out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&CHUNK_TYPE_JSON.to_le_bytes());
        out.extend_from_slice(&json_bytes);
        out.extend_from_slice(&(bin_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&CHUNK_TYPE_BIN.to_le_bytes());
        out.extend_from_slice(&bin_bytes);
        out
    }

    fn triangle_bin() -> Vec<u8> {
        let positions: [[f32; 3]; 3] = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let indices: [u16; 3] = [0, 1, 2];
        let mut bin = Vec::new();
        for p in &positions {
            for f in p {
                bin.extend_from_slice(&f.to_le_bytes());
            }
        }
        for i in &indices {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        bin
    }

    #[test]
    fn loads_valid_minimal_glb_with_barycentrics_and_base_color() {
        let bin = triangle_bin();
        let json = r#"{
            "asset": {"version": "2.0"},
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
            "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.2, 0.8, 0.9, 1.0]}}],
            "buffers": [{"byteLength": 42}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 6}
            ],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}
            ]
        }"#;
        let glb = build_glb(json, &bin);
        let asset = load_safe_glb_bytes(&glb).expect("valid GLB should load");
        assert_eq!(asset.vertices.len(), 3);
        assert_eq!(asset.vertices[0].bary, [1.0, 0.0, 0.0]);
        assert_eq!(asset.vertices[1].bary, [0.0, 1.0, 0.0]);
        assert_eq!(asset.vertices[2].bary, [0.0, 0.0, 1.0]);
        assert!(asset.has_base_color_factor);
        assert!((asset.base_color_factor[1] - 0.8).abs() < 1e-5);
    }

    #[test]
    fn loads_embedded_png_albedo_texture() {
        // Generate a tiny 2x2 PNG in memory
        let img = image::RgbaImage::from_fn(2, 2, |x, y| {
            image::Rgba([(x * 120) as u8, (y * 120) as u8, 255, 255])
        });
        let mut png_bytes = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
            .expect("encode png");

        let mut bin = triangle_bin();
        while bin.len() % 4 != 0 {
            bin.push(0);
        }
        let img_off = bin.len();
        bin.extend_from_slice(&png_bytes);

        let json = format!(
            r#"{{
                "asset": {{"version": "2.0"}},
                "meshes": [{{"primitives": [{{"attributes": {{"POSITION": 0}}, "indices": 1}}]}}],
                "materials": [{{"pbrMetallicRoughness": {{"baseColorTexture": {{"index": 0}}}}}}],
                "textures": [{{"source": 0}}],
                "images": [{{"bufferView": 2, "mimeType": "image/png"}}],
                "buffers": [{{"byteLength": {}}}],
                "bufferViews": [
                    {{"buffer": 0, "byteOffset": 0, "byteLength": 36}},
                    {{"buffer": 0, "byteOffset": 36, "byteLength": 6}},
                    {{"buffer": 0, "byteOffset": {}, "byteLength": {}}}
                ],
                "accessors": [
                    {{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}},
                    {{"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}}
                ]
            }}"#,
            bin.len(),
            img_off,
            png_bytes.len()
        );
        let glb = build_glb(&json, &bin);
        let asset = load_safe_glb_bytes(&glb).expect("GLB with embedded PNG should load");
        assert_eq!(asset.albedo_width, 2);
        assert_eq!(asset.albedo_height, 2);
        assert_eq!(asset.albedo_rgba.as_ref().unwrap().len(), 16);
    }

    #[test]
    fn rejects_external_and_data_uris_in_glb() {
        let bin = triangle_bin();
        let ext_json = r#"{
            "asset": {"version": "2.0"},
            "buffers": [{"uri": "https://evil.com/payload.bin", "byteLength": 42}],
            "meshes": [],
            "accessors": [],
            "bufferViews": []
        }"#;
        let err = load_safe_glb_bytes(&build_glb(ext_json, &bin))
            .expect_err("must reject external URI");
        assert!(err.contains("URI"), "{err}");

        let data_json = r#"{
            "asset": {"version": "2.0"},
            "images": [{"uri": "data:text/javascript;base64,YWxlcnQoMSk="}],
            "meshes": [],
            "accessors": [],
            "bufferViews": []
        }"#;
        let err2 =
            load_safe_glb_bytes(&build_glb(data_json, &bin)).expect_err("must reject data URI");
        assert!(err2.contains("URI"), "{err2}");
    }

    #[test]
    fn rejects_unsupported_extensions_and_oversized_vertex_counts() {
        let bin = triangle_bin();
        let ext_json = r#"{
            "asset": {"version": "2.0"},
            "extensionsRequired": ["KHR_materials_unlit"],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}]
        }"#;
        let err = load_safe_glb_bytes(&build_glb(ext_json, &bin))
            .expect_err("must reject unsupported extension");
        assert!(err.contains("extension"), "{err}");

        let big_json = r#"{
            "asset": {"version": "2.0"},
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 300000, "type": "VEC3"}]
        }"#;
        let err2 = load_safe_glb_bytes(&build_glb(big_json, &bin))
            .expect_err("must reject oversized vertex count");
        assert!(err2.contains("cap"), "{err2}");
    }
}
