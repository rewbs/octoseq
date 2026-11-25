//! Integration tests for declarative `scene_rig.v1` / `scene_rig.v2`,
//! sanitized `.glb` loading, Rhai `rig.*` hooks, optional 5-target AI conditioning MRT,
//! and bit-for-bit O(1) seek determinism on headless GPU.

use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;

use visualiser::event_rhai::{clear_named_event_streams, store_named_event_stream};
use visualiser::event_stream::{Event, EventStream, PickEventsOptions};
use visualiser::glb_loader::{
    load_safe_glb_bytes, CHUNK_TYPE_BIN, CHUNK_TYPE_JSON, GLB_MAGIC, GLB_VERSION,
};
use visualiser::gpu::renderer::Renderer;
use visualiser::input::{BandSignalMap, InputSignal, SignalMap};
use visualiser::rig_loader::{load_rig_file, parse_and_validate_rig_json, RigOutputMode};
use visualiser::visualiser::VisualiserState;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn rig_path(filename: &str) -> PathBuf {
    repo_root().join("assets/scenes3d").join(filename)
}

fn build_test_glb(gltf_json: &str, bin_chunk: &[u8]) -> Vec<u8> {
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

fn make_textured_cube_glb() -> Vec<u8> {
    // Simple tetrahedron + 4x4 PNG albedo embedded in bufferView
    let verts: [[f32; 3]; 4] = [
        [0.0, 1.0, 0.0],
        [-1.0, -1.0, 1.0],
        [1.0, -1.0, 1.0],
        [0.0, -1.0, -1.0],
    ];
    let uvs: [[f32; 2]; 4] = [[0.5, 1.0], [0.0, 0.0], [1.0, 0.0], [0.5, 0.5]];
    let indices: [u16; 12] = [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2];

    let img = image::RgbaImage::from_fn(4, 4, |x, y| {
        image::Rgba([(x * 60 + 40) as u8, (y * 60 + 40) as u8, 220, 255])
    });
    let mut png_bytes = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .unwrap();

    let mut bin = Vec::new();
    for v in &verts {
        for f in v {
            bin.extend_from_slice(&f.to_le_bytes());
        }
    }
    let uv_off = bin.len();
    for uv in &uvs {
        for f in uv {
            bin.extend_from_slice(&f.to_le_bytes());
        }
    }
    let idx_off = bin.len();
    for i in &indices {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let img_off = bin.len();
    bin.extend_from_slice(&png_bytes);

    let json = format!(
        r#"{{
            "asset": {{"version": "2.0"}},
            "meshes": [{{"primitives": [{{"attributes": {{"POSITION": 0, "TEXCOORD_0": 1}}, "indices": 2}}]}}],
            "materials": [{{"pbrMetallicRoughness": {{"baseColorFactor": [0.9, 0.95, 1.0, 1.0], "baseColorTexture": {{"index": 0}}}}}}],
            "textures": [{{"source": 0}}],
            "images": [{{"bufferView": 3, "mimeType": "image/png"}}],
            "buffers": [{{"byteLength": {}}}],
            "bufferViews": [
                {{"buffer": 0, "byteOffset": 0, "byteLength": 48}},
                {{"buffer": 0, "byteOffset": {}, "byteLength": 32}},
                {{"buffer": 0, "byteOffset": {}, "byteLength": 24}},
                {{"buffer": 0, "byteOffset": {}, "byteLength": {}}}
            ],
            "accessors": [
                {{"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"}},
                {{"bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC2"}},
                {{"bufferView": 2, "componentType": 5123, "count": 12, "type": "SCALAR"}}
            ]
        }}"#,
        bin.len(),
        uv_off,
        idx_off,
        img_off,
        png_bytes.len()
    );
    build_test_glb(&json, &bin)
}

fn create_headless_renderer(width: u32, height: u32) -> Option<(Renderer, wgpu::Texture, wgpu::TextureView, wgpu::Buffer, u32)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))?;
    let (device, queue) =
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None)).ok()?;

    let format = wgpu::TextureFormat::Rgba8UnormSrgb;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Test Target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    let unpadded = width * 4;
    let align = 256u32;
    let padded = unpadded + (align - unpadded % align) % align;
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Readback Buffer"),
        size: (padded * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let renderer = Renderer::new(device, queue, format, width, height);
    Some((renderer, texture, view, buf, padded))
}

fn readback_rgba(
    renderer: &Renderer,
    texture: &wgpu::Texture,
    buffer: &wgpu::Buffer,
    width: u32,
    height: u32,
    padded_bytes_per_row: u32,
) -> Vec<u8> {
    let mut encoder = renderer
        .device()
        .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    renderer.queue().submit(Some(encoder.finish()));

    let slice = buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |res| tx.send(res).unwrap());
    renderer.device().poll(wgpu::Maintain::Wait);
    rx.recv().unwrap().unwrap();
    let mapped = slice.get_mapped_range();
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let start = (y * padded_bytes_per_row) as usize;
        out.extend_from_slice(&mapped[start..start + (width * 4) as usize]);
    }
    drop(mapped);
    buffer.unmap();
    out
}

