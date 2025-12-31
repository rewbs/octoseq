/**
 * Config-map schema definitions for Monaco IDE support.
 *
 * This module defines the IDE contract for config-map APIs (e.g., `fx.bloom(#{ ... })`).
 * TypeScript owns this schema for IDE purposes; Rust owns runtime behavior.
 *
 * Structure is designed so it could eventually be generated or verified from Rust,
 * but for now it's maintained manually to avoid drift.
 *
 * To add a new config-map API:
 * 1. Add the schema to CONFIG_MAP_SCHEMAS below
 * 2. Ensure the function path matches how it appears in code (e.g., "fx.bloom")
 * 3. Document all parameters with types, defaults, ranges, and descriptions
 */

/**
 * Describes a single parameter in a config-map.
 */
export interface ConfigMapParam {
  /** Parameter key name */
  key: string;
  /** Type annotation for display (e.g., "float | Signal", "Color") */
  type: string;
  /** Human-readable description */
  description: string;
  /** Default value (for display in hints) */
  default?: unknown;
  /** Valid numeric range, if applicable */
  range?: { min: number; max: number };
  /** Valid enum values, if applicable */
  enumValues?: string[];
}

/**
 * Describes a config-map API function.
 */
export interface ConfigMapSchema {
  /** Function path as it appears in code (e.g., "fx.bloom", "line.strip") */
  functionPath: string;
  /** Human-readable description of the function */
  description: string;
  /** Parameters accepted in the config map */
  params: ConfigMapParam[];
}

/**
 * Registry of all config-map schemas, keyed by function path.
 */
export type ConfigMapRegistry = Map<string, ConfigMapSchema>;

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * All known config-map schemas.
 * Function paths must match exactly how they appear in Rhai code.
 */
