/**
 * Primitive type entries for the API registry.
 *
 * Basic value types: Vec2, Vec3, Color
 */

import type { RegistryEntry } from "../types";

export const PRIMITIVE_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // Vec2 - 2D vector
  // ============================================================================
  {
    kind: "type",
    name: "Vec2",
    path: "Vec2",
    description: "2D vector (x, y).",
    properties: [
      {
        name: "x",
        path: "Vec2.x",
        type: "float",
        description: "X component.",
      },
      {
        name: "y",
        path: "Vec2.y",
        type: "float",
        description: "Y component.",
      },
    ],
    methods: [],
    example: "let v = #{ x: 0.5, y: 0.5 };",
  },

  // ============================================================================
  // Vec3 - 3D vector
  // ============================================================================
  {
    kind: "type",
    name: "Vec3",
    path: "Vec3",
    description: "3D vector (x, y, z).",
    properties: [
      {
        name: "x",
        path: "Vec3.x",
        type: "float | Signal",
        description: "X component.",
      },
      {
        name: "y",
        path: "Vec3.y",
        type: "float | Signal",
        description: "Y component.",
      },
      {
        name: "z",
        path: "Vec3.z",
        type: "float | Signal",
        description: "Z component.",
      },
    ],
    methods: [],
    example: "cube.position.x = 1.0;",
  },

  // ============================================================================
  // Color - RGBA color
  // ============================================================================
  {
    kind: "type",
    name: "Color",
    path: "Color",
    description: "RGBA color (0.0-1.0).",
    properties: [
      {
        name: "r",
        path: "Color.r",
        type: "float | Signal",
        description: "Red (0.0-1.0).",
        range: { min: 0, max: 1 },
      },
      {
        name: "g",
        path: "Color.g",
        type: "float | Signal",
        description: "Green (0.0-1.0).",
        range: { min: 0, max: 1 },
      },
      {
        name: "b",
        path: "Color.b",
        type: "float | Signal",
        description: "Blue (0.0-1.0).",
        range: { min: 0, max: 1 },
      },
      {
        name: "a",
        path: "Color.a",
        type: "float | Signal",
        description: "Alpha (0.0-1.0).",
        range: { min: 0, max: 1 },
      },
    ],
    methods: [],
    example: "cube.color.r = inputs.amplitude;",
  },
];
