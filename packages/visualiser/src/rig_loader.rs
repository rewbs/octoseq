//! Declarative `scene_rig.v1` / `scene_rig.v2` loader, security validator,
//! and stateless O(1)-seekable musical role -> uniform mapper.
//!
//! Matches Lactoseq's `Scene3DRigConfig` and `PMAUDIO4` uniform contract so
//! `.rig.json` + sanitized `.glb` assets execute identically across native
//! headless `wgpu` and WebGPU/WASM.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

use crate::event_stream::EventStream;
use crate::glb_loader::GlbAsset;
use crate::input::{BandSignalMap, SignalMap};
use crate::musical_time::MusicalTimeStructure;

pub const MAX_RIG_INSTANCES: u32 = 50_000;
pub const MIN_CAMERA_FOV_DEG: f32 = 20.0;
pub const MAX_CAMERA_FOV_DEG: f32 = 110.0;

/// Forbidden JSON keys anywhere in a `.rig.json` document (zero untrusted code/shader injection).
const FORBIDDEN_KEYS: &[&str] = &[
    "glsl", "wgsl", "script", "rhai", "code", "shader", "eval", "lua", "js", "python", "wasm",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RigSchemaVersion {
    #[serde(rename = "scene_rig.v1")]
    V1,
    #[serde(rename = "scene_rig.v2")]
    V2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RigTemplate {
    #[default]
    InstancedMegastructure,
    KineticStageStateful,
    HybridMonolithStage,
    VolumetricConcertStage,
    CyberWireframeTunnel,
    GlbStage,
    SacredPolyhedraCathedral,
    OrbitalPrismArray,
}

impl RigTemplate {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InstancedMegastructure => "instanced_megastructure",
            Self::KineticStageStateful => "kinetic_stage_stateful",
            Self::HybridMonolithStage => "hybrid_monolith_stage",
            Self::VolumetricConcertStage => "volumetric_concert_stage",
            Self::CyberWireframeTunnel => "cyber_wireframe_tunnel",
            Self::GlbStage => "glb_stage",
            Self::SacredPolyhedraCathedral => "sacred_polyhedra_cathedral",
            Self::OrbitalPrismArray => "orbital_prism_array",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RigMaterialStyle {
    #[default]
    StylizedPbr,
    ToonCel,
    FlatUnlit,
    WireframeNeon,
    MilkdropProjected,
}

impl RigMaterialStyle {
    pub fn code(&self) -> u32 {
        match self {
            Self::StylizedPbr => 0,
            Self::ToonCel => 1,
            Self::FlatUnlit => 2,
            Self::WireframeNeon => 3,
            Self::MilkdropProjected => 4,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "stylized_pbr" => Some(Self::StylizedPbr),
            "toon_cel" => Some(Self::ToonCel),
            "flat_unlit" => Some(Self::FlatUnlit),
            "wireframe_neon" => Some(Self::WireframeNeon),
            "milkdrop_projected" => Some(Self::MilkdropProjected),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RigSimulationMode {
    #[default]
    Stateless,
    Stateful,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RigOutputMode {
    #[default]
    Beauty,
    Depth,
    Normal,
    Wireframe,
    Flat,
    Motion,
    QuadConditioning,
}

impl RigOutputMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "beauty" => Some(Self::Beauty),
            "depth" => Some(Self::Depth),
            "normal" => Some(Self::Normal),
            "wireframe" => Some(Self::Wireframe),
            "flat" => Some(Self::Flat),
            "motion" => Some(Self::Motion),
            "quad_conditioning" => Some(Self::QuadConditioning),
            _ => None,
        }
    }

    pub fn needs_mrt(&self) -> bool {
        !matches!(self, Self::Beauty)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigGeometryConfig {
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub primitive: String,
    #[serde(default = "default_instance_count")]
    pub instance_count: u32,
    #[serde(default)]
    pub glb_asset_ref: String,
}

fn default_source() -> String {
    "procedural".to_string()
}

fn default_instance_count() -> u32 {
    1024
}

impl Default for RigGeometryConfig {
    fn default() -> Self {
        Self {
            source: default_source(),
            primitive: String::new(),
            instance_count: default_instance_count(),
            glb_asset_ref: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigCameraConfig {
    #[serde(default)]
    pub rig: String,
    #[serde(default = "default_fov")]
    pub fov_deg: f32,
    #[serde(default = "default_near")]
    pub near: f32,
    #[serde(default = "default_far")]
    pub far: f32,
    #[serde(default = "default_orbit_speed")]
    pub orbit_speed: f32,
    #[serde(default = "default_cut_every_bars")]
    pub cut_every_bars: u32,
}

fn default_fov() -> f32 {
    56.0
}
fn default_near() -> f32 {
    0.25
}
fn default_far() -> f32 {
    120.0
}
fn default_orbit_speed() -> f32 {
    0.28
}
fn default_cut_every_bars() -> u32 {
    4
}

impl Default for RigCameraConfig {
    fn default() -> Self {
        Self {
            rig: String::new(),
            fov_deg: default_fov(),
            near: default_near(),
            far: default_far(),
            orbit_speed: default_orbit_speed(),
            cut_every_bars: default_cut_every_bars(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigPalette {
    #[serde(default = "default_bg_rgb")]
    pub bg_rgb: [f32; 3],
    #[serde(default = "default_drums_rgb")]
    pub drums_rgb: [f32; 3],
    #[serde(default = "default_bass_rgb")]
    pub bass_rgb: [f32; 3],
    #[serde(default = "default_vocals_rgb")]
    pub vocals_rgb: [f32; 3],
    #[serde(default = "default_other_rgb")]
    pub other_rgb: [f32; 3],
}

fn default_bg_rgb() -> [f32; 3] {
    [0.025, 0.035, 0.075]
}
fn default_drums_rgb() -> [f32; 3] {
    [1.0, 0.16, 0.52]
}
fn default_bass_rgb() -> [f32; 3] {
    [1.0, 0.62, 0.10]
}
fn default_vocals_rgb() -> [f32; 3] {
    [0.09, 0.88, 1.0]
}
fn default_other_rgb() -> [f32; 3] {
    [0.54, 0.31, 1.0]
}

impl Default for RigPalette {
    fn default() -> Self {
        Self {
            bg_rgb: default_bg_rgb(),
            drums_rgb: default_drums_rgb(),
            bass_rgb: default_bass_rgb(),
            vocals_rgb: default_vocals_rgb(),
            other_rgb: default_other_rgb(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigReactivity {
    #[serde(default = "default_one")]
    pub kick_punch: f32,
    #[serde(default = "default_one")]
    pub fill_turbulence: f32,
    #[serde(default = "default_one")]
    pub stem_spotlight: f32,
    #[serde(default = "default_one")]
    pub bar_wave_amp: f32,
    #[serde(default = "default_wireframe_glow")]
    pub wireframe_glow: f32,
    // scene_rig.v2 additions (default 1.0 for v1 compatibility)
    #[serde(default = "default_one")]
    pub hit_gather_gain: f32,
    #[serde(default = "default_one")]
    pub staying_step_gain: f32,
    #[serde(default = "default_one")]
    pub tonal_shift_gain: f32,
}

fn default_one() -> f32 {
    1.0
}
fn default_wireframe_glow() -> f32 {
    0.35
}

impl Default for RigReactivity {
    fn default() -> Self {
        Self {
            kick_punch: 1.0,
            fill_turbulence: 1.0,
            stem_spotlight: 1.0,
            bar_wave_amp: 1.0,
            wireframe_glow: default_wireframe_glow(),
            hit_gather_gain: 1.0,
            staying_step_gain: 1.0,
            tonal_shift_gain: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigConditioning {
    #[serde(default)]
    pub mrt_enabled: bool,
    #[serde(default = "default_depth_near")]
    pub depth_near: f32,
    #[serde(default = "default_depth_far")]
    pub depth_far: f32,
    #[serde(default = "default_wireframe_thickness")]
    pub wireframe_thickness: f32,
}

fn default_depth_near() -> f32 {
    0.5
}
fn default_depth_far() -> f32 {
    65.0
}
fn default_wireframe_thickness() -> f32 {
    1.25
}

impl Default for RigConditioning {
    fn default() -> Self {
        Self {
            mrt_enabled: false,
            depth_near: default_depth_near(),
            depth_far: default_depth_far(),
            wireframe_thickness: default_wireframe_thickness(),
        }
    }
}

/// Complete declarative 3D rig configuration parsed from `scene_rig.v1` / `scene_rig.v2`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRigConfig {
    pub schema_version: RigSchemaVersion,
    pub rig_id: String,
    #[serde(default)]
    pub simulation_mode: RigSimulationMode,
    #[serde(default = "default_sim_step_hz")]
    pub sim_step_hz: u32,
    pub template: RigTemplate,
    #[serde(default)]
    pub material_style: RigMaterialStyle,
    #[serde(default)]
    pub geometry: RigGeometryConfig,
    #[serde(default)]
    pub camera: RigCameraConfig,
    #[serde(default)]
    pub palette: RigPalette,
    #[serde(default)]
    pub reactivity: RigReactivity,
    #[serde(default)]
    pub conditioning: RigConditioning,
    /// Runtime output mode (defaults to Beauty; MRT conditioning is opt-in so beauty pays zero extra bandwidth).
    #[serde(default)]
    pub output_mode: RigOutputMode,
    /// Explicit runtime gate for allocating/writing the 5 conditioning MRT targets.
    /// Defaults to false even if the JSON specifies `conditioning.mrt_enabled: true`,
    /// and is automatically enabled when `output_mode != Beauty` or explicitly requested.
    #[serde(skip)]
    pub render_mrt: bool,
}

fn default_sim_step_hz() -> u32 {
    60
}

impl SceneRigConfig {
    /// Whether the renderer should allocate and render into the 5 extra conditioning MRT attachments.
    pub fn mrt_active(&self) -> bool {
        self.render_mrt || self.output_mode.needs_mrt()
    }
}

/// Recursively scan a parsed JSON tree for forbidden script/shader keys (case-insensitive).
fn check_forbidden_keys(val: &Value, path: &str) -> Result<(), String> {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                let lower = k.to_ascii_lowercase();
                if FORBIDDEN_KEYS.iter().any(|&fk| lower == fk) {
                    return Err(format!(
                        "Security violation: forbidden code/shader key '{}' at '{}'",
                        k, path
                    ));
                }
                let child = if path.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", path, k)
                };
                check_forbidden_keys(v, &child)?;
            }
        }
        Value::Array(arr) => {
            for (i, item) in arr.iter().enumerate() {
                check_forbidden_keys(item, &format!("{}[{}]", path, i))?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Validate a relative `glb_asset_ref` string against path traversal and external URLs.
pub fn validate_glb_asset_ref(glb_ref: &str) -> Result<(), String> {
    if glb_ref.is_empty() {
        return Ok(());
    }
    // Reject path traversal, absolute Unix/Windows paths, drive letters, UNC paths, and URI schemes.
    let bytes = glb_ref.as_bytes();
    let has_drive_prefix = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    if glb_ref.contains("..")
        || glb_ref.starts_with('/')
        || glb_ref.starts_with('\\')
        || glb_ref.contains("://")
        || glb_ref.starts_with("data:")
        || glb_ref.starts_with("file:")
        || has_drive_prefix
    {
        return Err(format!(
            "Security violation: unsafe glb_asset_ref '{}' (must be a clean relative path)",
            glb_ref
        ));
    }
    Ok(())
}

/// Parse and strictly validate a declarative `.rig.json` document.
pub fn parse_and_validate_rig_json(json_str: &str) -> Result<SceneRigConfig, String> {
    let raw_val: Value =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid rig JSON: {}", e))?;

    if !raw_val.is_object() {
        return Err("Rig JSON root must be an object".to_string());
    }

    // 1. Reject any forbidden code/shader keys anywhere in the JSON tree.
    check_forbidden_keys(&raw_val, "")?;

    // 2. Deserialize typed schema.
    let mut cfg: SceneRigConfig =
        serde_json::from_value(raw_val).map_err(|e| format!("Invalid scene_rig schema: {}", e))?;

    // 3. Validate bounds & security invariants.
    if cfg.rig_id.trim().is_empty() {
        return Err("rig_id must be a non-empty string".to_string());
    }
    if cfg.geometry.instance_count == 0 || cfg.geometry.instance_count > MAX_RIG_INSTANCES {
        return Err(format!(
            "geometry.instance_count ({}) out of bounds [1..={}]",
            cfg.geometry.instance_count, MAX_RIG_INSTANCES
        ));
    }
    validate_glb_asset_ref(&cfg.geometry.glb_asset_ref)?;

    if !(MIN_CAMERA_FOV_DEG..=MAX_CAMERA_FOV_DEG).contains(&cfg.camera.fov_deg)
        || !cfg.camera.fov_deg.is_finite()
    {
        return Err(format!(
            "camera.fov_deg ({}) out of bounds [{}..={}]",
            cfg.camera.fov_deg, MIN_CAMERA_FOV_DEG, MAX_CAMERA_FOV_DEG
        ));
    }

    // Normalize safe numeric ranges matching Lactoseq Scene3DRigConfig::LoadFromJsonFile
    cfg.sim_step_hz = cfg.sim_step_hz.clamp(30, 120);
    cfg.camera.near = cfg.camera.near.max(0.05);
    cfg.camera.far = cfg.camera.far.max(cfg.camera.near + 5.0);
    cfg.camera.cut_every_bars = cfg.camera.cut_every_bars.clamp(1, 32);
    cfg.conditioning.depth_near = cfg.conditioning.depth_near.max(0.05);
    cfg.conditioning.depth_far = cfg
        .conditioning
        .depth_far
        .max(cfg.conditioning.depth_near + 1.0);
    cfg.conditioning.wireframe_thickness = cfg.conditioning.wireframe_thickness.clamp(0.25, 4.0);
    // Keep MRT gated off by default unless output_mode requires it or caller opts in.
    cfg.render_mrt = cfg.output_mode.needs_mrt();

    Ok(cfg)
}

/// Load and validate a `.rig.json` file from disk (native only).
#[cfg(not(target_arch = "wasm32"))]
pub fn load_rig_file(path: &std::path::Path) -> Result<SceneRigConfig, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read rig file {:?}: {}", path, e))?;
    parse_and_validate_rig_json(&content)
}

/// Uniform block matching Lactoseq's `PMAUDIO4` / `Scene3DPass` musical uniforms.
#[derive(Debug, Clone, Copy, Default)]
pub struct RigMusicalUniforms {
    /// [beatPos, beatPhase, barPhase, sectionProg]
    pub musical0: [f32; 4],
    /// [kick, snare, hat, downbeatAccent]
    pub musical1: [f32; 4],
    /// [drumDensity, drumFill, drumSyncopation, leadStemId]
    pub musical2: [f32; 4],
    /// [leadEnergy, leadOnset, stemEnter, stemExit]
    pub musical3: [f32; 4],
    /// [wDrums, wBass, wVocals, wOther] (sums to 1.0)
    pub stem_weights: [f32; 4],
    /// [hitEnv, hitCount, hitGather, sectionIntensity]
    pub answer: [f32; 4],
    /// [brightness, harmonicChange, 0, 0]
    pub tonal: [f32; 4],
    /// [hitGatherGain, stayingStepGain, tonalShiftGain, 0]
    pub v2_gains: [f32; 4],
    /// Whether real audio/role inputs were present (false -> deterministic synthetic fallback)
    pub has_audio: bool,
}

impl RigMusicalUniforms {
    /// Deterministic synthetic musical fallback matching `Scene3DPass::RenderFrame` when no bundle is loaded.
    pub fn synthetic(time_sec: f32, reactivity: &RigReactivity) -> Self {
        let pi = std::f32::consts::PI;
        let beat = time_sec * 2.0; // 120 BPM
        let bp = beat - beat.floor();
        let bar_p = (beat * 0.25) - (beat * 0.25).floor();
        let kick = (-bp * 8.0).exp();
        let snare = (-((bp + 0.5).rem_euclid(1.0)) * 10.0).exp();
        let hat = 0.5 + 0.5 * (beat * 4.0 * pi).sin();
        let downbeat = (-bar_p * 12.0).exp();
        let drum_fill = if bar_p > 0.82 {
            (bar_p - 0.82) / 0.18
        } else {
            0.0
        };
        let drum_sync = 0.25 * (0.5 + 0.5 * (beat * 3.0 * pi).sin());
        let lead_energy = 0.45 + 0.35 * kick;
        let w_drums = 0.35;
        let w_bass = 0.30;
        let w_vocals = 0.20 + 0.15 * (time_sec * 0.6).sin();
        let w_other = 0.15;
        let w_sum = (w_drums + w_bass + w_vocals + w_other).max(1e-5);
        let hit_gather = (-(1.0 - bp).powi(2) * 18.0).exp();
        let brightness = 0.5 + 0.25 * (beat * 0.5).sin();
        let harmonic_change = 0.2 * (-bar_p * 6.0).exp();

        Self {
            musical0: [beat, bp, bar_p, (time_sec / 30.0).rem_euclid(1.0)],
            musical1: [kick, snare, hat, downbeat],
            musical2: [1.0, drum_fill, drum_sync, 0.0],
            musical3: [lead_energy, kick, 0.0, 0.0],
            stem_weights: [
                w_drums / w_sum,
                w_bass / w_sum,
                w_vocals / w_sum,
                w_other / w_sum,
            ],
            answer: [kick, beat.floor(), hit_gather, 0.65],
            tonal: [brightness, harmonic_change, 0.0, 0.0],
            v2_gains: [
                reactivity.hit_gather_gain,
                reactivity.staying_step_gain,
                reactivity.tonal_shift_gain,
                0.0,
            ],
            has_audio: false,
        }
    }
}

/// Stateless O(log N) event envelope: quadratic_out attack-decay matching Lactoseq `synthesize_hit_envelopes`.
fn eval_event_hit_envelope(
    stream: &EventStream,
    time: f32,
    att_s: f32,
    dec_s: f32,
) -> (f32, f32, f32) {
    let events = &stream.events;
    if events.is_empty() {
        return (0.0, 0.0, 0.0);
    }

    // Cumulative count: number of blows with t_hit <= time + 1e-6
    let hit_count = events.partition_point(|e| e.time <= time + 1e-6) as f32;

    // Attack-decay with quadratic_out easing
    let start_idx = events.partition_point(|e| e.time < time - dec_s - 1e-4);
    let end_idx = events.partition_point(|e| e.time <= time + att_s + 1e-4);
    let mut hit_env = 0.0f32;
    for ev in &events[start_idx..end_idx] {
        let dt = time - ev.time;
        let local = if dt >= -att_s && dt < 0.0 {
            (dt + att_s) / att_s
        } else if dt >= 0.0 && dt <= dec_s {
            let u = 1.0 - (dt / dec_s);
            u * u
        } else {
            0.0
        };
        let w = ev.weight.clamp(0.2, 1.5);
        hit_env = hit_env.max(local * w);
    }

    (hit_env.clamp(0.0, 1.5), hit_count, 0.0)
}

/// Stateless O(log N) non-causal pre-hit Gaussian gather (`sigma = 0.5 beats`).
fn eval_hit_gather(stream: &EventStream, time: f32, sigma_s: f32) -> f32 {
    let events = &stream.events;
    if events.is_empty() {
        return 0.0;
    }
    let span = 3.0 * sigma_s;
    let start_idx = events.partition_point(|e| e.time < time - span);
    let end_idx = events.partition_point(|e| e.time <= time + span);
    let mut gather = 0.0f32;
    for ev in &events[start_idx..end_idx] {
        let z = (time - ev.time) / sigma_s;
        let g = (-0.5 * z * z).exp() * ev.weight.clamp(0.2, 1.0);
        gather = gather.max(g);
    }
    gather.clamp(0.0, 1.0)
}

/// Stateless O(log N) exponential impulse envelope for drum/section events.
fn eval_exp_impulse(stream: &EventStream, time: f32, tau_s: f32, max_val: f32) -> f32 {
    let events = &stream.events;
    if events.is_empty() {
        return 0.0;
    }
    let window = tau_s * 5.0;
    let start_idx = events.partition_point(|e| e.time < time - window);
    let end_idx = events.partition_point(|e| e.time <= time + 1e-6);
    let mut val = 0.0f32;
    for ev in &events[start_idx..end_idx] {
        let dt = (time - ev.time).max(0.0);
        let contrib = (-dt / tau_s).exp() * ev.weight.clamp(0.35, 1.5);
        val = val.max(contrib);
    }
    val.clamp(0.0, max_val)
}

/// Stateless O(log N) beat position & phase from a beat event stream.
fn eval_beat_from_stream(stream: &EventStream, time: f32) -> Option<(f32, f32, f32)> {
    let events = &stream.events;
    if events.len() < 2 {
        return None;
    }
    let idx = events.partition_point(|e| e.time <= time);
    let (pos, period) = if idx == 0 {
        let p = (events[1].time - events[0].time).max(0.1);
        let frac = (time - events[0].time) / p;
        (frac, p)
    } else if idx >= events.len() {
        let n = events.len();
        let p = (events[n - 1].time - events[n - 2].time).max(0.1);
        let frac = (time - events[n - 1].time) / p;
        ((n - 1) as f32 + frac, p)
    } else {
        let t0 = events[idx - 1].time;
        let t1 = events[idx].time;
        let p = (t1 - t0).max(0.1);
        let frac = ((time - t0) / p).clamp(0.0, 1.0);
        ((idx - 1) as f32 + frac, p)
    };
    let phase = pos.rem_euclid(1.0);
    let bpm = (60.0 / period).clamp(40.0, 240.0);
    Some((pos.max(0.0), phase, bpm))
}

/// Stateless O(log N) count of events in `[time - window, time]`.
fn count_events_in_window(stream: &EventStream, time: f32, window_s: f32) -> usize {
    let events = &stream.events;
    let a = events.partition_point(|e| e.time < time - window_s);
    let b = events.partition_point(|e| e.time <= time + 1e-6);
    b.saturating_sub(a)
}

fn sample_named(signals: &SignalMap, names: &[&str], time: f32, dt: f32) -> Option<f32> {
    for &name in names {
        if let Some(sig) = signals.get(name) {
            return Some(sig.sample_window(time, dt));
        }
    }
    None
}

fn sample_stem(stems: &BandSignalMap, label: &str, time: f32, dt: f32) -> Option<f32> {
    let lower = label.to_ascii_lowercase();
    let stem_id = format!("stem-{}", lower);
    for key in [label, lower.as_str(), stem_id.as_str()] {
        if let Some(features) = stems.get(key) {
            if let Some(sig) = features.get("energy").or_else(|| features.get("amplitude")) {
                return Some(sig.sample_window(time, dt));
            }
        }
    }
    None
}

/// Stateless O(1)-seekable evaluation of `RigMusicalUniforms` directly from Octoseq's
/// signals, stems, musical time, and event streams at exact timestamp `time`.
pub fn evaluate_rig_musical_uniforms(
    time: f32,
    dt: f32,
    bpm_fallback: f32,
    reactivity: &RigReactivity,
    named_signals: &SignalMap,
    band_signals: &BandSignalMap,
    stem_signals: &BandSignalMap,
    custom_signals: &SignalMap,
    musical_time: Option<&MusicalTimeStructure>,
    event_streams: &HashMap<String, EventStream>,
) -> RigMusicalUniforms {
    let has_any = !named_signals.is_empty()
        || !custom_signals.is_empty()
        || !stem_signals.is_empty()
        || !event_streams.is_empty()
        || musical_time.is_some();

    if !has_any {
        return RigMusicalUniforms::synthetic(time, reactivity);
    }

    let safe_dt = if dt > 1e-5 { dt } else { 1.0 / 60.0 };
    let fps = (1.0 / safe_dt).clamp(15.0, 240.0);

    // 1. Beat / bar / BPM
    let (beat_pos, beat_phase_from_stream, est_bpm) = event_streams
        .get("beat")
        .and_then(|s| eval_beat_from_stream(s, time))
        .unwrap_or_else(|| {
            if let Some(bp) = musical_time.and_then(|mt| mt.beat_position_at(time)) {
                (
                    bp.beat_position.max(0.0),
                    bp.beat_phase.rem_euclid(1.0),
                    bp.bpm.clamp(40.0, 240.0),
                )
            } else {
                let bpm = bpm_fallback.clamp(40.0, 240.0);
                let bp = (time * bpm / 60.0).max(0.0);
                (bp, bp.rem_euclid(1.0), bpm)
            }
        });

    let beat_phase = sample_named(custom_signals, &["beat_phase"], time, safe_dt)
        .unwrap_or(beat_phase_from_stream)
        .clamp(0.0, 1.0);

    let bar_phase = sample_named(custom_signals, &["bar_phase"], time, safe_dt)
        .or_else(|| {
            event_streams
                .get("downbeat")
                .and_then(|s| eval_beat_from_stream(s, time))
                .map(|(_, p, _)| p)
        })
        .unwrap_or_else(|| (beat_pos * 0.25).rem_euclid(1.0))
        .clamp(0.0, 1.0);

    let section_prog = sample_named(custom_signals, &["section_progress"], time, safe_dt)
        .unwrap_or_else(|| (time / 30.0).rem_euclid(1.0))
        .clamp(0.0, 1.0);

    let section_intensity = sample_named(custom_signals, &["section_intensity"], time, safe_dt)
        .unwrap_or(0.65)
        .clamp(0.0, 1.0);

    // 2. Unified `hit` role -> hitEnv, hitCount, hitGather (matches Lactoseq synthesize_hit_envelopes)
    let beat_s = 60.0 / est_bpm.clamp(40.0, 240.0);
    let att_s = (1.0 / fps).max(0.01 * beat_s);
    let dec_s = (2.0 / fps).max(0.40 * beat_s);
    let sigma_s = (0.50 * beat_s).max(0.05);

    let hit_stream = event_streams
        .get("hit")
        .or_else(|| event_streams.get("kick"))
        .or_else(|| event_streams.get("onset"))
        .or_else(|| event_streams.get("events"))
        .or_else(|| event_streams.get("onsetPeaks"));

    let (hit_env, hit_count, hit_gather) = if let Some(hs) = hit_stream {
        let (env, cnt, _) = eval_event_hit_envelope(hs, time, att_s, dec_s);
        let gather = eval_hit_gather(hs, time, sigma_s);
        (env, cnt, gather)
    } else {
        (0.0, 0.0, 0.0)
    };

    // 3. Per-drum impulses (matching Lactoseq _events_to_impulse_env tau = 0.35 * decay_s)
    let kick = event_streams
        .get("kick")
        .map(|s| eval_exp_impulse(s, time, 0.042, 1.5))
        .unwrap_or(hit_env);
    let snare = event_streams
        .get("snare")
        .map(|s| eval_exp_impulse(s, time, 0.038, 1.5))
        .unwrap_or(0.0);
    let hat = event_streams
        .get("hat")
        .map(|s| eval_exp_impulse(s, time, 0.025, 1.2))
        .unwrap_or(0.0);
    let downbeat_accent = event_streams
        .get("downbeat")
        .map(|s| eval_exp_impulse(s, time, 0.14, 1.0))
        .unwrap_or_else(|| (-bar_phase * 10.0).exp());

    // 4. Drum density / fill / syncopation (stateless baseline-relative burst detector matching Lactoseq musicality.py)
    let kick_cnt = event_streams
        .get("kick")
        .map(|s| count_events_in_window(s, time, 1.0))
        .unwrap_or(0);
    let snare_cnt = event_streams
        .get("snare")
        .map(|s| count_events_in_window(s, time, 1.0))
        .unwrap_or(0);
    let hat_cnt = event_streams
        .get("hat")
        .map(|s| count_events_in_window(s, time, 1.0))
        .unwrap_or(0);
    let drum_density = ((kick_cnt + snare_cnt + hat_cnt) as f32 / 4.0).clamp(0.0, 3.5);
    let fill_win_s = (1.25 * beat_s).clamp(0.45, 0.90);
    let drum_fill = if let Some(ss) = event_streams.get("snare").or(hit_stream) {
        let total = ss.events.len();
        if total >= 4 {
            let span = (ss.events[total - 1].time - ss.events[0].time).max(1.0);
            let baseline_rate = (total as f32 / span).max(0.75);
            let local_rate = count_events_in_window(ss, time, fill_win_s) as f32 / fill_win_s;
            ((local_rate / baseline_rate - 1.45) / 0.85).clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else {
        0.0
    };
    let drum_syncopation = (snare * 0.65 + hat * 0.35).clamp(0.0, 1.5);

    // 5. Stem dominance weights & lead spotlight
    let mix_energy = sample_named(named_signals, &["energy", "amplitude"], time, safe_dt)
        .unwrap_or(0.35)
        .max(0.0);
    let s_drums = sample_stem(stem_signals, "Drums", time, safe_dt).unwrap_or(kick * 0.5 + 0.1);
    let s_bass = sample_stem(stem_signals, "Bass", time, safe_dt)
        .or_else(|| {
            band_signals
                .get("Bass")
                .and_then(|f| f.get("energy"))
                .map(|s| s.sample_window(time, safe_dt))
        })
        .unwrap_or(mix_energy * 0.8 + 0.1);
    let s_vocals = sample_stem(stem_signals, "Vocals", time, safe_dt).unwrap_or(mix_energy * 0.5);
    let s_other = sample_stem(stem_signals, "Other", time, safe_dt).unwrap_or(mix_energy * 0.6);

    let raw_stems = [
        s_drums.max(0.0),
        s_bass.max(0.0),
        s_vocals.max(0.0),
        s_other.max(0.0),
    ];
    let stem_sum: f32 = raw_stems.iter().sum();
    let stem_weights = if stem_sum > 1e-5 {
        [
            raw_stems[0] / stem_sum,
            raw_stems[1] / stem_sum,
            raw_stems[2] / stem_sum,
            raw_stems[3] / stem_sum,
        ]
    } else {
        [0.25, 0.25, 0.25, 0.25]
    };
    let mut lead_stem_id = 0usize;
    for i in 1..4 {
        if stem_weights[i] > stem_weights[lead_stem_id] {
            lead_stem_id = i;
        }
    }
    let lead_energy = sample_named(custom_signals, &["lead"], time, safe_dt)
        .unwrap_or(mix_energy)
        .clamp(0.0, 2.5);
    let lead_onset = sample_named(named_signals, &["onsetEnvelope"], time, safe_dt)
        .unwrap_or(0.0)
        .max(hit_env)
        .clamp(0.0, 2.0);
    let stem_enter = event_streams
        .get("section")
        .map(|s| eval_exp_impulse(s, time, 0.35, 1.0))
        .unwrap_or(0.0);

    // 6. Tonal channels: brightness (spectral centroid) & harmonic_change (spectral flux / chroma flux)
    let brightness = sample_named(
        named_signals,
        &["brightness", "spectralCentroid", "centroid"],
        time,
        safe_dt,
    )
    .or_else(|| sample_named(custom_signals, &["brightness"], time, safe_dt))
    .unwrap_or(0.5)
    .clamp(0.0, 1.0);

    let harmonic_change = sample_named(
        custom_signals,
        &["harmonic_change", "chroma_flux"],
        time,
        safe_dt,
    )
    .or_else(|| sample_named(named_signals, &["spectralFlux", "flux"], time, safe_dt))
    .unwrap_or(0.0)
    .clamp(0.0, 1.0);

    RigMusicalUniforms {
        musical0: [beat_pos, beat_phase, bar_phase, section_prog],
        musical1: [kick, snare, hat, downbeat_accent],
        musical2: [drum_density, drum_fill, drum_syncopation, lead_stem_id as f32],
        musical3: [lead_energy, lead_onset, stem_enter, 0.0],
        stem_weights,
        answer: [hit_env, hit_count, hit_gather, section_intensity],
        tonal: [brightness, harmonic_change, 0.0, 0.0],
        v2_gains: [
            reactivity.hit_gather_gain,
            reactivity.staying_step_gain,
            reactivity.tonal_shift_gain,
            0.0,
        ],
        has_audio: true,
    }
}

/// Active declarative 3D rig state attached to `VisualiserState`.
#[derive(Debug, Clone)]
pub struct ActiveSceneRig {
    pub config: SceneRigConfig,
    /// Optional sanitized GLB hero mesh + embedded albedo texture.
    pub glb_asset: Option<Arc<GlbAsset>>,
    /// Monotonically incremented when rig or GLB changes so the GPU pass knows when to re-upload hero mesh/albedo.
    pub generation: u64,
    /// Current evaluated musical uniforms for this frame.
    pub musical: RigMusicalUniforms,
    /// Exact frame index & dt for O(1)-seekable rendering and analytic motion vectors.
    pub time_sec: f32,
    pub frame_dt: f32,
    pub seed: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_stream::{Event, PickEventsOptions};

    const VALID_V2_CATHEDRAL: &str = r#"{
      "schema_version": "scene_rig.v2",
      "rig_id": "first_party/07_sacred_polyhedra_cathedral",
      "simulation_mode": "stateless",
      "sim_step_hz": 60,
      "template": "sacred_polyhedra_cathedral",
      "material_style": "stylized_pbr",
      "geometry": {
        "source": "procedural",
        "primitive": "instanced_sacred_cathedral",
        "instance_count": 720,
        "glb_asset_ref": ""
      },
      "camera": {
        "rig": "sanctuary_staying",
        "fov_deg": 54.0,
        "near": 0.25,
        "far": 120.0,
        "orbit_speed": 0.08,
        "cut_every_bars": 8
      },
      "palette": {
        "bg_rgb": [0.012, 0.014, 0.032],
        "drums_rgb": [1.0, 0.24, 0.42],
        "bass_rgb": [0.95, 0.68, 0.14],
        "vocals_rgb": [0.14, 0.90, 1.0],
        "other_rgb": [0.64, 0.32, 1.0]
      },
      "reactivity": {
        "kick_punch": 1.15,
        "fill_turbulence": 1.1,
        "stem_spotlight": 1.2,
        "bar_wave_amp": 0.75,
        "wireframe_glow": 0.65,
        "hit_gather_gain": 1.0,
        "staying_step_gain": 1.0,
        "tonal_shift_gain": 1.0
      },
      "conditioning": {
        "mrt_enabled": true,
        "depth_near": 0.5,
        "depth_far": 55.0,
        "wireframe_thickness": 1.25
      }
    }"#;

    #[test]
    fn parses_valid_v2_and_v1_rigs() {
        let cfg = parse_and_validate_rig_json(VALID_V2_CATHEDRAL).expect("valid v2 rig");
        assert_eq!(cfg.schema_version, RigSchemaVersion::V2);
        assert_eq!(cfg.template, RigTemplate::SacredPolyhedraCathedral);
        assert_eq!(cfg.geometry.instance_count, 720);
        assert_eq!(cfg.reactivity.hit_gather_gain, 1.0);
        assert_eq!(cfg.reactivity.staying_step_gain, 1.0);
        assert_eq!(cfg.reactivity.tonal_shift_gain, 1.0);
        // MRT stays gated off by default for zero beauty bandwidth overhead.
        assert!(!cfg.mrt_active());

        // v1 omits v2 reactivity keys -> defaults to 1.0
        let v1 = r#"{
            "schema_version": "scene_rig.v1",
            "rig_id": "test/v1_mega",
            "template": "instanced_megastructure",
            "geometry": { "instance_count": 16000 }
        }"#;
        let cfg1 = parse_and_validate_rig_json(v1).expect("valid v1 rig");
        assert_eq!(cfg1.schema_version, RigSchemaVersion::V1);
        assert_eq!(cfg1.reactivity.hit_gather_gain, 1.0);
        assert_eq!(cfg1.reactivity.staying_step_gain, 1.0);
    }

    #[test]
    fn rejects_embedded_script_and_shader_keys() {
        for forbidden in ["glsl", "wgsl", "script", "rhai", "shader", "eval", "wasm"] {
            let bad = format!(
                r#"{{
                    "schema_version": "scene_rig.v2",
                    "rig_id": "bad/rig",
                    "template": "sacred_polyhedra_cathedral",
                    "extra": {{ "{forbidden}": "malicious()" }}
                }}"#
            );
            let err = parse_and_validate_rig_json(&bad).expect_err("must reject forbidden key");
            assert!(
                err.contains("Security violation"),
                "expected security error for '{forbidden}', got: {err}"
            );
        }
    }

    #[test]
    fn rejects_path_traversal_and_external_glb_refs() {
        for bad_ref in [
            "../secret.glb",
            "models/../../etc/passwd",
            "/abs/path.glb",
            "\\windows\\path.glb",
            "C:\\evil.glb",
            "https://evil.com/mesh.glb",
            "data:application/octet-stream;base64,AAAA",
        ] {
            let bad = format!(
                r#"{{
                    "schema_version": "scene_rig.v2",
                    "rig_id": "bad/path",
                    "template": "glb_stage",
                    "geometry": {{ "instance_count": 1, "glb_asset_ref": {} }}
                }}"#,
                serde_json::to_string(bad_ref).unwrap()
            );
            let err = parse_and_validate_rig_json(&bad).expect_err("must reject unsafe glb ref");
            assert!(
                err.contains("Security violation"),
                "expected security error for '{bad_ref}', got: {err}"
            );
        }
    }

    #[test]
    fn rejects_excessive_instance_count_and_bad_fov() {
        let too_many = r#"{
            "schema_version": "scene_rig.v2",
            "rig_id": "bad/count",
            "template": "instanced_megastructure",
            "geometry": { "instance_count": 50001 }
        }"#;
        assert!(parse_and_validate_rig_json(too_many).is_err());

        let bad_fov = r#"{
            "schema_version": "scene_rig.v2",
            "rig_id": "bad/fov",
            "template": "instanced_megastructure",
            "camera": { "fov_deg": 150.0 }
        }"#;
        assert!(parse_and_validate_rig_json(bad_fov).is_err());
    }

    #[test]
    fn hit_envelope_count_and_gather_are_stateless_and_exact() {
        let hits = EventStream::new(
            vec![Event::new(1.0, 1.0), Event::new(2.0, 0.8)],
            "hit".to_string(),
            PickEventsOptions::default(),
        );
        let mut streams = HashMap::new();
        streams.insert("hit".to_string(), hits);
        let empty_sig = HashMap::new();
        let empty_band = HashMap::new();
        let react = RigReactivity::default();

        // Just before first hit (t=0.95): hit_count == 0, hit_gather > 0.8
        let pre = evaluate_rig_musical_uniforms(
            0.95,
            1.0 / 60.0,
            120.0,
            &react,
            &empty_sig,
            &empty_band,
            &empty_band,
            &empty_sig,
            None,
            &streams,
        );
        assert_eq!(pre.answer[1], 0.0);
        assert!(pre.answer[2] > 0.8, "expected pre-hit gather > 0.8, got {}", pre.answer[2]);

        // At first hit (t=1.0): hit_count == 1, hit_env == 1.0
        let at_hit = evaluate_rig_musical_uniforms(
            1.0,
            1.0 / 60.0,
            120.0,
            &react,
            &empty_sig,
            &empty_band,
            &empty_band,
            &empty_sig,
            None,
            &streams,
        );
        assert_eq!(at_hit.answer[1], 1.0);
        assert!((at_hit.answer[0] - 1.0).abs() < 1e-4);

        // After second hit (t=2.5): hit_count == 2, hit_env settled back to 0.0
        let after = evaluate_rig_musical_uniforms(
            2.5,
            1.0 / 60.0,
            120.0,
            &react,
            &empty_sig,
            &empty_band,
            &empty_band,
            &empty_sig,
            None,
            &streams,
        );
        assert_eq!(after.answer[1], 2.0);
        assert_eq!(after.answer[0], 0.0);
    }
}
