struct SparklineUniforms {
    color: vec4<f32>,
    offset: vec2<f32>,
    scale: vec2<f32>,
    capacity: f32,
}

@group(0) @binding(0)
var<uniform> spark_uniforms: SparklineUniforms;

struct SparklineOutput {
    @builtin(position) clip_position: vec4<f32>,
}

@vertex
fn vs_sparkline(@builtin(vertex_index) in_vertex_index: u32, @location(0) value: f32) -> SparklineOutput {
    var out: SparklineOutput;

    // Normalized X from 0 to 1
    let x_norm = f32(in_vertex_index) / spark_uniforms.capacity;

    // Map to screen space based on offset and scale
    // offset is bottom-left (or top-left depending on Y axis)
    // NDC: -1 to 1.

    let x_pos = spark_uniforms.offset.x + (x_norm * spark_uniforms.scale.x);
    let y_pos = spark_uniforms.offset.y + (value * spark_uniforms.scale.y);

    out.clip_position = vec4<f32>(x_pos, y_pos, 0.0, 1.0);
    return out;
}

@fragment
fn fs_sparkline() -> @location(0) vec4<f32> {
    return spark_uniforms.color;
}
