//! Material system for host-defined shader programs with script-exposed parameters.
//!
//! Materials are predefined by the host (Rust code) and referenced by scripts.
//! Scripts can select materials and set exposed parameters, but cannot define
//! new shaders or modify material behavior.

use std::collections::HashMap;
use std::sync::Arc;

use crate::feedback::SignalOrF32;
use crate::signal_eval::EvalContext;

/// Unique identifier for a material.
pub type MaterialId = String;

/// Types of shader parameters that can be exposed to scripts.
#[derive(Clone, Debug, PartialEq)]
pub enum ParamType {
    /// Single float value.
    Float,
    /// 2D vector (x, y).
    Vec2,
    /// 3D vector (x, y, z).
    Vec3,
    /// 4D vector (x, y, z, w).
    Vec4,
    /// RGBA color (r, g, b, a) - values clamped to 0-1.
    Color,
}

/// Runtime value for a shader parameter.
#[derive(Clone, Debug, PartialEq)]
pub enum ParamValue {
    Float(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
}

impl Default for ParamValue {
    fn default() -> Self {
        ParamValue::Float(0.0)
    }
}

impl ParamValue {
    /// Convert to bytes for GPU upload.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            ParamValue::Float(v) => bytemuck::cast_slice(&[*v]).to_vec(),
            ParamValue::Vec2(v) => bytemuck::cast_slice(v).to_vec(),
            ParamValue::Vec3(v) => bytemuck::cast_slice(v).to_vec(),
            ParamValue::Vec4(v) => bytemuck::cast_slice(v).to_vec(),
        }
    }

    /// Size in bytes.
    pub fn byte_size(&self) -> usize {
        match self {
            ParamValue::Float(_) => 4,
            ParamValue::Vec2(_) => 8,
            ParamValue::Vec3(_) => 12,
            ParamValue::Vec4(_) => 16,
        }
    }

    /// Get as float, returning 0.0 for non-float types.
    pub fn as_float(&self) -> f32 {
        match self {
            ParamValue::Float(v) => *v,
            _ => 0.0,
        }
    }

    /// Get as vec4, padding with zeros for smaller types.
    pub fn as_vec4(&self) -> [f32; 4] {
        match self {
            ParamValue::Float(v) => [*v, 0.0, 0.0, 0.0],
            ParamValue::Vec2(v) => [v[0], v[1], 0.0, 0.0],
            ParamValue::Vec3(v) => [v[0], v[1], v[2], 0.0],
            ParamValue::Vec4(v) => *v,
        }
    }
}

// ============================================================================
// Signal-enabled Parameter Types (following "Signals Everywhere" principle)
// ============================================================================

/// A 2D vector where each component can be a static f32 or a dynamic Signal.
#[derive(Clone, Debug)]
pub struct Vec2Signal {
    pub x: SignalOrF32,
    pub y: SignalOrF32,
}

impl Vec2Signal {
    /// Create a new Vec2Signal with static values.
    pub fn new(x: f32, y: f32) -> Self {
        Self {
            x: SignalOrF32::Scalar(x),
            y: SignalOrF32::Scalar(y),
        }
    }

    /// Evaluate all components to produce a static [f32; 2].
    pub fn evaluate(&self, ctx: &mut EvalContext) -> [f32; 2] {
        [self.x.evaluate(ctx), self.y.evaluate(ctx)]
    }
}

/// A 3D vector where each component can be a static f32 or a dynamic Signal.
#[derive(Clone, Debug)]
pub struct Vec3Signal {
    pub x: SignalOrF32,
    pub y: SignalOrF32,
    pub z: SignalOrF32,
}

impl Vec3Signal {
    /// Create a new Vec3Signal with static values.
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self {
            x: SignalOrF32::Scalar(x),
            y: SignalOrF32::Scalar(y),
            z: SignalOrF32::Scalar(z),
        }
    }

    /// Evaluate all components to produce a static [f32; 3].
    pub fn evaluate(&self, ctx: &mut EvalContext) -> [f32; 3] {
        [
            self.x.evaluate(ctx),
            self.y.evaluate(ctx),
            self.z.evaluate(ctx),
        ]
    }
}

/// A 4D vector where each component can be a static f32 or a dynamic Signal.
/// Used for colors and other 4-component values.
#[derive(Clone, Debug)]
pub struct Vec4Signal {
    pub x: SignalOrF32,
    pub y: SignalOrF32,
    pub z: SignalOrF32,
    pub w: SignalOrF32,
}

