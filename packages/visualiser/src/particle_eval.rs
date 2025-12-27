//! Particle system evaluation and GPU instance generation.
//!
//! This module handles per-frame particle system updates:
//! - Spawning new instances from events or signals
//! - Culling expired instances
//! - Generating GPU-ready instance data

use bytemuck::{Pod, Zeroable};

/// GPU instance data for point/billboard particles.
#[allow(dead_code)]
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct GpuParticleInstance {
    pub position: [f32; 3],
    pub scale: f32,
    pub color: [f32; 4],
}

/// GPU instance data for mesh-based particles.
/// Includes rotation quaternion for per-instance orientation.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct GpuMeshParticleInstance {
    /// World position of the particle.
    pub position: [f32; 3],
    /// Uniform scale factor.
    pub scale: f32,
    /// Rotation quaternion [x, y, z, w].
    pub rotation: [f32; 4],
    /// RGBA color with alpha for opacity.
    pub color: [f32; 4],
}

impl GpuMeshParticleInstance {
    /// Returns the vertex buffer layout for instanced rendering.
    /// This should be used as the second vertex buffer (slot 1) with step_mode::Instance.
    pub fn desc<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<GpuMeshParticleInstance>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                // position: vec3<f32>
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 3, // After mesh vertex attributes (0, 1, 2)
                    format: wgpu::VertexFormat::Float32x3,
                },
                // scale: f32
                wgpu::VertexAttribute {
                    offset: 12,
                    shader_location: 4,
                    format: wgpu::VertexFormat::Float32,
                },
                // rotation: vec4<f32> (quaternion)
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 5,
                    format: wgpu::VertexFormat::Float32x4,
                },
                // color: vec4<f32>
                wgpu::VertexAttribute {
                    offset: 32,
                    shader_location: 6,
                    format: wgpu::VertexFormat::Float32x4,
                },
            ],
        }
    }
}
use crate::particle::{EmissionSource, ParticleEnvelope, ParticleSystem, StreamMode};
use crate::signal::{EasingFunction, EnvelopeShape};

/// Evaluation context for particle systems.
pub struct ParticleEvalContext {
    /// Current time in seconds.
    pub current_time_secs: f32,
    /// Current beat position.
    pub current_beat: f32,
    /// Seconds per beat (for timing conversions).
    pub secs_per_beat: f32,
    /// Delta time since last frame.
    pub dt: f32,
    /// Delta beats since last frame.
    pub dt_beats: f32,
}

/// Update a particle system: spawn new instances and cull expired ones.
pub fn update_particle_system(system: &mut ParticleSystem, ctx: &ParticleEvalContext) {
    // First, cull expired instances
    let lifetime_secs = system.config.lifetime_beats * ctx.secs_per_beat;
    system.instances.retain(|instance| {
        ctx.current_time_secs - instance.spawn_time_secs < lifetime_secs
    });

    // Collect spawn requests to avoid borrowing issues
    let spawn_requests = collect_spawn_requests(system, ctx);

    // Spawn new instances
    for request in spawn_requests {
        system.spawn_instance(request.time_secs, request.beat, request.weight);
    }
}

/// A request to spawn a particle instance.
struct SpawnRequest {
    time_secs: f32,
    beat: f32,
    weight: f32,
}

/// Collect spawn requests based on emission source.
fn collect_spawn_requests(system: &mut ParticleSystem, ctx: &ParticleEvalContext) -> Vec<SpawnRequest> {
    let mut requests = Vec::new();

    match &mut system.source {
        EmissionSource::Events {
            events,
            instances_per_event,
            next_event_index,
        } => {
            // Spawn particles for events that have occurred
            while *next_event_index < events.len() {
                let event = &events[*next_event_index];
                if event.time <= ctx.current_time_secs {
                    // Spawn instances for this event
                    for _ in 0..*instances_per_event {
                        requests.push(SpawnRequest {
                            time_secs: event.time,
                            beat: event.beat_position.unwrap_or(0.0),
                            weight: event.weight,
                        });
                    }
                    *next_event_index += 1;
                } else {
                    break;
                }
            }
        }
        EmissionSource::Stream {
            mode,
            accumulator,
            prev_value,
            ..
        } => {
            // For stream mode, we need to evaluate the signal
            // For now, use a placeholder value (actual signal evaluation happens elsewhere)
            let signal_value = 0.5_f32; // This would be evaluated from the signal

            match mode {
                StreamMode::Proportional { rate_per_beat } => {
                    // Accumulate emission count
                    let emission_rate = signal_value * *rate_per_beat * ctx.dt_beats;
                    *accumulator += emission_rate;

                    // Spawn whole instances
                    while *accumulator >= 1.0 {
                        requests.push(SpawnRequest {
                            time_secs: ctx.current_time_secs,
                            beat: ctx.current_beat,
                            weight: signal_value,
                        });
                        *accumulator -= 1.0;
                    }
                }
                StreamMode::Threshold {
                    threshold,
                    instances_per_burst,
                } => {
                    // Check for threshold crossing (rising edge)
                    if signal_value >= *threshold && *prev_value < *threshold {
                        for _ in 0..*instances_per_burst {
                            requests.push(SpawnRequest {
                                time_secs: ctx.current_time_secs,
                                beat: ctx.current_beat,
                                weight: signal_value,
                            });
                        }
                    }
                    *prev_value = signal_value;
                }
            }
        }
    }

    requests
}

