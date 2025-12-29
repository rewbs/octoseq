//! Particle system types and core data structures.
//!
//! This module provides deterministic particle systems driven by EventStreams and Signals.
//! Particles are spawned at discrete events or continuously from signals, with no physics simulation.

use std::sync::Arc;

use crate::event_stream::Event;
use crate::scene_graph::{Transform, Vec3};
use crate::signal::{EasingFunction, EnvelopeShape, Signal};

/// A particle system that emits instances based on events or signals.
#[derive(Clone, Debug)]
pub struct ParticleSystem {
    /// Base transform for the system.
    pub transform: Transform,
    /// Whether the system is visible.
    pub visible: bool,
    /// Geometry type for particles.
    pub geometry: ParticleGeometry,
    /// Particle configuration.
    pub config: ParticleConfig,
    /// Emission source.
    pub source: EmissionSource,
    /// Live particle instances.
    pub instances: Vec<ParticleInstance>,
    /// Deterministic RNG state.
    rng_state: u64,
}

/// Geometry type for particles.
#[derive(Clone, Debug)]
pub enum ParticleGeometry {
    /// Camera-facing quad.
    Billboard { size: f32 },
    /// Simple point.
    Point { size: f32 },
    /// Mesh asset instance.
    Mesh {
        /// Asset ID referencing a registered mesh.
        asset_id: String,
        /// Base scale for the mesh (applied to all instances).
        base_scale: f32,
    },
}

impl Default for ParticleGeometry {
    fn default() -> Self {
        ParticleGeometry::Billboard { size: 0.1 }
    }
}

/// Source of particle emission.
#[derive(Clone, Debug)]
pub enum EmissionSource {
    /// Emit particles on each event.
    Events {
        events: Arc<Vec<Event>>,
        instances_per_event: usize,
        /// Track which events have been spawned.
        next_event_index: usize,
    },
    /// Emit particles continuously based on a signal.
    Stream {
        signal: Signal,
        mode: StreamMode,
        /// Accumulated fractional emission count.
        accumulator: f32,
        /// Previous signal value for threshold detection.
        prev_value: f32,
    },
}

/// Mode for signal-driven emission.
#[derive(Clone, Debug)]
pub enum StreamMode {
    /// Emission rate proportional to signal value.
    Proportional { rate_per_beat: f32 },
    /// Emit burst when signal crosses threshold.
    Threshold {
        threshold: f32,
        instances_per_burst: usize,
    },
}

/// Configuration for a particle system.
#[derive(Clone, Debug)]
pub struct ParticleConfig {
    /// Maximum number of live instances.
    pub max_instances: usize,
    /// Particle lifespan in beats.
    pub lifetime_beats: f32,
    /// Base color [r, g, b, a].
    pub base_color: [f32; 4],
    /// Base scale.
    pub base_scale: f32,
    /// Random seed.
    pub seed: u64,
    /// Envelope configuration.
    pub envelope: ParticleEnvelope,
    /// Variation configuration.
    pub variation: VariationConfig,
    /// Material ID override. If None, inherits from parent mesh.
    pub material_id: Option<String>,
}

impl Default for ParticleConfig {
    fn default() -> Self {
        Self {
            max_instances: 1000,
            lifetime_beats: 1.0,
            base_color: [1.0, 1.0, 1.0, 1.0],
            base_scale: 0.1,
            seed: 0,
            envelope: ParticleEnvelope::default(),
            variation: VariationConfig::default(),
            material_id: None,
        }
    }
}

/// Envelope configuration for particle lifetime.
#[derive(Clone, Debug)]
pub struct ParticleEnvelope {
    /// Shape of the envelope.
    pub shape: EnvelopeShape,
    /// Attack time in beats.
    pub attack_beats: f32,
    /// Decay time in beats.
    pub decay_beats: f32,
    /// Gaussian width in beats.
    pub width_beats: f32,
    /// Easing function.
    pub easing: EasingFunction,
}

impl Default for ParticleEnvelope {
    fn default() -> Self {
        Self {
            shape: EnvelopeShape::ExponentialDecay,
            attack_beats: 0.1,
            decay_beats: 0.5,
            width_beats: 0.25,
            easing: EasingFunction::Linear,
        }
    }
}

/// Variation configuration for particle instances.
#[derive(Clone, Debug)]
pub struct VariationConfig {
    /// Position spread.
    pub position_spread: Vec3,
    /// Scale range [min_mult, max_mult].
    pub scale_range: [f32; 2],
    /// Color variation (0.0-1.0).
    pub color_variation: f32,
    /// Rotation variation (0.0-1.0, multiplied by PI for max random rotation).
    pub rotation_variation: f32,
}

