//! Rhai integration for particle systems.
//!
//! This module registers particle system types and functions with the Rhai engine,
//! enabling scripts to create and configure particle systems declaratively.
//!
//! # Example (Rhai)
//! ```rhai
//! fn init(ctx) {
//!     let sparks = particles.from_events(events, #{
//!         count: 10,
//!         lifetime_beats: 0.5,
//!         envelope: "exponential_decay",
//!         decay_beats: 0.3,
//!         spread: #{ x: 0.1, y: 0.2, z: 0.1 },
//!         color: #{ r: 1.0, g: 0.5, b: 0.0, a: 1.0 },
//!         scale: 0.05,
//!         seed: 42
//!     });
//!     scene.add(sparks);
//! }
//! ```

use rhai::{Dynamic, Engine, Map};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::event_stream::EventStream;
use crate::particle::{
    ParticleConfig, ParticleEnvelope, ParticleGeometry, ParticleSystem, StreamMode,
    VariationConfig,
};
use crate::scene_graph::Vec3;
use crate::signal::{EasingFunction, EnvelopeShape, Signal};

/// Global seed for particle systems when not specified in script.
/// Set by ScriptEngine.set_global_seed() and read during particle config parsing.
static GLOBAL_PARTICLE_SEED: AtomicU64 = AtomicU64::new(0);

/// Set the global particle seed.
/// This is called by the ScriptEngine when set_global_seed is invoked.
pub fn set_global_particle_seed(seed: u64) {
    GLOBAL_PARTICLE_SEED.store(seed, Ordering::Relaxed);
}

/// Get the current global particle seed.
pub fn get_global_particle_seed() -> u64 {
    GLOBAL_PARTICLE_SEED.load(Ordering::Relaxed)
}

/// Particle system handle for Rhai scripts.
/// Wraps a ParticleSystem with an entity ID for scene management.
#[derive(Clone, Debug)]
pub struct ParticleSystemHandle {
    /// The underlying particle system configuration.
    pub system: ParticleSystem,
    /// Entity ID in the scene graph (set when added to scene).
    pub entity_id: Option<u64>,
}

impl ParticleSystemHandle {
    /// Create a new handle wrapping a particle system.
    pub fn new(system: ParticleSystem) -> Self {
        Self {
            system,
            entity_id: None,
        }
    }
}

/// Builder for particle system creation.
/// Returned by `particles.from_events()` and `particles.stream()`.
#[derive(Clone)]
pub struct ParticlesBuilder;

