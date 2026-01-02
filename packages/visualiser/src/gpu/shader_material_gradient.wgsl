// Gradient material shader
// Two-tone gradient based on world position with optional lighting

struct GlobalUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    time: f32,
    dt: f32,
    _time_padding: vec2<f32>,
    // Lighting
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
    color_a: vec4<f32>,
    color_b: vec4<f32>,
    direction: vec3<f32>,
    blend: f32,
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
    @location(1) world_pos: vec3<f32>,
    @location(2) world_normal: vec3<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world_pos = globals.model * vec4<f32>(input.position, 1.0);
    out.clip_position = globals.view_proj * world_pos;
    out.world_pos = world_pos.xyz;
    out.color = input.color;

    let normal_matrix = mat3x3<f32>(
        globals.model[0].xyz,
        globals.model[1].xyz,
        globals.model[2].xyz
    );
    out.world_normal = normalize(normal_matrix * input.normal);

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Normalize direction
    let dir = normalize(material.direction);

    // Calculate gradient factor based on world position projected onto direction
    let projected = dot(in.world_pos, dir);
    let t = clamp(projected * 0.5 + 0.5, 0.0, 1.0);
    let adjusted_t = pow(t, 1.0 / (material.blend + 0.01));

    // Interpolate between colors
    let gradient_color = mix(material.color_a, material.color_b, adjusted_t);

    // Base color: vertex color * gradient
    var final_color = vec4<f32>(in.color, 1.0) * gradient_color;

    // Apply lighting if enabled
    if globals.lighting_enabled != 0u {
        let N = normalize(in.world_normal);
        let L = normalize(-globals.light_direction.xyz);
        let NdotL = dot(N, L);
        let half_lambert = NdotL * 0.5 + 0.5;
        let diffuse = half_lambert * globals.light_intensity;

        let V = normalize(globals.camera_position.xyz - in.world_pos);
        let rim = 1.0 - max(dot(N, V), 0.0);
        let rim_factor = pow(rim, globals.rim_power) * globals.rim_intensity;

        let lit_color = final_color.rgb * (
            globals.ambient_intensity +
            diffuse * globals.light_color.rgb +
            rim_factor * globals.light_color.rgb
        );
        final_color = vec4<f32>(lit_color, final_color.a);
    }

    // Add emissive contribution (unaffected by lighting)
    let emissive = final_color.rgb * globals.entity_emissive;
    final_color = vec4<f32>(final_color.rgb + emissive, final_color.a);

    return final_color;
}