impl Default for VariationConfig {
    fn default() -> Self {
        Self {
            position_spread: Vec3::new(0.0, 0.0, 0.0),
            scale_range: [1.0, 1.0],
            color_variation: 0.0,
            rotation_variation: 0.0,
        }
    }
}

/// A single particle instance.
#[derive(Clone, Debug)]
pub struct ParticleInstance {
    /// Spawn time in seconds.
    pub spawn_time_secs: f32,
    /// Spawn beat position.
    pub spawn_beat: f32,
    /// Local position offset (from variation).
    pub local_offset: Vec3,
    /// Local scale multiplier (from variation).
    pub local_scale: f32,
    /// Color shift (from variation).
    pub color_shift: [f32; 3],
    /// Weight from source event (if applicable).
    pub event_weight: f32,
    /// Local rotation as quaternion [x, y, z, w] for mesh particles.
    pub local_rotation: [f32; 4],
}

impl ParticleSystem {
    /// Create a new particle system from events.
    pub fn from_events(
        events: Arc<Vec<Event>>,
        instances_per_event: usize,
        config: ParticleConfig,
    ) -> Self {
        Self {
            transform: Transform::default(),
            visible: true,
            geometry: ParticleGeometry::default(),
            config: config.clone(),
            source: EmissionSource::Events {
                events,
                instances_per_event,
                next_event_index: 0,
            },
            instances: Vec::with_capacity(config.max_instances),
            rng_state: config.seed,
        }
    }

    /// Create a new particle system from a signal stream.
    pub fn from_stream(signal: Signal, mode: StreamMode, config: ParticleConfig) -> Self {
        Self {
            transform: Transform::default(),
            visible: true,
            geometry: ParticleGeometry::default(),
            config: config.clone(),
            source: EmissionSource::Stream {
                signal,
                mode,
                accumulator: 0.0,
                prev_value: 0.0,
            },
            instances: Vec::with_capacity(config.max_instances),
            rng_state: config.seed,
        }
    }

    /// Get the current number of live instances.
    pub fn instance_count(&self) -> usize {
        self.instances.len()
    }

    /// Reset the particle system (clear all instances).
    pub fn reset(&mut self) {
        self.instances.clear();
        self.rng_state = self.config.seed;

        // Reset source state
        match &mut self.source {
            EmissionSource::Events {
                next_event_index, ..
            } => {
                *next_event_index = 0;
            }
            EmissionSource::Stream {
                accumulator,
                prev_value,
                ..
            } => {
                *accumulator = 0.0;
                *prev_value = 0.0;
            }
        }
    }

    /// Spawn a new particle instance with variation.
    pub fn spawn_instance(&mut self, spawn_time_secs: f32, spawn_beat: f32, event_weight: f32) {
        if self.instances.len() >= self.config.max_instances {
            // Remove oldest instance
            self.instances.remove(0);
        }

        let variation = self.next_variation();

        self.instances.push(ParticleInstance {
            spawn_time_secs,
            spawn_beat,
            local_offset: variation.position_offset,
            local_scale: variation.scale_mult,
            color_shift: variation.color_shift,
            event_weight,
            local_rotation: variation.rotation,
        });
    }

    /// Generate the next variation using deterministic RNG.
    fn next_variation(&mut self) -> VariationResult {
        let config = &self.config.variation;

        // xorshift64 for deterministic randomness
        // Note: seed 0 is degenerate (produces all zeros), so we use a default non-zero seed
        if self.rng_state == 0 {
            self.rng_state = 0x5DEECE66D; // Same default as Java's Random
        }
        let mut next_f32 = || {
            self.rng_state ^= self.rng_state << 13;
            self.rng_state ^= self.rng_state >> 7;
            self.rng_state ^= self.rng_state << 17;
            (self.rng_state as f32) / (u64::MAX as f32)
        };

        let position_offset = Vec3::new(
            (next_f32() - 0.5) * config.position_spread.x * 2.0,
            (next_f32() - 0.5) * config.position_spread.y * 2.0,
            (next_f32() - 0.5) * config.position_spread.z * 2.0,
        );

        let scale_mult = config.scale_range[0]
            + next_f32() * (config.scale_range[1] - config.scale_range[0]);

        let color_shift = [
            (next_f32() - 0.5) * config.color_variation * 2.0,
            (next_f32() - 0.5) * config.color_variation * 2.0,
            (next_f32() - 0.5) * config.color_variation * 2.0,
        ];

        // Generate random rotation as quaternion if rotation_variation > 0
        let rotation = if config.rotation_variation > 0.0 {
            // Random axis-angle rotation converted to quaternion
            // axis = normalized random direction, angle = rotation_variation * PI
            let ax = next_f32() - 0.5;
            let ay = next_f32() - 0.5;
            let az = next_f32() - 0.5;
            let len = (ax * ax + ay * ay + az * az).sqrt().max(0.0001);
            let (ax, ay, az) = (ax / len, ay / len, az / len);

            let angle = next_f32() * config.rotation_variation * std::f32::consts::PI;
            let half_angle = angle * 0.5;
            let s = half_angle.sin();
            let c = half_angle.cos();

            [ax * s, ay * s, az * s, c]
        } else {
            // Identity quaternion
            [0.0, 0.0, 0.0, 1.0]
        };

        VariationResult {
            position_offset,
            scale_mult,
            color_shift,
            rotation,
        }
    }
}

