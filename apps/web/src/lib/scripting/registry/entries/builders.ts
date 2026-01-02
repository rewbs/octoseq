/**
 * Builder entries for the API registry.
 *
 * Builders provide fluent APIs for constructing complex configurations.
 */

import type { RegistryEntry } from "../types";

export const BUILDER_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // FeedbackBuilder - Fluent feedback configuration builder
  // ============================================================================
  {
    kind: "builder",
    name: "FeedbackBuilder",
    path: "FeedbackBuilder",
    description: "Fluent builder for feedback configurations.",
    properties: [
      {
        name: "warp",
        path: "FeedbackBuilder.warp",
        type: "WarpBuilder",
        description: "Warp operations namespace.",
        readonly: true,
      },
      {
        name: "color",
        path: "FeedbackBuilder.color",
        type: "ColorBuilder",
        description: "Color operations namespace.",
        readonly: true,
      },
      {
        name: "blend",
        path: "FeedbackBuilder.blend",
        type: "BlendBuilder",
        description: "Blend mode selection namespace.",
        readonly: true,
      },
    ],
    methods: [
      {
        name: "opacity",
        path: "FeedbackBuilder.opacity",
        description: "Set the feedback opacity (0-1).",
        params: [
          {
            name: "value",
            type: "float | Signal",
            description: "Opacity (0 = invisible, 1 = full).",
            range: { min: 0, max: 1 },
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".opacity(0.9)",
        notes: "Default is 0.8.",
      },
      {
        name: "build",
        path: "FeedbackBuilder.build",
        description: "Build the final feedback configuration.",
        params: [],
        returns: "FeedbackConfig",
        example: "let config = builder.build();",
      },
      {
        name: "sample_before_effects",
        path: "FeedbackBuilder.sample_before_effects",
        description: "Sample feedback before post-processing effects (default).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".sample_before_effects()",
        notes: "Feedback samples the raw scene render, before any post-FX are applied.",
      },
      {
        name: "sample_after_effects",
        path: "FeedbackBuilder.sample_after_effects",
        description: "Sample feedback after post-processing effects.",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".sample_after_effects()",
        notes: "Feedback samples the post-processed result, including bloom, color grading, etc.",
      },
    ],
  },

  // ============================================================================
  // WarpBuilder - Warp operations for feedback
  // ============================================================================
  {
    kind: "builder",
    name: "WarpBuilder",
    path: "WarpBuilder",
    description: "Warp operations (returned by builder.warp).",
    parent: "FeedbackBuilder",
    properties: [],
    methods: [
      {
        name: "spiral",
        path: "WarpBuilder.spiral",
        description: "Add a spiral warp (rotation + radial scaling).",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Warp intensity (0-1).",
            range: { min: 0, max: 1 },
          },
          {
            name: "rotation",
            type: "float | Signal",
            description: "Rotation per frame (radians).",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "2-arg",
        example: ".warp.spiral(0.5, 0.02)",
        notes: "Scale defaults to 1.0.",
      },
      {
        name: "spiral",
        path: "WarpBuilder.spiral",
        description: "Add a spiral warp with custom scale.",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Warp intensity.",
          },
          {
            name: "rotation",
            type: "float | Signal",
            description: "Rotation per frame.",
          },
          {
            name: "scale",
            type: "float | Signal",
            description: "Scale factor.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "3-arg",
        example: ".warp.spiral(0.5, 0.02, 1.01)",
      },
      {
        name: "radial",
        path: "WarpBuilder.radial",
        description: "Add a radial warp (expand/contract from center).",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Warp intensity.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "1-arg",
        example: ".warp.radial(0.3)",
      },
      {
        name: "radial",
        path: "WarpBuilder.radial",
        description: "Add a radial warp with custom scale.",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Warp intensity.",
          },
          {
            name: "scale",
            type: "float | Signal",
            description: "Scale factor.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "2-arg",
        example: ".warp.radial(0.3, 1.01)",
      },
      {
        name: "affine",
        path: "WarpBuilder.affine",
        description: "Add an affine warp (scale + rotation).",
        params: [
          {
            name: "scale",
            type: "float | Signal",
            description: "Scale factor.",
          },
          {
            name: "rotation",
            type: "float | Signal",
            description: "Rotation (radians).",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "2-arg",
        example: ".warp.affine(1.01, 0.02)",
      },
      {
        name: "affine",
        path: "WarpBuilder.affine",
        description: "Add an affine warp with translation.",
        params: [
          {
            name: "scale",
            type: "float | Signal",
            description: "Scale factor.",
          },
          {
            name: "rotation",
            type: "float | Signal",
            description: "Rotation (radians).",
          },
          {
            name: "tx",
            type: "float | Signal",
            description: "X translation.",
          },
          {
            name: "ty",
            type: "float | Signal",
            description: "Y translation.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        overloadId: "4-arg",
        example: ".warp.affine(1.0, 0.0, 0.01, 0.0)",
      },
      {
        name: "noise",
        path: "WarpBuilder.noise",
        description: "Add a noise displacement warp.",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Noise intensity.",
          },
          {
            name: "frequency",
            type: "float | Signal",
            description: "Noise frequency.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".warp.noise(0.5, 2.0)",
      },
      {
        name: "shear",
        path: "WarpBuilder.shear",
        description: "Add a shear warp.",
        params: [
          {
            name: "strength",
            type: "float | Signal",
            description: "Shear intensity.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".warp.shear(0.3)",
      },
    ],
  },

  // ============================================================================
  // ColorBuilder - Color operations for feedback
  // ============================================================================
  {
    kind: "builder",
    name: "ColorBuilder",
    path: "ColorBuilder",
    description: "Color operations (returned by builder.color).",
    parent: "FeedbackBuilder",
    properties: [],
    methods: [
      {
        name: "decay",
        path: "ColorBuilder.decay",
        description: "Add a decay effect (fade to black).",
        params: [
          {
            name: "rate",
            type: "float | Signal",
            description: "Decay rate (0.9=fast, 0.99=slow).",
            range: { min: 0, max: 1 },
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".color.decay(0.95)",
      },
      {
        name: "hsv",
        path: "ColorBuilder.hsv",
        description: "Add an HSV shift effect.",
        params: [
          {
            name: "h",
            type: "float | Signal",
            description: "Hue shift (0-1 = full rotation).",
          },
          {
            name: "s",
            type: "float | Signal",
            description: "Saturation shift.",
          },
          {
            name: "v",
            type: "float | Signal",
            description: "Value shift.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".color.hsv(0.01, 0.0, -0.02)",
      },
      {
        name: "posterize",
        path: "ColorBuilder.posterize",
        description: "Add a posterize effect (reduce color levels).",
        params: [
          {
            name: "levels",
            type: "float | Signal",
            description: "Number of levels (2-16 typical).",
            range: { min: 2, max: 256 },
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".color.posterize(8.0)",
      },
      {
        name: "channel_offset",
        path: "ColorBuilder.channel_offset",
        description: "Add a channel offset effect (RGB split).",
        params: [
          {
            name: "x",
            type: "float | Signal",
            description: "X offset amount.",
          },
          {
            name: "y",
            type: "float | Signal",
            description: "Y offset amount.",
          },
        ],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".color.channel_offset(0.5, 0.0)",
      },
    ],
  },

  // ============================================================================
  // BlendBuilder - Blend mode selection for feedback
  // ============================================================================
  {
    kind: "builder",
    name: "BlendBuilder",
    path: "BlendBuilder",
    description: "Blend mode selection (returned by builder.blend).",
    parent: "FeedbackBuilder",
    properties: [],
    methods: [
      {
        name: "alpha",
        path: "BlendBuilder.alpha",
        description: "Linear interpolation blend (default).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.alpha()",
      },
      {
        name: "add",
        path: "BlendBuilder.add",
        description: "Additive blend (good for trails).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.add()",
      },
      {
        name: "multiply",
        path: "BlendBuilder.multiply",
        description: "Multiplicative blend (darkens).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.multiply()",
      },
      {
        name: "screen",
        path: "BlendBuilder.screen",
        description: "Screen blend (brightens).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.screen()",
      },
      {
        name: "overlay",
        path: "BlendBuilder.overlay",
        description: "Overlay blend (contrast enhancement).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.overlay()",
      },
      {
        name: "difference",
        path: "BlendBuilder.difference",
        description: "Difference blend (psychedelic effects).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.difference()",
      },
      {
        name: "max",
        path: "BlendBuilder.max",
        description: "Maximum blend (brightest wins).",
        params: [],
        returns: "FeedbackBuilder",
        chainsTo: "FeedbackBuilder",
        example: ".blend.max()",
      },
    ],
  },
];
