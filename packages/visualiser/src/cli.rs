//! CLI interface for offline rendering.
//!
//! Provides commands for:
//! - Single job rendering with deterministic output
//! - Batch rendering of multiple presets
//! - Configuration validation

use anyhow::Result;
use chrono::Utc;
use clap::{Parser, Subcommand};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

use crate::gpu::renderer::Renderer;
use crate::input::{BandSignalMap, InputSignal, SharedSignal, SignalMap};
use crate::render_job::{BatchJobSpec, RenderJobSpec, RenderMetadata, RenderPhase};
use crate::video_encode::{check_ffmpeg, encode_video_with_ffmpeg, FfmpegStatus};
use crate::visualiser::VisualiserState;

#[derive(Parser)]
#[command(author, version, about = "Octoseq offline rendering CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Render frames to disk (single job)
    Render {
        /// Input JSON file (array of floats) based input signal
        #[arg(long)]
        input: PathBuf,

        /// Output directory for frames
        #[arg(long)]
        out: PathBuf,

        /// Rhai script file for controlling the visualiser
        #[arg(long)]
        script: PathBuf,

        /// Frames per second
        #[arg(long, default_value_t = 60.0)]
        fps: f32,

        /// Duration in seconds (overrides input duration if shorter)
        #[arg(long)]
        duration: Option<f32>,

        /// Output width in pixels
        #[arg(long, default_value_t = 1920)]
        width: u32,

        /// Output height in pixels
        #[arg(long, default_value_t = 1080)]
        height: u32,

        /// Random seed for particle systems (for reproducibility)
        #[arg(long, default_value_t = 0)]
        seed: u64,

        /// Input signal sample rate in Hz
        #[arg(long, default_value_t = 100.0)]
        sample_rate: f32,

        /// Generate video output using FFmpeg
        #[arg(long)]
        output_video: bool,

        /// Video output path (default: {out}/render.mp4)
        #[arg(long)]
        video_path: Option<PathBuf>,

        /// Preset name (for metadata tracking)
        #[arg(long)]
        preset: Option<String>,

        /// Skip metadata.json generation
        #[arg(long)]
        no_metadata: bool,

        /// Quiet mode (minimal output)
        #[arg(short, long)]
        quiet: bool,
    },

    /// Render batch of presets from config file
    Batch {
        /// Path to batch config JSON file
        #[arg(long)]
        config: PathBuf,

        /// Override output base directory
        #[arg(long)]
        out: Option<PathBuf>,

        /// Continue on error (don't stop batch on first failure)
        #[arg(long)]
        continue_on_error: bool,

        /// Quiet mode (minimal output)
        #[arg(short, long)]
        quiet: bool,
    },

    /// Validate render job or batch config without rendering
    Validate {
        /// Path to job/batch config JSON file
        config: PathBuf,
    },
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Render {
            input,
            out,
            script,
            fps,
            duration,
            width,
            height,
            seed,
            sample_rate,
            output_video,
            video_path,
            preset,
            no_metadata,
            quiet,
        } => {
            let job = RenderJobSpec {
                input_path: input,
                script_path: script,
                output_dir: out,
                fps,
                duration,
                width,
                height,
                seed,
                input_sample_rate: sample_rate,
                preset_name: preset,
                output_video,
                video_path,
            };

            pollster::block_on(execute_render_job(&job, !no_metadata, quiet))?;
        }
        Commands::Batch {
            config,
            out,
            continue_on_error,
            quiet,
        } => {
            pollster::block_on(run_batch(&config, out, continue_on_error, quiet))?;
        }
        Commands::Validate { config } => {
            validate_config(&config)?;
        }
    }
    Ok(())
}

