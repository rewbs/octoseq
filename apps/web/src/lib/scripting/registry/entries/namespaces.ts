/**
 * Namespace entries for the API registry.
 *
 * These are the top-level global objects available in Rhai scripts:
 * mesh, line, scene, log, dbg, gen, inputs, feedback, fx, post, camera
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
      {
        name: "ribbon",
        path: "line.ribbon",
        description:
          "Create a ribbon (thick extruded line) from Signal history. Supports strip (flat) and tube (cylindrical) modes.",
        params: [
          {
            name: "signal",
            type: "Signal",
            description: "The Signal to trace. Evaluated each frame.",
          },
          {
            name: "options",
            type: "RibbonOptions",
            description: "Options map (max_points, mode, width, twist, tube_segments).",
          },
        ],
        returns: "RibbonEntity",
        chainsTo: "RibbonEntity",
        example: 'let ribbon = line.ribbon(inputs.amplitude, #{ width: 0.1, mode: "strip" });',
        notes:
          "Ribbon records signal values over time and extrudes them into a 3D path. Strip mode creates a flat ribbon; tube mode creates a cylindrical tube.",
      },
    ],
  },

  // ============================================================================
  // radial - Radial primitive factory namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "radial",
    path: "radial",
    description:
      "Radial primitive factory. Create ring and arc meshes in the XY plane.",
    properties: [],
    methods: [
      {
        name: "ring",
        path: "radial.ring",
        description:
          "Create a radial ring/arc mesh in the XY plane (facing +Z). Supports partial arcs and Signal-driven parameters.",
        params: [
          {
            name: "options",
            type: "RadialRingOptions",
            description: "Ring configuration options.",
          },
        ],
        returns: "MeshEntity",
        chainsTo: "MeshEntity",
        example: `let ring = radial.ring(#{
  radius: 2.0,
  thickness: 0.2,
  start_angle: 0.0,
  end_angle: 3.14159
});`,
        notes: "All numeric options (radius, thickness, angles) accept Signal | f32.",
      },
      {
        name: "wave",
        path: "radial.wave",
        description:
          "Create a signal-modulated radial wave. Renders as a closed circular line with radius varying based on the signal value.",
        params: [
          {
            name: "signal",
            type: "Signal",
            description: "The Signal to modulate the wave amplitude. Evaluated each frame.",
          },
          {
            name: "options",
            type: "RadialWaveOptions",
            description: "Wave configuration options.",
          },
        ],
        returns: "RadialWaveEntity",
        chainsTo: "RadialWaveEntity",
        example: `let wave = radial.wave(inputs.amplitude, #{
  base_radius: 1.0,
  amplitude: 0.5,
  wave_frequency: 4,
  resolution: 128
});`,
        notes: "radius(angle) = base_radius + amplitude * signal_value * sin(angle * wave_frequency)",
      },
    ],
  },

  // ============================================================================
  // points - Point cloud factory namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "points",
    path: "points",
    description:
      "Point cloud factory. Create GL point primitives with deterministic distribution.",
    properties: [],
    methods: [
      {
        name: "cloud",
        path: "points.cloud",
        description:
          "Create a point cloud with deterministic pseudo-random distribution. Points are rendered as GL points.",
        params: [
          {
            name: "options",
            type: "PointCloudOptions",
            description: "Point cloud configuration options.",
          },
        ],
        returns: "PointCloudEntity",
        chainsTo: "PointCloudEntity",
        example: `let cloud = points.cloud(#{
  count: 1000,
  spread: 2.0,
  mode: "sphere",
  seed: 42,
  point_size: 3.0
});`,
        notes: "Use 'seed' for deterministic positions. Modes: 'uniform' (cube), 'sphere'.",
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
  // timing - Time and musical timing signals
  // ============================================================================
  {
    kind: "namespace",
    name: "timing",
    path: "timing",
    description:
      "Time and musical timing signals. Available in both init() and update().",
    properties: [
      {
        name: "time",
        path: "timing.time",
        type: "Signal",
        description: "Playback time in seconds.",
        readonly: true,
      },
      {
        name: "dt",
        path: "timing.dt",
        type: "Signal",
        description: "Delta time in seconds.",
        readonly: true,
      },
      {
        name: "beatPosition",
        path: "timing.beatPosition",
        type: "Signal",
        description: "Continuous beat position (beatIndex + beatPhase).",
        readonly: true,
      },
      {
        name: "beatIndex",
        path: "timing.beatIndex",
        type: "Signal",
        description: "Current beat index (integer-valued).",
        readonly: true,
      },
      {
        name: "beatPhase",
        path: "timing.beatPhase",
        type: "Signal",
        description: "Phase within current beat (0-1).",
        readonly: true,
      },
      {
        name: "bpm",
        path: "timing.bpm",
        type: "Signal",
        description: "Tempo in beats per minute.",
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // inputs - Audio input signals namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "inputs",
    path: "inputs",
    description:
      "Audio input signals namespace. Contains mix (mixdown), stems, bands, and custom signals.",
    properties: [
      {
        name: "mix",
        path: "inputs.mix",
        type: "MixSignals",
        description: "Mixdown audio signals (rms, energy, centroid, flux, onset).",
        readonly: true,
      },
      {
        name: "stems",
        path: "inputs.stems",
        type: "Stems",
        description: 'Stem-scoped signal accessors: inputs.stems["Drums"].energy.',
        readonly: true,
      },
      {
        name: "customSignals",
        path: "inputs.customSignals",
        type: "CustomSignals",
        description: 'User-defined 1D signals: inputs.customSignals["mySignal"].',
        readonly: true,
      },
      {
        name: "customEvents",
        path: "inputs.customEvents",
        type: "CustomEvents",
        description: 'User-authored event streams: inputs.customEvents["beats"].',
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // inputs.mix - Mixdown audio signals
  // ============================================================================
  {
    kind: "namespace",
    name: "MixSignals",
    path: "inputs.mix",
    description:
      "Mixdown (full mix) audio signal accessors.",
    properties: [
      {
        name: "rms",
        path: "inputs.mix.rms",
        type: "Signal",
        description: "RMS amplitude (normalized 0-1).",
        readonly: true,
      },
      {
        name: "energy",
        path: "inputs.mix.energy",
        type: "Signal",
        description: "Audio energy level.",
        readonly: true,
      },
      {
        name: "centroid",
        path: "inputs.mix.centroid",
        type: "Signal",
        description: "Spectral centroid (brightness).",
        readonly: true,
      },
      {
        name: "flux",
        path: "inputs.mix.flux",
        type: "Signal",
        description: "Spectral flux (rate of spectral change).",
        readonly: true,
      },
      {
        name: "onset",
        path: "inputs.mix.onset",
        type: "Signal",
        description: "Onset detection envelope.",
        readonly: true,
      },
      {
        name: "searchSimilarity",
        path: "inputs.mix.searchSimilarity",
        type: "Signal",
        description: "Search similarity curve (0-1).",
        readonly: true,
      },
      {
        name: "harmonic",
        path: "inputs.mix.harmonic",
        type: "Signal",
        description: "CQT harmonic energy - measures tonal presence vs noise (0-1).",
        readonly: true,
      },
      {
        name: "bassMotion",
        path: "inputs.mix.bassMotion",
        type: "Signal",
        description: "CQT bass pitch motion - measures bassline activity and low-end groove.",
        readonly: true,
      },
      {
        name: "tonal",
        path: "inputs.mix.tonal",
        type: "Signal",
        description: "CQT tonal stability - measures harmonic stability vs modulation (0-1).",
        readonly: true,
      },
      {
        name: "bands",
        path: "inputs.mix.bands",
        type: "Bands",
        description: 'Frequency band signals: inputs.mix.bands["Bass"].energy.',
        readonly: true,
      },
      {
        name: "beatCandidates",
        path: "inputs.mix.beatCandidates",
        type: "EventStream",
        description: "Beat candidate events extracted from the mixdown.",
        readonly: true,
      },
      {
        name: "onsetPeaks",
        path: "inputs.mix.onsetPeaks",
        type: "EventStream",
        description: "Onset peak events extracted from the mixdown.",
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
      {
        name: "zoomWrap",
        path: "fx.zoomWrap",
        description: "Create a zoom effect with edge wrapping.",
        params: [
          {
            name: "options",
            type: "ZoomWrapOptions",
            description: "Zoom with wrap parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: 'let zoom = fx.zoomWrap(#{ amount: 0.99, wrap_mode: "mirror" });',
        notes: "Parameters: amount (0.5-2.0, <1 = zoom in), center {x, y}, wrap_mode.",
      },
      {
        name: "radialBlur",
        path: "fx.radialBlur",
        description: "Create a radial motion blur effect.",
        params: [
          {
            name: "options",
            type: "RadialBlurOptions",
            description: "Radial blur parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let blur = fx.radialBlur(#{ strength: 0.3, samples: 16 });",
        notes: "Parameters: strength (0-1), center {x, y}, samples (2-32).",
      },
      {
        name: "directionalBlur",
        path: "fx.directionalBlur",
        description: "Create a directional motion blur effect.",
        params: [
          {
            name: "options",
            type: "DirectionalBlurOptions",
            description: "Directional blur parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let blur = fx.directionalBlur(#{ amount: 5.0, angle: 0.0 });",
        notes: "Parameters: amount (0-20 px), angle (radians), samples (2-32).",
      },
      {
        name: "chromaticAberration",
        path: "fx.chromaticAberration",
        description: "Create a chromatic aberration (RGB split) effect.",
        params: [
          {
            name: "options",
            type: "ChromaticAberrationOptions",
            description: "Chromatic aberration parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let aberr = fx.chromaticAberration(#{ amount: 2.0 });",
        notes: "Parameters: amount (0-10), angle (radians).",
      },
      {
        name: "grain",
        path: "fx.grain",
        description: "Create a deterministic film grain noise effect.",
        params: [
          {
            name: "options",
            type: "GrainOptions",
            description: "Grain parameters.",
          },
        ],
        returns: "PostEffect",
        chainsTo: "PostEffect",
        example: "let grain = fx.grain(#{ amount: 0.03, seed: 42 });",
        notes: "Parameters: amount (0-0.5), scale (0.1-10), seed (int).",
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

  // ============================================================================
  // camera - Camera control namespace (global singleton)
  // ============================================================================
  {
    kind: "namespace",
    name: "camera",
    path: "camera",
    description:
      "Camera control singleton. Controls view position, orientation, and projection. Supports signal-binding for audio-reactive camera motion.",
    properties: [
      {
        name: "position",
        path: "camera.position",
        type: "Map { x, y, z }",
        description:
          "Camera position in world space. Each component accepts Signal | f32.",
        readonly: false,
      },
      {
        name: "rotation",
        path: "camera.rotation",
        type: "Map { x, y, z }",
        description:
          "Euler rotation (pitch, yaw, roll) in radians. Used when target is not set.",
        readonly: false,
      },
      {
        name: "target",
        path: "camera.target",
        type: "Map { x, y, z } | ()",
        description:
          "Look-at target position. Set to enable LookAt mode; () for Euler mode.",
        readonly: false,
      },
      {
        name: "up",
        path: "camera.up",
        type: "Map { x, y, z }",
        description: "Up vector for LookAt mode. Default: (0, 1, 0).",
        readonly: false,
      },
      {
        name: "fov",
        path: "camera.fov",
        type: "Signal | f32",
        description: "Field of view in degrees. Default: 45.",
        readonly: false,
      },
      {
        name: "near",
        path: "camera.near",
        type: "Signal | f32",
        description: "Near clip plane. Default: 0.1.",
        readonly: false,
      },
      {
        name: "far",
        path: "camera.far",
        type: "Signal | f32",
        description: "Far clip plane. Default: 100.0.",
        readonly: false,
      },
    ],
    methods: [
      {
        name: "lookAt",
        path: "camera.lookAt",
        description:
          "Set camera to look at a target position (enables LookAt mode).",
        params: [
          {
            name: "target",
            type: "Map { x, y, z }",
            description: "Target position to look at.",
          },
        ],
        returns: "void",
        example: "camera.lookAt(#{ x: 0.0, y: 0.0, z: 0.0 });",
      },
      {
        name: "orbit",
        path: "camera.orbit",
        description:
          "Position camera on a circular orbit around a center point.",
        params: [
          {
            name: "center",
            type: "Map { x, y, z }",
            description: "Center point to orbit around.",
          },
          {
            name: "radius",
            type: "Signal | f32",
            description: "Distance from center.",
          },
          {
            name: "angle",
            type: "Signal | f32",
            description: "Angle in radians around Y-axis.",
          },
        ],
        returns: "void",
        example: "camera.orbit(#{ x: 0.0, y: 0.0, z: 0.0 }, 5.0, time.seconds * 0.5);",
      },
      {
        name: "dolly",
        path: "camera.dolly",
        description:
          "Move camera forward/backward along view direction. Works in both Euler and LookAt modes.",
        params: [
          {
            name: "distance",
            type: "f32",
            description:
              "How far to move (positive = forward, negative = backward).",
          },
        ],
        returns: "void",
        example: "camera.dolly(2.0);",
      },
      {
        name: "pan",
        path: "camera.pan",
        description: "Move camera laterally (left/right, up/down).",
        params: [
          {
            name: "dx",
            type: "f32",
            description: "Horizontal movement (positive = right).",
          },
          {
            name: "dy",
            type: "f32",
            description: "Vertical movement (positive = up).",
          },
        ],
        returns: "void",
        example: "camera.pan(1.0, 0.5);",
      },
    ],
  },

  // ============================================================================
  // lighting - Global lighting control namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "lighting",
    path: "lighting",
    description:
      "Global lighting control singleton. Configures directional light, ambient, and rim lighting. All numeric properties accept Signal | f32 for audio-reactive lighting.",
    properties: [
      {
        name: "enabled",
        path: "lighting.enabled",
        type: "bool",
        description:
          "Enable/disable global lighting. When false, all objects render unlit (flat colors). Default: false.",
        readonly: false,
      },
      {
        name: "direction",
        path: "lighting.direction",
        type: "Map { x, y, z }",
        description:
          "Light direction vector. Points FROM the light. Each component accepts Signal | f32. Default: (0, -1, 0) (light from above).",
        readonly: false,
      },
      {
        name: "intensity",
        path: "lighting.intensity",
        type: "Signal | f32",
        description:
          "Light intensity multiplier. Default: 1.0.",
        readonly: false,
      },
      {
        name: "color",
        path: "lighting.color",
        type: "Map { r, g, b }",
        description:
          "Light color (RGB, 0-1 range). Each component accepts Signal | f32. Default: (1, 1, 1) white.",
        readonly: false,
      },
      {
        name: "ambient",
        path: "lighting.ambient",
        type: "Signal | f32",
        description:
          "Ambient light intensity. Fills in shadowed areas. Default: 0.3.",
        readonly: false,
      },
      {
        name: "rim_intensity",
        path: "lighting.rim_intensity",
        type: "Signal | f32",
        description:
          "Rim lighting intensity. Highlights edges facing away from camera. Default: 0.0.",
        readonly: false,
      },
      {
        name: "rim_power",
        path: "lighting.rim_power",
        type: "Signal | f32",
        description:
          "Rim lighting falloff power. Higher = sharper rim. Default: 2.0.",
        readonly: false,
      },
    ],
    methods: [],
  },
];
