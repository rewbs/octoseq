// Mesh Particle Shader
// Renders instanced mesh geometry with per-instance position, scale, rotation, and color.

struct ViewUniforms {
    view_proj: mat4x4<f32>,
}

@group(0) @binding(0)
var<uniform> view: ViewUniforms;

// Vertex attributes from the mesh (per-vertex)
struct MeshVertex {
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>,
}

// Instance attributes (per-instance)
struct ParticleInstance {
    @location(3) instance_position: vec3<f32>,
    @location(4) instance_scale: f32,
    @location(5) instance_rotation: vec4<f32>,  // quaternion (x, y, z, w)
    @location(6) instance_color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

// Rotate a vector by a quaternion
// q = (x, y, z, w) where w is the scalar part
fn quat_rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    // Quaternion multiplication: q * v * q^-1
    // Using the optimized formula: v' = v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
    let qv = q.xyz;
    let uv = cross(qv, v);
    let uuv = cross(qv, uv);
    return v + 2.0 * (uv * q.w + uuv);
}

@vertex
fn vs_main(mesh: MeshVertex, instance: ParticleInstance) -> VertexOutput {
    var out: VertexOutput;

    // Apply rotation to mesh vertex position
    let rotated_pos = quat_rotate(instance.instance_rotation, mesh.position);

    // Apply scale
    let scaled_pos = rotated_pos * instance.instance_scale;

    // Apply translation (instance position)
    let world_pos = scaled_pos + instance.instance_position;

    // Transform to clip space
    out.clip_position = view.view_proj * vec4<f32>(world_pos, 1.0);

    // Blend mesh color with instance color
    // Use multiplicative blending: mesh_color * instance_color
    out.color = vec4<f32>(mesh.color, 1.0) * instance.instance_color;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Discard fully transparent pixels
    if (in.color.a < 0.01) {
        discard;
    }
    return in.color;
}