impl Vec4Signal {
    /// Create a new Vec4Signal with static values.
    pub fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self {
            x: SignalOrF32::Scalar(x),
            y: SignalOrF32::Scalar(y),
            z: SignalOrF32::Scalar(z),
            w: SignalOrF32::Scalar(w),
        }
    }

    /// Evaluate all components to produce a static [f32; 4].
    pub fn evaluate(&self, ctx: &mut EvalContext) -> [f32; 4] {
        [
            self.x.evaluate(ctx),
            self.y.evaluate(ctx),
            self.z.evaluate(ctx),
            self.w.evaluate(ctx),
        ]
    }
}

/// Runtime value for a shader parameter with Signal support.
///
/// This is the script-facing type that supports both static values and Signals.
/// At render time, these are evaluated to produce ParamValue (GPU-ready values).
#[derive(Clone, Debug)]
pub enum MaterialParamValue {
    Float(SignalOrF32),
    Vec2(Vec2Signal),
    Vec3(Vec3Signal),
    Vec4(Vec4Signal),
}

impl Default for MaterialParamValue {
    fn default() -> Self {
        MaterialParamValue::Float(SignalOrF32::Scalar(0.0))
    }
}

impl MaterialParamValue {
    /// Evaluate the parameter to produce a GPU-ready ParamValue.
    pub fn evaluate(&self, ctx: &mut EvalContext) -> ParamValue {
        match self {
            MaterialParamValue::Float(v) => ParamValue::Float(v.evaluate(ctx)),
            MaterialParamValue::Vec2(v) => ParamValue::Vec2(v.evaluate(ctx)),
            MaterialParamValue::Vec3(v) => ParamValue::Vec3(v.evaluate(ctx)),
            MaterialParamValue::Vec4(v) => ParamValue::Vec4(v.evaluate(ctx)),
        }
    }

    /// Get the static value if all components are scalars (no signals).
    /// Returns None if any component contains a Signal.
    ///
    /// This is useful for extracting default values which are always static.
    pub fn as_static(&self) -> Option<ParamValue> {
        match self {
            MaterialParamValue::Float(v) => {
                if let SignalOrF32::Scalar(val) = v {
                    Some(ParamValue::Float(*val))
                } else {
                    None
                }
            }
            MaterialParamValue::Vec2(v) => {
                if let (SignalOrF32::Scalar(x), SignalOrF32::Scalar(y)) = (&v.x, &v.y) {
                    Some(ParamValue::Vec2([*x, *y]))
                } else {
                    None
                }
            }
            MaterialParamValue::Vec3(v) => {
                if let (SignalOrF32::Scalar(x), SignalOrF32::Scalar(y), SignalOrF32::Scalar(z)) =
                    (&v.x, &v.y, &v.z)
                {
                    Some(ParamValue::Vec3([*x, *y, *z]))
                } else {
                    None
                }
            }
            MaterialParamValue::Vec4(v) => {
                if let (
                    SignalOrF32::Scalar(x),
                    SignalOrF32::Scalar(y),
                    SignalOrF32::Scalar(z),
                    SignalOrF32::Scalar(w),
                ) = (&v.x, &v.y, &v.z, &v.w)
                {
                    Some(ParamValue::Vec4([*x, *y, *z, *w]))
                } else {
                    None
                }
            }
        }
    }

    /// Create from a static f32 value.
    pub fn from_float(value: f32) -> Self {
        MaterialParamValue::Float(SignalOrF32::Scalar(value))
    }

    /// Create from a static vec2 value.
    pub fn from_vec2(value: [f32; 2]) -> Self {
        MaterialParamValue::Vec2(Vec2Signal::new(value[0], value[1]))
    }

    /// Create from a static vec3 value.
    pub fn from_vec3(value: [f32; 3]) -> Self {
        MaterialParamValue::Vec3(Vec3Signal::new(value[0], value[1], value[2]))
    }

    /// Create from a static vec4/color value.
    pub fn from_vec4(value: [f32; 4]) -> Self {
        MaterialParamValue::Vec4(Vec4Signal::new(value[0], value[1], value[2], value[3]))
    }
}

