//! Post-processing effect pipeline.
//!
//! This module provides types for defining and managing a chain of post-processing
//! effects that are applied after scene rendering.

use std::collections::HashMap;

/// Unique identifier for a post-processing effect.
pub type EffectId = String;

/// Types of parameters for post-processing effects.
#[derive(Clone, Debug, PartialEq)]
pub enum EffectParamType {
    Float,
    Vec2,
    Vec3,
    Vec4,
    Color,
}

/// Runtime value for an effect parameter.
#[derive(Clone, Debug, PartialEq)]
pub enum EffectParamValue {
    Float(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
}

impl Default for EffectParamValue {
    fn default() -> Self {
        EffectParamValue::Float(0.0)
    }
}

impl EffectParamValue {
    /// Convert to bytes for GPU upload.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            EffectParamValue::Float(v) => bytemuck::cast_slice(&[*v]).to_vec(),
            EffectParamValue::Vec2(v) => bytemuck::cast_slice(v).to_vec(),
            EffectParamValue::Vec3(v) => bytemuck::cast_slice(v).to_vec(),
            EffectParamValue::Vec4(v) => bytemuck::cast_slice(v).to_vec(),
        }
    }

    /// Get as float.
    pub fn as_float(&self) -> f32 {
        match self {
            EffectParamValue::Float(v) => *v,
            _ => 0.0,
        }
    }

    /// Get as vec4, padding smaller types.
    pub fn as_vec4(&self) -> [f32; 4] {
        match self {
            EffectParamValue::Float(v) => [*v, 0.0, 0.0, 0.0],
            EffectParamValue::Vec2(v) => [v[0], v[1], 0.0, 0.0],
            EffectParamValue::Vec3(v) => [v[0], v[1], v[2], 0.0],
            EffectParamValue::Vec4(v) => *v,
        }
    }
}

/// Definition of an effect parameter.
#[derive(Clone, Debug)]
pub struct EffectParamDef {
    pub name: String,
    pub param_type: EffectParamType,
    pub default_value: EffectParamValue,
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub description: String,
}