fn install_synthetic_bundle() -> (SignalMap, BandSignalMap, SignalMap) {
    clear_named_event_streams();
    let hits = EventStream::new(
        (0..20).map(|i| Event::new(0.25 + i as f32 * 0.5, 0.9)).collect(),
        "hit".to_string(),
        PickEventsOptions::default(),
    );
    let beats = EventStream::new(
        (0..20).map(|i| Event::new(i as f32 * 0.5, 1.0)).collect(),
        "beat".to_string(),
        PickEventsOptions::default(),
    );
    store_named_event_stream("hit".to_string(), hits.clone());
    store_named_event_stream("kick".to_string(), hits);
    store_named_event_stream("beat".to_string(), beats);

    let mut named: SignalMap = HashMap::new();
    let vals: Vec<f32> = (0..500).map(|i| 0.3 + 0.5 * ((i as f32) * 0.08).sin().abs()).collect();
    named.insert("energy".to_string(), Rc::new(InputSignal::new(vals.clone(), 50.0)));
    named.insert("spectralCentroid".to_string(), Rc::new(InputSignal::new(vals.clone(), 50.0)));
    named.insert("spectralFlux".to_string(), Rc::new(InputSignal::new(vals, 50.0)));

    let mut custom: SignalMap = HashMap::new();
    let sec_int = vec![0.8f32; 500];
    custom.insert("section_intensity".to_string(), Rc::new(InputSignal::new(sec_int, 50.0)));

    (named, HashMap::new(), custom)
}

#[test]
fn loads_all_five_reference_rigs_from_assets() {
    for name in [
        "01_instanced_megastructure.rig.json",
        "04_volumetric_concert_stage.rig.json",
        "06_cyber_wireframe_tunnel.rig.json",
        "07_sacred_polyhedra_cathedral.rig.json",
        "08_orbital_prism_array.rig.json",
    ] {
        let cfg = load_rig_file(&rig_path(name))
            .unwrap_or_else(|e| panic!("failed to load {name}: {e}"));
        assert!(!cfg.rig_id.is_empty());
        assert!(!cfg.mrt_active(), "MRT must default off for zero beauty bandwidth");
    }
}

#[test]
fn security_rejects_malicious_rigs_and_external_uri_glbs() {
    // Embedded script/shader keys
    let bad_rig = r#"{
        "schema_version": "scene_rig.v2",
        "rig_id": "bad/shader",
        "template": "sacred_polyhedra_cathedral",
        "wgsl": "@fragment fn main() {}"
    }"#;
    assert!(parse_and_validate_rig_json(bad_rig).is_err());

    let bad_rhai = r#"{
        "schema_version": "scene_rig.v2",
        "rig_id": "bad/rhai",
        "template": "orbital_prism_array",
        "nested": { "rhai": "evil()" }
    }"#;
    assert!(parse_and_validate_rig_json(bad_rhai).is_err());

    // Path traversal in glb_asset_ref
    let bad_path = r#"{
        "schema_version": "scene_rig.v2",
        "rig_id": "bad/traversal",
        "template": "glb_stage",
        "geometry": { "instance_count": 1, "glb_asset_ref": "../../etc/passwd" }
    }"#;
    assert!(parse_and_validate_rig_json(bad_path).is_err());

    // External URI in GLB
    let bad_glb = build_test_glb(
        r#"{"asset":{"version":"2.0"},"buffers":[{"uri":"http://evil.invalid/a.bin","byteLength":4}]}"#,
        &[0u8; 4],
    );
    assert!(load_safe_glb_bytes(&bad_glb).is_err());
}

#[test]
fn rhai_rig_load_and_overrides_work_and_reject_unsafe_json() {
    let mut state = VisualiserState::new();
    let script = format!(
        r#"
        fn init(ctx) {{
            rig.load({});
            rig.set_gain("staying_step_gain", 1.25);
            rig.set_material("toon_cel");
            rig.set_output("wireframe");
        }}
        "#,
        serde_json::to_string(&rig_path("07_sacred_polyhedra_cathedral.rig.json").to_string_lossy().to_string()).unwrap()
    );
    assert!(state.load_script(&script), "script should compile");
    let empty_sig = HashMap::new();
    let empty_band = HashMap::new();
    state.update(1.0 / 30.0, None, None, &empty_sig, &empty_band, &empty_sig, None);
    let active = state.active_scene_rig().expect("rig should be active after init()");
    assert!((active.config.reactivity.staying_step_gain - 1.25).abs() < 1e-5);
    assert_eq!(active.config.output_mode, RigOutputMode::Wireframe);
    assert!(active.config.mrt_active());

    // Malicious rig JSON inside Rhai must fail at init()
    let mut state2 = VisualiserState::new();
    let evil_script = r#"
        fn init(ctx) {
            rig.load_json("{\"schema_version\":\"scene_rig.v2\",\"rig_id\":\"x\",\"template\":\"glb_stage\",\"glsl\":\"void main(){}\"}");
        }
    "#;
    assert!(state2.load_script(evil_script));
    state2.update(1.0 / 30.0, None, None, &empty_sig, &empty_band, &empty_sig, None);
    let diags = state2.take_script_diagnostics();
    assert!(!diags.is_empty(), "malicious rig.load_json should produce a script error diagnostic");
    assert!(state2.active_scene_rig().is_none());
}

