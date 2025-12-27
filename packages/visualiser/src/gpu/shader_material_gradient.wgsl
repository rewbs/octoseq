// Gradient material shader
// Two-tone gradient based on world position

struct GlobalUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    time: f32,
    dt: f32,
    _padding: vec2<f32>,
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
    // Normalize direction
    let dir = normalize(material.direction);

    // Calculate gradient factor based on world position projected onto direction
    // Assuming object is centered at origin, positions range roughly -0.5 to 0.5
    let projected = dot(in.world_pos, dir);

    // Map to 0-1 range (assuming -1 to 1 range in world space)
    let t = clamp(projected * 0.5 + 0.5, 0.0, 1.0);

    // Apply blend factor to control gradient sharpness
    let adjusted_t = pow(t, 1.0 / (material.blend + 0.01));

    // Interpolate between colors
    let gradient_color = mix(material.color_a, material.color_b, adjusted_t);

    // Multiply by vertex color
    return vec4<f32>(in.color, 1.0) * gradient_color;
}