impl EffectParamDef {
    pub fn float(name: impl Into<String>, default: f32) -> Self {
        Self {
            name: name.into(),
            param_type: EffectParamType::Float,
            default_value: EffectParamValue::Float(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    pub fn color(name: impl Into<String>, default: [f32; 4]) -> Self {
        Self {
            name: name.into(),
            param_type: EffectParamType::Color,
            default_value: EffectParamValue::Vec4(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    pub fn vec2(name: impl Into<String>, default: [f32; 2]) -> Self {
        Self {
            name: name.into(),
            param_type: EffectParamType::Vec2,
            default_value: EffectParamValue::Vec2(default),
            min: None,
            max: None,
            description: String::new(),
        }
    }

    pub fn with_range(mut self, min: f32, max: f32) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }
}

/// Definition of a post-processing effect.
#[derive(Clone)]
pub struct PostEffect {
    pub id: EffectId,
    pub name: String,
    pub description: String,
    pub params: Vec<EffectParamDef>,
    pub fragment_entry: String,
}

impl PostEffect {
    /// Create a new effect builder.
    pub fn builder(id: impl Into<String>) -> PostEffectBuilder {
        PostEffectBuilder::new(id)
    }

    /// Get the default value for a parameter.
    pub fn get_default(&self, name: &str) -> Option<&EffectParamValue> {
        self.params.iter()
            .find(|p| p.name == name)
            .map(|p| &p.default_value)
    }

    /// Check if a parameter exists.
    pub fn has_param(&self, name: &str) -> bool {
        self.params.iter().any(|p| p.name == name)
    }
}

/// Builder for post-processing effects.
pub struct PostEffectBuilder {
    id: String,
    name: String,
    description: String,
    params: Vec<EffectParamDef>,
    fragment_entry: String,
}

impl PostEffectBuilder {
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            name: id.clone(),
            id,
            description: String::new(),
            params: Vec::new(),
            fragment_entry: "fs_main".to_string(),
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

    pub fn param(mut self, param: EffectParamDef) -> Self {
        self.params.push(param);
        self
    }

    pub fn fragment_entry(mut self, entry: impl Into<String>) -> Self {
        self.fragment_entry = entry.into();
        self
    }

    pub fn build(self) -> PostEffect {
        PostEffect {
            id: self.id,
            name: self.name,
            description: self.description,
            params: self.params,
            fragment_entry: self.fragment_entry,
        }
    }
}

/// Runtime instance of a post-processing effect with evaluated parameters.
#[derive(Clone, Debug, Default)]
pub struct PostEffectInstance {
    /// Effect ID.
    pub effect_id: EffectId,
    /// Whether the effect is enabled.
    pub enabled: bool,
    /// Evaluated parameter values.
    pub params: HashMap<String, EffectParamValue>,
}

impl PostEffectInstance {
    pub fn new(effect_id: impl Into<String>) -> Self {
        Self {
            effect_id: effect_id.into(),
            enabled: true,
            params: HashMap::new(),
        }
    }

    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn with_param(mut self, name: impl Into<String>, value: EffectParamValue) -> Self {
        self.params.insert(name.into(), value);
        self
    }

    pub fn set_param(&mut self, name: impl Into<String>, value: EffectParamValue) {
        self.params.insert(name.into(), value);
    }

    pub fn get_param(&self, name: &str) -> Option<&EffectParamValue> {
        self.params.get(name)
    }
}

/// The post-processing chain - ordered list of effects to apply.
#[derive(Clone, Debug, Default)]
pub struct PostProcessingChain {
    /// Ordered list of effect instances.
    pub effects: Vec<PostEffectInstance>,
}

impl PostProcessingChain {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an effect to the end of the chain.
    pub fn add(&mut self, effect: PostEffectInstance) {
        self.effects.push(effect);
    }

    /// Remove an effect by ID.
    pub fn remove(&mut self, effect_id: &str) {
        self.effects.retain(|e| e.effect_id != effect_id);
    }

    /// Clear all effects.
    pub fn clear(&mut self) {
        self.effects.clear();
    }

    /// Check if the chain is empty.
    pub fn is_empty(&self) -> bool {
        self.effects.is_empty()
    }

    /// Check if the chain has any enabled effects.
    pub fn has_enabled_effects(&self) -> bool {
        self.effects.iter().any(|e| e.enabled)
    }

    /// Get enabled effects in order.
    pub fn enabled_effects(&self) -> impl Iterator<Item = &PostEffectInstance> {
        self.effects.iter().filter(|e| e.enabled)
    }

    /// Enable or disable an effect by ID.
    pub fn set_enabled(&mut self, effect_id: &str, enabled: bool) {
        for effect in &mut self.effects {
            if effect.effect_id == effect_id {
                effect.enabled = enabled;
            }
        }
    }

    /// Reorder effects according to the given order of IDs.
    /// Effects not in the order list are appended at the end.
    pub fn reorder(&mut self, order: &[&str]) {
        let mut new_effects = Vec::new();
        for id in order {
            if let Some(pos) = self.effects.iter().position(|e| e.effect_id == *id) {
                new_effects.push(self.effects.remove(pos));
            }
        }
        // Append remaining effects
        new_effects.append(&mut self.effects);
        self.effects = new_effects;
    }

    /// Get an effect by ID.
    pub fn get(&self, effect_id: &str) -> Option<&PostEffectInstance> {
        self.effects.iter().find(|e| e.effect_id == effect_id)
    }

    /// Get a mutable reference to an effect by ID.
    pub fn get_mut(&mut self, effect_id: &str) -> Option<&mut PostEffectInstance> {
        self.effects.iter_mut().find(|e| e.effect_id == effect_id)
    }

    /// Build evaluated params map for use with PostProcessor::process().
    /// Uses the registry to determine param order and defaults.
    pub fn build_params_map(&self, registry: &PostEffectRegistry) -> HashMap<String, Vec<EffectParamValue>> {
        let mut result = HashMap::new();
        for effect in &self.effects {
            if !effect.enabled {
                continue;
            }
            if let Some(def) = registry.get(&effect.effect_id) {
                let mut params = Vec::new();
                for param_def in &def.params {
                    let value = effect.params.get(&param_def.name)
                        .cloned()
                        .unwrap_or_else(|| param_def.default_value.clone());
                    params.push(value);
                }
                result.insert(effect.effect_id.clone(), params);
            }
        }
        result
    }
}

/// Registry of available post-processing effects.
pub struct PostEffectRegistry {
    effects: HashMap<EffectId, PostEffect>,
}

impl PostEffectRegistry {
    /// Create a new registry with built-in effects.
    pub fn new() -> Self {
        let mut registry = Self {
            effects: HashMap::new(),
        };
        registry.register_builtin_effects();
        registry
    }

    fn register_builtin_effects(&mut self) {
        // Bloom effect (uses optimized multi-pass processor with separable blur)
        self.register(
            PostEffect::builder("bloom")
                .name("Bloom")
                .description("Adds glow to bright areas (optimized multi-pass)")
                .param(EffectParamDef::float("threshold", 0.8)
                    .with_range(0.0, 2.0)
                    .with_description("Brightness threshold for bloom"))
                .param(EffectParamDef::float("intensity", 0.5)
                    .with_range(0.0, 2.0)
                    .with_description("Bloom intensity"))
                .param(EffectParamDef::float("radius", 4.0)
                    .with_range(0.0, 32.0)
                    .with_description("Blur radius (capped at 32)"))
                .param(EffectParamDef::float("downsample", 2.0)
                    .with_range(1.0, 8.0)
                    .with_description("Downsample factor (1=full res, 2=half, etc.)"))
                .build()
        );

        // Color Grade effect
        self.register(
            PostEffect::builder("color_grade")
                .name("Color Grade")
                .description("Adjusts color and tone")
                .param(EffectParamDef::float("brightness", 0.0)
                    .with_range(-1.0, 1.0)
                    .with_description("Brightness adjustment"))
                .param(EffectParamDef::float("contrast", 1.0)
                    .with_range(0.0, 2.0)
                    .with_description("Contrast multiplier"))
                .param(EffectParamDef::float("saturation", 1.0)
                    .with_range(0.0, 2.0)
                    .with_description("Saturation multiplier"))
                .param(EffectParamDef::float("gamma", 1.0)
                    .with_range(0.1, 3.0)
                    .with_description("Gamma correction"))
                .param(EffectParamDef::color("tint", [1.0, 1.0, 1.0, 1.0])
                    .with_description("Color tint"))
                .build()
        );

        // Vignette effect
        self.register(
            PostEffect::builder("vignette")
                .name("Vignette")
                .description("Darkens edges of the frame")
                .param(EffectParamDef::float("intensity", 0.3)
                    .with_range(0.0, 1.0)
                    .with_description("Vignette darkness"))
                .param(EffectParamDef::float("smoothness", 0.5)
                    .with_range(0.0, 1.0)
                    .with_description("Edge smoothness"))
                .param(EffectParamDef::color("color", [0.0, 0.0, 0.0, 1.0])
                    .with_description("Vignette color"))
                .build()
        );

        // Distortion effect
        self.register(
            PostEffect::builder("distortion")
                .name("Distortion")
                .description("Barrel/pincushion distortion")
                .param(EffectParamDef::float("amount", 0.0)
                    .with_range(-1.0, 1.0)
                    .with_description("Distortion amount (negative = barrel, positive = pincushion)"))
                .param(EffectParamDef::vec2("center", [0.5, 0.5])
                    .with_description("Distortion center (normalized)"))
                .build()
        );

        // Zoom with wrap effect
        // Note: Parameter order must match shader uniform struct layout
        self.register(
            PostEffect::builder("zoom_wrap")
                .name("Zoom Wrap")
                .description("Zoom in/out with edge wrapping (repeat or mirror)")
                .param(EffectParamDef::float("amount", 1.0)
                    .with_range(0.5, 2.0)
                    .with_description("Zoom scale factor (<1 = zoom in, >1 = zoom out)"))
                .param(EffectParamDef::float("wrap_mode", 0.0)
                    .with_range(0.0, 1.0)
                    .with_description("Wrap mode: 0 = repeat, 1 = mirror"))
                .param(EffectParamDef::vec2("center", [0.5, 0.5])
                    .with_description("Zoom center in normalized coordinates"))
                .build()
        );

        // Radial blur effect
        // Note: Parameter order must match shader uniform struct layout
        self.register(
            PostEffect::builder("radial_blur")
                .name("Radial Blur")
                .description("Motion blur radiating from a center point")
                .param(EffectParamDef::float("strength", 0.0)
                    .with_range(0.0, 1.0)
                    .with_description("Blur strength"))
                .param(EffectParamDef::float("samples", 8.0)
                    .with_range(2.0, 32.0)
                    .with_description("Number of blur samples (higher = smoother)"))
                .param(EffectParamDef::vec2("center", [0.5, 0.5])
                    .with_description("Blur center in normalized coordinates"))
                .build()
        );

        // Directional blur effect
        self.register(
            PostEffect::builder("directional_blur")
                .name("Directional Blur")
                .description("Motion blur in a specific direction")
                .param(EffectParamDef::float("amount", 0.0)
                    .with_range(0.0, 20.0)
                    .with_description("Blur amount in pixels"))
                .param(EffectParamDef::float("angle", 0.0)
                    .with_range(0.0, 6.283185)
                    .with_description("Blur direction in radians"))
                .param(EffectParamDef::float("samples", 8.0)
                    .with_range(2.0, 32.0)
                    .with_description("Number of blur samples"))
                .build()
        );

        // Chromatic aberration effect
        self.register(
            PostEffect::builder("chromatic_aberration")
                .name("Chromatic Aberration")
                .description("RGB channel separation effect")
                .param(EffectParamDef::float("amount", 0.0)
                    .with_range(0.0, 10.0)
                    .with_description("Separation amount"))
                .param(EffectParamDef::float("angle", 0.0)
                    .with_range(0.0, 6.283185)
                    .with_description("Separation direction in radians"))
                .build()
        );

        // Film grain effect
        self.register(
            PostEffect::builder("grain")
                .name("Film Grain")
                .description("Add deterministic film grain noise")
                .param(EffectParamDef::float("amount", 0.0)
                    .with_range(0.0, 0.5)
                    .with_description("Grain intensity"))
                .param(EffectParamDef::float("scale", 1.0)
                    .with_range(0.1, 10.0)
                    .with_description("Grain scale (smaller = finer)"))
                .param(EffectParamDef::float("seed", 0.0)
                    .with_range(0.0, 1000.0)
                    .with_description("Random seed for reproducibility"))
                .build()
        );
    }

    /// Register a new effect.
    pub fn register(&mut self, effect: PostEffect) {
        self.effects.insert(effect.id.clone(), effect);
    }

    /// Get an effect by ID.
    pub fn get(&self, id: &str) -> Option<&PostEffect> {
        self.effects.get(id)
    }

    /// List all effect IDs.
    pub fn list_ids(&self) -> Vec<&str> {
        self.effects.keys().map(|s| s.as_str()).collect()
    }

    /// Check if an effect exists.
    pub fn exists(&self, id: &str) -> bool {
        self.effects.contains_key(id)
    }
}

impl Default for PostEffectRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_has_builtin_effects() {
        let registry = PostEffectRegistry::new();
        assert!(registry.exists("bloom"));
        assert!(registry.exists("color_grade"));
        assert!(registry.exists("vignette"));
        assert!(registry.exists("distortion"));
    }

    #[test]
    fn test_chain_operations() {
        let mut chain = PostProcessingChain::new();
        assert!(chain.is_empty());

        chain.add(PostEffectInstance::new("bloom"));
        chain.add(PostEffectInstance::new("vignette"));
        assert_eq!(chain.effects.len(), 2);

        chain.set_enabled("bloom", false);
        assert!(!chain.get("bloom").unwrap().enabled);
        assert!(chain.get("vignette").unwrap().enabled);

        chain.reorder(&["vignette", "bloom"]);
        assert_eq!(chain.effects[0].effect_id, "vignette");
        assert_eq!(chain.effects[1].effect_id, "bloom");

        chain.remove("bloom");
        assert_eq!(chain.effects.len(), 1);
    }
}
