//! Render job specification and metadata.
//!
//! This module defines the formal structures for offline rendering jobs,
//! including single job specs, batch job specs, and render metadata.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg(not(target_arch = "wasm32"))]
use chrono::{DateTime, Utc};

#[cfg(not(target_arch = "wasm32"))]
use sha2::{Digest, Sha256};

/// Default FPS for rendering.
fn default_fps() -> f32 {
    60.0
}

/// Default output width.
fn default_width() -> u32 {
    1920
}

/// Default output height.
fn default_height() -> u32 {
    1080
}

/// Default input signal sample rate (Hz).
fn default_sample_rate() -> f32 {
    100.0
}

/// Specification for a single render job.
/// Contains all information needed to deterministically render a sequence of frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJobSpec {
    /// Path to input signal JSON file (array of floats).
    pub input_path: PathBuf,

    /// Path to Rhai script file.
    pub script_path: PathBuf,

    /// Output directory for frames.
    pub output_dir: PathBuf,

    /// Frames per second.
    #[serde(default = "default_fps")]
    pub fps: f32,

    /// Duration in seconds. None means use input signal duration.
    #[serde(default)]
    pub duration: Option<f32>,

    /// Output width in pixels.
    #[serde(default = "default_width")]
    pub width: u32,

    /// Output height in pixels.
    #[serde(default = "default_height")]
    pub height: u32,

    /// Random seed for particle systems. Default 0 means deterministic default behavior.
    #[serde(default)]
    pub seed: u64,

    /// Input signal sample rate in Hz.
    #[serde(default = "default_sample_rate")]
    pub input_sample_rate: f32,

    /// Optional preset name for metadata tracking.
    #[serde(default)]
    pub preset_name: Option<String>,

    /// Whether to generate video output via FFmpeg.
    #[serde(default)]
    pub output_video: bool,

    /// Video output path. If None and output_video is true, defaults to {output_dir}/render.mp4.
    #[serde(default)]
    pub video_path: Option<PathBuf>,
}

impl RenderJobSpec {
    /// Create a new render job spec with required fields only.
    pub fn new(input_path: PathBuf, script_path: PathBuf, output_dir: PathBuf) -> Self {
        Self {
            input_path,
            script_path,
            output_dir,
            fps: default_fps(),
            duration: None,
            width: default_width(),
            height: default_height(),
            seed: 0,
            input_sample_rate: default_sample_rate(),
            preset_name: None,
            output_video: false,
            video_path: None,
        }
    }

    /// Validate the job specification.
    pub fn validate(&self) -> Result<(), String> {
        if !self.input_path.exists() {
            return Err(format!("Input file not found: {:?}", self.input_path));
        }
        if !self.script_path.exists() {
            return Err(format!("Script file not found: {:?}", self.script_path));
        }
        if self.fps <= 0.0 {
            return Err("FPS must be positive".to_string());
        }
        if self.width == 0 || self.height == 0 {
            return Err("Width and height must be positive".to_string());
        }
        if self.input_sample_rate <= 0.0 {
            return Err("Sample rate must be positive".to_string());
        }
        Ok(())
    }

    /// Get the effective video output path.
    pub fn effective_video_path(&self) -> PathBuf {
        self.video_path
            .clone()
            .unwrap_or_else(|| self.output_dir.join("render.mp4"))
    }
}

/// Specification for a batch render job.
/// Renders multiple presets against potentially different inputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchJobSpec {
    /// Batch identifier.
    pub batch_id: String,

    /// Base output directory. Each job creates subdirectories under this.
    pub output_base: PathBuf,

    /// List of render jobs in the batch.
    pub jobs: Vec<RenderJobSpec>,

    /// Whether to run jobs in parallel.
    #[serde(default = "default_parallel")]
    pub parallel: bool,

    /// Maximum number of parallel jobs. None means use available CPU cores.
    #[serde(default)]
    pub max_parallel_jobs: Option<usize>,
}

fn default_parallel() -> bool {
    true
}

impl BatchJobSpec {
    /// Load a batch spec from a JSON file.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read batch file {:?}: {}", path, e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse batch file {:?}: {}", path, e))
    }

    /// Validate all jobs in the batch.
    pub fn validate(&self) -> Result<(), String> {
        if self.batch_id.is_empty() {
            return Err("Batch ID cannot be empty".to_string());
        }
        if self.jobs.is_empty() {
            return Err("Batch must contain at least one job".to_string());
        }
        for (i, job) in self.jobs.iter().enumerate() {
            job.validate()
                .map_err(|e| format!("Job {}: {}", i, e))?;
        }
        Ok(())
    }

    /// Generate structured output paths for all jobs.
    /// Format: {output_base}/{track_name}/{preset_name}/frames/
    pub fn generate_output_paths(&mut self) {
        for job in &mut self.jobs {
            let preset_name = job
                .preset_name
                .clone()
                .unwrap_or_else(|| "default".to_string());
            let track_name = job
                .input_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "track".to_string());

            job.output_dir = self
                .output_base
                .join(&track_name)
                .join(&preset_name)
                .join("frames");
        }
    }
}