/// Generate GPU-ready particle instances from a particle system.
pub fn generate_gpu_instances(
    system: &ParticleSystem,
    ctx: &ParticleEvalContext,
) -> Vec<GpuParticleInstance> {
    let lifetime_secs = system.config.lifetime_beats * ctx.secs_per_beat;

    system
        .instances
        .iter()
        .filter_map(|instance| {
            let age_secs = ctx.current_time_secs - instance.spawn_time_secs;
            if age_secs < 0.0 || age_secs >= lifetime_secs {
                return None;
            }

            let age_beats = age_secs / ctx.secs_per_beat;
            let envelope_value = evaluate_particle_envelope(age_beats, &system.config.envelope);

            // Apply envelope to scale and opacity
            let scale = system.config.base_scale * instance.local_scale * envelope_value;
            let opacity = envelope_value * instance.event_weight;

            // Calculate world position
            let position = [
                system.transform.position.x + instance.local_offset.x,
                system.transform.position.y + instance.local_offset.y,
                system.transform.position.z + instance.local_offset.z,
            ];

            // Apply color shift
            let color = [
                (system.config.base_color[0] + instance.color_shift[0]).clamp(0.0, 1.0),
                (system.config.base_color[1] + instance.color_shift[1]).clamp(0.0, 1.0),
                (system.config.base_color[2] + instance.color_shift[2]).clamp(0.0, 1.0),
                system.config.base_color[3] * opacity,
            ];

            Some(GpuParticleInstance {
                position,
                scale,
                color,
            })
        })
        .collect()
}

/// Generate GPU-ready mesh particle instances from a particle system.
/// Similar to `generate_gpu_instances` but includes rotation quaternion.
pub fn generate_mesh_particle_instances(
    system: &ParticleSystem,
    ctx: &ParticleEvalContext,
    base_mesh_scale: f32,
) -> Vec<GpuMeshParticleInstance> {
    let lifetime_secs = system.config.lifetime_beats * ctx.secs_per_beat;

    system
        .instances
        .iter()
        .filter_map(|instance| {
            let age_secs = ctx.current_time_secs - instance.spawn_time_secs;
            if age_secs < 0.0 || age_secs >= lifetime_secs {
                return None;
            }

            let age_beats = age_secs / ctx.secs_per_beat;
            let envelope_value = evaluate_particle_envelope(age_beats, &system.config.envelope);

            // Apply envelope to scale and opacity
            let scale = base_mesh_scale * system.config.base_scale * instance.local_scale * envelope_value;
            let opacity = envelope_value * instance.event_weight;

            // Calculate world position
            let position = [
                system.transform.position.x + instance.local_offset.x,
                system.transform.position.y + instance.local_offset.y,
                system.transform.position.z + instance.local_offset.z,
            ];

            // Apply color shift
            let color = [
                (system.config.base_color[0] + instance.color_shift[0]).clamp(0.0, 1.0),
                (system.config.base_color[1] + instance.color_shift[1]).clamp(0.0, 1.0),
                (system.config.base_color[2] + instance.color_shift[2]).clamp(0.0, 1.0),
                system.config.base_color[3] * opacity,
            ];

            // Use local rotation from variation (quaternion xyzw)
            let rotation = instance.local_rotation;

            Some(GpuMeshParticleInstance {
                position,
                scale,
                rotation,
                color,
            })
        })
        .collect()
}

