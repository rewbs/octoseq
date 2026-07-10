// Point cloud shader
// Renders each 3D position as a camera-facing circular sprite.

struct PointCloudUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    color: vec4<f32>,
    point_size: f32,
    _padding: f32,
    viewport_size: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: PointCloudUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) sprite_position: vec2<f32>,
}

@vertex
fn vs_main(input: VertexInput, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5,  0.5),
    );
    let corner = corners[vertex_index];
    let world_pos = uniforms.model * vec4<f32>(input.position, 1.0);
    var clip_position = uniforms.view_proj * world_pos;
    let safe_viewport = max(uniforms.viewport_size, vec2<f32>(1.0, 1.0));
    let pixel_to_ndc = vec2<f32>(2.0, 2.0) / safe_viewport;
    let sprite_offset = corner * uniforms.point_size * pixel_to_ndc * clip_position.w;
    clip_position = vec4<f32>(
        clip_position.xy + sprite_offset,
        clip_position.z,
        clip_position.w,
    );
    out.clip_position = clip_position;
    out.sprite_position = corner * 2.0;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let distance_from_center = length(in.sprite_position);
    if distance_from_center >= 1.0 {
        discard;
    }
    let edge_alpha = 1.0 - smoothstep(0.72, 1.0, distance_from_center);
    return vec4<f32>(uniforms.color.rgb, uniforms.color.a * edge_alpha);
}