/// A shader parameter definition.
#[derive(Clone, Debug)]
pub struct ParamDef {
    /// Parameter name (used in scripts and shaders).
    pub name: String,
    /// Type of the parameter.
    pub param_type: ParamType,
    /// Default value when not specified by script (supports Signals).
    pub default_value: MaterialParamValue,
    /// Optional minimum value (for Float type).
    pub min: Option<f32>,
    /// Optional maximum value (for Float type).
    pub max: Option<f32>,
    /// Human-readable description.
    pub description: String,
}

impl ParamDef {
    /// Create a new float parameter definition.
    pub fn float(name: impl Into<String>, default: f32) -> Self {
        Self {
            name: name.into(),
            param_type: ParamType::Float,
            default_value: MaterialParamValue::from_float(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    /// Create a new vec4/color parameter definition.
    pub fn color(name: impl Into<String>, default: [f32; 4]) -> Self {
        Self {
            name: name.into(),
            param_type: ParamType::Color,
            default_value: MaterialParamValue::from_vec4(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    /// Create a new vec3 parameter definition.
    pub fn vec3(name: impl Into<String>, default: [f32; 3]) -> Self {
        Self {
            name: name.into(),
            param_type: ParamType::Vec3,
            default_value: MaterialParamValue::from_vec3(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    /// Builder: set min/max range.
    pub fn with_range(mut self, min: f32, max: f32) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    /// Builder: set description.
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }
}

/// Primitive topology for materials.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MaterialTopology {
    /// Triangle list (standard solid rendering).
    #[default]
    Triangles,
    /// Line list (wireframe rendering using edge indices).
    Lines,
    /// Point list (render vertices as points).
    Points,
}

impl MaterialTopology {
    /// Convert to wgpu primitive topology.
    pub fn to_wgpu(&self) -> wgpu::PrimitiveTopology {
        match self {
            MaterialTopology::Triangles => wgpu::PrimitiveTopology::TriangleList,
            MaterialTopology::Lines => wgpu::PrimitiveTopology::LineList,
            MaterialTopology::Points => wgpu::PrimitiveTopology::PointList,
        }
    }

    /// Check if this topology uses edge indices (Lines) vs triangle indices (Triangles).
    pub fn uses_edge_indices(&self) -> bool {
        matches!(self, MaterialTopology::Lines)
    }

    /// Check if this topology requires indices at all.
    pub fn uses_indices(&self) -> bool {
        !matches!(self, MaterialTopology::Points)
    }
}

/// Blend modes for materials.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BlendMode {
    /// No blending, fully opaque.
    #[default]
    Opaque,
    /// Standard alpha blending.
    AlphaBlend,
    /// Additive blending (for glows, particles).
    Additive,
    /// Multiply blending.
    Multiply,
}

impl BlendMode {
    /// Convert to wgpu blend state.
    pub fn to_blend_state(&self) -> wgpu::BlendState {
        match self {
            BlendMode::Opaque => wgpu::BlendState::REPLACE,
            BlendMode::AlphaBlend => wgpu::BlendState::ALPHA_BLENDING,
            BlendMode::Additive => wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::SrcAlpha,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
            },
            BlendMode::Multiply => wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::Dst,
                    dst_factor: wgpu::BlendFactor::Zero,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent::OVER,
            },
        }
    }
}

/// A host-defined material with shader and parameters.
#[derive(Clone)]
pub struct Material {
    /// Unique identifier.
    pub id: MaterialId,
    /// Human-readable name.
    pub name: String,
    /// Description of the material.
    pub description: String,
    /// Vertex shader entry point.
    pub vertex_entry: String,
    /// Fragment shader entry point.
    pub fragment_entry: String,
    /// Parameter schema.
    pub params: Vec<ParamDef>,
    /// Blend mode.
    pub blend_mode: BlendMode,
    /// Face culling mode.
    pub cull_mode: Option<wgpu::Face>,
    /// Whether to write to depth buffer.
    pub depth_write: bool,
    /// Primitive topology for this material.
    pub topology: MaterialTopology,
}

impl Material {
    /// Create a new material builder.
    pub fn builder(id: impl Into<String>) -> MaterialBuilder {
        MaterialBuilder::new(id)
    }

    /// Get the default value for a parameter by name.
    pub fn get_default(&self, name: &str) -> Option<&MaterialParamValue> {
        self.params.iter()
            .find(|p| p.name == name)
            .map(|p| &p.default_value)
    }

    /// Check if a parameter exists.
    pub fn has_param(&self, name: &str) -> bool {
        self.params.iter().any(|p| p.name == name)
    }
}

/// Builder for creating materials.
pub struct MaterialBuilder {
    id: String,
    name: String,
    description: String,
    vertex_entry: String,
    fragment_entry: String,
    params: Vec<ParamDef>,
    blend_mode: BlendMode,
    cull_mode: Option<wgpu::Face>,
    depth_write: bool,
    topology: MaterialTopology,
}

impl MaterialBuilder {
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            name: id.clone(),
            id,
            description: String::new(),
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            params: Vec::new(),
            blend_mode: BlendMode::Opaque,
            cull_mode: Some(wgpu::Face::Back),
            depth_write: false,
            topology: MaterialTopology::Triangles,
        }
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = name.into();
        self
    }

    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }

    pub fn vertex_entry(mut self, entry: impl Into<String>) -> Self {
        self.vertex_entry = entry.into();
        self
    }

    pub fn fragment_entry(mut self, entry: impl Into<String>) -> Self {
        self.fragment_entry = entry.into();
        self
    }

    pub fn param(mut self, param: ParamDef) -> Self {
        self.params.push(param);
        self
    }

    pub fn blend_mode(mut self, mode: BlendMode) -> Self {
        self.blend_mode = mode;
        self
    }

    pub fn cull_mode(mut self, mode: Option<wgpu::Face>) -> Self {
        self.cull_mode = mode;
        self
    }

    pub fn depth_write(mut self, write: bool) -> Self {
        self.depth_write = write;
        self
    }

    pub fn topology(mut self, topology: MaterialTopology) -> Self {
        self.topology = topology;
        self
    }

    pub fn build(self) -> Material {
        Material {
            id: self.id,
            name: self.name,
            description: self.description,
            vertex_entry: self.vertex_entry,
            fragment_entry: self.fragment_entry,
            params: self.params,
            blend_mode: self.blend_mode,
            cull_mode: self.cull_mode,
            depth_write: self.depth_write,
            topology: self.topology,
        }
    }
}

/// The material registry - holds all host-defined materials.
pub struct MaterialRegistry {
    materials: HashMap<MaterialId, Arc<Material>>,
    default_material: MaterialId,
}

impl MaterialRegistry {
    /// Create a new registry with built-in materials.
    pub fn new() -> Self {
        let mut registry = Self {
            materials: HashMap::new(),
            default_material: "default".to_string(),
        };
        registry.register_builtin_materials();
        registry
    }