/// Result of variation generation.
struct VariationResult {
    position_offset: Vec3,
    scale_mult: f32,
    color_shift: [f32; 3],
    rotation: [f32; 4],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_particle_system_from_events() {
        let events = Arc::new(vec![
            Event::new(0.0, 1.0),
            Event::new(1.0, 0.8),
        ]);
        let config = ParticleConfig::default();
        let system = ParticleSystem::from_events(events, 5, config);

        assert_eq!(system.instance_count(), 0);
        assert!(system.visible);
    }

    #[test]
    fn test_particle_reset() {
        let events = Arc::new(vec![Event::new(0.0, 1.0)]);
        let mut config = ParticleConfig::default();
        config.seed = 42;
        let mut system = ParticleSystem::from_events(events, 1, config);

        system.spawn_instance(0.0, 0.0, 1.0);
        assert_eq!(system.instance_count(), 1);

        system.reset();
        assert_eq!(system.instance_count(), 0);
    }

    #[test]
    fn test_deterministic_variation() {
        let events = Arc::new(vec![Event::new(0.0, 1.0)]);
        let mut config = ParticleConfig::default();
        config.seed = 123;
        config.variation.position_spread = Vec3::new(1.0, 1.0, 1.0);

        let mut system1 = ParticleSystem::from_events(events.clone(), 1, config.clone());
        let mut system2 = ParticleSystem::from_events(events, 1, config);

        system1.spawn_instance(0.0, 0.0, 1.0);
        system2.spawn_instance(0.0, 0.0, 1.0);

        // Both should have the same variation due to same seed
        assert_eq!(
            system1.instances[0].local_offset.x,
            system2.instances[0].local_offset.x
        );
    }

    #[test]
    fn test_multiple_particles_have_different_positions() {
        let events = Arc::new(vec![Event::new(0.0, 1.0)]);
        let mut config = ParticleConfig::default();
        config.seed = 42;
        config.variation.position_spread = Vec3::new(1.0, 1.0, 1.0);

        let mut system = ParticleSystem::from_events(events, 10, config);

        // Spawn 10 particles
        for i in 0..10 {
            system.spawn_instance(i as f32 * 0.1, i as f32 * 0.1, 1.0);
        }

        assert_eq!(system.instance_count(), 10);

        // Verify particles have different positions (variation is working)
        let first_offset = system.instances[0].local_offset.x;
        let second_offset = system.instances[1].local_offset.x;
        assert!(
            (first_offset - second_offset).abs() > 0.001,
            "Particles should have different positions due to variation"
        );
    }

    #[test]
    fn test_seed_zero_produces_valid_variation() {
        // Seed 0 was previously degenerate (xorshift produces all zeros)
        // After fix, it should produce valid variation
        let events = Arc::new(vec![Event::new(0.0, 1.0)]);
        let mut config = ParticleConfig::default();
        config.seed = 0; // Explicitly test seed 0
        config.variation.position_spread = Vec3::new(1.0, 1.0, 1.0);

        let mut system = ParticleSystem::from_events(events, 2, config);

        system.spawn_instance(0.0, 0.0, 1.0);
        system.spawn_instance(0.1, 0.1, 1.0);

        // Both particles should exist
        assert_eq!(system.instance_count(), 2);

        // Particles should have different positions (RNG is not stuck at 0)
        let first_offset = system.instances[0].local_offset.x;
        let second_offset = system.instances[1].local_offset.x;
        assert!(
            (first_offset - second_offset).abs() > 0.001,
            "Seed 0 should produce valid variation after fix"
        );
    }
}
