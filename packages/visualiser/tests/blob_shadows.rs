//! Each blob shadow is drawn with its own uniforms.
//!
//! Regression test for the shadow pass writing every shadow's uniforms to the same
//! buffer offset: the writes all landed before the pass's draws ran, so every shadow
//! was drawn at the last shadowed mesh's position with its radius, softness and
//! opacity.
//!
//! GPU-dependent, so ignored by default. Run explicitly with:
//!
//! ```sh
//! cargo test --test blob_shadows -- --ignored
//! ```

use std::path::PathBuf;

use visualiser::cli::execute_render_job;
use visualiser::render_job::RenderJobSpec;

const WIDTH: u32 = 320;
const HEIGHT: u32 = 180;

fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// Mean luma (0-255) of the 5x5 block of pixels centred on (x, y).
fn luma_at(frame: &image::GrayImage, x: u32, y: u32) -> f32 {
    let mut sum = 0.0;
    for dy in 0..5 {
        for dx in 0..5 {
            sum += frame.get_pixel(x + dx - 2, y + dy - 2).0[0] as f32;
        }
    }
    sum / 25.0
}

#[test]
#[ignore = "requires a GPU; run with --ignored"]
fn two_shadows_render_in_their_own_places() {
    let out_dir = std::env::temp_dir().join(format!(
        "octoseq-blob-shadows-{}-{}",
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
        script_path: Some(manifest_path("tests/fixtures/two-blob-shadows.rhai")),
        output_dir: out_dir.clone(),
        fps: 10.0,
        duration: Some(0.2),
        width: WIDTH,
        height: HEIGHT,
        seed: 0,
        input_sample_rate: 100.0,
        preset_name: None,
        output_video: false,
        video_path: None,
    };
    pollster::block_on(execute_render_job(&job, false, true)).expect("render job succeeds");

    let frame = image::open(out_dir.join("frame_00001.png"))
        .expect("frame is a readable image")
        .to_luma8();
    let _ = std::fs::remove_dir_all(&out_dir);

    // The camera looks at the midpoint between the two shadow centres, so both project
    // onto the horizontal centre line, mirrored about the vertical one. Each is 3 units
    // to the side at a view depth of sqrt(11^2 + 9^2), with a 45 degree vertical field
    // of view: an offset of 3 / (depth * tan(22.5 deg)) half-heights.
    let depth = (11.0f32 * 11.0 + 9.0 * 9.0).sqrt();
    let offset_px = 3.0 / (depth * 22.5f32.to_radians().tan()) * (HEIGHT as f32 / 2.0);
    let centre_y = HEIGHT / 2;
    let left_x = (WIDTH as f32 / 2.0 - offset_px).round() as u32;
    let right_x = (WIDTH as f32 / 2.0 + offset_px).round() as u32;

    let background = luma_at(&frame, WIDTH / 2, HEIGHT - 10);
    let left = luma_at(&frame, left_x, centre_y);
    let right = luma_at(&frame, right_x, centre_y);
    // 0.8 world units out from each centre: beyond the left shadow's radius (0.6),
    // inside the right one's (1.6).
    let outer_px = (offset_px * 0.8 / 3.0).round() as u32;
    let left_outer = luma_at(&frame, left_x - outer_px, centre_y);
    let right_outer = luma_at(&frame, right_x + outer_px, centre_y);

    assert!(
        background > 40.0,
        "expected the grey clear colour away from the shadows, got luma {background}"
    );
    assert!(
        left < background * 0.2,
        "left shadow (opacity 1.0) should be near black at its centre: luma {left} \
         against background {background}"
    );
    assert!(
        right < background * 0.9 && right > left + 15.0,
        "right shadow (opacity 0.6) should darken its centre, but less than the left \
         one: luma {right}, left {left}, background {background}"
    );
    assert!(
        right_outer < background * 0.95,
        "right shadow (radius 1.6) should still darken 0.8 units from its centre: \
         luma {right_outer} against background {background}"
    );
    assert!(
        (left_outer - background).abs() < 3.0,
        "left shadow (radius 0.6) should not reach 0.8 units from its centre: \
         luma {left_outer} against background {background}"
    );
}