    /// Register built-in materials.
    fn register_builtin_materials(&mut self) {
        // 1. Default - basic solid material
        self.register(
            Material::builder("default")
                .name("Default")
                .description("Basic solid material with color tint")
                .param(ParamDef::color("base_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Base color multiplied with vertex colors"))
                .build()
        );

        // 2. Emissive - glowing material
        self.register(
            Material::builder("emissive")
                .name("Emissive")
                .description("Material with additive emission glow")
                .param(ParamDef::color("base_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Base color"))
                .param(ParamDef::color("emission_color", [1.0, 0.5, 0.0, 1.0])
                    .with_description("Emission color"))
                .param(ParamDef::float("emission_intensity", 1.0)
                    .with_range(0.0, 10.0)
                    .with_description("Emission intensity multiplier"))
                .blend_mode(BlendMode::AlphaBlend)
                .build()
        );

        // 3. Wire Glow - wireframe with glow effect
        self.register(
            Material::builder("wire_glow")
                .name("Wire Glow")
                .description("Wireframe material with glow effect")
                .param(ParamDef::color("core_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Core wire color"))
                .param(ParamDef::color("glow_color", [0.0, 0.5, 1.0, 1.0])
                    .with_description("Glow color"))
                .param(ParamDef::float("glow_intensity", 1.0)
                    .with_range(0.0, 5.0)
                    .with_description("Glow intensity"))
                .blend_mode(BlendMode::Additive)
                .cull_mode(None)
                .topology(MaterialTopology::Lines)
                .build()
        );

        // 4. Wire - simple wireframe material (no glow)
        self.register(
            Material::builder("wire")
                .name("Wire")
                .description("Simple wireframe material without glow effects")
                .param(ParamDef::color("wire_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Wire color"))
                .blend_mode(BlendMode::AlphaBlend)
                .cull_mode(None)
                .topology(MaterialTopology::Lines)
                .build()
        );

        // 5. Points - render vertices as points
        self.register(
            Material::builder("points")
                .name("Points")
                .description("Render mesh vertices as points")
                .param(ParamDef::color("point_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Point color"))
                .param(ParamDef::float("point_size", 1.0)
                    .with_range(0.1, 10.0)
                    .with_description("Point size (visual scaling in shader)"))
                .blend_mode(BlendMode::AlphaBlend)
                .cull_mode(None)
                .topology(MaterialTopology::Points)
                .build()
        );

        // 5. Soft Additive - for particles and soft glows
        self.register(
            Material::builder("soft_additive")
                .name("Soft Additive")
                .description("Soft additive blending for particles and glows")
                .param(ParamDef::color("base_color", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Base color"))
                .param(ParamDef::float("softness", 0.5)
                    .with_range(0.0, 1.0)
                    .with_description("Blend softness (0 = sharp, 1 = very soft)"))
                .blend_mode(BlendMode::Additive)
                .cull_mode(None)
                .build()
        );

        // 5. Gradient - two-tone gradient based on position
        self.register(
            Material::builder("gradient")
                .name("Gradient")
                .description("Two-tone gradient based on world position")
                .param(ParamDef::color("color_a", [0.0, 0.5, 1.0, 1.0])
                    .with_description("Start color"))
                .param(ParamDef::color("color_b", [1.0, 0.5, 0.0, 1.0])
                    .with_description("End color"))
                .param(ParamDef::vec3("direction", [0.0, 1.0, 0.0])
                    .with_description("Gradient direction (normalized)"))
                .param(ParamDef::float("blend", 0.5)
                    .with_range(0.0, 1.0)
                    .with_description("Gradient blend factor"))
                .build()
        );
    }

    /// Get a material by ID.
    pub fn get(&self, id: &str) -> Option<Arc<Material>> {
        self.materials.get(id).cloned()
    }

    /// Get the default material.
    pub fn default_material(&self) -> Arc<Material> {
        self.get(&self.default_material).expect("Default material must exist")
    }

    /// Register a new material.
    pub fn register(&mut self, material: Material) {
        self.materials.insert(material.id.clone(), Arc::new(material));
    }

    /// List all registered material IDs.
    pub fn list_ids(&self) -> Vec<&str> {
        self.materials.keys().map(|s| s.as_str()).collect()
    }

    /// Check if a material exists.
    pub fn exists(&self, id: &str) -> bool {
        self.materials.contains_key(id)
    }

    /// Get the number of registered materials.
    pub fn len(&self) -> usize {
        self.materials.len()
    }

    /// Check if the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.materials.is_empty()
    }
}

impl Default for MaterialRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_has_builtin_materials() {
        let registry = MaterialRegistry::new();
        assert!(registry.exists("default"));
        assert!(registry.exists("emissive"));
        assert!(registry.exists("wire_glow"));
        assert!(registry.exists("wire"));
        assert!(registry.exists("points"));
        assert!(registry.exists("soft_additive"));
        assert!(registry.exists("gradient"));
        assert_eq!(registry.len(), 7);
    }

