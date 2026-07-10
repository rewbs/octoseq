// Screen-space thick polyline shader.
// Each instance is one 3D line segment expanded to a six-vertex quad.

struct PolylineUniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    color: vec4<f32>,
    line_width: f32,
    _padding: f32,
    viewport_size: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: PolylineUniforms;

struct SegmentInput {
    @location(0) start: vec3<f32>,
    @location(1) end: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) edge_distance: f32,
}

@vertex
fn vs_main(input: SegmentInput, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0,  1.0),
        vec2<f32>(0.0, -1.0),
        vec2<f32>(1.0,  1.0),
        vec2<f32>(0.0,  1.0),
    );
    let corner = corners[vertex_index];

    let start_clip = uniforms.view_proj * uniforms.model * vec4<f32>(input.start, 1.0);
    let end_clip = uniforms.view_proj * uniforms.model * vec4<f32>(input.end, 1.0);
    let start_ndc = start_clip.xy / start_clip.w;
    let end_ndc = end_clip.xy / end_clip.w;
    let safe_viewport = max(uniforms.viewport_size, vec2<f32>(1.0, 1.0));
    let screen_direction = (end_ndc - start_ndc) * safe_viewport;
    let direction_length = max(length(screen_direction), 0.0001);
    let normal = vec2<f32>(-screen_direction.y, screen_direction.x) / direction_length;
    let offset_ndc = normal * corner.y * uniforms.line_width / safe_viewport;

    var clip_position = mix(start_clip, end_clip, corner.x);
    let base_ndc = mix(start_ndc, end_ndc, corner.x);
    clip_position = vec4<f32>(
        (base_ndc + offset_ndc) * clip_position.w,
        clip_position.z,
        clip_position.w,
    );

    out.clip_position = clip_position;
    out.edge_distance = corner.y;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let edge_alpha = 1.0 - smoothstep(0.72, 1.0, abs(in.edge_distance));
    return vec4<f32>(uniforms.color.rgb, uniforms.color.a * edge_alpha);
}
