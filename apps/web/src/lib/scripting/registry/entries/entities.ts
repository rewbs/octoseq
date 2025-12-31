/**
 * Entity entries for the API registry.
 *
 * Entities are scene objects like meshes, lines, and particle systems.
 */

import type { RegistryEntry } from "../types";

export const ENTITY_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // MeshEntity - Mesh entity
  // ============================================================================
  {
    kind: "type",
    name: "MeshEntity",
    path: "MeshEntity",
    description: "A mesh entity created by mesh.cube() or mesh.plane().",
    properties: [
      {
        name: "position",
        path: "MeshEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "MeshEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "MeshEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "MeshEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "material",
        path: "MeshEntity.material",
        type: "string",
        description:
          'Material ID (e.g., "default", "emissive", "wire_glow", "soft_additive", "gradient").',
      },
      {
        name: "params",
        path: "MeshEntity.params",
        type: "MaterialParams",
        description: "Material parameters map. Keys depend on the selected material.",
      },
      {
        name: "color",
        path: "MeshEntity.color",
        type: "Color",
        description: "Entity color (RGBA 0.0-1.0). Channels can be Signals.",
      },
      {
        name: "deformations",
        path: "MeshEntity.deformations",
        type: "array<DeformDescriptor>",
        description: "Array of deformation descriptors to apply.",
      },
    ],
    methods: [],
  },

  // ============================================================================
  // LineStripEntity - Procedural line strip
  // ============================================================================
  {
    kind: "type",
    name: "LineStripEntity",
    path: "LineStripEntity",
    description: "A procedural line strip created by line.strip(options).",
    properties: [
      {
        name: "position",
        path: "LineStripEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "LineStripEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "LineStripEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "LineStripEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "LineStripEntity.color",
        type: "Color",
        description: "Line color.",
      },
    ],
    methods: [
      {
        name: "push",
        path: "LineStripEntity.push",
        description: "Add a 2D point to the strip.",
        params: [
          { name: "x", type: "float", description: "X coordinate." },
          { name: "y", type: "float", description: "Y coordinate." },
        ],
        returns: "void",
        example: "spark.push(inputs.time, inputs.amplitude);",
        notes: "Points are stored in a ring buffer (oldest points are overwritten when full).",
      },
      {
        name: "clear",
        path: "LineStripEntity.clear",
        description: "Clear all points from the strip.",
        params: [],
        returns: "void",
        example: "spark.clear();",
      },
    ],
  },

  // ============================================================================
  // LineTraceEntity - Signal-driven line trace
  // ============================================================================
  {
    kind: "type",
    name: "LineTraceEntity",
    path: "LineTraceEntity",
    description: "A Signal-driven line created by line.trace(signal, options).",
    properties: [
      {
        name: "position",
        path: "LineTraceEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "LineTraceEntity.rotation",
        type: "Vec3",
        description: "Euler angles in radians.",
      },
      {
        name: "scale",
        path: "LineTraceEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "LineTraceEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "LineTraceEntity.color",
        type: "Color",
        description: "RGBA color (0.0-1.0 range). Channels can be Signals.",
      },
    ],
    methods: [
      {
        name: "clear",
        path: "LineTraceEntity.clear",
        description: "Clear all points from the trace.",
        params: [],
        returns: "void",
        example: "trace.clear();",
      },
    ],
  },

  // ============================================================================
  // PostEffect - Post-processing effect instance
  // ============================================================================
  {
    kind: "type",
    name: "PostEffect",
    path: "PostEffect",
    description: "A post-processing effect instance. Properties can be modified dynamically.",
    properties: [
      {
        name: "enabled",
        path: "PostEffect.enabled",
        type: "bool",
        description: "Enable/disable the effect.",
      },
      {
        name: "__id",
        path: "PostEffect.__id",
        type: "int",
        description: "Internal effect ID (for ordering).",
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // ParticleSystemHandle - Particle system
  // ============================================================================
  {
    kind: "type",
    name: "ParticleSystemHandle",
    path: "ParticleSystemHandle",
    description: "A handle to a particle system created by particles.from_events or particles.stream.",
    properties: [
      {
        name: "visible",
        path: "ParticleSystemHandle.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "position",
        path: "ParticleSystemHandle.position",
        type: "Vec3",
        description: "Base position (x, y, z).",
      },
      {
        name: "color",
        path: "ParticleSystemHandle.color",
        type: "Color",
        description: "Base color (r, g, b, a).",
      },
      {
        name: "scale",
        path: "ParticleSystemHandle.scale",
        type: "float | Signal",
        description: "Uniform scale.",
      },
    ],
    methods: [
      {
        name: "instance_count",
        path: "ParticleSystemHandle.instance_count",
        description: "Get active particle count.",
        params: [],
        returns: "int",
        example: "let n = particles.instance_count();",
      },
      {
        name: "reset",
        path: "ParticleSystemHandle.reset",
        description: "Clear all particles.",
        params: [],
        returns: "void",
        example: "particles.reset();",
      },
    ],
  },

  // ============================================================================
  // DeformDescriptor - Deformation descriptor (opaque)
  // ============================================================================
  {
    kind: "type",
    name: "DeformDescriptor",
    path: "DeformDescriptor",
    description: "A deformation descriptor created by deform.twist, deform.bend, etc.",
    properties: [],
    methods: [],
  },

  // ============================================================================
  // MaterialParams - Material parameters map
  // ============================================================================
  {
    kind: "type",
    name: "MaterialParams",
    path: "MaterialParams",
    description:
      "Material parameters map. Keys and types depend on the selected material. Use dbg.describeMaterial() to see available parameters.",
    properties: [],
    methods: [],
  },

  // ============================================================================
  // FeedbackConfig - Feedback configuration
  // ============================================================================
  {
    kind: "type",
    name: "FeedbackConfig",
    path: "FeedbackConfig",
    description: "Feedback configuration (result of builder.build()).",
    properties: [],
    methods: [],
  },
];
