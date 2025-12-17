struct Uniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
}

struct SparklineUniforms {
    color: vec4<f32>,
    offset: vec2<f32>,
    scale: vec2<f32>,
    capacity: f32, // Passed as float
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(1) @binding(0)
var<uniform> spark_uniforms: SparklineUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@vertex
fn vs_main(model: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.color = model.color;
    out.clip_position = uniforms.view_proj * uniforms.model * vec4<f32>(model.position, 1.0);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}

// Sparkline Shader

struct SparklineOutput {
    @builtin(position) clip_position: vec4<f32>,
}

@vertex
fn vs_sparkline(@builtin(vertex_index) in_vertex_index: u32, @location(0) value: f32) -> SparklineOutput {
    var out: SparklineOutput;

    // x from 0 to 1 based on index
    let x_norm = f32(in_vertex_index) / spark_uniforms.capacity;

    // Scale and positioning
    // We want x to go from offset.x to offset.x + scale.x
    // y to go from offset.y to offset.y + value * scale.y

    // Input value is normalized 0-1 (mostly), but might exceed.
    // We map it to screen space -1 to 1.

    // Screen X: -1 is left, 1 is right.
    // Screen Y: -1 is bottom, 1 is top.

    // Let's treat uniforms.offset as the "origin" in NDC (-1 to 1)
    // and uniforms.scale as the size in NDC.

    let x_pos = spark_uniforms.offset.x + (x_norm * spark_uniforms.scale.x);
    let y_pos = spark_uniforms.offset.y + (value * spark_uniforms.scale.y);

    out.clip_position = vec4<f32>(x_pos, y_pos, 0.0, 1.0);
    return out;
}

@fragment
fn fs_sparkline() -> @location(0) vec4<f32> {
    return spark_uniforms.color;
}
