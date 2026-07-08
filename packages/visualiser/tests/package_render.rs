//! End-to-end render of the golden interpretation package fixture.
//!
//! GPU-dependent, so ignored by default. Run explicitly with:
//!
//! ```sh
//! cargo test --test package_render -- --ignored
//! ```
//!
//! The fixture at `tests/fixtures/interpretation-package-v1.json` is exported
//! by the web app's package exporter (see
//! `docs/design/phase3-interpretation-package.md`). If it has not been
//! generated yet, the test skips with a note rather than failing.

use std::path::PathBuf;

use visualiser::cli::execute_render_job;
use visualiser::interpretation_package::load_package;
use visualiser::render_job::RenderJobSpec;

const FRAME_COUNT: usize = 5;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/interpretation-package-v1.json")
}

#[test]
#[ignore = "requires a GPU and the golden fixture; run with --ignored"]
fn renders_frames_from_golden_package() {
    let fixture = fixture_path();
    if !fixture.exists() {
        eprintln!(
            "Skipping package_render: golden fixture not present at {:?}",
            fixture
        );
        return;
    }

    // Parse first so schema drift fails loudly before touching the GPU.
    let json = std::fs::read_to_string(&fixture).expect("fixture is readable");
    let pkg = load_package(&json).expect("golden fixture parses as an interpretation package v1");
    if pkg.script.is_none() {
        eprintln!("Skipping package_render: fixture embeds no script and the test passes none");
        return;
    }

    let out_dir = std::env::temp_dir().join(format!(
        "octoseq-package-render-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&out_dir).expect("create temp output dir");

    // 5 frames: ceil(0.5s * 10fps).
    let job = RenderJobSpec {
        input_path: None,
        package_path: Some(fixture),
        script_path: None,
        output_dir: out_dir.clone(),
        fps: 10.0,
        duration: Some(FRAME_COUNT as f32 / 10.0),
        width: 160,
        height: 120,
        seed: 0,
        input_sample_rate: 100.0,
        preset_name: None,
        output_video: false,
        video_path: None,
    };

    // Same render path the CLI `render --package` command uses.
    pollster::block_on(execute_render_job(&job, false, true)).expect("render job succeeds");

    for i in 0..FRAME_COUNT {
        let frame = out_dir.join(format!("frame_{:05}.png", i));
        let metadata = std::fs::metadata(&frame)
            .unwrap_or_else(|e| panic!("missing frame {:?}: {}", frame, e));
        assert!(metadata.len() > 0, "frame {:?} is empty", frame);
    }

    let _ = std::fs::remove_dir_all(&out_dir);
}
