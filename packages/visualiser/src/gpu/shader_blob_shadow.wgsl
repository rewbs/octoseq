// Blob shadow shader
// Renders a soft ellipse on a ground plane for contact/fake shadows

struct GlobalUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    time: f32,
    dt: f32,
    _time_padding: vec2<f32>,
    // Lighting (unused in blob shadow shader)
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

struct ShadowUniforms {
    // Shadow center position (x, y, z) where y is the plane height
    center: vec4<f32>,
    // Shadow color (rgb) and opacity (a)
    color: vec4<f32>,
    // Radius (x, z) and softness (z), w unused
    params: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> globals: GlobalUniforms;

@group(1) @binding(0)
var<uniform> shadow: ShadowUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_pos: vec2<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // input.position is the local position on a unit plane (-0.5 to 0.5)
    // We scale it by the radius and position it at the shadow center
    let radius_x = shadow.params.x;
    let radius_z = shadow.params.y;

    // World position: scale and translate
    let world_pos = vec3<f32>(
        shadow.center.x + input.position.x * radius_x * 2.0,
        shadow.center.y,
        shadow.center.z + input.position.z * radius_z * 2.0
    );

    out.clip_position = globals.view_proj * vec4<f32>(world_pos, 1.0);

    // Pass normalized local position for ellipse calculation (-1 to 1)
    out.local_pos = input.position.xz * 2.0;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Calculate ellipse distance (1.0 at edge, 0.0 at center)
    let dist_sq = dot(in.local_pos, in.local_pos);
    let dist = sqrt(dist_sq);

    // Apply softness with smoothstep
    // softness controls how gradual the falloff is
    let softness = shadow.params.z;
    let inner = 1.0 - softness;
    let alpha = 1.0 - smoothstep(inner, 1.0, dist);

    // Final color with opacity
    let final_alpha = alpha * shadow.color.a;

    // Discard fully transparent pixels
    if final_alpha < 0.001 {
        discard;
    }

    return vec4<f32>(shadow.color.rgb, final_alpha);
}
