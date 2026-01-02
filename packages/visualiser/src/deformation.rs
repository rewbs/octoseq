//! Mesh deformation system.
//!
//! Provides predefined, parameterized deformations that can be applied to meshes.
//! Deformations are applied on the CPU to ensure determinism across WASM and native.

use crate::gpu::mesh::Vertex;

/// Axis for deformation operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DeformAxis {
    X,
    #[default]
    Y,
    Z,
}

impl DeformAxis {
    /// Parse axis from string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "x" => Some(Self::X),
            "y" => Some(Self::Y),
            "z" => Some(Self::Z),
            _ => None,
        }
    }

    /// Get the index of this axis (0=X, 1=Y, 2=Z).
    pub fn index(&self) -> usize {
        match self {
            Self::X => 0,
            Self::Y => 1,
            Self::Z => 2,
        }
    }
}

/// A deformation operation that can be applied to a mesh.
#[derive(Debug, Clone)]
pub enum Deformation {
    /// Twist vertices around an axis based on their position along that axis.
    Twist {
        /// Axis to twist around.
        axis: DeformAxis,
        /// Twist amount in radians per unit distance from center.
        amount: f32,
        /// Center position along the axis.
        center: f32,
    },

    /// Bend vertices toward an axis, creating an arc.
    Bend {
        /// Axis to bend around.
        axis: DeformAxis,
        /// Bend amount in radians.
        amount: f32,
        /// Center position along the axis where bending is minimal.
        center: f32,
    },

    /// Apply sinusoidal wave displacement.
    Wave {
        /// Axis along which the wave travels.
        axis: DeformAxis,
        /// Direction of displacement.
        direction: DeformAxis,
        /// Wave amplitude (displacement magnitude).
        amplitude: f32,
        /// Wave frequency (cycles per unit).
        frequency: f32,
        /// Wave phase offset.
        phase: f32,
    },

    /// Apply deterministic noise displacement.
    Noise {
        /// Noise scale (frequency).
        scale: f32,
        /// Displacement amplitude.
        amplitude: f32,
        /// Seed for deterministic noise.
        seed: u32,
    },
}

impl Default for Deformation {
    fn default() -> Self {
        Self::Twist {
            axis: DeformAxis::Y,
            amount: 0.0,
            center: 0.0,
        }
    }
}

/// Apply a list of deformations to vertices, returning new deformed vertices.
///
/// The original vertices are not modified. Deformations are applied in order.
pub fn apply_deformations(vertices: &[Vertex], deformations: &[Deformation]) -> Vec<Vertex> {
    if deformations.is_empty() {
        return vertices.to_vec();
    }

    let mut result: Vec<Vertex> = vertices.to_vec();

    for deform in deformations {
        apply_single_deformation(&mut result, deform);
    }

    result
}

/// Apply a single deformation to vertices in place.
fn apply_single_deformation(vertices: &mut [Vertex], deform: &Deformation) {
    match deform {
        Deformation::Twist { axis, amount, center } => {
            apply_twist(vertices, *axis, *amount, *center);
        }
        Deformation::Bend { axis, amount, center } => {
            apply_bend(vertices, *axis, *amount, *center);
        }
        Deformation::Wave { axis, direction, amplitude, frequency, phase } => {
            apply_wave(vertices, *axis, *direction, *amplitude, *frequency, *phase);
        }
        Deformation::Noise { scale, amplitude, seed } => {
            apply_noise(vertices, *scale, *amplitude, *seed);
        }
    }
}

/// Twist vertices around an axis.
///
/// Each vertex is rotated around the axis by an angle proportional to its
/// distance from the center along that axis.
fn apply_twist(vertices: &mut [Vertex], axis: DeformAxis, amount: f32, center: f32) {
    if amount.abs() < 1e-6 {
        return;
    }

    let axis_idx = axis.index();
    let (other1, other2) = match axis {
        DeformAxis::X => (1, 2), // Y and Z
        DeformAxis::Y => (0, 2), // X and Z
        DeformAxis::Z => (0, 1), // X and Y
    };

    for v in vertices.iter_mut() {
        let pos_along_axis = v.position[axis_idx];
        let angle = (pos_along_axis - center) * amount;

        let cos_a = angle.cos();
        let sin_a = angle.sin();

        let p1 = v.position[other1];
        let p2 = v.position[other2];

        v.position[other1] = p1 * cos_a - p2 * sin_a;
        v.position[other2] = p1 * sin_a + p2 * cos_a;
    }
}