impl ParticlesBuilder {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ParticlesBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Register particle API types and functions with a Rhai engine.
pub fn register_particle_api(engine: &mut Engine) {
    // === Register ParticleSystemHandle type ===
    engine.register_type_with_name::<ParticleSystemHandle>("ParticleSystem");

    // Property accessors for ParticleSystemHandle

    // __id getter/setter for scene management compatibility
    engine.register_get("__id", |h: &mut ParticleSystemHandle| -> i64 {
        h.entity_id.map(|id| id as i64).unwrap_or(-1)
    });
    engine.register_set("__id", |h: &mut ParticleSystemHandle, id: i64| {
        h.entity_id = Some(id as u64);
    });

    // __type getter for entity type identification
    engine.register_get("__type", |_h: &mut ParticleSystemHandle| -> String {
        "particle_system".to_string()
    });

    engine.register_get("visible", |h: &mut ParticleSystemHandle| h.system.visible);
    engine.register_set("visible", |h: &mut ParticleSystemHandle, v: bool| {
        h.system.visible = v;
    });

    engine.register_get("position", |h: &mut ParticleSystemHandle| -> Map {
        let mut map = Map::new();
        map.insert("x".into(), Dynamic::from(h.system.transform.position.x));
        map.insert("y".into(), Dynamic::from(h.system.transform.position.y));
        map.insert("z".into(), Dynamic::from(h.system.transform.position.z));
        map
    });

    engine.register_set("position", |h: &mut ParticleSystemHandle, pos: Map| {
        if let Some(x) = pos.get("x").and_then(|v| v.as_float().ok()) {
            h.system.transform.position.x = x as f32;
        }
        if let Some(y) = pos.get("y").and_then(|v| v.as_float().ok()) {
            h.system.transform.position.y = y as f32;
        }
        if let Some(z) = pos.get("z").and_then(|v| v.as_float().ok()) {
            h.system.transform.position.z = z as f32;
        }
    });

    engine.register_get("color", |h: &mut ParticleSystemHandle| -> Map {
        let mut map = Map::new();
        map.insert("r".into(), Dynamic::from(h.system.config.base_color[0]));
        map.insert("g".into(), Dynamic::from(h.system.config.base_color[1]));
        map.insert("b".into(), Dynamic::from(h.system.config.base_color[2]));
        map.insert("a".into(), Dynamic::from(h.system.config.base_color[3]));
        map
    });

    engine.register_set("color", |h: &mut ParticleSystemHandle, color: Map| {
        if let Some(r) = color.get("r").and_then(|v| v.as_float().ok()) {
            h.system.config.base_color[0] = r as f32;
        }
        if let Some(g) = color.get("g").and_then(|v| v.as_float().ok()) {
            h.system.config.base_color[1] = g as f32;
        }
        if let Some(b) = color.get("b").and_then(|v| v.as_float().ok()) {
            h.system.config.base_color[2] = b as f32;
        }
        if let Some(a) = color.get("a").and_then(|v| v.as_float().ok()) {
            h.system.config.base_color[3] = a as f32;
        }
    });

    engine.register_get("scale", |h: &mut ParticleSystemHandle| {
        h.system.config.base_scale
    });
    engine.register_set("scale", |h: &mut ParticleSystemHandle, s: f64| {
        h.system.config.base_scale = s as f32;
    });

    engine.register_fn("instance_count", |h: &mut ParticleSystemHandle| {
        h.system.instance_count() as i64
    });

    engine.register_fn("reset", |h: &mut ParticleSystemHandle| {
        h.system.reset();
    });

    // === Register ParticlesBuilder ===
    engine.register_type_with_name::<ParticlesBuilder>("ParticlesBuilder");

    // Factory function for creating the particles namespace
    engine.register_fn("__particles_builder", ParticlesBuilder::new);

    // particles.from_events(events, options)
    engine.register_fn(
        "from_events",
        |_builder: &mut ParticlesBuilder, events: EventStream, options: Map| -> ParticleSystemHandle {
            let config = parse_particle_config(&options);
            let instances_per_event = get_int_or(&options, "count", 1) as usize;

            let system = ParticleSystem::from_events(
                Arc::clone(&events.events),
                instances_per_event,
                config,
            );

            ParticleSystemHandle::new(apply_options_to_system(system, &options))
        },
    );

    // particles.stream(signal, options)
    engine.register_fn(
        "stream",
        |_builder: &mut ParticlesBuilder, signal: Signal, options: Map| -> ParticleSystemHandle {
            let config = parse_particle_config(&options);
            let mode = parse_stream_mode(&options);

            let system = ParticleSystem::from_stream(signal, mode, config);

            ParticleSystemHandle::new(apply_options_to_system(system, &options))
        },
    );
}

/// Parse particle configuration from Rhai options map.
fn parse_particle_config(options: &Map) -> ParticleConfig {
    let mut config = ParticleConfig::default();

    // Lifetime
    if let Some(lifetime) = get_float(options, "lifetime_beats") {
        config.lifetime_beats = lifetime;
    }

    // Max instances
    if let Some(max) = get_int(options, "max_instances") {
        config.max_instances = max as usize;
    }

    // Base color
    if let Some(color_map) = options.get("color").and_then(|v| v.clone().try_cast::<Map>()) {
        config.base_color = parse_color(&color_map);
    }

    // Base scale
    if let Some(scale) = get_float(options, "scale") {
        config.base_scale = scale;
    }

    // Seed - use explicit seed if provided, otherwise fall back to global seed
    if let Some(seed) = get_int(options, "seed") {
        config.seed = seed as u64;
    } else {
        // Use global seed if no explicit seed is provided
        let global_seed = get_global_particle_seed();
        if global_seed != 0 {
            config.seed = global_seed;
        }
    }

    // Envelope configuration
    config.envelope = parse_envelope(options);

    // Variation configuration
    config.variation = parse_variation(options);

    // Material ID override (optional - inherits from parent mesh if not specified)
    if let Some(material_id) = get_string(options, "material") {
        config.material_id = Some(material_id);
    }

    config
}

/// Parse envelope configuration from options.
fn parse_envelope(options: &Map) -> ParticleEnvelope {
    let mut envelope = ParticleEnvelope::default();

    // Envelope shape
    if let Some(shape_str) = get_string(options, "envelope") {
        envelope.shape = match shape_str.as_str() {
            "impulse" => EnvelopeShape::Impulse,
            "step" => EnvelopeShape::Step,
            "attack_decay" | "attackDecay" => EnvelopeShape::AttackDecay,
            "adsr" => EnvelopeShape::Adsr,
            "gaussian" => EnvelopeShape::Gaussian,
            "exponential_decay" | "exponentialDecay" => EnvelopeShape::ExponentialDecay,
            _ => EnvelopeShape::ExponentialDecay,
        };
    }

    // Envelope timing
    if let Some(attack) = get_float(options, "attack_beats") {
        envelope.attack_beats = attack;
    }
    if let Some(decay) = get_float(options, "decay_beats") {
        envelope.decay_beats = decay;
    }
    if let Some(width) = get_float(options, "width_beats") {
        envelope.width_beats = width;
    }

    // Easing
    if let Some(easing_str) = get_string(options, "easing") {
        envelope.easing = match easing_str.as_str() {
            "linear" => EasingFunction::Linear,
            "quadratic_in" | "quadraticIn" => EasingFunction::QuadraticIn,
            "quadratic_out" | "quadraticOut" => EasingFunction::QuadraticOut,
            "quadratic_in_out" | "quadraticInOut" => EasingFunction::QuadraticInOut,
            "cubic_in" | "cubicIn" => EasingFunction::CubicIn,
            "cubic_out" | "cubicOut" => EasingFunction::CubicOut,
            "cubic_in_out" | "cubicInOut" => EasingFunction::CubicInOut,
            "exponential_in" | "exponentialIn" => EasingFunction::ExponentialIn,
            "exponential_out" | "exponentialOut" => EasingFunction::ExponentialOut,
            "smoothstep" | "smooth_step" => EasingFunction::SmoothStep,
            "elastic" => EasingFunction::Elastic,
            _ => EasingFunction::Linear,
        };
    }

    envelope
}

/// Parse variation configuration from options.
fn parse_variation(options: &Map) -> VariationConfig {
    let mut variation = VariationConfig::default();

    // Position spread
    if let Some(spread_map) = options.get("spread").and_then(|v| v.clone().try_cast::<Map>()) {
        variation.position_spread = Vec3::new(
            get_float(&spread_map, "x").unwrap_or(0.0),
            get_float(&spread_map, "y").unwrap_or(0.0),
            get_float(&spread_map, "z").unwrap_or(0.0),
        );
    }

    // Scale variation
    if let Some(scale_var) = get_float(options, "scale_variation") {
        variation.scale_range = [1.0 - scale_var, 1.0 + scale_var];
    }

    // Color variation
    if let Some(color_var) = get_float(options, "color_variation") {
        variation.color_variation = color_var;
    }

    // Rotation variation (0.0 to 1.0, multiplied by PI for max rotation angle)
    if let Some(rot_var) = get_float(options, "rotation_variation") {
        variation.rotation_variation = rot_var.clamp(0.0, 1.0);
    }

    variation
}

/// Parse stream mode from options.
fn parse_stream_mode(options: &Map) -> StreamMode {
    let mode_str = get_string(options, "mode").unwrap_or_else(|| "proportional".to_string());

    match mode_str.as_str() {
        "threshold" => StreamMode::Threshold {
            threshold: get_float(options, "threshold").unwrap_or(0.5),
            instances_per_burst: get_int_or(options, "instances_per_burst", 10) as usize,
        },
        _ => StreamMode::Proportional {
            rate_per_beat: get_float(options, "rate_per_beat").unwrap_or(10.0),
        },
    }
}

/// Apply additional options to a particle system.
fn apply_options_to_system(mut system: ParticleSystem, options: &Map) -> ParticleSystem {
    // Mesh geometry takes priority (shorthand syntax: mesh: "asset_id")
    if let Some(asset_id) = get_string(options, "mesh") {
        system.geometry = ParticleGeometry::Mesh {
            asset_id,
            base_scale: get_float(options, "mesh_scale")
                .or_else(|| get_float(options, "scale"))
                .unwrap_or(1.0),
        };
        return system;
    }

    // Geometry type (explicit syntax: geometry: "point" or geometry: "billboard")
    if let Some(geom_str) = get_string(options, "geometry") {
        system.geometry = match geom_str.as_str() {
            "point" => ParticleGeometry::Point {
                size: get_float(options, "point_size").unwrap_or(2.0),
            },
            "billboard" | _ => ParticleGeometry::Billboard {
                size: get_float(options, "billboard_size")
                    .or_else(|| get_float(options, "scale"))
                    .unwrap_or(0.1),
            },
        };
    }

    system
}

/// Parse RGBA color from a map.
fn parse_color(color_map: &Map) -> [f32; 4] {
    [
        get_float(color_map, "r").unwrap_or(1.0),
        get_float(color_map, "g").unwrap_or(1.0),
        get_float(color_map, "b").unwrap_or(1.0),
        get_float(color_map, "a").unwrap_or(1.0),
    ]
}

// === Helper functions for parsing Rhai maps ===

fn get_float(map: &Map, key: &str) -> Option<f32> {
    map.get(key).and_then(|v| {
        v.as_float()
            .ok()
            .map(|f| f as f32)
            .or_else(|| v.as_int().ok().map(|i| i as f32))
    })
}

fn get_int(map: &Map, key: &str) -> Option<i64> {
    map.get(key).and_then(|v| v.as_int().ok())
}

fn get_int_or(map: &Map, key: &str, default: i64) -> i64 {
    get_int(map, key).unwrap_or(default)
}

fn get_string(map: &Map, key: &str) -> Option<String> {
    map.get(key).and_then(|v| v.clone().into_string().ok())
}

/// Generate Rhai code for the particles namespace.
/// This wraps the native builder methods to allocate entity IDs and register particle systems.
pub fn generate_particles_namespace() -> String {
    r#"
let __particles_builder_inner = __particles_builder();
let particles = #{};
particles.__type = "particles_namespace";

particles.from_events = |events, options| {
    let sys = __particles_builder_inner.from_events(events, options);
    let id = __next_id;
    __next_id += 1;
    sys.__id = id;
    __particle_systems["" + id] = sys;
    sys
};

particles.stream = |signal, options| {
    let sys = __particles_builder_inner.stream(signal, options);
    let id = __next_id;
    __next_id += 1;
    sys.__id = id;
    __particle_systems["" + id] = sys;
    sys
};
"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_particle_config() {
        let mut options = Map::new();
        options.insert("lifetime_beats".into(), Dynamic::from(0.5f32));
        options.insert("scale".into(), Dynamic::from(0.1f32));
        options.insert("seed".into(), Dynamic::from(42i64));

        let config = parse_particle_config(&options);
        assert!((config.lifetime_beats - 0.5).abs() < 0.01);
        assert!((config.base_scale - 0.1).abs() < 0.01);
        assert_eq!(config.seed, 42);
    }

