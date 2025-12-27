// Particle system shader with billboarding support.
// Renders camera-facing quads with per-instance position, scale, and color.

struct ParticleUniforms {
    view_proj: mat4x4<f32>,
    camera_right: vec4<f32>,
    camera_up: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: ParticleUniforms;

struct VertexInput {
    // Per-vertex: quad corner position (-0.5 to 0.5)
    @location(0) local_position: vec2<f32>,
}

struct InstanceInput {
    // Per-instance data
    @location(1) world_position: vec3<f32>,
    @location(2) scale: f32,
    @location(3) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
}

@vertex
fn vs_particle(
    vertex: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    // Billboard: expand quad in camera space
    let right = uniforms.camera_right.xyz * vertex.local_position.x * instance.scale;
    let up = uniforms.camera_up.xyz * vertex.local_position.y * instance.scale;
    let world_pos = instance.world_position + right + up;

    var out: VertexOutput;
    out.clip_position = uniforms.view_proj * vec4<f32>(world_pos, 1.0);
    out.color = instance.color;
    out.uv = vertex.local_position + 0.5; // Convert to 0-1 range
    return out;
}

@fragment
fn fs_particle(in: VertexOutput) -> @location(0) vec4<f32> {
    // Simple circular particle with soft edges
    let center = vec2<f32>(0.5, 0.5);
    let dist = distance(in.uv, center) * 2.0; // Distance from center (0 to 1)

    // Soft circle falloff
    let alpha = 1.0 - smoothstep(0.8, 1.0, dist);

    // Discard fully transparent pixels
    if alpha < 0.01 {
        discard;
    }

    return vec4<f32>(in.color.rgb, in.color.a * alpha);
}

// Simple point rendering (no billboarding)
@vertex
fn vs_particle_point(
    @builtin(vertex_index) vertex_index: u32,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = uniforms.view_proj * vec4<f32>(instance.world_position, 1.0);
    out.color = instance.color;
    out.uv = vec2<f32>(0.5, 0.5);
    return out;
}

@fragment
fn fs_particle_point(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