/// Metadata for a completed render.
/// Written as metadata.json alongside rendered frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_arch = "wasm32"))]
pub struct RenderMetadata {
    /// The job specification used.
    pub job: RenderJobSpec,

    /// Timestamp when render started (ISO 8601).
    pub started_at: DateTime<Utc>,

    /// Timestamp when render completed (ISO 8601).
    pub completed_at: DateTime<Utc>,

    /// Total render duration in seconds.
    pub render_duration_secs: f64,

    /// Total frames rendered.
    pub frame_count: usize,

    /// Average rendering FPS (frames / render_duration).
    pub average_render_fps: f64,

    /// SHA-256 hash of the script content.
    pub script_hash: String,

    /// SHA-256 hash of the input file.
    pub input_hash: String,

    /// Octoseq version.
    pub octoseq_version: String,

    /// GPU adapter info.
    pub gpu_adapter: String,

    /// Output video path if video was generated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_path: Option<PathBuf>,

    /// Any warnings or issues during render.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[cfg(not(target_arch = "wasm32"))]
impl RenderMetadata {
    /// Compute SHA-256 hash of file content.
    pub fn hash_file(path: &std::path::Path) -> Result<String, std::io::Error> {
        use std::io::Read;

        let mut file = std::fs::File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Save metadata to a JSON file.
    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write metadata: {}", e))
    }
}

/// Render phase for error reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderPhase {
    Initialization,
    InputLoading,
    ScriptLoading,
    GpuSetup,
    FrameRender,
    FrameSave,
    VideoEncode,
    MetadataSave,
}

impl std::fmt::Display for RenderPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderPhase::Initialization => write!(f, "Initialization"),
            RenderPhase::InputLoading => write!(f, "Input Loading"),
            RenderPhase::ScriptLoading => write!(f, "Script Loading"),
            RenderPhase::GpuSetup => write!(f, "GPU Setup"),
            RenderPhase::FrameRender => write!(f, "Frame Render"),
            RenderPhase::FrameSave => write!(f, "Frame Save"),
            RenderPhase::VideoEncode => write!(f, "Video Encode"),
            RenderPhase::MetadataSave => write!(f, "Metadata Save"),
        }
    }
}

/// Structured error for render failures.
#[derive(Debug)]
pub struct RenderError {
    pub phase: RenderPhase,
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.phase, self.message)?;
        if let Some(ref source) = self.source {
            write!(f, " (caused by: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for RenderError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|e| e.as_ref() as &(dyn std::error::Error + 'static))
    }
}

impl RenderError {
    /// Create a new render error.
    pub fn new(phase: RenderPhase, message: impl Into<String>) -> Self {
        Self {
            phase,
            message: message.into(),
            source: None,
        }
    }

    /// Create a render error with a source error.
    pub fn with_source(
        phase: RenderPhase,
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self {
            phase,
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

/// Progress information for render callbacks.
#[derive(Debug, Clone)]
pub struct RenderProgress {
    /// Current frame number (1-indexed).
    pub current_frame: usize,
    /// Total frames to render.
    pub total_frames: usize,
    /// Elapsed time in seconds.
    pub elapsed_secs: f64,
    /// Estimated time remaining in seconds.
    pub eta_secs: Option<f64>,
}

impl RenderProgress {
    /// Get progress as a percentage (0.0 to 100.0).
    pub fn percentage(&self) -> f64 {
        if self.total_frames == 0 {
            100.0
        } else {
            (self.current_frame as f64 / self.total_frames as f64) * 100.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_job_spec_validation() {
        let spec = RenderJobSpec {
            input_path: PathBuf::from("/nonexistent/input.json"),
            script_path: PathBuf::from("/nonexistent/script.rhai"),
            output_dir: PathBuf::from("/output"),
            fps: 60.0,
            duration: None,
            width: 1920,
            height: 1080,
            seed: 42,
            input_sample_rate: 100.0,
            preset_name: Some("test".to_string()),
            output_video: false,
            video_path: None,
        };

        // Should fail because files don't exist
        assert!(spec.validate().is_err());
    }

    #[test]
    fn test_render_job_spec_defaults() {
        let spec = RenderJobSpec::new(
            PathBuf::from("input.json"),
            PathBuf::from("script.rhai"),
            PathBuf::from("output"),
        );

        assert_eq!(spec.fps, 60.0);
        assert_eq!(spec.width, 1920);
        assert_eq!(spec.height, 1080);
        assert_eq!(spec.seed, 0);
        assert_eq!(spec.input_sample_rate, 100.0);
    }

    #[test]
    fn test_render_progress_percentage() {
        let progress = RenderProgress {
            current_frame: 50,
            total_frames: 100,
            elapsed_secs: 5.0,
            eta_secs: Some(5.0),
        };

        assert_eq!(progress.percentage(), 50.0);
    }
}
