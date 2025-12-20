struct SparklineUniforms {
    color: vec4<f32>,
    offset: vec2<f32>,
    scale: vec2<f32>,
    count: f32,      // Number of valid points
    max_points: f32, // Maximum capacity
}

@group(0) @binding(0)
var<uniform> spark_uniforms: SparklineUniforms;

struct SparklineOutput {
    @builtin(position) clip_position: vec4<f32>,
}

// Vertex input is x,y pairs
@vertex
fn vs_sparkline(@builtin(vertex_index) in_vertex_index: u32, @location(0) point: vec2<f32>) -> SparklineOutput {
    var out: SparklineOutput;

    // Normalize X based on vertex index (0 to 1)
    let x_norm = f32(in_vertex_index) / spark_uniforms.count;

    // Map to screen space based on offset and scale
    // X: use normalized position from 0 to 1
    // Y: use the point's Y value
    let x_pos = spark_uniforms.offset.x + (x_norm * spark_uniforms.scale.x);
    let y_pos = spark_uniforms.offset.y + (point.y * spark_uniforms.scale.y);

    out.clip_position = vec4<f32>(x_pos, y_pos, 0.0, 1.0);
    return out;
}

@fragment
fn fs_sparkline() -> @location(0) vec4<f32> {
    return spark_uniforms.color;
}
