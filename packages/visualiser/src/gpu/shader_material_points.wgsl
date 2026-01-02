// Points material shader
// Renders mesh vertices as points (unlit)

struct GlobalUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    time: f32,
    dt: f32,
    _time_padding: vec2<f32>,
    // Lighting (unused in points shader)
    light_direction: vec4<f32>,
    light_color: vec4<f32>,
    light_intensity: f32,
    ambient_intensity: f32,
    rim_intensity: f32,
    rim_power: f32,
    lighting_enabled: u32,
    entity_emissive: f32,
    _light_padding: vec2<u32>,
    camera_position: vec4<f32>,
}

struct MaterialUniforms {
    point_color: vec4<f32>,
    point_size: f32,
    _padding: vec3<f32>,
}

@group(0) @binding(0)
var<uniform> globals: GlobalUniforms;

@group(1) @binding(0)
var<uniform> material: MaterialUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world_pos = globals.model * vec4<f32>(input.position, 1.0);
    out.clip_position = globals.view_proj * world_pos;
    out.color = input.color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Points are always unlit
    let intensity = clamp(material.point_size, 0.1, 10.0);
    return material.point_color * vec4<f32>(in.color * intensity, 1.0);
}