#[test]
fn o1_seek_matches_continuous_rendering_bit_for_bit_on_v2_rigs() {
    let width = 160u32;
    let height = 90u32;
    let fps = 30.0f32;
    let dt = 1.0 / fps;
    let target_frame = 21usize; // After a blow at t=0.25s and right near t=0.70s!

    let (named, bands, custom) = install_synthetic_bundle();

    for rig_name in [
        "07_sacred_polyhedra_cathedral.rig.json",
        "08_orbital_prism_array.rig.json",
    ] {
        // 1. Continuous render 0..=target_frame
        let Some((mut r_cont, tex_cont, view_cont, buf_cont, pad_cont)) =
            create_headless_renderer(width, height)
        else {
            eprintln!("Skipping GPU determinism test: no GPU adapter available");
            return;
        };
        let mut s_cont = VisualiserState::new();
        s_cont.set_global_seed(42);
        s_cont.load_rig_file(&rig_path(rig_name)).unwrap();

        for f in 0..=target_frame {
            let t = (f as f64 / fps as f64) as f32;
            s_cont.update_rig_at_time(t, dt, &named, &bands, &custom, None);
            r_cont.render(&view_cont, &s_cont);
        }
        let cont_bytes = readback_rgba(&r_cont, &tex_cont, &buf_cont, width, height, pad_cont);

        // Verify MRT was NOT allocated for default beauty rendering
        assert!(
            r_cont.scene3d_pass().unwrap().depth_texture().is_none(),
            "MRT targets should not be allocated in default beauty mode"
        );

        // 2. Direct O(1) seek straight to target_frame on fresh Renderer + VisualiserState
        let (mut r_seek, tex_seek, view_seek, buf_seek, pad_seek) =
            create_headless_renderer(width, height).unwrap();
        let mut s_seek = VisualiserState::new();
        s_seek.set_global_seed(42);
        s_seek.load_rig_file(&rig_path(rig_name)).unwrap();

        let t = (target_frame as f64 / fps as f64) as f32;
        s_seek.update_rig_at_time(t, dt, &named, &bands, &custom, None);
        r_seek.render(&view_seek, &s_seek);
        let seek_bytes = readback_rgba(&r_seek, &tex_seek, &buf_seek, width, height, pad_seek);

        assert_eq!(
            cont_bytes, seek_bytes,
            "O(1) seek frame {target_frame} must match continuous rendering bit-for-bit on {rig_name}"
        );

        // Confirm rendered pixels actually have non-uniform lit geometry (not flat/black)
        let luma_vals: Vec<u8> = cont_bytes.chunks_exact(4).map(|px| px[0].max(px[1]).max(px[2])).collect();
        let max_v = *luma_vals.iter().max().unwrap();
        let min_v = *luma_vals.iter().min().unwrap();
        assert!(
            max_v > min_v + 30,
            "{rig_name} rendered image lacks contrast (min={min_v}, max={max_v})"
        );
    }
}

#[test]
fn mrt_conditioning_fresnel_cones_and_glb_albedo_render_cleanly() {
    let width = 160u32;
    let height = 90u32;
    let Some((mut renderer, tex, view, buf, pad)) = create_headless_renderer(width, height) else {
        eprintln!("Skipping GPU MRT/GLB test: no GPU adapter available");
        return;
    };
    let (named, bands, custom) = install_synthetic_bundle();

    // 1. Volumetric concert stage with Fresnel cones + MRT quad_conditioning + GLB with embedded PNG albedo
    let mut state = VisualiserState::new();
    state.set_global_seed(7);
    state
        .load_rig_file(&rig_path("04_volumetric_concert_stage.rig.json"))
        .unwrap();
    let glb_bytes = make_textured_cube_glb();
    state.load_rig_glb_bytes(&glb_bytes).unwrap();
    state.set_rig_output_mode(RigOutputMode::QuadConditioning);

    state.update_rig_at_time(1.0, 1.0 / 30.0, &named, &bands, &custom, None);
    renderer.render(&view, &state);
    let quad_bytes = readback_rgba(&renderer, &tex, &buf, width, height, pad);

    let s3d = renderer.scene3d_pass().expect("scene3d pass initialized");
    assert!(s3d.depth_texture().is_some());
    assert!(s3d.normal_texture().is_some());
    assert!(s3d.wireframe_texture().is_some());
    assert!(s3d.flat_texture().is_some());
    assert!(s3d.motion_texture().is_some());

    let unique_sum: u64 = quad_bytes.iter().map(|&b| b as u64).sum();
    assert!(unique_sum > 1000, "quad_conditioning output should not be black");
}
