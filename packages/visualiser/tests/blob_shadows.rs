//! Blob shadows render where, and how, the script says.
//!
//! Regression tests for three bugs:
//!
//! - The shadow pass wrote every shadow's uniforms to the same buffer offset. The
//!   writes all landed before the pass's draws ran, so every shadow was drawn at the
//!   last shadowed mesh's position with its radius, softness and opacity.
//! - `shadow.color` was discarded by the blend state: every shadow was black.
//! - `shadow.radius_x` / `shadow.radius_z` were overwritten by the default uniform
//!   `shadow.radius`: every shadow was a circle.
//!
//! GPU-dependent, so ignored by default. Run explicitly with:
//!
//! ```sh
//! cargo test --test blob_shadows -- --ignored
//! ```
//!
//! Both fixtures use the same camera: at (0, 9, 9), looking at (0, -2, 0), with the
//! shadows on the plane y = -2 and no floor, so they show on the grey clear colour.

use std::path::PathBuf;

use visualiser::cli::execute_render_job;
use visualiser::render_job::RenderJobSpec;

const WIDTH: u32 = 320;
const HEIGHT: u32 = 180;

fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// Render the second frame of a fixture scene.
fn render_fixture(script: &str) -> image::RgbImage {
    let out_dir = std::env::temp_dir().join(format!(
        "octoseq-blob-shadows-{}-{}-{}",
        script,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&out_dir).expect("create temp output dir");

    let job = RenderJobSpec {
        input_path: Some(manifest_path("test_input.json")),
        package_path: None,
        script_path: Some(manifest_path("tests/fixtures").join(script)),
        output_dir: out_dir.clone(),
        fps: 10.0,
        duration: Some(0.2),
        width: WIDTH,
        height: HEIGHT,
        seed: 0,
        input_sample_rate: 100.0,
        step_rate: 0.0,
        shutter: 0.0,
        preset_name: None,
        output_video: false,
        video_path: None,
    };
    pollster::block_on(execute_render_job(&job, false, true)).expect("render job succeeds");

    let frame = image::open(out_dir.join("frame_00001.png"))
        .expect("frame is a readable image")
        .to_rgb8();
    let _ = std::fs::remove_dir_all(&out_dir);
    frame
}

/// Pixel that the point (x, -2, z) on the shadow plane projects to, for the fixtures'
/// camera and its 45 degree vertical field of view.
fn project(x: f32, z: f32) -> (u32, u32) {
    // View direction (0, -11, -9) / d and camera up (0, 9, -11) / d, with d = |view|.
    let d = (11.0f32 * 11.0 + 9.0 * 9.0).sqrt();
    let depth = (11.0 * 11.0 - 9.0 * (z - 9.0)) / d;
    let up = -11.0 * z / d;
    let half_height = HEIGHT as f32 / 2.0;
    let scale = half_height / (depth * 22.5f32.to_radians().tan());
    (
        (WIDTH as f32 / 2.0 + x * scale).round() as u32,
        (half_height - up * scale).round() as u32,
    )
}

/// Mean RGB (0-255) of the 5x5 block of pixels centred on where (x, -2, z) projects.
fn colour_at(frame: &image::RgbImage, x: f32, z: f32) -> [f32; 3] {
    let (px, py) = project(x, z);
    let mut sum = [0.0f32; 3];
    for dy in 0..5 {
        for dx in 0..5 {
            let pixel = frame.get_pixel(px + dx - 2, py + dy - 2).0;
            for (total, channel) in sum.iter_mut().zip(pixel) {
                *total += channel as f32;
            }
        }
    }
    sum.map(|total| total / 25.0)
}

/// Whether a sampled colour is the grey clear colour, untouched by any shadow.
fn is_background(colour: [f32; 3], background: [f32; 3]) -> bool {
    colour
        .iter()
        .zip(background)
        .all(|(c, b)| (c - b).abs() < 3.0)
}

/// The clear colour, sampled well in front of every shadow.
fn background_of(frame: &image::RgbImage) -> [f32; 3] {
    let background = colour_at(frame, 0.0, 4.0);
    assert!(
        background.iter().all(|&c| c > 40.0),
        "expected the grey clear colour away from the shadows, got {background:?}"
    );
    background
}

#[test]
#[ignore = "requires a GPU; run with --ignored"]
fn two_shadows_render_in_their_own_places() {
    // Left: x = -3, radius 0.6, opacity 1.0, hard edge.
    // Right: x = +3, radius 1.6, opacity 0.6, soft edge.
    let frame = render_fixture("two-blob-shadows.rhai");
    let background = background_of(&frame)[0];

    // Shadows are black, so one channel is enough.
    let left = colour_at(&frame, -3.0, 0.0)[0];
    let right = colour_at(&frame, 3.0, 0.0)[0];
    // 0.8 units out from each centre: beyond the left shadow's radius, inside the
    // right one's.
    let left_outer = colour_at(&frame, -3.8, 0.0)[0];
    let right_outer = colour_at(&frame, 3.8, 0.0)[0];

    assert!(
        left < background * 0.2,
        "left shadow (opacity 1.0) should be near black at its centre: {left} against \
         background {background}"
    );
    assert!(
        right < background * 0.9 && right > left + 15.0,
        "right shadow (opacity 0.6) should darken its centre, but less than the left \
         one: {right}, left {left}, background {background}"
    );
    assert!(
        right_outer < background * 0.95,
        "right shadow (radius 1.6) should still darken 0.8 units from its centre: \
         {right_outer} against background {background}"
    );
    assert!(
        (left_outer - background).abs() < 3.0,
        "left shadow (radius 0.6) should not reach 0.8 units from its centre: \
         {left_outer} against background {background}"
    );
}

#[test]
#[ignore = "requires a GPU; run with --ignored"]
fn shadow_takes_its_colour_and_per_axis_radii() {
    // One opaque red shadow at the origin: radius 2.0 in X, 0.4 in Z.
    let frame = render_fixture("coloured-elliptical-blob-shadow.rhai");
    let background = background_of(&frame);

    let is_red = |colour: [f32; 3]| colour[0] > 200.0 && colour[1] < 40.0 && colour[2] < 40.0;

    let centre = colour_at(&frame, 0.0, 0.0);
    assert!(
        is_red(centre),
        "an opaque red shadow should be red at its centre, got {centre:?}"
    );

    // 1.5 units along X is inside the X radius (2.0) but outside a default circle (1.0).
    for x in [-1.5, 1.5] {
        let colour = colour_at(&frame, x, 0.0);
        assert!(
            is_red(colour),
            "radius_x 2.0 should reach {x} units along X, got {colour:?}"
        );
    }

    // 0.8 units along Z is outside the Z radius (0.4) but inside a default circle (1.0).
    for z in [-0.8, 0.8] {
        let colour = colour_at(&frame, 0.0, z);
        assert!(
            is_background(colour, background),
            "radius_z 0.4 should not reach {z} units along Z, got {colour:?} against \
             background {background:?}"
        );
    }
}
