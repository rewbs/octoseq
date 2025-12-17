use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wasm_bindgen::closure::Closure;

use crate::gpu::renderer::Renderer;
use crate::visualiser::VisualiserState;
use crate::input::InputSignal;

fn window() -> web_sys::Window {
    web_sys::window().expect("no global `window` exists")
}

fn request_animation_frame(f: &Closure<dyn FnMut(f64)>) {
    window()
        .request_animation_frame(f.as_ref().unchecked_ref())
        .expect("should register `requestAnimationFrame` OK");
}

#[wasm_bindgen]
pub struct WasmVisualiser {
    inner: Rc<RefCell<VisualiserContext>>,
}

struct VisualiserContext {
    renderer: Renderer,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    state: VisualiserState,
    rotation_signal: Option<InputSignal>,
    zoom_signal: Option<InputSignal>,
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

#[wasm_bindgen]
impl WasmVisualiser {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        panic!("Use create_visualiser async constructor");
    }

    pub fn push_rotation_data(&self, samples: &[f32], sample_rate: f32) {
        log::info!("Rust received rotation data: {} samples, rate {}", samples.len(), sample_rate);
        let mut inner = self.inner.borrow_mut();
        inner.rotation_signal = Some(InputSignal::new(samples.to_vec(), sample_rate));
    }

    pub fn push_zoom_data(&self, samples: &[f32], sample_rate: f32) {
        log::info!("Rust received zoom data: {} samples, rate {}", samples.len(), sample_rate);
        let mut inner = self.inner.borrow_mut();
        inner.zoom_signal = Some(InputSignal::new(samples.to_vec(), sample_rate));
    }

    // Legacy support (optional, can remove if we update TS)
    pub fn push_data(&self, samples: &[f32], sample_rate: f32) {
         self.push_rotation_data(samples, sample_rate);
    }

    pub fn set_sigmoid_k(&self, k: f32) {
        let mut inner = self.inner.borrow_mut();
        inner.state.config.sigmoid_k = k;
    }

    pub fn resize(&self, width: u32, height: u32) {
        if width == 0 || height == 0 { return; }

        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        // We need mutable access to renderer but immutable to state?
        // state is in `inner`. `ctx` has both.
        // ctx.renderer.resize needs `&mut renderer`.
        // and checks `&state`.
        // `ctx` is `&mut VisualiserContext`.
        // We can split borrow:
        // let state = &ctx.state;
        // ctx.renderer.resize(..., state);

        ctx.renderer.resize(width, height, &ctx.state);
        ctx.config.width = width;
        ctx.config.height = height;

        ctx.surface.configure(ctx.renderer.device(), &ctx.config);
    }

    pub fn set_time(&self, time: f32) {
        let mut inner = self.inner.borrow_mut();
        inner.state.set_time(time);
    }

    pub fn get_current_vals(&self) -> Vec<f32> {
        let inner = self.inner.borrow();
        vec![
            inner.state.rotation,
            inner.state.zoom,
            inner.state.time,
            inner.state.last_rot_input,
            // Debug signal info if present
            if let Some(s) = &inner.rotation_signal { s.get_duration() } else { -1.0 }
        ]
    }

    pub fn render(&self, dt: f32) {
        let mut inner = self.inner.borrow_mut();
        let ctx = &mut *inner;

        // Update state
        ctx.state.update(
            dt,
            ctx.rotation_signal.as_ref(),
            ctx.zoom_signal.as_ref()
        );

        // Render
        match ctx.surface.get_current_texture() {
            Ok(output) => {
                let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());

                // We need to split borrow here as well?
                // ctx.renderer.render(&view, &ctx.state);
                // The issue here is ctx.renderer needs mut, ctx.state needs ref.
                // Since `ctx` is `&mut VisualiserContext`, the compiler can split the borrow.
                // But previously `ctx` was `RefMut<VisualiserContext>`, which cannot split.
                // Dereferencing to `&mut *inner` above solved it.

                ctx.renderer.render(&view, &ctx.state);

                output.present();
            },
            Err(wgpu::SurfaceError::Lost) => {
                ctx.renderer.resize(ctx.config.width, ctx.config.height, &ctx.state);
                ctx.surface.configure(ctx.renderer.device(), &ctx.config);
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                 // log
            }
            Err(_e) => {
                // log
            }
        }
    }
}

// Global hook for logging
#[wasm_bindgen]
pub async fn create_visualiser(canvas: HtmlCanvasElement) -> Result<WasmVisualiser, JsValue> {
    init_panic_hook();

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        dx12_shader_compiler: Default::default(),
        flags: wgpu::InstanceFlags::default(),
        gles_minor_version: wgpu::Gles3MinorVersion::Automatic,
    });

    // Error 1: create_surface using generic WindowHandle approach + traits
    // wgpu 0.17+ requires a target. For Web, Instance::create_surface_from_canvas or wgpu::SurfaceTarget::Canvas
    // wgpu v22/23: create_surface(target).
    // We need to pass the canvas into something that implements Into<SurfaceTarget>.
    // SurfaceTarget has a Canvas variant.
    let target = wgpu::SurfaceTarget::Canvas(canvas.clone());
    let surface = instance.create_surface(target)
        .map_err(|e| JsValue::from_str(&format!("Failed to create surface: {}", e)))?;

    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::None, // No 'Default'
        compatible_surface: Some(&surface),
        force_fallback_adapter: false,
    }).await.ok_or_else(|| JsValue::from_str("Failed to find an appropriate adapter"))?;

    let (device, queue) = adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: None,
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
            memory_hints: Default::default(), // Missing field
        },
        None,
    ).await.map_err(|e| JsValue::from_str(&format!("Failed to create device: {}", e)))?;

    // Error 2: type inference for format
    let surface_caps = surface.get_capabilities(&adapter);
    let surface_format = surface_caps.formats.iter()
        .copied()
        .find(|f: &wgpu::TextureFormat| f.is_srgb())
        .unwrap_or(surface_caps.formats[0]);

    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: surface_format,
        width: canvas.width(),
        height: canvas.height(),
        present_mode: surface_caps.present_modes[0],
        alpha_mode: surface_caps.alpha_modes[0],
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    surface.configure(&device, &config);

    let renderer = Renderer::new(
        device,
        queue,
        config.format,
        config.width,
        config.height
    );

    let state = VisualiserState::new();

    Ok(WasmVisualiser {
        inner: Rc::new(RefCell::new(VisualiserContext {
            renderer,
            surface,
            config,
            state,
            rotation_signal: None,
            zoom_signal: None,
        })),
    })
}
