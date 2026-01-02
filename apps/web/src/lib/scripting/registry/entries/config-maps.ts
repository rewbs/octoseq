/**
 * Config-map entries for the API registry.
 *
 * Config-maps are APIs that accept #{ ... } hash map literals.
 * This file defines the valid keys for each config-map function.
 */

import type { RegistryEntry } from "../types";

export const CONFIG_MAP_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // fx.bloom - Bloom effect options
  // ============================================================================
  {
    kind: "config-map",
    name: "fx.bloom",
    path: "fx.bloom",
    description: "Create a bloom effect (glow on bright areas).",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "threshold",
        type: "float | Signal",
        description: "Brightness threshold above which bloom is applied.",
        default: 0.8,
        range: { min: 0.0, max: 2.0 },
      },
      {
        name: "intensity",
        type: "float | Signal",
        description: "Bloom strength.",
        default: 0.5,
        range: { min: 0.0, max: 2.0 },
      },
      {
        name: "radius",
        type: "float | Signal",
        description: "Blur radius in pixels.",
        default: 4.0,
        range: { min: 0.0, max: 32.0 },
      },
      {
        name: "downsample",
        type: "float | Signal",
        description: "Resolution downsampling factor (1 = full, 2 = half).",
        default: 2.0,
        range: { min: 1.0, max: 4.0 },
      },
    ],
  },

  // ============================================================================
  // fx.colorGrade - Color grading options
  // ============================================================================
  {
    kind: "config-map",
    name: "fx.colorGrade",
    path: "fx.colorGrade",
    description: "Create a color grading effect.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "brightness",
        type: "float | Signal",
        description: "Brightness adjustment.",
        default: 0.0,
        range: { min: -1.0, max: 1.0 },
      },
      {
        name: "contrast",
        type: "float | Signal",
        description: "Contrast multiplier.",
        default: 1.0,
        range: { min: 0.0, max: 3.0 },
      },
      {
        name: "saturation",
        type: "float | Signal",
        description: "Saturation multiplier.",
        default: 1.0,
        range: { min: 0.0, max: 3.0 },
      },
      {
        name: "gamma",
        type: "float | Signal",
        description: "Gamma correction.",
        default: 1.0,
        range: { min: 0.1, max: 3.0 },
      },
      {
        name: "tint",
        type: "Color",
        description: "Color tint applied to the image.",
        default: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
    ],
  },

  // ============================================================================
  // fx.vignette - Vignette effect options
  // ============================================================================
  {
    kind: "config-map",
    name: "fx.vignette",
    path: "fx.vignette",
    description: "Create a vignette effect (darkened edges).",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "intensity",
        type: "float | Signal",
        description: "Vignette intensity (how dark the edges are).",
        default: 0.3,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "smoothness",
        type: "float | Signal",
        description: "Edge smoothness (how gradual the falloff is).",
        default: 0.5,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "color",
        type: "Color",
        description: "Vignette color.",
        default: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      },
    ],
  },

  // ============================================================================
  // fx.distortion - Distortion effect options
  // ============================================================================
  {
    kind: "config-map",
    name: "fx.distortion",
    path: "fx.distortion",
    description: "Create a barrel/pincushion distortion effect.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "amount",
        type: "float | Signal",
        description: "Distortion amount (negative = pincushion, positive = barrel).",
        default: 0.0,
        range: { min: -1.0, max: 1.0 },
      },
      {
        name: "center",
        type: "Vec2",
        description: "Distortion center in normalized coordinates.",
        default: { x: 0.5, y: 0.5 },
      },
    ],
  },

  // ============================================================================
  // line.strip - Line strip options
  // ============================================================================
  {
    kind: "config-map",
    name: "line.strip",
    path: "line.strip",
    description: "Create a procedural line strip with manual push() control.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "max_points",
        type: "int",
        description: "Maximum number of points in the ring buffer.",
        default: 256,
        range: { min: 2, max: 10000 },
      },
      {
        name: "mode",
        type: '"line" | "points"',
        description: "Render mode: connected lines or individual points.",
        default: "line",
        enumValues: ["line", "points"],
      },
    ],
  },

  // ============================================================================
  // line.trace - Line trace options
  // ============================================================================
  {
    kind: "config-map",
    name: "line.trace",
    path: "line.trace",
    description: "Create a Signal-driven line that automatically plots values over time.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "max_points",
        type: "int",
        description: "Maximum number of points in the ring buffer.",
        default: 256,
        range: { min: 2, max: 10000 },
      },
      {
        name: "mode",
        type: '"line" | "points"',
        description: "Render mode: connected lines or individual points.",
        default: "line",
        enumValues: ["line", "points"],
      },
      {
        name: "x_scale",
        type: "float | Signal",
        description: "Scale factor for the time axis.",
        default: 1.0,
      },
      {
        name: "y_scale",
        type: "float | Signal",
        description: "Scale factor for signal values.",
        default: 1.0,
      },
      {
        name: "y_offset",
        type: "float | Signal",
        description: "Offset added to values before scaling.",
        default: 0.0,
      },
    ],
  },

  // ============================================================================
  // deform.twist - Twist deformation options
  // ============================================================================
  {
    kind: "config-map",
    name: "deform.twist",
    path: "deform.twist",
    description: "Apply a twist deformation around an axis.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis to twist around.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        name: "amount",
        type: "float | Signal",
        description: "Twist amount in radians.",
        default: 0.0,
      },
      {
        name: "center",
        type: "float | Signal",
        description: "Center point along the axis.",
        default: 0.0,
      },
    ],
  },

  // ============================================================================
  // deform.bend - Bend deformation options
  // ============================================================================
  {
    kind: "config-map",
    name: "deform.bend",
    path: "deform.bend",
    description: "Apply a bend deformation around an axis.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis to bend around.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        name: "amount",
        type: "float | Signal",
        description: "Bend amount.",
        default: 0.0,
      },
      {
        name: "center",
        type: "float | Signal",
        description: "Center point along the axis.",
        default: 0.0,
      },
    ],
  },

  // ============================================================================
  // deform.wave - Wave deformation options
  // ============================================================================
  {
    kind: "config-map",
    name: "deform.wave",
    path: "deform.wave",
    description: "Apply a wave deformation.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "axis",
        type: '"x" | "y" | "z"',
        description: "Axis along which the wave propagates.",
        default: "x",
        enumValues: ["x", "y", "z"],
      },
      {
        name: "direction",
        type: '"x" | "y" | "z"',
        description: "Displacement direction.",
        default: "y",
        enumValues: ["x", "y", "z"],
      },
      {
        name: "amplitude",
        type: "float | Signal",
        description: "Wave amplitude.",
        default: 0.1,
      },
      {
        name: "frequency",
        type: "float | Signal",
        description: "Wave frequency.",
        default: 1.0,
      },
      {
        name: "phase",
        type: "float | Signal",
        description: "Wave phase offset.",
        default: 0.0,
      },
    ],
  },

  // ============================================================================
  // deform.noise - Noise deformation options
  // ============================================================================
  {
    kind: "config-map",
    name: "deform.noise",
    path: "deform.noise",
    description: "Apply a noise-based displacement.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "scale",
        type: "float | Signal",
        description: "Noise scale (affects pattern size).",
        default: 1.0,
      },
      {
        name: "amplitude",
        type: "float | Signal",
        description: "Displacement amplitude.",
        default: 0.1,
      },
      {
        name: "seed",
        type: "int",
        description: "Random seed for reproducibility.",
        default: 0,
      },
    ],
  },

  // ============================================================================
  // signal.pick.events - Event extraction options
  // ============================================================================
  {
    kind: "config-map",
    name: "signal.pick.events",
    path: "signal.pick.events",
    description: "Extract events from a signal using peak-picking.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "hysteresis_beats",
        type: "float",
        description: "Minimum time between events in beats.",
        default: 0.25,
        range: { min: 0.0, max: 4.0 },
      },
      {
        name: "target_density",
        type: "float",
        description: "Target events per beat.",
        default: 1.0,
        range: { min: 0.1, max: 8.0 },
      },
      {
        name: "similarity_tolerance",
        type: "float",
        description: "Similarity clustering tolerance (0.0-1.0).",
        default: 0.15,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "phase_bias",
        type: "float",
        description: "Prefer on-beat events (0.0-1.0).",
        default: 0.0,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "min_threshold",
        type: "float",
        description: "Minimum absolute threshold.",
        default: 0.1,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "adaptive_factor",
        type: "float",
        description: "Adaptive threshold factor.",
        default: 0.5,
        range: { min: 0.0, max: 2.0 },
      },
      {
        name: "weight_mode",
        type: '"peak_height" | "integrated_energy"',
        description: "How to assign event weights.",
        default: "peak_height",
        enumValues: ["peak_height", "integrated_energy"],
      },
      {
        name: "energy_window_beats",
        type: "float",
        description: "If weight_mode is integrated_energy, integration window in beats.",
        default: 0.25,
        range: { min: 0.0, max: 2.0 },
      },
    ],
  },

  // ============================================================================
  // eventStream.to_signal - Event to signal conversion options
  // ============================================================================
  {
    kind: "config-map",
    name: "eventStream.to_signal",
    path: "eventStream.to_signal",
    description: "Convert events to a shaped signal.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "envelope",
        type: "string",
        description: "Envelope shape.",
        default: "impulse",
        enumValues: [
          "impulse",
          "step",
          "attack_decay",
          "adsr",
          "gaussian",
          "exponential_decay",
        ],
      },
      {
        name: "attack_beats",
        type: "float",
        description: "Attack in beats.",
        default: 0.1,
        range: { min: 0.0, max: 4.0 },
      },
      {
        name: "decay_beats",
        type: "float",
        description: "Decay in beats.",
        default: 0.5,
        range: { min: 0.0, max: 4.0 },
      },
      {
        name: "sustain_level",
        type: "float",
        description: "ADSR sustain level.",
        default: 0.7,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "sustain_beats",
        type: "float",
        description: "ADSR sustain time in beats.",
        default: 0.5,
        range: { min: 0.0, max: 4.0 },
      },
      {
        name: "release_beats",
        type: "float",
        description: "ADSR release in beats.",
        default: 0.3,
        range: { min: 0.0, max: 4.0 },
      },
      {
        name: "width_beats",
        type: "float",
        description: "Gaussian width in beats.",
        default: 0.25,
        range: { min: 0.0, max: 2.0 },
      },
      {
        name: "easing",
        type: "string",
        description: "Easing function.",
        default: "linear",
        enumValues: [
          "linear",
          "quadratic_in",
          "quadratic_out",
          "quadratic_in_out",
          "cubic_in",
          "cubic_out",
          "cubic_in_out",
          "exponential_in",
          "exponential_out",
          "smoothstep",
          "elastic",
        ],
      },
      {
        name: "overlap_mode",
        type: "string",
        description: "How to combine overlapping envelopes.",
        default: "sum",
        enumValues: ["sum", "max", "replace"],
      },
      {
        name: "group_within_beats",
        type: "float",
        description: "Group nearby events before shaping.",
        optional: true,
      },
      {
        name: "merge_mode",
        type: "string",
        description: "How to merge grouped events.",
        default: "sum",
        enumValues: ["sum", "max", "avg"],
      },
    ],
  },

  // ============================================================================
  // particles.from_events - Particle system from events options
  // ============================================================================
  {
    kind: "config-map",
    name: "particles.from_events",
    path: "particles.from_events",
    description: "Create a particle system driven by events.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "lifetime_beats",
        type: "float",
        description: "Particle lifespan in beats.",
        default: 1.0,
        range: { min: 0.1, max: 16.0 },
      },
      {
        name: "max_instances",
        type: "int",
        description: "Maximum particle count.",
        default: 256,
        range: { min: 1, max: 10000 },
      },
      {
        name: "color",
        type: "Color",
        description: "Base particle color.",
        default: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
      {
        name: "scale",
        type: "float | Signal",
        description: "Base scale.",
        default: 1.0,
      },
      {
        name: "geometry",
        type: '"point" | "billboard"',
        description: "Particle geometry type.",
        default: "billboard",
        enumValues: ["point", "billboard"],
      },
      {
        name: "point_size",
        type: "float | Signal",
        description: "Size for point geometry.",
        default: 4.0,
      },
      {
        name: "billboard_size",
        type: "float | Signal",
        description: "Size for billboard geometry.",
        default: 0.1,
      },
      {
        name: "envelope",
        type: "string",
        description: "Envelope shape over lifetime.",
        default: "impulse",
        enumValues: [
          "impulse",
          "step",
          "attack_decay",
          "adsr",
          "gaussian",
          "exponential_decay",
        ],
      },
      {
        name: "attack_beats",
        type: "float",
        description: "Attack duration.",
        default: 0.05,
      },
      {
        name: "decay_beats",
        type: "float",
        description: "Decay duration.",
        default: 0.5,
      },
      {
        name: "easing",
        type: "string",
        description: "Easing function.",
        default: "linear",
        enumValues: [
          "linear",
          "quadratic_in",
          "quadratic_out",
          "quadratic_in_out",
          "cubic_in",
          "cubic_out",
          "cubic_in_out",
          "exponential_in",
          "exponential_out",
          "smoothstep",
          "elastic",
        ],
      },
      {
        name: "spread",
        type: "Vec3",
        description: "Position spread (x, y, z).",
        default: { x: 0.0, y: 0.0, z: 0.0 },
      },
      {
        name: "scale_variation",
        type: "float",
        description: "Scale randomness.",
        default: 0.0,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "color_variation",
        type: "float",
        description: "Color randomness.",
        default: 0.0,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "rotation_variation",
        type: "float",
        description: "Rotation randomness (0-1).",
        default: 0.0,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "seed",
        type: "int",
        description: "Random seed for reproducibility.",
        default: 0,
      },
    ],
  },

  // ============================================================================
  // particles.stream - Continuous particle stream options
  // ============================================================================
  {
    kind: "config-map",
    name: "particles.stream",
    path: "particles.stream",
    description: "Create a continuous particle stream from a signal.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "mode",
        type: '"proportional" | "threshold"',
        description: "Emission mode.",
        default: "proportional",
        enumValues: ["proportional", "threshold"],
      },
      {
        name: "rate_per_beat",
        type: "float",
        description: "Particles per beat (proportional mode).",
        default: 4.0,
        range: { min: 0.1, max: 100.0 },
      },
      {
        name: "threshold",
        type: "float",
        description: "Trigger threshold (threshold mode).",
        default: 0.5,
        range: { min: 0.0, max: 1.0 },
      },
      {
        name: "instances_per_burst",
        type: "int",
        description: "Particles per trigger (threshold mode).",
        default: 1,
        range: { min: 1, max: 100 },
      },
      {
        name: "lifetime_beats",
        type: "float",
        description: "Particle lifespan in beats.",
        default: 1.0,
        range: { min: 0.1, max: 16.0 },
      },
      {
        name: "max_instances",
        type: "int",
        description: "Maximum particle count.",
        default: 256,
        range: { min: 1, max: 10000 },
      },
      {
        name: "color",
        type: "Color",
        description: "Base particle color.",
        default: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
      {
        name: "scale",
        type: "float | Signal",
        description: "Base scale.",
        default: 1.0,
      },
      {
        name: "geometry",
        type: '"point" | "billboard"',
        description: "Particle geometry type.",
        default: "billboard",
        enumValues: ["point", "billboard"],
      },
      {
        name: "spread",
        type: "Vec3",
        description: "Position spread (x, y, z).",
        default: { x: 0.0, y: 0.0, z: 0.0 },
      },
      {
        name: "seed",
        type: "int",
        description: "Random seed for reproducibility.",
        default: 0,
      },
    ],
  },

  // ============================================================================
  // radial.ring - Radial ring options
  // ============================================================================
  {
    kind: "config-map",
    name: "radial.ring",
    path: "radial.ring",
    description: "Options for creating a radial ring/arc mesh.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "radius",
        type: "float | Signal",
        description: "Distance from center to middle of ring.",
        default: 1.0,
        range: { min: 0.0, max: 100.0 },
      },
      {
        name: "thickness",
        type: "float | Signal",
        description: "Width of the ring (inner to outer edge).",
        default: 0.1,
        range: { min: 0.0, max: 10.0 },
      },
      {
        name: "start_angle",
        type: "float | Signal",
        description: "Starting angle in radians (0 = +X axis).",
        default: 0.0,
      },
      {
        name: "end_angle",
        type: "float | Signal",
        description: "Ending angle in radians (2π = full circle).",
        default: 6.283185,
      },
      {
        name: "segments",
        type: "int",
        description: "Number of segments around the arc. Higher = smoother.",
        default: 64,
        range: { min: 3, max: 256 },
      },
    ],
  },

  // ============================================================================
  // radial.wave - Radial wave options
  // ============================================================================
  {
    kind: "config-map",
    name: "radial.wave",
    path: "radial.wave",
    description: "Options for creating a radial wave.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "base_radius",
        type: "float | Signal",
        description: "Base radius of the wave.",
        default: 1.0,
        range: { min: 0.0, max: 100.0 },
      },
      {
        name: "amplitude",
        type: "float | Signal",
        description: "Amplitude of wave modulation.",
        default: 0.5,
        range: { min: 0.0, max: 10.0 },
      },
      {
        name: "wave_frequency",
        type: "float | Signal",
        description: "Number of wave cycles per revolution.",
        default: 4,
        range: { min: 1, max: 32 },
      },
      {
        name: "resolution",
        type: "int",
        description: "Number of line segments around the circle. Higher = smoother.",
        default: 128,
        range: { min: 16, max: 512 },
      },
    ],
  },

  // ============================================================================
  // points.cloud - Point cloud options
  // ============================================================================
  {
    kind: "config-map",
    name: "points.cloud",
    path: "points.cloud",
    description: "Options for creating a point cloud.",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "count",
        type: "int",
        description: "Number of points in the cloud.",
        default: 100,
        range: { min: 1, max: 10000 },
      },
      {
        name: "spread",
        type: "float | Signal",
        description: "Size of the distribution volume (cube half-extent or sphere radius).",
        default: 1.0,
        range: { min: 0.0, max: 100.0 },
      },
      {
        name: "mode",
        type: '"uniform" | "sphere"',
        description: "Distribution mode: 'uniform' (cube) or 'sphere'.",
        default: "uniform",
        enumValues: ["uniform", "sphere"],
      },
      {
        name: "seed",
        type: "int",
        description: "Random seed for deterministic point positions.",
        default: 0,
      },
      {
        name: "point_size",
        type: "float | Signal",
        description: "Size of each point in pixels.",
        default: 2.0,
        range: { min: 0.5, max: 32.0 },
      },
    ],
  },

  // ============================================================================
  // line.ribbon - Ribbon options
  // ============================================================================
  {
    kind: "config-map",
    name: "line.ribbon",
    path: "line.ribbon",
    description: "Options for creating a ribbon (thick extruded line).",
    properties: [],
    methods: [],
    configMapKeys: [
      {
        name: "max_points",
        type: "int",
        description: "Maximum number of points in the ribbon history.",
        default: 256,
        range: { min: 2, max: 4096 },
      },
      {
        name: "mode",
        type: '"strip" | "tube"',
        description: "Ribbon mode: 'strip' (flat ribbon) or 'tube' (cylindrical).",
        default: "strip",
        enumValues: ["strip", "tube"],
      },
      {
        name: "width",
        type: "float | Signal",
        description: "Width of the ribbon (or diameter for tube mode).",
        default: 0.1,
        range: { min: 0.001, max: 10.0 },
      },
      {
        name: "twist",
        type: "float | Signal",
        description: "Twist rate along the ribbon length (radians per unit distance).",
        default: 0.0,
        range: { min: -10.0, max: 10.0 },
      },
      {
        name: "tube_segments",
        type: "int",
        description: "Number of segments around the tube circumference (tube mode only).",
        default: 8,
        range: { min: 3, max: 32 },
      },
    ],
  },
];
