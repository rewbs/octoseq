use anyhow::Result;
use clap::{Parser, Subcommand};
use crate::gpu::renderer::Renderer;
use crate::visualiser::VisualiserState;
use crate::input::InputSignal;
use wgpu::util::DeviceExt;
use std::path::PathBuf;
use std::io::Read;
use std::fs::File;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Render frames to disk
    Render {
        /// Input JSON file (array of floats) based input signal
        #[arg(long)]
        input: PathBuf,

        /// Output directory for frames
        #[arg(long)]
        out: PathBuf,

        /// Frames per second
        #[arg(long, default_value_t = 60.0)]
        fps: f32,

        /// Duration in seconds (overrides input duration if shorter)
        #[arg(long)]
        duration: Option<f32>,

        /// Output width
        #[arg(long, default_value_t = 800)]
        width: u32,

        /// Output height
        #[arg(long, default_value_t = 600)]
        height: u32,
    },
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Render { input, out, fps, duration, width, height } => {
            pollster::block_on(render_offline(input, out, fps, duration, width, height))?;
        }
    }
    Ok(())
}

async fn render_offline(input_path: PathBuf, out_dir: PathBuf, fps: f32, duration_limit: Option<f32>, width: u32, height: u32) -> Result<()> {
    // Deserialize input
    let mut file = File::open(input_path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    // Assuming simple JSON array of floats for v0
    // If not JSON, we might need a parser usage. Plan said "data.json".
    // Let's assume input is [float, float, ...] for now.
    // If fails, maybe it's raw bytes?
    // Requirement said: Consumes a stream of 1D float values.
    // Let's try serde_json.
    let samples: Vec<f32> = serde_json::from_str(&contents)
        .or_else(|_| {
             // Fallback: space separated?
             contents.split_whitespace().map(|s| s.parse::<f32>()).collect::<Result<Vec<_>, _>>()
        })
        .map_err(|_| anyhow::anyhow!("Failed to parse input file as JSON list of floats or whitespace separated floats"))?;

    // Assume input sample rate is same as FPS for simplicity if not specified?
    // Or assume standard audio feature rate (e.g. 100Hz)?
    // The InputSignal needs sample_rate.
    // Let's assume the input *is* the data sampled at the render FPS for the proof of concept,
    // OR we assume a separate rate.
    // The requirement says "resampling to visual frame rate".
    // I'll assume 100Hz default for features if metadata not present.
    let signal = InputSignal::new(samples, 100.0);

    let render_duration = duration_limit.unwrap_or(signal.duration);
    let total_frames = (render_duration * fps).ceil() as usize;
    let dt = 1.0 / fps;

    std::fs::create_dir_all(&out_dir)?;

    // WGPU Init
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None, // Headless
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| anyhow::anyhow!("No adapter found"))?;

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default(), None)
        .await?;

    let texture_desc = wgpu::TextureDescriptor {
        label: Some("Target Texture"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
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
    let unpadded_bytes_per_row = u32_size * width;
    let align = 256;
    let padded_bytes_per_row_padding = (align - unpadded_bytes_per_row % align) % align;
    let padded_bytes_per_row = unpadded_bytes_per_row + padded_bytes_per_row_padding;

    let output_buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;
    let output_buffer_desc = wgpu::BufferDescriptor {
        label: Some("Output Buffer"),
        size: output_buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    };
    let output_buffer = device.create_buffer(&output_buffer_desc);

    // Move device/queue to Renderer
    let mut renderer = Renderer::new(device, queue, texture_desc.format, width, height);
    let mut state = VisualiserState::new();

    println!("Rendering {} frames to {:?}...", total_frames, out_dir);

    for i in 0..total_frames {
        state.update(dt, Some(&signal), None);

        // Render to texture
        renderer.render(&texture_view, &state);

        // Copy texture to buffer
        let mut encoder = renderer.device().create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

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
                    rows_per_image: Some(height),
                },
            },
            texture_desc.size,
        );

        // We need to poll on device, so we need access to it.
        // renderer.queue().submit(...)
        renderer.queue().submit(Some(encoder.finish()));

        // Map buffer and save
        let buffer_slice = output_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |v| tx.send(v).unwrap());
        renderer.device().poll(wgpu::Maintain::Wait);
        rx.recv().unwrap().unwrap();

        let data = buffer_slice.get_mapped_range();

        // Unpad data
        // We can just iterate rows.
        let mut unpadded_data = Vec::with_capacity((width * height * 4) as usize);
        for i in 0..height {
            let start = (i * padded_bytes_per_row) as usize;
            let end = start + (width * 4) as usize;
            unpadded_data.extend_from_slice(&data[start..end]);
        }

        // Save frame
        let frame_path = out_dir.join(format!("frame_{:05}.png", i));
        image::save_buffer(
            &frame_path,
            &unpadded_data,
            width,
            height,
            image::ColorType::Rgba8,
        )?;

        drop(data);
        output_buffer.unmap();

        if i % 60 == 0 {
            print!(".");
            use std::io::Write;
            std::io::stdout().flush()?;
        }
    }
    println!("\nDone.");

    Ok(())
}