    #[test]
    fn test_parse_envelope() {
        let mut options = Map::new();
        options.insert("envelope".into(), Dynamic::from("exponential_decay"));
        options.insert("decay_beats".into(), Dynamic::from(0.3f32));
        options.insert("easing".into(), Dynamic::from("smoothstep"));

        let envelope = parse_envelope(&options);
        assert!(matches!(envelope.shape, EnvelopeShape::ExponentialDecay));
        assert!((envelope.decay_beats - 0.3).abs() < 0.01);
        assert!(matches!(envelope.easing, EasingFunction::SmoothStep));
    }

    #[test]
    fn test_parse_stream_mode_proportional() {
        let mut options = Map::new();
        options.insert("mode".into(), Dynamic::from("proportional"));
        options.insert("rate_per_beat".into(), Dynamic::from(20.0f32));

        let mode = parse_stream_mode(&options);
        assert!(matches!(
            mode,
            StreamMode::Proportional { rate_per_beat } if (rate_per_beat - 20.0).abs() < 0.01
        ));
    }

    #[test]
    fn test_parse_stream_mode_threshold() {
        let mut options = Map::new();
        options.insert("mode".into(), Dynamic::from("threshold"));
        options.insert("threshold".into(), Dynamic::from(0.7f32));
        options.insert("instances_per_burst".into(), Dynamic::from(15i64));

        let mode = parse_stream_mode(&options);
        assert!(matches!(
            mode,
            StreamMode::Threshold { threshold, instances_per_burst }
            if (threshold - 0.7).abs() < 0.01 && instances_per_burst == 15
        ));
    }
}