/// Execute a single render job.
async fn execute_render_job(job: &RenderJobSpec, save_metadata: bool, quiet: bool) -> Result<()> {
    let start_time = Utc::now();
    let render_start = std::time::Instant::now();
    let mut warnings: Vec<String> = Vec::new();

    // Validate job
    job.validate().map_err(|e| anyhow::anyhow!("[{}] {}", RenderPhase::Initialization, e))?;

    // Load script
    let script_content = {
        let mut script_file = File::open(&job.script_path)
            .map_err(|e| anyhow::anyhow!("[{}] Failed to open script {:?}: {}", RenderPhase::ScriptLoading, job.script_path, e))?;
        let mut content = String::new();
        script_file.read_to_string(&mut content)
            .map_err(|e| anyhow::anyhow!("[{}] Failed to read script: {}", RenderPhase::ScriptLoading, e))?;
        content
    };

    // Load input signal
    let signal = {
        let mut file = File::open(&job.input_path)
            .map_err(|e| anyhow::anyhow!("[{}] Failed to open input {:?}: {}", RenderPhase::InputLoading, job.input_path, e))?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| anyhow::anyhow!("[{}] Failed to read input: {}", RenderPhase::InputLoading, e))?;

        let samples: Vec<f32> = serde_json::from_str(&contents)
            .or_else(|_| {
                contents
                    .split_whitespace()
                    .map(|s| s.parse::<f32>())
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|_| {
                anyhow::anyhow!(
                    "[{}] Failed to parse input file as JSON list of floats or whitespace separated floats",
                    RenderPhase::InputLoading
                )
            })?;

        InputSignal::new(samples, job.input_sample_rate)
    };

    // Calculate frame count
    let render_duration = job.duration.unwrap_or(signal.get_duration());
    let total_frames = (render_duration * job.fps).ceil() as usize;
    let dt = 1.0 / job.fps;

    // Create output directory
    std::fs::create_dir_all(&job.output_dir)
        .map_err(|e| anyhow::anyhow!("[{}] Failed to create output directory {:?}: {}", RenderPhase::Initialization, job.output_dir, e))?;

    // WGPU Init
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| anyhow::anyhow!("[{}] No GPU adapter found", RenderPhase::GpuSetup))?;

    let adapter_info = adapter.get_info();
    let gpu_adapter_str = format!("{} ({:?})", adapter_info.name, adapter_info.backend);

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default(), None)
        .await
        .map_err(|e| anyhow::anyhow!("[{}] Failed to create device: {}", RenderPhase::GpuSetup, e))?;

    let texture_desc = wgpu::TextureDescriptor {
        label: Some("Target Texture"),
        size: wgpu::Extent3d {
            width: job.width,
            height: job.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    };

    let texture = device.create_texture(&texture_desc);
    let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    // Buffer for reading back data
    let u32_size = std::mem::size_of::<u32>() as u32;
    let unpadded_bytes_per_row = u32_size * job.width;
    let align = 256;
    let padded_bytes_per_row_padding = (align - unpadded_bytes_per_row % align) % align;
    let padded_bytes_per_row = unpadded_bytes_per_row + padded_bytes_per_row_padding;

    let output_buffer_size = (padded_bytes_per_row * job.height) as wgpu::BufferAddress;
    let output_buffer_desc = wgpu::BufferDescriptor {
        label: Some("Output Buffer"),
        size: output_buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    };
    let output_buffer = device.create_buffer(&output_buffer_desc);

    // Create renderer and state
    let mut renderer = Renderer::new(device, queue, texture_desc.format, job.width, job.height);
    let mut state = VisualiserState::new();

    // Set global seed for deterministic particle systems
    if job.seed != 0 {
        state.set_global_seed(job.seed);
    }

    // Load script
    if !state.load_script(&script_content) {
        let error_msg = state
            .get_script_error()
            .unwrap_or("Unknown script error")
            .to_string();
        return Err(anyhow::anyhow!("[{}] {}", RenderPhase::ScriptLoading, error_msg));
    }

    if !quiet {
        println!("Rendering {} frames at {}x{} @ {} fps...", total_frames, job.width, job.height, job.fps);
        if job.seed != 0 {
            println!("  Seed: {}", job.seed);
        }
        println!("  Output: {:?}", job.output_dir);
    }

    // Render frames
    for i in 0..total_frames {
        let empty_signals: SignalMap = HashMap::new();
        let empty_band_signals: BandSignalMap = HashMap::new();
        let empty_custom_signals: SignalMap = HashMap::new();
        let signal_rc: SharedSignal = std::rc::Rc::new(signal.clone());
        state.update(dt, Some(&signal_rc), None, &empty_signals, &empty_band_signals, &empty_custom_signals, None);

        // Render to texture
        renderer.render(&texture_view, &state);

        // Copy texture to buffer
        let mut encoder = renderer
            .device()
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &output_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(job.height),
                },
            },
            texture_desc.size,
        );

        renderer.queue().submit(Some(encoder.finish()));

        // Map buffer and save
        let buffer_slice = output_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |v| tx.send(v).unwrap());
        renderer.device().poll(wgpu::Maintain::Wait);
        rx.recv()
            .unwrap()
            .map_err(|e| anyhow::anyhow!("[{}] Buffer mapping failed: {:?}", RenderPhase::FrameSave, e))?;

        let data = buffer_slice.get_mapped_range();

        // Unpad data
        let mut unpadded_data = Vec::with_capacity((job.width * job.height * 4) as usize);
        for row in 0..job.height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + (job.width * 4) as usize;
            unpadded_data.extend_from_slice(&data[start..end]);
        }

        // Save frame
        let frame_path = job.output_dir.join(format!("frame_{:05}.png", i));
        image::save_buffer(
            &frame_path,
            &unpadded_data,
            job.width,
            job.height,
            image::ColorType::Rgba8,
        )
        .map_err(|e| anyhow::anyhow!("[{}] Failed to save frame {}: {}", RenderPhase::FrameSave, i, e))?;

        drop(data);
        output_buffer.unmap();

        // Progress reporting
        if !quiet && i % 60 == 0 {
            let elapsed = render_start.elapsed().as_secs_f64();
            let fps_actual = (i + 1) as f64 / elapsed;
            let eta = if i > 0 {
                (total_frames - i) as f64 / fps_actual
            } else {
                0.0
            };
            print!(
                "\r  Frame {}/{} ({:.1}%) - {:.1} fps - ETA: {:.0}s  ",
                i + 1,
                total_frames,
                (i + 1) as f64 / total_frames as f64 * 100.0,
                fps_actual,
                eta
            );
            use std::io::Write;
            std::io::stdout().flush()?;
        }
    }

    let render_duration_secs = render_start.elapsed().as_secs_f64();

    if !quiet {
        println!("\r  Completed {} frames in {:.1}s ({:.1} fps average)        ",
            total_frames,
            render_duration_secs,
            total_frames as f64 / render_duration_secs
        );
    }

    // Video encoding
    let video_path = if job.output_video {
        let video_out = job.effective_video_path();

        match check_ffmpeg() {
            FfmpegStatus::Available(version) => {
                if !quiet {
                    println!("Encoding video with {}...", version.split('\n').next().unwrap_or("FFmpeg"));
                }
                match encode_video_with_ffmpeg(&job.output_dir, &video_out, job.fps) {
                    Ok(()) => {
                        if !quiet {
                            println!("  Video saved to {:?}", video_out);
                        }
                        Some(video_out)
                    }
                    Err(e) => {
                        let warning = format!("Video encoding failed: {}", e);
                        if !quiet {
                            eprintln!("  Warning: {}", warning);
                        }
                        warnings.push(warning);
                        None
                    }
                }
            }
            FfmpegStatus::NotFound => {
                let warning = "FFmpeg not found. Video encoding skipped. Install FFmpeg to enable video output.".to_string();
                if !quiet {
                    eprintln!("  Warning: {}", warning);
                }
                warnings.push(warning);
                None
            }
            FfmpegStatus::Unknown => {
                if !quiet {
                    println!("Encoding video...");
                }
                match encode_video_with_ffmpeg(&job.output_dir, &video_out, job.fps) {
                    Ok(()) => {
                        if !quiet {
                            println!("  Video saved to {:?}", video_out);
                        }
                        Some(video_out)
                    }
                    Err(e) => {
                        let warning = format!("Video encoding failed: {}", e);
                        if !quiet {
                            eprintln!("  Warning: {}", warning);
                        }
                        warnings.push(warning);
                        None
                    }
                }
            }
        }
    } else {
        None
    };

    // Save metadata
    if save_metadata {
        let end_time = Utc::now();

        let script_hash = RenderMetadata::hash_file(&job.script_path)
            .unwrap_or_else(|_| "unknown".to_string());
        let input_hash = RenderMetadata::hash_file(&job.input_path)
            .unwrap_or_else(|_| "unknown".to_string());

        let metadata = RenderMetadata {
            job: job.clone(),
            started_at: start_time,
            completed_at: end_time,
            render_duration_secs,
            frame_count: total_frames,
            average_render_fps: total_frames as f64 / render_duration_secs,
            script_hash,
            input_hash,
            octoseq_version: env!("CARGO_PKG_VERSION").to_string(),
            gpu_adapter: gpu_adapter_str,
            video_path,
            warnings,
        };

        let metadata_path = job.output_dir.join("metadata.json");
        metadata
            .save(&metadata_path)
            .map_err(|e| anyhow::anyhow!("[{}] {}", RenderPhase::MetadataSave, e))?;

        if !quiet {
            println!("  Metadata saved to {:?}", metadata_path);
        }
    }

    if !quiet {
        println!("Done.");
    }

    Ok(())
}

