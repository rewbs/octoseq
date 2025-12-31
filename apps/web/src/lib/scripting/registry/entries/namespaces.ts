/**
 * Namespace entries for the API registry.
 *
 * These are the top-level global objects available in Rhai scripts:
 * mesh, line, scene, log, dbg, gen, inputs, feedback, fx, post
 */

import type { RegistryEntry } from "../types";

export const NAMESPACE_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // mesh - Mesh factory namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "mesh",
    path: "mesh",
    description: "Mesh factory namespace. Create mesh entities (cube, plane).",
    properties: [],
    methods: [
      {
        name: "cube",
        path: "mesh.cube",
        description: "Create a cube mesh entity.",
        params: [],
        returns: "MeshEntity",
        chainsTo: "MeshEntity",
        example: "let cube = mesh.cube();",
      },
      {
        name: "plane",
        path: "mesh.plane",
        description: "Create a plane mesh entity.",
        params: [],
        returns: "MeshEntity",
        chainsTo: "MeshEntity",
        example: "let ground = mesh.plane();",
      },
    ],
  },

  // ============================================================================
  // line - Line factory namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "line",
    path: "line",
    description:
      "Line factory namespace. Create line strips (manual push) or traces (Signal-driven).",
    properties: [],
    methods: [
      {
        name: "strip",
        path: "line.strip",
        description: "Create a procedural line strip with manual push() control.",
        params: [
          {
            name: "options",
            type: "LineStripOptions",
            description: "Options map (optional keys: max_points, mode).",
          },
        ],
        returns: "LineStripEntity",
        chainsTo: "LineStripEntity",
        example: 'let spark = line.strip(#{ max_points: 256, mode: "line" });',
        notes: 'Defaults: max_points=256, mode="line".',
      },
      {
        name: "trace",
        path: "line.trace",
        description: "Create a Signal-driven line that automatically plots values over time.",
        params: [
          {
            name: "signal",
            type: "Signal",
            description: "The Signal to trace. Evaluated each frame.",
          },
          {
            name: "options",
            type: "LineTraceOptions",
            description: "Options map (max_points, mode, x_scale, y_scale, y_offset).",
          },
        ],
        returns: "LineTraceEntity",
        chainsTo: "LineTraceEntity",
        example: "let trace = line.trace(inputs.amplitude, #{ max_points: 256 });",
        notes: "Plots (time * x_scale, (value + y_offset) * y_scale) each frame.",
      },
    ],
  },

  // ============================================================================
  // scene - Scene management namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "scene",
    path: "scene",
    description: "Scene management namespace. Add/remove entities for rendering.",
    properties: [],
    methods: [
      {
        name: "add",
        path: "scene.add",
        description: "Add an entity to the render list.",
        params: [
          {
            name: "entity",
            type: "MeshEntity | LineStripEntity | LineTraceEntity",
            description: "Entity to render.",
          },
        ],
        returns: "void",
        example: "scene.add(cube);",
      },
      {
        name: "remove",
        path: "scene.remove",
        description: "Remove an entity from the render list.",
        params: [
          {
            name: "entity",
            type: "MeshEntity | LineStripEntity | LineTraceEntity",
            description: "Entity to stop rendering.",
          },
        ],
        returns: "void",
        example: "scene.remove(cube);",
      },
    ],
  },

  // ============================================================================
  // log - Logging namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "log",
    path: "log",
    description: "Script logging namespace. Use for non-fatal debugging output.",
    properties: [],
    methods: [
      {
        name: "info",
        path: "log.info",
        description: "Log an info message.",
        params: [
          {
            name: "value",
            type: "any",
            description: "Value to log.",
          },
        ],
        returns: "void",
        example: 'log.info("hello");',
        notes: "Log volume is limited per frame.",
      },
      {
        name: "warn",
        path: "log.warn",
        description: "Log a warning message.",
        params: [
          {
            name: "value",
            type: "any",
            description: "Value to log.",
          },
        ],
        returns: "void",
        example: 'log.warn("careful");',
        notes: "Log volume is limited per frame.",
      },
      {
        name: "error",
        path: "log.error",
        description: "Log an error message.",
        params: [
          {
            name: "value",
            type: "any",
            description: "Value to log.",
          },
        ],
        returns: "void",
        example: 'log.error("oops");',
        notes: "Log volume is limited per frame.",
      },
    ],
  },

  // ============================================================================
  // dbg - Debug namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "dbg",
    path: "dbg",
    description: "Debug and inspection namespace.",
    properties: [],
    methods: [
      {
        name: "emit",
        path: "dbg.emit",
        description: "Emit a named debug signal value (analysis mode only).",
        params: [
          {
            name: "name",
            type: "string",
            description: "Signal name to record.",
          },
          {
            name: "value",
            type: "float",
            description: "Numeric value to record.",
          },
        ],
        returns: "void",
        example: 'dbg.emit("energy", 0.5);',
        notes: "In playback mode this is a no-op.",
      },
      {
        name: "listMaterials",
        path: "dbg.listMaterials",
        description: "List all available material IDs.",
        params: [],
        returns: "array<string>",
        example: "log.info(dbg.listMaterials());",
      },
      {
        name: "describeMaterial",
        path: "dbg.describeMaterial",
        description: "Get detailed information about a material.",
        params: [
          {
            name: "id",
            type: "string",
            description: "Material ID.",
          },
        ],
        returns: "Map",
        example: 'log.info(dbg.describeMaterial("emissive"));',
        notes: "Returns {name, blend_mode, params: [{name, type}]}.",
      },
      {
        name: "listEffects",
        path: "dbg.listEffects",
        description: "List all available post-processing effect IDs.",
        params: [],
        returns: "array<string>",
        example: "log.info(dbg.listEffects());",
      },
      {
        name: "describeEffect",
        path: "dbg.describeEffect",
        description: "Get detailed information about a post-processing effect.",
        params: [
          {
            name: "id",
            type: "string",
            description: "Effect ID.",
          },
        ],
        returns: "Map",
        example: 'log.info(dbg.describeEffect("bloom"));',
        notes: "Returns {name, description, params: [{name, type, description}]}.",
      },
    ],
  },

  // ============================================================================
  // gen - Signal generator namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "gen",
    path: "gen",
    description: "Signal generator namespace (beat-synced oscillators and noise).",
    properties: [],
    methods: [
      {
        name: "sin",
        path: "gen.sin",
        description: "Sine wave oscillator synced to beats.",
        params: [
          {
            name: "freq_beats",
            type: "float",
            description: "Frequency in cycles per beat.",
          },
          {
            name: "phase",
            type: "float",
            description: "Phase offset.",
            optional: true,
            default: 0.0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let s = gen.sin(1.0, 0.0);",
      },
      {
        name: "square",
        path: "gen.square",
        description: "Square wave oscillator.",
        params: [
          {
            name: "freq_beats",
            type: "float",
            description: "Frequency in cycles per beat.",
          },
          {
            name: "phase",
            type: "float",
            description: "Phase offset.",
            optional: true,
            default: 0.0,
          },
          {
            name: "duty",
            type: "float",
            description: "Duty cycle (0.0-1.0).",
            optional: true,
            default: 0.5,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let s = gen.square(1.0, 0.0, 0.5);",
      },
      {
        name: "triangle",
        path: "gen.triangle",
        description: "Triangle wave oscillator synced to beats.",
        params: [
          {
            name: "freq_beats",
            type: "float",
            description: "Frequency in cycles per beat.",
          },
          {
            name: "phase",
            type: "float",
            description: "Phase offset.",
            optional: true,
            default: 0.0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let s = gen.triangle(1.0, 0.0);",
      },
      {
        name: "saw",
        path: "gen.saw",
        description: "Sawtooth oscillator synced to beats.",
        params: [
          {
            name: "freq_beats",
            type: "float",
            description: "Frequency in cycles per beat.",
          },
          {
            name: "phase",
            type: "float",
            description: "Phase offset.",
            optional: true,
            default: 0.0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let s = gen.saw(1.0, 0.0);",
      },
      {
        name: "noise",
        path: "gen.noise",
        description: "Noise generator (white or pink).",
        params: [
          {
            name: "noise_type",
            type: '"white" | "pink"',
            description: "Noise type.",
            enumValues: ["white", "pink"],
            default: "white",
          },
          {
            name: "seed",
            type: "int",
            description: "Deterministic seed.",
            optional: true,
            default: 0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: 'let n = gen.noise("pink", 42);',
      },
      {
        name: "perlin",
        path: "gen.perlin",
        description: "1D Perlin noise synced to beats.",
        params: [
          {
            name: "scale_beats",
            type: "float",
            description: "Scale in beats.",
          },
          {
            name: "seed",
            type: "int",
            description: "Deterministic seed.",
            optional: true,
            default: 0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let n = gen.perlin(1.0, 42);",
      },
      {
        name: "constant",
        path: "gen.constant",
        description: "Constant-valued signal.",
        params: [
          {
            name: "value",
            type: "float",
            description: "Constant value.",
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "let one = gen.constant(1.0);",
      },
    ],
  },

  // ============================================================================
  // inputs - Signal accessors namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "inputs",
    path: "inputs",
    description:
      "Signal accessors namespace. Properties return Signal objects. Available in both init() and update().",
    properties: [
      {
        name: "time",
        path: "inputs.time",
        type: "Signal",
        description: "Playback time in seconds.",
        readonly: true,
      },
      {
        name: "dt",
        path: "inputs.dt",
        type: "Signal",
        description: "Delta time in seconds.",
        readonly: true,
      },
      {
        name: "amplitude",
        path: "inputs.amplitude",
        type: "Signal",
        description: "Audio amplitude (normalized).",
        readonly: true,
      },
      {
        name: "flux",
        path: "inputs.flux",
        type: "Signal",
        description: "Spectral flux (alias for spectralFlux).",
        readonly: true,
      },
      {
        name: "spectralCentroid",
        path: "inputs.spectralCentroid",
        type: "Signal",
        description: "Spectral centroid (brightness).",
        readonly: true,
      },
      {
        name: "spectralFlux",
        path: "inputs.spectralFlux",
        type: "Signal",
        description: "Spectral flux (rate of spectral change).",
        readonly: true,
      },
      {
        name: "onsetEnvelope",
        path: "inputs.onsetEnvelope",
        type: "Signal",
        description: "Onset detection envelope.",
        readonly: true,
      },
      {
        name: "searchSimilarity",
        path: "inputs.searchSimilarity",
        type: "Signal",
        description: "Search similarity curve (0-1).",
        readonly: true,
      },
      {
        name: "beatPosition",
        path: "inputs.beatPosition",
        type: "Signal",
        description: "Continuous beat position (beatIndex + beatPhase).",
        readonly: true,
      },
      {
        name: "beatIndex",
        path: "inputs.beatIndex",
        type: "Signal",
        description: "Current beat index (integer-valued).",
        readonly: true,
      },
      {
        name: "beatPhase",
        path: "inputs.beatPhase",
        type: "Signal",
        description: "Phase within current beat (0-1).",
        readonly: true,
      },
      {
        name: "bpm",
        path: "inputs.bpm",
        type: "Signal",
        description: "Tempo in beats per minute.",
        readonly: true,
      },
      {
        name: "bands",
        path: "inputs.bands",
        type: "Bands",
        description: 'Band-scoped signal accessors: inputs.bands["Bass"].energy.',
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // feedback - Frame feedback namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "feedback",
    path: "feedback",
    description:
      "Frame feedback namespace for Milkdrop-style temporal visual effects (trails, warping).",
    properties: [],
    methods: [
      {
        name: "builder",
        path: "feedback.builder",
        description: "Create a new feedback configuration builder.",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: "let fb = feedback.builder().warp.spiral(0.5, 0.02).build();",
      },
      {
        name: "enable",
        path: "feedback.enable",
        description: "Enable feedback with a configuration.",
        params: [
          {
            name: "config",
            type: "FeedbackConfig",
            description: "Feedback configuration from builder.build().",
          },
        ],
        returns: "void",
        example: "feedback.enable(fb);",
      },
      {
        name: "disable",
        path: "feedback.disable",
        description: "Disable feedback effects.",
        params: [],
        returns: "void",
        example: "feedback.disable();",
      },
      {
        name: "is_enabled",
        path: "feedback.is_enabled",
        description: "Check if feedback is currently enabled.",
        params: [],
        returns: "bool",
        example: "if feedback.is_enabled() { ... }",
      },
    ],
  },

  // ============================================================================
  // fx - Post-processing effect factory namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "fx",
    path: "fx",
    description:
      "Post-processing effect factory. Create composable visual effects (bloom, color grading, vignette, distortion).",
    properties: [],
    methods: [
      {
        name: "bloom",
        path: "fx.bloom",
        description: "Create a bloom effect (glow on bright areas).",
        params: [
          {
            name: "options",
            type: "BloomOptions",
            description: "Bloom parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let bloom = fx.bloom(#{ threshold: 0.7, intensity: 0.5 });",
        notes: "Parameters: threshold (0-1), intensity (0-1), radius (px).",
      },
      {
        name: "colorGrade",
        path: "fx.colorGrade",
        description: "Create a color grading effect.",
        params: [
          {
            name: "options",
            type: "ColorGradeOptions",
            description: "Color grading parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let grade = fx.colorGrade(#{ contrast: 1.1, saturation: 1.2 });",
        notes: "Parameters: brightness, contrast, saturation, gamma, tint.",
      },
      {
        name: "vignette",
        path: "fx.vignette",
        description: "Create a vignette effect (darkened edges).",
        params: [
          {
            name: "options",
            type: "VignetteOptions",
            description: "Vignette parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let vig = fx.vignette(#{ intensity: 0.3, smoothness: 0.5 });",
        notes: "Parameters: intensity (0-1), smoothness (0-1), color.",
      },
      {
        name: "distortion",
        path: "fx.distortion",
        description: "Create a distortion effect (barrel/pincushion).",
        params: [
          {
            name: "options",
            type: "DistortionOptions",
            description: "Distortion parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let dist = fx.distortion(#{ amount: 0.1 });",
        notes: "Parameters: amount (-1 to 1), center {x, y}.",
      },
    ],
  },

  // ============================================================================
  // post - Post-processing chain management namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "post",
    path: "post",
    description: "Post-processing chain management. Add/remove/reorder effects in the render pipeline.",
    properties: [],
    methods: [
      {
        name: "add",
        path: "post.add",
        description: "Add an effect to the post-processing chain.",
        params: [
          {
            name: "effect",
            type: "PostEffect",
            description: "Effect to add.",
          },
        ],
        returns: "void",
        example: "post.add(bloom);",
      },
      {
        name: "remove",
        path: "post.remove",
        description: "Remove an effect from the post-processing chain.",
        params: [
          {
            name: "effect",
            type: "PostEffect",
            description: "Effect to remove.",
          },
        ],
        returns: "void",
        example: "post.remove(bloom);",
      },
      {
        name: "clear",
        path: "post.clear",
        description: "Clear all effects from the chain.",
        params: [],
        returns: "void",
        example: "post.clear();",
      },
      {
        name: "setOrder",
        path: "post.setOrder",
        description: "Reorder effects in the chain.",
        params: [
          {
            name: "order",
            type: "array<int>",
            description: "Effect IDs in desired order.",
          },
        ],
        returns: "void",
        example: "post.setOrder([bloom.__id, grade.__id]);",
      },
    ],
  },

  // ============================================================================
  // deform - Deformation descriptor namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "deform",
    path: "deform",
    description: "Mesh deformation descriptors. Create deformation effects to apply to meshes.",
    properties: [],
    methods: [
      {
        name: "twist",
        path: "deform.twist",
        description: "Apply a twist deformation around an axis.",
        params: [
          {
            name: "options",
            type: "TwistOptions",
            description: "Twist options (axis, amount, center).",
          },
        ],
        returns: "DeformDescriptor",
        example: 'let tw = deform.twist(#{ axis: "y", amount: 0.5 });',
      },
      {
        name: "bend",
        path: "deform.bend",
        description: "Apply a bend deformation around an axis.",
        params: [
          {
            name: "options",
            type: "BendOptions",
            description: "Bend options (axis, amount, center).",
          },
        ],
        returns: "DeformDescriptor",
        example: 'let bd = deform.bend(#{ axis: "x", amount: 0.3 });',
      },
      {
        name: "wave",
        path: "deform.wave",
        description: "Apply a wave deformation.",
        params: [
          {
            name: "options",
            type: "WaveOptions",
            description: "Wave options (axis, direction, amplitude, frequency, phase).",
          },
        ],
        returns: "DeformDescriptor",
        example: 'let wv = deform.wave(#{ axis: "x", direction: "y", amplitude: 0.1 });',
      },
      {
        name: "noise",
        path: "deform.noise",
        description: "Apply a noise-based displacement.",
        params: [
          {
            name: "options",
            type: "NoiseOptions",
            description: "Noise options (scale, amplitude, seed).",
          },
        ],
        returns: "DeformDescriptor",
        example: "let ns = deform.noise(#{ scale: 1.0, amplitude: 0.1 });",
      },
    ],
  },
];
