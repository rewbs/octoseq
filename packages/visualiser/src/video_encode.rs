//! FFmpeg integration for video encoding.
//!
//! This module provides optional video encoding using FFmpeg as an external tool.
//! If FFmpeg is not available, rendering continues with frame-only output.

#![cfg(not(target_arch = "wasm32"))]

use std::path::Path;
use std::process::Command;

/// Result of checking FFmpeg availability.
#[derive(Debug)]
pub enum FfmpegStatus {
    /// FFmpeg is available with the given version string.
    Available(String),
    /// FFmpeg is not found.
    NotFound,
    /// FFmpeg was found but couldn't determine version.
    Unknown,
}

/// Check if FFmpeg is available on the system.
pub fn check_ffmpeg() -> FfmpegStatus {
    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Extract version from first line, e.g., "ffmpeg version 6.0 ..."
                if let Some(first_line) = stdout.lines().next() {
                    FfmpegStatus::Available(first_line.to_string())
                } else {
                    FfmpegStatus::Unknown
                }
            } else {
                FfmpegStatus::NotFound
            }
        }
        Err(_) => FfmpegStatus::NotFound,
    }
}

/// Encode frames to video using FFmpeg.
///
/// # Arguments
///
/// * `frames_dir` - Directory containing frames named `frame_XXXXX.png`
/// * `output_path` - Output video file path (e.g., `render.mp4`)
/// * `fps` - Frame rate for the video
///
/// # Returns
///
/// * `Ok(())` if encoding succeeded
/// * `Err(message)` if encoding failed
///
/// # Example
///
/// ```ignore
/// encode_video_with_ffmpeg(
///     Path::new("./frames"),
///     Path::new("./output.mp4"),
///     60.0,
/// )?;
/// ```
pub fn encode_video_with_ffmpeg(
    frames_dir: &Path,
    output_path: &Path,
    fps: f32,
) -> Result<(), String> {
    // Check FFmpeg availability
    match check_ffmpeg() {
        FfmpegStatus::Available(version) => {
            log::info!("Using {}", version);
        }
        FfmpegStatus::NotFound => {
            return Err(
                "FFmpeg not found. Install FFmpeg and ensure it's in your PATH.\n\
                 See: https://ffmpeg.org/download.html"
                    .to_string(),
            );
        }
        FfmpegStatus::Unknown => {
            log::warn!("FFmpeg found but version unknown, proceeding anyway");
        }
    }

    // Build frame pattern path
    let frame_pattern = frames_dir.join("frame_%05d.png");

    // Ensure output directory exists
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    // Build FFmpeg command
    // -y: Overwrite output without asking
    // -framerate: Input frame rate
    // -i: Input pattern
    // -c:v libx264: Use H.264 codec
    // -pix_fmt yuv420p: Use widely compatible pixel format
    // -crf 18: High quality (lower = better, 18-23 is good range)
    let output = Command::new("ffmpeg")
        .arg("-y")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-i")
        .arg(&frame_pattern)
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-crf")
        .arg("18")
        .arg(output_path)
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg encoding failed:\n{}", stderr));
    }

    log::info!("Video encoded to {:?}", output_path);
    Ok(())
}

/// Encode frames to video with additional options.
///
/// # Arguments
///
/// * `frames_dir` - Directory containing frames
/// * `output_path` - Output video file path
/// * `fps` - Frame rate
/// * `options` - Additional encoding options
pub fn encode_video_with_options(
    frames_dir: &Path,
    output_path: &Path,
    fps: f32,
    options: &VideoEncodingOptions,
) -> Result<(), String> {
    // Check FFmpeg availability
    match check_ffmpeg() {
        FfmpegStatus::Available(_) => {}
        FfmpegStatus::NotFound => {
            return Err(
                "FFmpeg not found. Install FFmpeg and ensure it's in your PATH.\n\
                 See: https://ffmpeg.org/download.html"
                    .to_string(),
            );
        }
        FfmpegStatus::Unknown => {}
    }

    let frame_pattern = frames_dir.join("frame_%05d.png");

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-i")
        .arg(&frame_pattern);

    // Add codec
    cmd.arg("-c:v").arg(&options.codec);

    // Add pixel format
    cmd.arg("-pix_fmt").arg(&options.pixel_format);

    // Add quality setting
    match options.codec.as_str() {
        "libx264" | "libx265" => {
            cmd.arg("-crf").arg(options.crf.to_string());
        }
        "libvpx-vp9" => {
            cmd.arg("-crf").arg(options.crf.to_string());
            cmd.arg("-b:v").arg("0"); // Constant quality mode
        }
        _ => {}
    }

    // Add preset if applicable
    if let Some(ref preset) = options.preset {
        cmd.arg("-preset").arg(preset);
    }

    // Add any extra arguments
    for arg in &options.extra_args {
        cmd.arg(arg);
    }

    cmd.arg(output_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg encoding failed:\n{}", stderr));
    }

    Ok(())
}

/// Options for video encoding.
#[derive(Debug, Clone)]
pub struct VideoEncodingOptions {
    /// Video codec (default: libx264)
    pub codec: String,
    /// Pixel format (default: yuv420p)
    pub pixel_format: String,
    /// Constant Rate Factor for quality (default: 18, lower = better)
    pub crf: u32,
    /// Encoding preset (e.g., "slow", "medium", "fast")
    pub preset: Option<String>,
    /// Additional FFmpeg arguments
    pub extra_args: Vec<String>,
}

impl Default for VideoEncodingOptions {
    fn default() -> Self {
        Self {
            codec: "libx264".to_string(),
            pixel_format: "yuv420p".to_string(),
            crf: 18,
            preset: None,
            extra_args: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_ffmpeg() {
        // This test just verifies the function runs without panicking.
        // The result depends on whether FFmpeg is installed.
        let status = check_ffmpeg();
        match status {
            FfmpegStatus::Available(v) => println!("FFmpeg available: {}", v),
            FfmpegStatus::NotFound => println!("FFmpeg not found"),
            FfmpegStatus::Unknown => println!("FFmpeg status unknown"),
        }
    }

    #[test]
    fn test_video_encoding_options_default() {
        let opts = VideoEncodingOptions::default();
        assert_eq!(opts.codec, "libx264");
        assert_eq!(opts.pixel_format, "yuv420p");
        assert_eq!(opts.crf, 18);
    }
}