/// Run a batch of render jobs from a config file.
async fn run_batch(
    config_path: &PathBuf,
    out_override: Option<PathBuf>,
    continue_on_error: bool,
    quiet: bool,
) -> Result<()> {
    let mut batch = BatchJobSpec::from_file(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load batch config: {}", e))?;

    // Override output base if specified
    if let Some(out) = out_override {
        batch.output_base = out;
    }

    // Validate batch
    batch
        .validate()
        .map_err(|e| anyhow::anyhow!("Batch validation failed: {}", e))?;

    // Generate output paths
    batch.generate_output_paths();

    if !quiet {
        println!("Batch: {} ({} jobs)", batch.batch_id, batch.jobs.len());
    }

    let mut completed = 0;
    let mut failed = 0;
    let total = batch.jobs.len();

    for (i, job) in batch.jobs.iter().enumerate() {
        let preset_name = job.preset_name.as_deref().unwrap_or("default");

        if !quiet {
            println!("\n[{}/{}] Rendering preset: {}", i + 1, total, preset_name);
        }

        match execute_render_job(job, true, quiet).await {
            Ok(()) => {
                completed += 1;
            }
            Err(e) => {
                failed += 1;
                eprintln!("Error rendering {}: {}", preset_name, e);
                if !continue_on_error {
                    return Err(anyhow::anyhow!(
                        "Batch aborted after {} of {} jobs ({} failed)",
                        i + 1,
                        total,
                        failed
                    ));
                }
            }
        }
    }

    if !quiet {
        println!("\nBatch complete: {} succeeded, {} failed", completed, failed);
    }

    if failed > 0 && !continue_on_error {
        return Err(anyhow::anyhow!("{} jobs failed", failed));
    }

    Ok(())
}

/// Validate a job or batch config file without rendering.
fn validate_config(config_path: &PathBuf) -> Result<()> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to read config file: {}", e))?;

    // Try parsing as batch first
    if let Ok(batch) = serde_json::from_str::<BatchJobSpec>(&content) {
        println!("Detected: Batch config");
        println!("  Batch ID: {}", batch.batch_id);
        println!("  Jobs: {}", batch.jobs.len());
        println!("  Parallel: {}", batch.parallel);

        batch
            .validate()
            .map_err(|e| anyhow::anyhow!("Validation failed: {}", e))?;

        println!("  Status: Valid");
        return Ok(());
    }

    // Try parsing as single job
    if let Ok(job) = serde_json::from_str::<RenderJobSpec>(&content) {
        println!("Detected: Single job config");
        println!("  Input: {:?}", job.input_path);
        println!("  Script: {:?}", job.script_path);
        println!("  Resolution: {}x{}", job.width, job.height);
        println!("  FPS: {}", job.fps);

        job.validate()
            .map_err(|e| anyhow::anyhow!("Validation failed: {}", e))?;

        println!("  Status: Valid");
        return Ok(());
    }

    Err(anyhow::anyhow!(
        "Config file is neither a valid batch config nor a valid job config"
    ))
}