/// Evaluate the particle envelope at a given age.
pub fn evaluate_particle_envelope(age_beats: f32, envelope: &ParticleEnvelope) -> f32 {
    let raw_value = match envelope.shape {
        EnvelopeShape::Impulse => {
            if age_beats < 0.01 {
                1.0
            } else {
                0.0
            }
        }
        EnvelopeShape::Step => 1.0,
        EnvelopeShape::AttackDecay => {
            if age_beats < envelope.attack_beats {
                // Attack phase
                age_beats / envelope.attack_beats
            } else {
                // Decay phase
                let decay_progress = (age_beats - envelope.attack_beats) / envelope.decay_beats;
                (1.0 - decay_progress).max(0.0)
            }
        }
        EnvelopeShape::Adsr => {
            // Simplified ADSR (no sustain/release params in this context)
            if age_beats < envelope.attack_beats {
                age_beats / envelope.attack_beats
            } else {
                let decay_progress = (age_beats - envelope.attack_beats) / envelope.decay_beats;
                (1.0 - decay_progress * 0.3).max(0.0) // Decay to 70% sustain
            }
        }
        EnvelopeShape::Gaussian => {
            let sigma = envelope.width_beats / 2.35; // FWHM to sigma
            let center = envelope.width_beats / 2.0;
            let x = age_beats - center;
            (-x * x / (2.0 * sigma * sigma)).exp()
        }
        EnvelopeShape::ExponentialDecay => {
            let decay_rate = 1.0 / envelope.decay_beats;
            (-age_beats * decay_rate).exp()
        }
    };

    // Apply easing
    apply_easing(raw_value, envelope.easing)
}

/// Apply an easing function to a value.
fn apply_easing(t: f32, easing: EasingFunction) -> f32 {
    match easing {
        EasingFunction::Linear => t,
        EasingFunction::QuadraticIn => t * t,
        EasingFunction::QuadraticOut => t * (2.0 - t),
        EasingFunction::QuadraticInOut => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                -1.0 + (4.0 - 2.0 * t) * t
            }
        }
        EasingFunction::CubicIn => t * t * t,
        EasingFunction::CubicOut => {
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }
        EasingFunction::CubicInOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                let t1 = 2.0 * t - 2.0;
                0.5 * t1 * t1 * t1 + 1.0
            }
        }
        EasingFunction::ExponentialIn => {
            if t == 0.0 {
                0.0
            } else {
                (2.0_f32).powf(10.0 * (t - 1.0))
            }
        }
        EasingFunction::ExponentialOut => {
            if t == 1.0 {
                1.0
            } else {
                1.0 - (2.0_f32).powf(-10.0 * t)
            }
        }
        EasingFunction::SmoothStep => t * t * (3.0 - 2.0 * t),
        EasingFunction::Elastic => {
            if t == 0.0 || t == 1.0 {
                t
            } else {
                let p = 0.3;
                let s = p / 4.0;
                (2.0_f32).powf(-10.0 * t) * ((t - s) * std::f32::consts::TAU / p).sin() + 1.0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::particle::ParticleEnvelope;

    #[test]
    fn test_evaluate_envelope_impulse() {
        let envelope = ParticleEnvelope {
            shape: EnvelopeShape::Impulse,
            ..Default::default()
        };
        assert!((evaluate_particle_envelope(0.0, &envelope) - 1.0).abs() < 0.01);
        assert!((evaluate_particle_envelope(0.1, &envelope) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_evaluate_envelope_exponential_decay() {
        let envelope = ParticleEnvelope {
            shape: EnvelopeShape::ExponentialDecay,
            decay_beats: 1.0,
            ..Default::default()
        };
        let v0 = evaluate_particle_envelope(0.0, &envelope);
        let v1 = evaluate_particle_envelope(1.0, &envelope);
        assert!((v0 - 1.0).abs() < 0.01);
        assert!(v1 < v0); // Should decay
    }

    #[test]
    fn test_evaluate_envelope_gaussian() {
        let envelope = ParticleEnvelope {
            shape: EnvelopeShape::Gaussian,
            width_beats: 1.0,
            ..Default::default()
        };
        let v_center = evaluate_particle_envelope(0.5, &envelope);
        let v_edge = evaluate_particle_envelope(0.0, &envelope);
        assert!(v_center > v_edge); // Peak should be at center
    }

    #[test]
    fn test_apply_easing_smoothstep() {
        let v = apply_easing(0.5, EasingFunction::SmoothStep);
        assert!((v - 0.5).abs() < 0.01); // Smoothstep(0.5) = 0.5
    }
}
