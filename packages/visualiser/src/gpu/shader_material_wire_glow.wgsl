// Wire Glow material shader
// Wireframe material with additive glow effect

struct GlobalUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    time: f32,
    dt: f32,
    _padding: vec2<f32>,
}

struct MaterialUniforms {
    core_color: vec4<f32>,
    glow_color: vec4<f32>,
    glow_intensity: f32,
    _padding: vec3<f32>,
}

@group(0) @binding(0)
var<uniform> globals: GlobalUniforms;

@group(1) @binding(0)
var<uniform> material: MaterialUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) world_pos: vec3<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world_pos = globals.model * vec4<f32>(input.position, 1.0);
    out.clip_position = globals.view_proj * world_pos;
    out.world_pos = world_pos.xyz;
    out.color = input.color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Core wire color
    let core = material.core_color;

    // Add glow based on intensity
    let glow = material.glow_color * material.glow_intensity;

    // Combine: core + glow
    let final_color = vec4<f32>(
        core.rgb + glow.rgb,
        max(core.a, glow.a)
    );

    return final_color;
}