/// Bend vertices around an axis.
///
/// Creates an arc effect by rotating vertices based on their position.
fn apply_bend(vertices: &mut [Vertex], axis: DeformAxis, amount: f32, center: f32) {
    if amount.abs() < 1e-6 {
        return;
    }

    let axis_idx = axis.index();

    // For bending, we create an arc in the plane perpendicular to the bend axis
    // The bend axis determines which direction "up" is
    let (forward_idx, up_idx) = match axis {
        DeformAxis::X => (2, 1), // Bend around X: forward=Z, up=Y
        DeformAxis::Y => (2, 0), // Bend around Y: forward=Z, up=X
        DeformAxis::Z => (0, 1), // Bend around Z: forward=X, up=Y
    };

    for v in vertices.iter_mut() {
        let pos_along_axis = v.position[axis_idx];
        let dist_from_center = pos_along_axis - center;

        // Calculate bend angle based on distance from center
        let angle = dist_from_center * amount;

        if angle.abs() < 1e-6 {
            continue;
        }

        let cos_a = angle.cos();
        let sin_a = angle.sin();

        // Apply rotation in the forward-up plane
        let forward = v.position[forward_idx];
        let up = v.position[up_idx];

        v.position[forward_idx] = forward * cos_a - up * sin_a;
        v.position[up_idx] = forward * sin_a + up * cos_a;
    }
}

/// Apply sinusoidal wave displacement.
fn apply_wave(
    vertices: &mut [Vertex],
    axis: DeformAxis,
    direction: DeformAxis,
    amplitude: f32,
    frequency: f32,
    phase: f32,
) {
    if amplitude.abs() < 1e-6 {
        return;
    }

    let axis_idx = axis.index();
    let dir_idx = direction.index();

    for v in vertices.iter_mut() {
        let pos = v.position[axis_idx];
        let offset = amplitude * (pos * frequency * std::f32::consts::TAU + phase).sin();
        v.position[dir_idx] += offset;
    }
}

/// Apply deterministic noise displacement.
///
/// Uses a simple deterministic hash-based noise for cross-platform consistency.
fn apply_noise(vertices: &mut [Vertex], scale: f32, amplitude: f32, seed: u32) {
    if amplitude.abs() < 1e-6 {
        return;
    }

    for v in vertices.iter_mut() {
        // Generate deterministic noise based on position and seed
        let noise_x = deterministic_noise_3d(
            v.position[0] * scale,
            v.position[1] * scale,
            v.position[2] * scale,
            seed,
        );
        let noise_y = deterministic_noise_3d(
            v.position[0] * scale + 17.3,
            v.position[1] * scale + 31.7,
            v.position[2] * scale + 47.1,
            seed,
        );
        let noise_z = deterministic_noise_3d(
            v.position[0] * scale + 73.9,
            v.position[1] * scale + 89.3,
            v.position[2] * scale + 97.7,
            seed,
        );

        // Displace along surface normal approximation (radial from origin)
        // For more accurate results, we'd need actual normals
        let len = (v.position[0].powi(2) + v.position[1].powi(2) + v.position[2].powi(2)).sqrt();
        if len > 1e-6 {
            let nx = v.position[0] / len;
            let ny = v.position[1] / len;
            let nz = v.position[2] / len;

            // Combine noise components with normal direction
            let displacement = (noise_x + noise_y + noise_z) / 3.0 * amplitude;
            v.position[0] += nx * displacement;
            v.position[1] += ny * displacement;
            v.position[2] += nz * displacement;
        } else {
            // Fallback for vertices at origin
            v.position[0] += noise_x * amplitude * 0.5;
            v.position[1] += noise_y * amplitude * 0.5;
            v.position[2] += noise_z * amplitude * 0.5;
        }
    }
}

/// Deterministic 3D noise function using hash-based approach.
///
/// Returns a value in range [-1, 1].
fn deterministic_noise_3d(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    // Use integer grid points and interpolate
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let iz = z.floor() as i32;

    let fx = x - x.floor();
    let fy = y - y.floor();
    let fz = z - z.floor();

    // Smoothstep interpolation weights
    let u = fx * fx * (3.0 - 2.0 * fx);
    let v = fy * fy * (3.0 - 2.0 * fy);
    let w = fz * fz * (3.0 - 2.0 * fz);

    // Hash corner values
    let n000 = hash_to_float(hash_3d(ix, iy, iz, seed));
    let n100 = hash_to_float(hash_3d(ix + 1, iy, iz, seed));
    let n010 = hash_to_float(hash_3d(ix, iy + 1, iz, seed));
    let n110 = hash_to_float(hash_3d(ix + 1, iy + 1, iz, seed));
    let n001 = hash_to_float(hash_3d(ix, iy, iz + 1, seed));
    let n101 = hash_to_float(hash_3d(ix + 1, iy, iz + 1, seed));
    let n011 = hash_to_float(hash_3d(ix, iy + 1, iz + 1, seed));
    let n111 = hash_to_float(hash_3d(ix + 1, iy + 1, iz + 1, seed));

    // Trilinear interpolation
    let nx00 = lerp(n000, n100, u);
    let nx10 = lerp(n010, n110, u);
    let nx01 = lerp(n001, n101, u);
    let nx11 = lerp(n011, n111, u);

    let nxy0 = lerp(nx00, nx10, v);
    let nxy1 = lerp(nx01, nx11, v);

    lerp(nxy0, nxy1, w)
}