export const CONFIG_MAP_SCHEMAS: ConfigMapSchema[] = [
  // ---------------------------------------------------------------------------
  // Post-Processing Effects (fx.*)
  // ---------------------------------------------------------------------------
  {
    functionPath: "fx.bloom",
    description: "Create a bloom effect (glow on bright areas).",
    params: [
      {
        key: "threshold",
        type: "float | Signal",
        description: "Brightness threshold above which bloom is applied.",
        default: 0.8,
        range: { min: 0.0, max: 2.0 },
      },
      {
        key: "intensity",
        type: "float | Signal",
        description: "Bloom strength.",
        default: 0.5,
        range: { min: 0.0, max: 2.0 },
      },
      {
        key: "radius",
        type: "float | Signal",
        description: "Blur radius in pixels.",
        default: 4.0,
        range: { min: 0.0, max: 32.0 },
      },
      {
        key: "downsample",
        type: "float | Signal",
        description: "Resolution downsampling factor (1 = full, 2 = half).",
        default: 2.0,
        range: { min: 1.0, max: 4.0 },
      },
    ],
  },
  {
    functionPath: "fx.colorGrade",
    description: "Create a color grading effect.",
    params: [
      {
        key: "brightness",
        type: "float | Signal",
        description: "Brightness adjustment.",
        default: 0.0,
        range: { min: -1.0, max: 1.0 },
      },
      {
        key: "contrast",
        type: "float | Signal",
        description: "Contrast multiplier.",
        default: 1.0,
        range: { min: 0.0, max: 3.0 },
      },
      {
        key: "saturation",
        type: "float | Signal",
        description: "Saturation multiplier.",
        default: 1.0,
        range: { min: 0.0, max: 3.0 },
      },
      {
        key: "gamma",
        type: "float | Signal",
        description: "Gamma correction.",
        default: 1.0,
        range: { min: 0.1, max: 3.0 },
      },
      {
        key: "tint",
        type: "Color",
        description: "Color tint applied to the image.",
        default: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
    ],
  },
  {
    functionPath: "fx.vignette",
    description: "Create a vignette effect (darkened edges).",
    params: [
      {
        key: "intensity",
        type: "float | Signal",
        description: "Vignette intensity (how dark the edges are).",
        default: 0.3,
        range: { min: 0.0, max: 1.0 },
      },
      {
        key: "smoothness",
        type: "float | Signal",
        description: "Edge smoothness (how gradual the falloff is).",
        default: 0.5,
        range: { min: 0.0, max: 1.0 },
      },
      {
        key: "color",
        type: "Color",
        description: "Vignette color.",
        default: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      },
    ],
  },
  {
    functionPath: "fx.distortion",
    description: "Create a barrel/pincushion distortion effect.",
    params: [
      {
        key: "amount",
        type: "float | Signal",
        description: "Distortion amount (negative = pincushion, positive = barrel).",
        default: 0.0,
        range: { min: -1.0, max: 1.0 },
      },
      {
        key: "center",
        type: "Vec2",
        description: "Distortion center in normalized coordinates.",
        default: { x: 0.5, y: 0.5 },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Line Primitives (line.*)
  // ---------------------------------------------------------------------------
  {
    functionPath: "line.strip",
    description: "Create a procedural line strip with manual push() control.",
    params: [
      {
        key: "max_points",
        type: "int",
        description: "Maximum number of points in the ring buffer.",
        default: 256,
        range: { min: 2, max: 10000 },
      },
      {
        key: "mode",
        type: '"line" | "points"',
        description: "Render mode: connected lines or individual points.",
        default: "line",
        enumValues: ["line", "points"],
      },
    ],
  },
  {
    functionPath: "line.trace",
    description: "Create a Signal-driven line that automatically plots values over time.",
    params: [
      {
        key: "max_points",
        type: "int",
        description: "Maximum number of points in the ring buffer.",
        default: 256,
        range: { min: 2, max: 10000 },
      },
      {
        key: "mode",
        type: '"line" | "points"',
        description: "Render mode: connected lines or individual points.",
        default: "line",
        enumValues: ["line", "points"],
      },
      {
        key: "x_scale",
        type: "float | Signal",
        description: "Scale factor for the time axis.",
        default: 1.0,
      },
      {
        key: "y_scale",
        type: "float | Signal",
        description: "Scale factor for signal values.",
        default: 1.0,
      },
      {
        key: "y_offset",
        type: "float | Signal",
        description: "Offset added to values before scaling.",
        default: 0.0,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Deformations (deform.*)
  // ---------------------------------------------------------------------------
  {
    functionPath: "deform.twist",
    description: "Apply a twist deformation around an axis.",
    params: [
      {
        key: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis to twist around.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        key: "amount",
        type: "float | Signal",
        description: "Twist amount in radians.",
        default: 0.0,
      },
      {
        key: "center",
        type: "float | Signal",
        description: "Center point along the axis.",
        default: 0.0,
      },
    ],
  },
  {
    functionPath: "deform.bend",
    description: "Apply a bend deformation around an axis.",
    params: [
      {
        key: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis to bend around.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        key: "amount",
        type: "float | Signal",
        description: "Bend amount.",
        default: 0.0,
      },
      {
        key: "center",
        type: "float | Signal",
        description: "Center point along the axis.",
        default: 0.0,
      },
    ],
  },
  {
    functionPath: "deform.wave",
    description: "Apply a wave deformation.",
    params: [
      {
        key: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis along which the wave propagates.",
        default: "x",
        enumValues: ["x", "y", "z"],
      },
      {
        key: "direction",
        type: '"x" | "y" | "z"',
        description: "Displacement direction.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        key: "amplitude",
        type: "float | Signal",
        description: "Wave amplitude.",
        default: 0.1,
      },
      {
        key: "frequency",
        type: "float | Signal",
        description: "Wave frequency.",
        default: 1.0,
      },
      {
        key: "phase",
        type: "float | Signal",
        description: "Wave phase offset.",
        default: 0.0,
      },
    ],
  },
  {
    functionPath: "deform.noise",
    description: "Apply a noise-based displacement.",
    params: [
      {
        key: "scale",
        type: "float | Signal",
        description: "Noise scale (affects pattern size).",
        default: 1.0,
      },
      {
        key: "amplitude",
        type: "float | Signal",
        description: "Displacement amplitude.",
        default: 0.1,
      },
      {
        key: "seed",
        type: "int",
        description: "Random seed for reproducibility.",
        default: 0,
      },
    ],
  },
];

// =============================================================================
// Registry Access
// =============================================================================

let _registry: ConfigMapRegistry | null = null;

/**
 * Get the config-map registry, building it lazily on first access.
 */
export function getConfigMapRegistry(): ConfigMapRegistry {
  if (!_registry) {
    _registry = new Map();
    for (const schema of CONFIG_MAP_SCHEMAS) {
      _registry.set(schema.functionPath, schema);
    }
  }
  return _registry;
}

/**
 * Look up a config-map schema by function path.
 * Returns null if not found.
 */
export function getConfigMapSchema(functionPath: string): ConfigMapSchema | null {
  return getConfigMapRegistry().get(functionPath) ?? null;
}

/**
 * Get all registered function paths.
 */
export function getConfigMapFunctionPaths(): string[] {
  return Array.from(getConfigMapRegistry().keys());
}