    #[test]
    fn test_material_params() {
        let registry = MaterialRegistry::new();
        let emissive = registry.get("emissive").unwrap();

        assert!(emissive.has_param("base_color"));
        assert!(emissive.has_param("emission_color"));
        assert!(emissive.has_param("emission_intensity"));
        assert!(!emissive.has_param("nonexistent"));
    }

    #[test]
    fn test_param_value_conversion() {
        let v = ParamValue::Vec4([1.0, 0.5, 0.25, 1.0]);
        assert_eq!(v.as_vec4(), [1.0, 0.5, 0.25, 1.0]);

        let f = ParamValue::Float(0.75);
        assert_eq!(f.as_float(), 0.75);
        assert_eq!(f.as_vec4(), [0.75, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_default_material() {
        let registry = MaterialRegistry::new();
        let default = registry.default_material();
        assert_eq!(default.id, "default");
    }

    #[test]
    fn test_builtin_material_defaults_are_static() {
        // The renderer extracts defaults via `as_static().expect(...)`, so every
        // built-in material default must remain static (no Signal components).
        let registry = MaterialRegistry::new();
        for id in registry.list_ids() {
            let material = registry.get(id).unwrap();
            for param in &material.params {
                assert!(
                    param.default_value.as_static().is_some(),
                    "built-in material '{}' param '{}' has a non-static default",
                    id,
                    param.name
                );
            }
        }
    }

    #[test]
    fn test_material_param_value_static_conversions() {
        assert_eq!(
            MaterialParamValue::from_float(0.75).as_static(),
            Some(ParamValue::Float(0.75))
        );
        assert_eq!(
            MaterialParamValue::from_vec2([1.0, 2.0]).as_static(),
            Some(ParamValue::Vec2([1.0, 2.0]))
        );
        assert_eq!(
            MaterialParamValue::from_vec3([1.0, 2.0, 3.0]).as_static(),
            Some(ParamValue::Vec3([1.0, 2.0, 3.0]))
        );
        assert_eq!(
            MaterialParamValue::from_vec4([1.0, 0.5, 0.25, 1.0]).as_static(),
            Some(ParamValue::Vec4([1.0, 0.5, 0.25, 1.0]))
        );
    }

    #[test]
    fn test_signal_bound_material_param_evaluates_per_frame() {
        use crate::input::{BandSignalMap, InputSignal, SignalMap};
        use crate::signal::Signal;
        use crate::signal_state::SignalState;
        use crate::signal_stats::StatisticsCache;
        use std::rc::Rc;

        // An "amplitude" input that ramps from 0.0 to 3.0 over 4 samples at 1 Hz,
        // so its value depends on the frame time it is sampled at.
        let mut inputs: SignalMap = HashMap::new();
        inputs.insert(
            "amplitude".to_string(),
            Rc::new(InputSignal::new(vec![0.0, 1.0, 2.0, 3.0], 1.0)),
        );
        let bands: BandSignalMap = HashMap::new();
        let stems: BandSignalMap = HashMap::new();
        let custom: SignalMap = HashMap::new();
        let composed: SignalMap = HashMap::new();
        let stats = StatisticsCache::new();
        let mut state = SignalState::new();

        // A material param with a Signal bound to it:
        // e.g. emission intensity following the amplitude signal.
        let param = MaterialParamValue::Float(SignalOrF32::Signal(Signal::input("amplitude")));

        // Signal-bound params have no static value; they must be evaluated per-frame.
        assert!(param.as_static().is_none());

        // Evaluate the same param definition on two different frames.
        let mut eval_at = |time: f32, state: &mut SignalState| -> f32 {
            let mut ctx = EvalContext::new(
                time, 0.016, 0, None, &inputs, &bands, &stems, &custom, &composed, &stats, state,
                None,
            );
            match param.evaluate(&mut ctx) {
                ParamValue::Float(v) => v,
                other => panic!("expected Float, got {:?}", other),
            }
        };

        let frame_a = eval_at(0.1, &mut state);
        let frame_b = eval_at(2.5, &mut state);

        // Per-frame evaluation: the same param yields different values as the
        // underlying signal changes over time.
        assert_ne!(frame_a, frame_b);
        assert!(frame_a < 0.5, "early frame should sample the low ramp, got {frame_a}");
        assert!(
            (1.5..=3.0).contains(&frame_b),
            "later frame should sample the high ramp, got {frame_b}"
        );

        // A vector param with one signal-bound component evaluates per-frame too,
        // while its static components stay fixed.
        let color = MaterialParamValue::Vec4(Vec4Signal {
            x: SignalOrF32::Scalar(1.0),
            y: SignalOrF32::Scalar(0.5),
            z: SignalOrF32::Scalar(0.0),
            w: SignalOrF32::Signal(Signal::input("amplitude")),
        });
        assert!(color.as_static().is_none());

        let mut eval_color_at = |time: f32, state: &mut SignalState| -> [f32; 4] {
            let mut ctx = EvalContext::new(
                time, 0.016, 0, None, &inputs, &bands, &stems, &custom, &composed, &stats, state,
                None,
            );
            match color.evaluate(&mut ctx) {
                ParamValue::Vec4(v) => v,
                other => panic!("expected Vec4, got {:?}", other),
            }
        };

        let color_a = eval_color_at(0.1, &mut state);
        let color_b = eval_color_at(2.5, &mut state);
        assert_eq!(color_a[0..3], [1.0, 0.5, 0.0]);
        assert_eq!(color_b[0..3], [1.0, 0.5, 0.0]);
        assert_ne!(color_a[3], color_b[3]);
    }
}