/// Simple 3D hash function.
fn hash_3d(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    let mut h = seed;
    h = h.wrapping_add(x as u32).wrapping_mul(0x9e3779b9);
    h = h.wrapping_add(y as u32).wrapping_mul(0x85ebca6b);
    h = h.wrapping_add(z as u32).wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h = h.wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h
}

/// Convert hash to float in range [-1, 1].
fn hash_to_float(h: u32) -> f32 {
    (h as f32 / u32::MAX as f32) * 2.0 - 1.0
}

/// Linear interpolation.
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_vertices() -> Vec<Vertex> {
        let up = [0.0, 1.0, 0.0];
        vec![
            Vertex::new([0.0, 0.0, 0.0], up, [1.0; 3]),
            Vertex::new([1.0, 0.0, 0.0], up, [1.0; 3]),
            Vertex::new([0.0, 1.0, 0.0], up, [1.0; 3]),
            Vertex::new([0.0, 0.0, 1.0], up, [1.0; 3]),
        ]
    }

    #[test]
    fn test_zero_deformation() {
        let vertices = make_test_vertices();
        let deformations = vec![
            Deformation::Twist { axis: DeformAxis::Y, amount: 0.0, center: 0.0 },
        ];

        let result = apply_deformations(&vertices, &deformations);
        assert_eq!(result.len(), vertices.len());

        // Vertices should be unchanged
        for (orig, deformed) in vertices.iter().zip(result.iter()) {
            assert!((orig.position[0] - deformed.position[0]).abs() < 1e-6);
            assert!((orig.position[1] - deformed.position[1]).abs() < 1e-6);
            assert!((orig.position[2] - deformed.position[2]).abs() < 1e-6);
        }
    }

    #[test]
    fn test_twist_deformation() {
        let vertices = vec![
            Vertex::new([1.0, 1.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
        ];
        let deformations = vec![
            Deformation::Twist {
                axis: DeformAxis::Y,
                amount: std::f32::consts::FRAC_PI_2, // 90 degrees per unit
                center: 0.0,
            },
        ];

        let result = apply_deformations(&vertices, &deformations);

        // At y=1, should rotate 90 degrees around Y axis
        // (1, 1, 0) -> (0, 1, 1) approximately
        assert!((result[0].position[0] - 0.0).abs() < 1e-5);
        assert!((result[0].position[1] - 1.0).abs() < 1e-5);
        assert!((result[0].position[2] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_wave_deformation() {
        let vertices = vec![
            Vertex::new([0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
            Vertex::new([0.5, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0; 3]),
        ];
        let deformations = vec![
            Deformation::Wave {
                axis: DeformAxis::X,
                direction: DeformAxis::Y,
                amplitude: 1.0,
                frequency: 1.0,
                phase: 0.0,
            },
        ];

        let result = apply_deformations(&vertices, &deformations);

        // At x=0, sin(0) = 0
        assert!((result[0].position[1] - 0.0).abs() < 1e-5);
        // At x=0.5, sin(pi) = 0
        assert!((result[1].position[1] - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_noise_determinism() {
        let vertices = make_test_vertices();
        let deformations = vec![
            Deformation::Noise { scale: 1.0, amplitude: 0.1, seed: 42 },
        ];

        let result1 = apply_deformations(&vertices, &deformations);
        let result2 = apply_deformations(&vertices, &deformations);

        // Same seed should produce identical results
        for (v1, v2) in result1.iter().zip(result2.iter()) {
            assert!((v1.position[0] - v2.position[0]).abs() < 1e-6);
            assert!((v1.position[1] - v2.position[1]).abs() < 1e-6);
            assert!((v1.position[2] - v2.position[2]).abs() < 1e-6);
        }
    }

    #[test]
    fn test_deformation_axis_parsing() {
        assert_eq!(DeformAxis::from_str("x"), Some(DeformAxis::X));
        assert_eq!(DeformAxis::from_str("Y"), Some(DeformAxis::Y));
        assert_eq!(DeformAxis::from_str("z"), Some(DeformAxis::Z));
        assert_eq!(DeformAxis::from_str("invalid"), None);
    }
}
